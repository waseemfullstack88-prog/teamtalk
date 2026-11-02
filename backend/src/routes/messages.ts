import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { badRequest, forbidden, parse, wrap } from '../lib/http.js';
import { isChatAdmin, partnerIds, requireMember } from '../lib/chatAccess.js';
import { me, requireAuth } from '../middleware/auth.js';
import { bodyOf, messageInclude, onlineSet, publicUser, serializeMessage } from '../lib/serialize.js';
import { emitToChat } from '../realtime/hub.js';
import {
  deleteMessage, editMessage, forwardMessage, loadFull, markRead, requireMessage, sendMessage, setReaction, totalOthers, votePoll,
} from '../services/messages.js';
import { limiter } from '../middleware/limits.js';

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

const sendLimiter = limiter({ windowMs: 10_000, max: 40, key: (r) => r.auth?.user.id ?? r.ip ?? 'x', message: 'You are sending messages too fast.' });

messagesRouter.get('/chats/:chatId/messages', wrap(async (req, res) => {
  const user = me(req);
  const chatId = String(req.params.chatId);
  const ms = await requireMember(chatId, user.id);
  const q = parse(z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }), req.query);
  const rows = await prisma.message.findMany({
    where: {
      chatId, deletions: { none: { userId: user.id } },
      createdAt: { ...(ms.member.clearedAt ? { gt: ms.member.clearedAt } : {}), ...(q.before ? { lt: new Date(q.before) } : {}) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' }, take: q.limit, include: messageInclude,
  });
  const others = await totalOthers(chatId, user.id);
  const messages = rows.reverse().map((m) => serializeMessage(m, user.id, others));
  res.json({ messages, hasMore: rows.length === q.limit });
}));

messagesRouter.post('/chats/:chatId/messages', sendLimiter, wrap(async (req, res) => {
  const msg = await sendMessage(me(req), String(req.params.chatId), req.body, req);
  res.status(201).json({ message: msg });
}));

messagesRouter.post('/chats/:chatId/read', wrap(async (req, res) => {
  res.json(await markRead(me(req), String(req.params.chatId)));
}));

messagesRouter.get('/chats/:chatId/pinned', wrap(async (req, res) => {
  const user = me(req);
  await requireMember(String(req.params.chatId), user.id);
  const rows = await prisma.message.findMany({ where: { chatId: String(req.params.chatId), pinnedAt: { not: null }, deletedForAllAt: null, deletions: { none: { userId: user.id } } }, orderBy: { pinnedAt: 'desc' }, include: messageInclude });
  res.json({ messages: rows.map((m) => serializeMessage(m, user.id, 0)) });
}));

messagesRouter.patch('/messages/:id', wrap(async (req, res) => {
  const { body } = parse(z.object({ body: z.string().max(8000) }), req.body);
  res.json({ message: await editMessage(me(req), String(req.params.id), body) });
}));

messagesRouter.delete('/messages/:id', wrap(async (req, res) => {
  const scope = z.enum(['me', 'all']).default('me').parse(req.query.scope);
  res.json(await deleteMessage(me(req), String(req.params.id), scope, req));
}));

messagesRouter.post('/messages/:id/forward', wrap(async (req, res) => {
  const { chatIds } = parse(z.object({ chatIds: z.array(z.string().max(40)).min(1).max(10) }), req.body);
  res.status(201).json({ messages: await forwardMessage(me(req), String(req.params.id), chatIds, req) });
}));

messagesRouter.put('/messages/:id/reaction', wrap(async (req, res) => {
  const { emoji } = parse(z.object({ emoji: z.string().max(16) }), req.body);
  res.json({ reactions: await setReaction(me(req), String(req.params.id), emoji) });
}));
messagesRouter.delete('/messages/:id/reaction', wrap(async (req, res) => {
  res.json({ reactions: await setReaction(me(req), String(req.params.id), null) });
}));

messagesRouter.post('/messages/:id/star', wrap(async (req, res) => {
  const user = me(req);
  const { msg } = await requireMessage(String(req.params.id), user.id);
  if (msg.deletedForAllAt) throw badRequest('Message was deleted');
  await prisma.star.upsert({ where: { messageId_userId: { messageId: msg.id, userId: user.id } }, update: {}, create: { messageId: msg.id, userId: user.id } });
  res.json({ ok: true });
}));
messagesRouter.delete('/messages/:id/star', wrap(async (req, res) => {
  const user = me(req);
  await requireMessage(String(req.params.id), user.id);
  await prisma.star.deleteMany({ where: { messageId: String(req.params.id), userId: user.id } });
  res.json({ ok: true });
}));

messagesRouter.get('/starred', wrap(async (req, res) => {
  const user = me(req);
  const stars = await prisma.star.findMany({ where: { userId: user.id, message: { deletedForAllAt: null, chat: { members: { some: { userId: user.id } } } } }, orderBy: { createdAt: 'desc' }, take: 100, include: { message: { include: messageInclude } } });
  res.json({ messages: stars.map((s) => serializeMessage(s.message, user.id, 0)) });
}));

