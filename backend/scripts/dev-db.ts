import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Convenience for local development WITHOUT Docker: runs a real PostgreSQL server (embedded-postgres binaries)
 * with data kept in backend/.pgdata. Production uses the postgres container from docker-compose.
 *   npm run dev:db     -> postgresql://teamtalk:teamtalk@localhost:5433/teamtalk
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.pgdata');
const port = Number(process.env.DEV_DB_PORT ?? 5433);

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
console.log(`PostgreSQL ready: postgresql://teamtalk:teamtalk@localhost:${port}/teamtalk  (Ctrl+C to stop)`);
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
