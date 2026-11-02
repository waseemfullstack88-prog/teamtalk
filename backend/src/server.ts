import http from 'node:http';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { createSocketServer, failStaleCalls } from './realtime/socket.js';
import { runCleanup } from './jobs.js';
import { prisma } from './lib/db.js';

process.on('unhandledRejection', (reason) => {
  console.warn('[Server] Unhandled rejection prevented from crashing process:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception logged:', err);
});

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);

  if (env.REDIS_URL) {
    // Redis adapter: lets several API replicas share rooms/presence/real-time events.
    const { createClient } = await import('redis');
    const { createAdapter } = await import('@socket.io/redis-adapter');
    const pub = createClient({ url: env.REDIS_URL });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
    console.log('[redis] socket.io adapter enabled');
  }

  await failStaleCalls();
  const timer = setInterval(() => runCleanup().catch((e) => console.error('[cleanup]', e)), 60_000);
  timer.unref();

  server.listen(env.PORT, () => console.log(`[teamtalk] API + realtime listening on :${env.PORT} (${env.NODE_ENV})`));

  const shutdown = async () => {
    clearInterval(timer);
    io.close();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
