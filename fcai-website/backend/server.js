'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { CONTENT_KEYS, openDatabase, hashPassword, verifyPassword } = require('./database');

const ROOT = path.resolve(__dirname, '..');
const API_PREFIX = '/api/v1';
const SESSION_COOKIE = 'fcai_session';
const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(Object.assign(new Error('Request body is too large'), { status: 413 }));
        return;
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('Expected a JSON object');
        }
        resolve(body);
      } catch {
        reject(Object.assign(new Error('Expected a JSON request body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function getCookie(req, name) {
  const cookies = (req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const index = cookie.indexOf('=');
    if (index >= 0 && cookie.slice(0, index).trim() === name) {
      return decodeURIComponent(cookie.slice(index + 1).trim());
    }
  }
  return '';
}

function toPublicUser(user) {
  return {
    id: Number(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    studentId: user.student_id || '',
    department: user.department || '',
    createdAt: user.created_at
  };
}

function checkOrigin(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    const expectedProtocol = isSecureRequest(req) ? 'https:' : 'http:';
    return origin.host === req.headers.host && origin.protocol === expectedProtocol;
  } catch {
    return false;
  }
}

function isSecureRequest(req) {
  const forwardedProtocol = req.headers['x-forwarded-proto']?.split(',')[0].trim();
  return Boolean(req.socket.encrypted) ||
    (process.env.TRUST_PROXY === '1' && forwardedProtocol === 'https');
}

function getClientAddress(req) {
  if (process.env.TRUST_PROXY === '1') {
    const forwardedFor = req.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string') {
      const address = forwardedFor.split(',')[0].trim();
      if (address && address.length <= 100) return address;
    }
  }
  return req.socket.remoteAddress || 'unknown';
}

function consumeRateLimit(limits, key, maxRequests, windowMs, now = Date.now()) {
  let record = limits.get(key);
  if (!record || record.resetAt <= now) {
    if (limits.size >= MAX_RATE_LIMIT_ENTRIES) {
      for (const [entryKey, entry] of limits) {
        if (entry.resetAt <= now) limits.delete(entryKey);
      }
      while (limits.size >= MAX_RATE_LIMIT_ENTRIES) {
        limits.delete(limits.keys().next().value);
      }
    }
    record = { count: 0, resetAt: now + windowMs };
    limits.set(key, record);
  }
  if (record.count >= maxRequests) {
    return Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  }
  record.count += 1;
  return 0;
}

function rateLimitResponse(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  sendJson(res, 429, { error: 'Too many requests. Try again later.' });
}

function makeSession(database, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + SESSION_LIFETIME;
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, expiresAt);
  return { token, expiresAt };
}

function currentUser(req, database) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = database.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(tokenHash, Date.now());
  if (!session) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return session;
}

