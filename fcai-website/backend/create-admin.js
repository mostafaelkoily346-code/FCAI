'use strict';

const crypto = require('node:crypto');
const { createAdminAccount, DEFAULT_DATABASE_FILE, openDatabase } = require('./database');

function getEmail(args) {
  const index = args.indexOf('--email');
  return index < 0 ? null : args[index + 1];
}

function main() {
  const email = getEmail(process.argv.slice(2)) || 'admin@fcai.local';
  const password = crypto.randomBytes(24).toString('base64url');
  const database = openDatabase();
  try {
    const userId = createAdminAccount(database, email, password);
    console.log(`Admin account created (user id ${userId}). Save this password now; it cannot be recovered.`);
    console.log(`Email: ${email.trim().toLowerCase()}`);
    console.log(`Password: ${password}`);
    console.log(`Database: ${DEFAULT_DATABASE_FILE}`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`[admin setup] ${error.message}`);
  process.exitCode = 1;
}
