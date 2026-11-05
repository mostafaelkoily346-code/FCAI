'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DATABASE_FILE = path.join(__dirname, 'data', 'fcai.sqlite');
const CONTENT_KEYS = ['news', 'projects', 'library', 'gallery', 'timetables'];
const PASSWORD_BYTES = 64;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, PASSWORD_BYTES, { maxmem: 128 * 1024 * 1024 });
  return { salt, hash: hash.toString('hex') };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, PASSWORD_BYTES, { maxmem: 128 * 1024 * 1024 });
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function readSeed(seedDirectory, name) {
  return JSON.parse(fs.readFileSync(path.join(seedDirectory, `${name}.json`), 'utf8'));
}

function openDatabase({ filename = DEFAULT_DATABASE_FILE, seedDirectory = path.join(__dirname, 'data') } = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });

  const database = new DatabaseSync(filename);
  if (filename !== ':memory:' && process.platform !== 'win32') {
    fs.chmodSync(filename, 0o600);
  }
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'student')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'blocked')),
      student_id TEXT UNIQUE,
      department TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('training', 'contact', 'complaint', 'suggestion')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      student_id TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('new', 'in_progress', 'resolved')),
      created_at TEXT NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0, 1))
    );
    CREATE INDEX IF NOT EXISTS submissions_kind_created
      ON submissions(kind, created_at DESC);

    CREATE TABLE IF NOT EXISTS content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const insertContent = database.prepare(
    'INSERT OR IGNORE INTO content (key, value, updated_at) VALUES (?, ?, ?)'
  );
  const now = new Date().toISOString();
  for (const key of CONTENT_KEYS) {
    insertContent.run(key, JSON.stringify(readSeed(seedDirectory, key)), now);
  }

  const insertComplaint = database.prepare(`
    INSERT OR IGNORE INTO submissions
      (id, kind, name, email, student_id, department, message, status, created_at, demo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const item of readSeed(seedDirectory, 'complaints')) {
    insertComplaint.run(
      item.id,
      item.kind,
      item.name,
      item.email,
      item.studentId || '',
      item.department || '',
      item.message,
      item.status,
      item.createdAt
    );
  }

  return database;
}

function createAdminAccount(database, email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid admin email');
  if (password.length < 16) throw new Error('Admin password must contain at least 16 characters');
  if (database.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('admin')) {
    throw new Error('An admin account already exists; use the existing account instead');
  }

  const { salt, hash } = hashPassword(password);
  const result = database.prepare(`
    INSERT INTO users (email, name, password_salt, password_hash, role, status, created_at)
    VALUES (?, ?, ?, ?, 'admin', 'active', ?)
  `).run(email.trim().toLowerCase(), 'Project administrator', salt, hash, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function updateAdminPassword(database, email, password) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid admin email');
  if (password.length < 16 || password.length > 128) {
    throw new Error('Admin password must contain between 16 and 128 characters');
  }
  const user = database.prepare('SELECT id FROM users WHERE email = ? AND role = ?')
    .get(email.trim().toLowerCase(), 'admin');
  if (!user) throw new Error('No admin account exists for this email');

  const { salt, hash } = hashPassword(password);
  database.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?')
    .run(salt, hash, user.id);
  database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  return Number(user.id);
}

module.exports = {
  CONTENT_KEYS,
  DEFAULT_DATABASE_FILE,
  createAdminAccount,
  hashPassword,
  openDatabase,
  updateAdminPassword,
  verifyPassword
};