const MAX_PINNED = 5;
messagesRouter.post('/messages/:id/pin', wrap(async (req, res) => {
  const user = me(req);
  const { msg, ms } = await requireMessage(String(req.params.id), user.id);
  if (ms.chat.type !== 'DIRECT' && !isChatAdmin(ms.member)) throw forbidden('Only group admins can pin messages');
  if (msg.deletedForAllAt || msg.type === 'SYSTEM') throw badRequest('This message cannot be pinned');
  if (!msg.pinnedAt && (await prisma.message.count({ where: { chatId: msg.chatId, pinnedAt: { not: null } } })) >= MAX_PINNED) throw badRequest(`You can pin up to ${MAX_PINNED} messages`);
  await prisma.message.update({ where: { id: msg.id }, data: { pinnedAt: new Date(), pinnedById: user.id } });
  emitToChat(msg.chatId, 'message:updated', serializeMessage((await loadFull(msg.id))!, '', 0));
  res.json({ ok: true });
}));
messagesRouter.delete('/messages/:id/pin', wrap(async (req, res) => {
  const user = me(req);
  const { msg, ms } = await requireMessage(String(req.params.id), user.id);
  if (ms.chat.type !== 'DIRECT' && !isChatAdmin(ms.member)) throw forbidden('Only group admins can unpin messages');
  await prisma.message.update({ where: { id: msg.id }, data: { pinnedAt: null, pinnedById: null } });
  emitToChat(msg.chatId, 'message:updated', serializeMessage((await loadFull(msg.id))!, '', 0));
  res.json({ ok: true });
}));

messagesRouter.post('/messages/:id/poll/vote', wrap(async (req, res) => {
  const { optionIds } = parse(z.object({ optionIds: z.array(z.string().max(40)).max(12) }), req.body);
  res.json({ message: await votePoll(me(req), String(req.params.id), optionIds) });
}));

// ---------- search: users, chats, messages, links, documents, media ----------
messagesRouter.get('/search', wrap(async (req, res) => {
  const user = me(req);
  const { q, scope } = parse(z.object({ q: z.string().trim().min(2).max(100), scope: z.enum(['all', 'users', 'chats', 'messages', 'links', 'docs', 'media']).default('all') }), req.query);
  const needle = q.toLowerCase();
  const want = (s: string) => scope === 'all' || scope === s;
  const out: Record<string, unknown[]> = { users: [], chats: [], messages: [], links: [], docs: [], media: [] };

  if (want('users')) {
    const cleanQ = q.replace(/^@/, '').trim();
    const [partners, online] = await Promise.all([partnerIds(user.id), onlineSet()]);
    const users = await prisma.user.findMany({
      where: {
        workspaceId: user.workspaceId,
        status: 'ACTIVE',
        id: { not: user.id },
        OR: [
          { username: { contains: cleanQ, mode: 'insensitive' } },
          { displayName: { contains: cleanQ, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });
    out.users = users.map((u) => publicUser(u, { viewerId: user.id, partners, online }));
  }
  if (want('chats')) {
    const chats = await prisma.chat.findMany({ where: { type: { not: 'DIRECT' }, name: { contains: q, mode: 'insensitive' }, members: { some: { userId: user.id, hidden: false } } }, take: 20, select: { id: true, name: true, type: true } });
    out.chats = chats;
  }
  if (want('messages') || want('links')) {
    // Message bodies are encrypted at rest, so the database cannot search them. We decrypt a bounded window
    // of the user's most recent visible messages in memory. Scale-out would need a blind index or client-side search.
    const rows = await prisma.message.findMany({
      where: {
        chat: { members: { some: { userId: user.id } } }, deletedForAllAt: null, type: 'TEXT', deletions: { none: { userId: user.id } },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' }, take: 1500, select: { id: true, chatId: true, senderId: true, createdAt: true, bodyEnc: true, deletedForAllAt: true },
    });
    for (const r of rows) {
      const body = bodyOf(r) ?? '';
      if (want('messages') && body.toLowerCase().includes(needle) && out.messages.length < 30) out.messages.push({ id: r.id, chatId: r.chatId, senderId: r.senderId, createdAt: r.createdAt, snippet: body.slice(0, 160) });
      if (want('links') && out.links.length < 30) {
        for (const url of body.match(/https?:\/\/[^\s<>"']+/g) ?? []) if (url.toLowerCase().includes(needle)) out.links.push({ url, chatId: r.chatId, messageId: r.id, createdAt: r.createdAt });
      }
    }
  }
  if (want('docs') || want('media')) {
    const atts = await prisma.attachment.findMany({
      where: { originalName: { contains: q, mode: 'insensitive' }, message: { deletedForAllAt: null, chat: { members: { some: { userId: user.id } } }, deletions: { none: { userId: user.id } } } },
      orderBy: { createdAt: 'desc' }, take: 40, include: { message: { select: { chatId: true } } },
    });
    for (const a of atts) {
      const item = { id: a.id, name: a.originalName, mime: a.mime, size: a.size, chatId: a.message?.chatId, createdAt: a.createdAt };
      (/^(image|video)\//.test(a.mime) ? out.media : out.docs).push(item);
    }
  }
  res.json(out);
}));
