'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const {
  createAdminAccount,
  openDatabase,
  updateAdminPassword,
  verifyPassword
} = require('./database');
const { createServer } = require('./server');

let server;
let baseUrl;
let testDirectory;
let databaseFile;
let adminCookie;
const adminEmail = 'admin@fcai.local';
const adminPassword = 'Test-Admin-Password-2026!';

async function startServer() {
  server = createServer({ databaseFile });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function api(url, options = {}, cookie = '') {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  return fetch(`${baseUrl}/api/v1${url}`, { ...options, headers });
}

async function adminLogin() {
  const response = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  });
  assert.equal(response.status, 200);
  adminCookie = response.headers.get('set-cookie').split(';')[0];
  return response.json();
}

before(async () => {
  testDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'fcai-backend-test-'));
  databaseFile = path.join(testDirectory, 'fcai.sqlite');
  const database = openDatabase({ filename: databaseFile });
  createAdminAccount(database, adminEmail, adminPassword);
  database.close();
  await startServer();
});

after(async () => {
  await stopServer();
  await fs.rm(testDirectory, { recursive: true, force: true });
});

test('health endpoint and seeded content are served from SQLite', async () => {
  const health = await api('/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const names = ['news', 'projects', 'library', 'gallery', 'timetables'];
  const values = await Promise.all(names.map(async name => {
    const response = await api(`/${name}`);
    assert.equal(response.status, 200, `${name} should be available`);
    return response.json();
  }));
  assert.ok(values[0].length > 0);
  assert.ok(values[1].length >= 10);
  assert.ok(values[2].length >= 10);
  assert.ok(values[3].length >= 11);
  assert.deepEqual(
    values[3].map(item => item[0]).filter(key => ['auditorium', 'computer_lab', 'classroom'].includes(key)).sort(),
    ['auditorium', 'classroom', 'computer_lab']
  );
  assert.ok(Array.isArray(values[4].S));
});

test('changing an admin password hashes it and revokes existing sessions', () => {
  const database = openDatabase({ filename: ':memory:' });
  try {
    const id = createAdminAccount(database, 'owner@example.test', 'Initial-Admin-Password-2026');
    database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run('session-hash', id, Date.now() + 60_000);
    assert.equal(updateAdminPassword(database, 'owner@example.test', 'Replacement-Admin-Password-2026'), id);
    const admin = database.prepare('SELECT password_salt, password_hash FROM users WHERE id = ?').get(id);
    assert.equal(verifyPassword('Replacement-Admin-Password-2026', admin.password_salt, admin.password_hash), true);
    assert.equal(verifyPassword('Initial-Admin-Password-2026', admin.password_salt, admin.password_hash), false);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
    assert.throws(() => updateAdminPassword(database, 'owner@example.test', 'too-short'), /at least|between/);
  } finally {
    database.close();
  }
});

test('administrator uses an HttpOnly cookie and can review requests and demo complaints', async () => {
  assert.equal((await api('/admin/submissions')).status, 401);
  const result = await adminLogin();
  assert.equal(result.user.role, 'admin');
  assert.match(adminCookie, /^fcai_session=/);

  const cookieHeader = (await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  })).headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);

  const identity = await api('/auth/me', {}, adminCookie);
  assert.equal((await identity.json()).role, 'admin');
  const requests = await api('/admin/submissions', {}, adminCookie);
  assert.deepEqual(await requests.json(), []);
  const complaints = await api('/admin/complaints', {}, adminCookie);
  const rows = await complaints.json();
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.demo));
});

