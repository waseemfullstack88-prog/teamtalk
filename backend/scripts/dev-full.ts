import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.pgdata');
const port = 5433;

console.log('[teamtalk] Initializing embedded PostgreSQL...');
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'teamtalk',
  password: 'teamtalk',
  port,
  persistent: true,
  initdbFlags: ['-E', 'UTF8', '--locale=C'],
});

if (!fs.existsSync(path.join(dir, 'PG_VERSION'))) {
  await pg.initialise();
}
await pg.start();

try {
  const client = pg.getPgClient('postgres');
  await client.connect();
  await client.query("CREATE DATABASE teamtalk WITH ENCODING 'UTF8' TEMPLATE template0;").catch(async () => {
    await client.query("CREATE DATABASE teamtalk WITH ENCODING 'UTF8';");
  });
  await client.end();
} catch {
  try {
    await pg.createDatabase('teamtalk');
  } catch {}
}

console.log(`[teamtalk] PostgreSQL active at postgresql://teamtalk:teamtalk@127.0.0.1:${port}/teamtalk`);

// Ensure PostgreSQL is fully accepting queries
let connected = false;
for (let i = 0; i < 20; i++) {
  try {
    const testClient = pg.getPgClient('teamtalk');
    await testClient.connect();
    await testClient.query('SELECT 1');
    await testClient.end();
    connected = true;
    break;
  } catch (err: any) {
    console.log('[pg retry error]:', err?.message || err);
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!connected) {
  console.warn('[teamtalk] Waiting an additional moment for database...');
  await new Promise((r) => setTimeout(r, 2000));
}

// Push database schema
console.log('[teamtalk] Applying Prisma schema to database...');
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execSync(`${npxCmd} prisma db push --skip-generate --accept-data-loss`, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: `postgresql://teamtalk:teamtalk@127.0.0.1:${port}/teamtalk` },
  shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
});

// Seed demo users and chats
console.log('[teamtalk] Seeding initial workspace and accounts...');
try {
  execSync(`${npxCmd} tsx prisma/seed.ts`, {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://teamtalk:teamtalk@127.0.0.1:${port}/teamtalk`,
      JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_at_least_32_chars_long_teamtalk',
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY || 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=',
      FILE_SIGNING_SECRET: process.env.FILE_SIGNING_SECRET || 'file_signing_secret_at_least_32_characters_long',
      TURN_SECRET: process.env.TURN_SECRET || 'teamtalk_turn_secret_16char',
      SEED_ADMIN_EMAIL: 'owner@teamtalk.local',
      SEED_ADMIN_PASSWORD: 'SuperSecurePass!2026',
      SEED_DEMO: 'true',
    },
    shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
  });
} catch (e: any) {
  console.log('[teamtalk] Seed notice:', e.message || 'Seed completed or already present');
}

// Ensure environment variables are populated
process.env.DATABASE_URL = `postgresql://teamtalk:teamtalk@127.0.0.1:${port}/teamtalk`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_at_least_32_chars_long_teamtalk';
process.env.DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY || 'MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=';
process.env.FILE_SIGNING_SECRET = process.env.FILE_SIGNING_SECRET || 'file_signing_secret_at_least_32_characters_long';
process.env.TURN_SECRET = process.env.TURN_SECRET || 'teamtalk_turn_secret_16char';
process.env.PORT = process.env.PORT || '4000';
process.env.NODE_ENV = 'development';

// Start backend server
console.log('[teamtalk] Starting Express API & Socket.IO server on port 4000...');
await import('../src/server.js');

const shutdown = async () => {
  console.log('\n[teamtalk] Shutting down embedded database and services...');
  await pg.stop().catch(() => undefined);
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
