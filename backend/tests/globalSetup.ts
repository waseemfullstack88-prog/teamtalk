import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Starts a throw-away REAL PostgreSQL server for the test run and applies the Prisma schema to it,
 * so tests exercise the same database engine as production (no mocks).
 */
let pg: EmbeddedPostgres | undefined;
let dir = '';
const PORT = 54329;
const URL = `postgresql://teamtalk:teamtalk@localhost:${PORT}/teamtalk_test`;

export async function setup() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teamtalk-pg-'));
  pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'teamtalk',
    password: 'teamtalk',
    port: PORT,
    persistent: false,
    initdbFlags: ['-E', 'UTF8', '--locale=C'],
  });
  await pg.initialise();
  await pg.start();
  try {
    const client = pg.getPgClient('postgres');
    await client.connect();
    await client.query("CREATE DATABASE teamtalk_test WITH ENCODING 'UTF8' TEMPLATE template0;").catch(async () => {
      await client.query("CREATE DATABASE teamtalk_test WITH ENCODING 'UTF8';");
    });
    await client.end();
  } catch {
    await pg.createDatabase('teamtalk_test');
  }
  execSync('npx prisma db push --skip-generate --accept-data-loss', { stdio: 'pipe', env: { ...process.env, DATABASE_URL: URL }, shell: process.platform === 'win32' ? 'cmd.exe' : undefined });
}

import { prisma } from '../src/lib/db.js';

export async function teardown() {
  await prisma.$disconnect().catch(() => undefined);
  await pg?.stop().catch(() => undefined);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  try {
    fs.rmSync(path.resolve('.test-storage'), { recursive: true, force: true });
  } catch {}
}
