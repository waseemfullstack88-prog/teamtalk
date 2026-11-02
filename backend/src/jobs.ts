import { prisma } from './lib/db.js';
import { removeMessageContent } from './services/messages.js';
import { removeStatusFiles } from './routes/status.js';
import { emitToChat } from './realtime/hub.js';
import { getSettings } from './lib/settings.js';

/**
 * Housekeeping: disappearing messages, workspace retention policy, expired status updates and stale auth rows.
 * Exported as a function so it can be unit-tested; server.ts runs it every minute.
 */
export async function runCleanup(now = new Date()) {
  // 1. disappearing messages
  const expired = await prisma.message.findMany({ where: { expiresAt: { lte: now } }, select: { id: true, chatId: true }, take: 1000 });
  await purge(expired);

  // 2. retention policy (per workspace)
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });
  for (const w of workspaces) {
    const s = await getSettings(w.id);
    if (!s.messageRetentionDays) continue;
    const cutoff = new Date(now.getTime() - s.messageRetentionDays * 86400_000);
    const old = await prisma.message.findMany({ where: { createdAt: { lt: cutoff }, chat: { workspaceId: w.id } }, select: { id: true, chatId: true }, take: 1000 });
    await purge(old);
  }

  // 3. status updates older than 24h
  const dead = await prisma.statusUpdate.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, take: 500 });
  if (dead.length) {
    await removeStatusFiles(dead.map((d) => d.id));
    await prisma.statusUpdate.deleteMany({ where: { id: { in: dead.map((d) => d.id) } } });
  }

  // 4. stale auth artefacts
  await prisma.passkeyChallenge.deleteMany({ where: { expiresAt: { lt: now } } });
  await prisma.authToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400_000) } } });
  await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * 86400_000) } }] } });

  return { messages: expired.length, statuses: dead.length };
}

async function purge(rows: { id: string; chatId: string }[]) {
  if (!rows.length) return;
  await removeMessageContent(rows.map((r) => r.id));
  await prisma.message.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  const byChat = new Map<string, string[]>();
  for (const r of rows) byChat.set(r.chatId, [...(byChat.get(r.chatId) ?? []), r.id]);
  for (const [chatId, ids] of byChat) emitToChat(chatId, 'message:expired', { chatId, messageIds: ids });
}