test('student accounts require approval and students cannot access admin data', async () => {
  const registration = await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Student',
      email: 'student@example.test',
      studentId: 'ST-42',
      department: 'Computer Science',
      password: 'Student-password-2026'
    })
  });
  assert.equal(registration.status, 201);
  const created = await registration.json();
  assert.equal(created.status, 'pending');

  const pendingLogin = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@example.test', password: 'Student-password-2026' })
  });
  assert.equal(pendingLogin.status, 403);

  const users = await (await api('/admin/users', {}, adminCookie)).json();
  const student = users.find(user => user.id === created.id);
  assert.equal(student.status, 'pending');
  const approved = await api(`/admin/users/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' })
  }, adminCookie);
  assert.equal(approved.status, 200);

  const signedIn = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'student@example.test', password: 'Student-password-2026' })
  });
  assert.equal(signedIn.status, 200);
  const studentCookie = signedIn.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('/admin/submissions', {}, studentCookie)).status, 403);
  assert.deepEqual(await (await api('/student/submissions', {}, studentCookie)).json(), []);
  assert.equal((await api('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Student',
      email: 'student@example.test',
      studentId: 'ST-42',
      department: 'Computer Science',
      password: 'Student-password-2026'
    })
  })).status, 409);
});

test('request and complaint records are persisted and their statuses are admin-only', async () => {
  const invalid = await api('/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'null'
  });
  assert.equal(invalid.status, 400);

  const createdResponse = await api('/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'training',
      name: 'Test Student',
      email: 'student@example.test',
      studentId: 'ST-42',
      department: 'Computer Science',
      message: 'A sample internship application for the dashboard.'
    })
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.status, 'new');

  const denied = await api(`/admin/submissions/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' })
  });
  assert.equal(denied.status, 401);

  const statusResponse = await api(`/admin/submissions/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress' })
  }, adminCookie);
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).status, 'in_progress');

  const complaintResponse = await api('/complaints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'suggestion',
      name: 'Another Student',
      email: 'student2@example.test',
      message: 'Please add more references to the e-library.'
    })
  });
  assert.equal(complaintResponse.status, 201);
  const complaint = await complaintResponse.json();
  const complaintUpdate = await api(`/admin/complaints/${complaint.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'resolved' })
  }, adminCookie);
  assert.equal(complaintUpdate.status, 200);
  assert.equal((await complaintUpdate.json()).status, 'resolved');
  assert.equal((await api('/admin/submissions', {}, adminCookie)).status, 200);
});

test('administrator content updates are protected and served through the public API', async () => {
  assert.equal((await api('/admin/content')).status, 401);
  const update = await api('/admin/content/news', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: [{ en: 'Updated', ar: 'محدث' }] })
  }, adminCookie);
  assert.equal(update.status, 200);
  assert.deepEqual(await (await api('/news')).json(), [{ en: 'Updated', ar: 'محدث' }]);
});

test('cross-origin state-changing requests are rejected', async () => {
  const response = await api('/registrations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({
      kind: 'contact',
      name: 'Test Student',
      email: 'student@example.test',
      message: 'A test message to check cross-origin protections.'
    })
  });
  assert.equal(response.status, 403);
});

test('logout revokes the persisted session, and server restart preserves the database', async () => {
  const logout = await api('/auth/logout', { method: 'POST' }, adminCookie);
  assert.equal(logout.status, 200);
  assert.equal((await api('/admin/submissions', {}, adminCookie)).status, 401);

  await stopServer();
  await startServer();
  const result = await adminLogin();
  assert.equal(result.user.role, 'admin');
  const requests = await api('/admin/submissions', {}, adminCookie);
  const rows = await requests.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'in_progress');
  assert.ok((await fs.stat(databaseFile)).size > 0);
});

test('static delivery includes security headers and hides backend files', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<main id="app"><\/main>/);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(page.headers.get('permissions-policy'), /camera=\(\)/);

  assert.equal((await fetch(`${baseUrl}/backend/server.js`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/backend/data/fcai.sqlite`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/js/backend-ui.js`)).status, 200);
});

test('trusted HTTPS proxy enables secure session cookies and HSTS', async () => {
  const previousTrustProxy = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  try {
    const response = await api('/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: baseUrl.replace('http:', 'https:'),
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-For': '192.0.2.10'
      },
      body: JSON.stringify({ email: adminEmail, password: adminPassword })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /; Secure/);

    const page = await fetch(baseUrl, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.equal(page.headers.get('strict-transport-security'), 'max-age=31536000');
  } finally {
    if (previousTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = previousTrustProxy;
  }
});

test('public registration and submission endpoints apply per-client rate limits', async () => {
  const limitedServer = createServer({
    databaseFile: path.join(testDirectory, 'rate-limit.sqlite')
  });
  await new Promise(resolve => limitedServer.listen(0, '127.0.0.1', resolve));
  const limitedBaseUrl = `http://127.0.0.1:${limitedServer.address().port}/api/v1`;
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${limitedBaseUrl}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null'
      });
      assert.equal(response.status, 400);
    }
    const limitedSubmission = await fetch(`${limitedBaseUrl}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    });
    assert.equal(limitedSubmission.status, 429);
    assert.ok(Number(limitedSubmission.headers.get('retry-after')) > 0);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await fetch(`${limitedBaseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unknown@example.test', password: 'not-the-password' })
      });
      assert.equal(response.status, 401);
    }
    const limitedLogin = await fetch(`${limitedBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@example.test', password: 'not-the-password' })
    });
    assert.equal(limitedLogin.status, 429);
  } finally {
    await new Promise((resolve, reject) => {
      limitedServer.close(error => error ? reject(error) : resolve());
    });
  }
});