function setSessionCookie(res, token, req) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME / 1000}${secure}`);
}

function clearSessionCookie(res, req) {
  const secure = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

function createServer({ databaseFile, seedDirectory } = {}) {
  const database = openDatabase({ filename: databaseFile, seedDirectory });
  const attempts = new Map();

  async function handleApi(req, res, pathname) {
    if (!checkOrigin(req)) {
      sendJson(res, 403, { error: 'Cross-origin request rejected' });
      return;
    }

    if (pathname === `${API_PREFIX}/health`) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      database.prepare('SELECT 1').get();
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname === `${API_PREFIX}/auth/register`) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const retryAfter = consumeRateLimit(
        attempts, `register:${getClientAddress(req)}`, 10, 60 * 60 * 1000
      );
      if (retryAfter) {
        rateLimitResponse(res, retryAfter);
        return;
      }
      const body = await readBody(req);
      const student = {
        name: typeof body.name === 'string' ? body.name.trim() : '',
        email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
        studentId: typeof body.studentId === 'string' ? body.studentId.trim() : '',
        department: typeof body.department === 'string' ? body.department.trim() : '',
        password: typeof body.password === 'string' ? body.password : ''
      };
      if (student.name.length < 2 || student.name.length > 120 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email) || student.email.length > 200 ||
          student.studentId.length < 2 || student.studentId.length > 40 ||
          student.department.length > 120 || student.password.length < 12 ||
          student.password.length > 128) {
        sendJson(res, 400, { error: 'Provide a valid name, email, student ID, department, and password of at least 12 characters' });
        return;
      }
      const { salt, hash } = hashPassword(student.password);
      try {
        const result = database.prepare(`
          INSERT INTO users
            (email, name, password_salt, password_hash, role, status, student_id, department, created_at)
          VALUES (?, ?, ?, ?, 'student', 'pending', ?, ?, ?)
        `).run(student.email, student.name, salt, hash, student.studentId, student.department, new Date().toISOString());
        sendJson(res, 201, { id: Number(result.lastInsertRowid), status: 'pending' });
      } catch (error) {
        if (error.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE' ||
            error.errcode === 2067 || error.errcode === 1555) {
          sendJson(res, 409, { error: 'An account with this email or student ID already exists' });
          return;
        }
        throw error;
      }
      return;
    }

    if (pathname === `${API_PREFIX}/auth/login`) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const client = getClientAddress(req);
      const now = Date.now();
      const loginKey = `login:${client}`;
      const retryAfter = attempts.get(loginKey)?.resetAt;
      if (retryAfter && retryAfter <= now) attempts.delete(loginKey);
      const currentAttempt = attempts.get(loginKey);
      if (currentAttempt && currentAttempt.count >= 8) {
        rateLimitResponse(res, Math.max(1, Math.ceil((currentAttempt.resetAt - now) / 1000)));
        return;
      }

      const body = await readBody(req);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (email.length > 200 || password.length > 128) {
        sendJson(res, 401, { error: 'Invalid email or password' });
        return;
      }
      const user = database.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const passwordMatches = user ? verifyPassword(password, user.password_salt, user.password_hash) : false;
      if (!user || !passwordMatches) {
        const failed = attempts.get(loginKey);
        if (failed) failed.count += 1;
        else consumeRateLimit(attempts, loginKey, 8, 15 * 60 * 1000, now);
        sendJson(res, 401, { error: 'Invalid email or password' });
        return;
      }
      if (user.status !== 'active') {
        sendJson(res, 403, { error: user.status === 'pending' ? 'Account is awaiting administrator approval' : 'Account is blocked' });
        return;
      }
      attempts.delete(loginKey);
      database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      const session = makeSession(database, user.id);
      setSessionCookie(res, session.token, req);
      sendJson(res, 200, { user: toPublicUser(user) });
      return;
    }

    if (pathname === `${API_PREFIX}/auth/me`) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const user = currentUser(req, database);
      if (!user || user.status !== 'active') {
        sendJson(res, 401, { error: 'Unauthorized' });
        return;
      }
      sendJson(res, 200, toPublicUser(user));
      return;
    }

    if (pathname === `${API_PREFIX}/auth/logout`) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const token = getCookie(req, SESSION_COOKIE);
      if (token) {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      }
      clearSessionCookie(res, req);
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname === `${API_PREFIX}/admin/submissions` ||
        pathname === `${API_PREFIX}/admin/complaints`) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const user = currentUser(req, database);
      if (!user || user.role !== 'admin' || user.status !== 'active') {
        sendJson(res, user ? 403 : 401, { error: user ? 'Admin role required' : 'Unauthorized' });
        return;
      }
      const kinds = pathname.endsWith('/complaints')
        ? ['complaint', 'suggestion']
        : ['training', 'contact'];
      const rows = database.prepare(`
        SELECT id, kind, name, email, student_id AS studentId, department, message, status,
          created_at AS createdAt, demo
        FROM submissions WHERE kind IN (?, ?) ORDER BY created_at DESC
      `).all(...kinds);
      sendJson(res, 200, rows.map(row => ({ ...row, demo: Boolean(row.demo) })));
      return;
    }

    if (pathname === `${API_PREFIX}/admin/users`) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const user = currentUser(req, database);
      if (!user || user.role !== 'admin' || user.status !== 'active') {
        sendJson(res, user ? 403 : 401, { error: user ? 'Admin role required' : 'Unauthorized' });
        return;
      }
      const users = database.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
      sendJson(res, 200, users.map(toPublicUser));
      return;
    }

    const userMatch = pathname.match(new RegExp(`^${API_PREFIX}/admin/users/(\\d+)$`));
    if (userMatch) {
      if (req.method !== 'PATCH') {
        res.setHeader('Allow', 'PATCH');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const admin = currentUser(req, database);
      if (!admin || admin.role !== 'admin' || admin.status !== 'active') {
        sendJson(res, admin ? 403 : 401, { error: admin ? 'Admin role required' : 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      if (!['pending', 'active', 'blocked'].includes(body.status)) {
        sendJson(res, 400, { error: 'Invalid account status' });
        return;
      }
      const target = database.prepare('SELECT * FROM users WHERE id = ?').get(Number(userMatch[1]));
      if (!target) {
        sendJson(res, 404, { error: 'User not found' });
        return;
      }
      if (target.role === 'admin') {
        sendJson(res, 400, { error: 'Admin accounts cannot be changed here' });
        return;
      }
      database.prepare('UPDATE users SET status = ? WHERE id = ?').run(body.status, target.id);
      database.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      sendJson(res, 200, toPublicUser({ ...target, status: body.status }));
      return;
    }

    if (pathname === `${API_PREFIX}/admin/content`) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const user = currentUser(req, database);
      if (!user || user.role !== 'admin' || user.status !== 'active') {
        sendJson(res, user ? 403 : 401, { error: user ? 'Admin role required' : 'Unauthorized' });
        return;
      }
      const items = database.prepare('SELECT key, value, updated_at AS updatedAt FROM content').all();
      sendJson(res, 200, Object.fromEntries(items.map(item => [
        item.key,
        { value: JSON.parse(item.value), updatedAt: item.updatedAt }
      ])));
      return;
    }

    const contentMatch = pathname.match(new RegExp(`^${API_PREFIX}/admin/content/([a-z]+)$`));
    if (contentMatch) {
      if (req.method !== 'PUT') {
        res.setHeader('Allow', 'PUT');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const admin = currentUser(req, database);
      if (!admin || admin.role !== 'admin' || admin.status !== 'active') {
        sendJson(res, admin ? 403 : 401, { error: admin ? 'Admin role required' : 'Unauthorized' });
        return;
      }
      const key = contentMatch[1];
      if (!CONTENT_KEYS.includes(key)) {
        sendJson(res, 404, { error: 'Unknown content collection' });
        return;
      }
      const body = await readBody(req);
      if (!Object.hasOwn(body, 'value') ||
          (!Array.isArray(body.value) && (typeof body.value !== 'object' || body.value === null))) {
        sendJson(res, 400, { error: 'Content value must be an array or object' });
        return;
      }
      const updatedAt = new Date().toISOString();
      database.prepare(`
        INSERT INTO content (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, JSON.stringify(body.value), updatedAt);
      sendJson(res, 200, { key, value: body.value, updatedAt });
      return;
    }

    const submissionMatch = pathname.match(new RegExp(`^${API_PREFIX}/admin/(submissions|complaints)/([\\w-]+)$`));
    if (submissionMatch) {
      if (req.method !== 'PATCH') {
        res.setHeader('Allow', 'PATCH');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const admin = currentUser(req, database);
      if (!admin || admin.role !== 'admin' || admin.status !== 'active') {
        sendJson(res, admin ? 403 : 401, { error: admin ? 'Admin role required' : 'Unauthorized' });
        return;
      }
      const body = await readBody(req);
      if (!['new', 'in_progress', 'resolved'].includes(body.status)) {
        sendJson(res, 400, { error: 'Invalid submission status' });
        return;
      }
      const kinds = submissionMatch[1] === 'complaints'
        ? ['complaint', 'suggestion']
        : ['training', 'contact'];
      const update = database.prepare(`
        UPDATE submissions SET status = ?
        WHERE id = ? AND kind IN (?, ?)
      `).run(body.status, submissionMatch[2], ...kinds);
      if (!update.changes) {
        sendJson(res, 404, { error: 'Submission not found' });
        return;
      }
      const saved = database.prepare(`
        SELECT id, kind, name, email, student_id AS studentId, department, message, status,
          created_at AS createdAt, demo
        FROM submissions WHERE id = ?
      `).get(submissionMatch[2]);
      sendJson(res, 200, { ...saved, demo: Boolean(saved.demo) });
      return;
    }

    if (pathname === `${API_PREFIX}/student/submissions`) {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const user = currentUser(req, database);
      if (!user || user.role !== 'student' || user.status !== 'active') {
        sendJson(res, user ? 403 : 401, { error: user ? 'Active student account required' : 'Unauthorized' });
        return;
      }
      const rows = database.prepare(`
        SELECT id, kind, status, created_at AS createdAt
        FROM submissions WHERE email = ? ORDER BY created_at DESC
      `).all(user.email);
      sendJson(res, 200, rows);
      return;
    }

    if (pathname === `${API_PREFIX}/complaints` || pathname === `${API_PREFIX}/registrations`) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const retryAfter = consumeRateLimit(
        attempts, `submission:${getClientAddress(req)}`, 20, 60 * 60 * 1000
      );
      if (retryAfter) {
        rateLimitResponse(res, retryAfter);
        return;
      }
      const isComplaintEndpoint = pathname.endsWith('/complaints');
      const body = await readBody(req);
      const submission = {
        name: typeof body.name === 'string' ? body.name.trim() : '',
        email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
        studentId: typeof body.studentId === 'string' ? body.studentId.trim() : '',
        department: typeof body.department === 'string' ? body.department.trim() : '',
        message: typeof body.message === 'string' ? body.message.trim() : ''
      };
      const validKind = isComplaintEndpoint
        ? ['complaint', 'suggestion'].includes(body.kind)
        : ['training', 'contact'].includes(body.kind);
      if (!validKind || submission.name.length < 2 || submission.name.length > 120 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.email) || submission.email.length > 200 ||
          submission.studentId.length > 40 || submission.department.length > 120 ||
          submission.message.length < 10 || submission.message.length > 2000) {
        sendJson(res, 400, { error: 'Provide valid contact details and a message of 10 to 2000 characters' });
        return;
      }
      const id = `${isComplaintEndpoint ? 'CMP' : 'REQ'}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      const createdAt = new Date().toISOString();
      database.prepare(`
        INSERT INTO submissions
          (id, kind, name, email, student_id, department, message, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)
      `).run(id, body.kind, submission.name, submission.email, submission.studentId,
        submission.department, submission.message, createdAt);
      sendJson(res, 201, { id, status: 'new', createdAt });
      return;
    }

    if (req.method === 'GET') {
      const key = pathname.slice(API_PREFIX.length + 1);
      if (CONTENT_KEYS.includes(key)) {
        const item = database.prepare('SELECT value FROM content WHERE key = ?').get(key);
        sendJson(res, 200, JSON.parse(item.value));
        return;
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    if (/^\/backend(?:\/|$)/i.test(pathname) || pathname.split('/').some(part => part.startsWith('.'))) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(ROOT, relativePath);
    const relativeToRoot = path.relative(ROOT, filePath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    try {
      const content = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        ...(isSecureRequest(req) ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'"
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }
      throw error;
    }
  }

  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      sendJson(res, 400, { error: 'Invalid URL' });
      return;
    }
    const handler = pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)
      ? handleApi(req, res, pathname)
      : handleStatic(req, res, pathname);
    handler.catch(error => {
      if (!error.status || error.status >= 500) console.error('[server] request failed:', error.message);
      if (!res.headersSent) sendJson(res, error.status || 500, {
        error: error.status ? error.message : 'Internal server error'
      });
      else res.destroy();
    });
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.on('close', () => database.close());
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error('Node.js 22.13 or newer is required for the built-in SQLite support');
  }
  if (process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY !== '1') {
    throw new Error('Production requires a trusted HTTPS reverse proxy and TRUST_PROXY=1');
  }
  const server = createServer();
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => {
    console.log(`FCAI website server listening at http://${host}:${port}`);
  });
  process.once('SIGINT', () => server.close());
  process.once('SIGTERM', () => server.close());
}

module.exports = { createServer };
