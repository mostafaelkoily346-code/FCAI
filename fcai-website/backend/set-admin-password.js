'use strict';

const { DEFAULT_DATABASE_FILE, openDatabase, updateAdminPassword } = require('./database');

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal so the password can be entered privately'));
  }

  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const finish = (error, result) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(result);
    };
    const onData = input => {
      for (const character of input.toString('utf8')) {
        if (character === '\u0003') {
          finish(new Error('Password setup cancelled'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(null, value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          continue;
        }
        if (character >= ' ' && character !== '\u007f' && value.length < 128) value += character;
      }
    };

    process.stdout.write(prompt);
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const emailIndex = args.indexOf('--email');
  const email = emailIndex < 0 ? '' : args[emailIndex + 1] || '';
  if (!email) throw new Error('Usage: npm run admin:password -- --email admin@example.com');

  const password = await readHidden('New admin password (16-128 characters): ');
  const confirmation = await readHidden('Confirm new password: ');
  if (password.length < 16 || password.length > 128) {
    throw new Error('Admin password must contain between 16 and 128 characters');
  }
  if (password !== confirmation) throw new Error('Passwords do not match');

  const database = openDatabase();
  try {
    const id = updateAdminPassword(database, email, password);
    console.log(`Password updated for admin account ${id}. All existing sessions were revoked.`);
    console.log(`Database: ${DEFAULT_DATABASE_FILE}`);
  } finally {
    database.close();
  }
}

main().catch(error => {
  console.error(`[admin password] ${error.message}`);
  process.exitCode = 1;
});
