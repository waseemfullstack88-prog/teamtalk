import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { badRequest, notFound, parse, wrap } from '../lib/http.js';
import { me, requireAuth } from '../middleware/auth.js';
import { onlineSet, publicUser, selfUser } from '../lib/serialize.js';
import { partnerIds, requireMember } from '../lib/chatAccess.js';
import { requireMessage } from '../services/messages.js';
import { limiter } from '../middleware/limits.js';
import { fetchLinkPreview } from '../lib/linkpreview.js';
import { getSettings } from '../lib/settings.js';
import { turnCredentials } from '../lib/turn.js';
import { env } from '../config/env.js';
import { emitToUser, getIo } from '../realtime/hub.js';
import { endActiveCallForUser } from '../realtime/socket.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const vis = z.enum(['EVERYONE', 'CHAT_PARTNERS', 'NOBODY']);

usersRouter.get('/users', wrap(async (req, res) => {
  const user = me(req);
  const [partners, online] = await Promise.all([partnerIds(user.id), onlineSet()]);
  const users = await prisma.user.findMany({ where: { workspaceId: user.workspaceId, status: 'ACTIVE' }, orderBy: { displayName: 'asc' }, take: 500 });
  res.json({ users: users.map((u) => publicUser(u, { viewerId: user.id, partners, online })) });
}));

usersRouter.get('/users/:id', wrap(async (req, res) => {
  const user = me(req);
  const u = await prisma.user.findFirst({ where: { id: String(req.params.id), workspaceId: user.workspaceId, status: 'ACTIVE' } });
  if (!u) throw notFound('User not found');
  res.json({ user: publicUser(u, { viewerId: user.id, partners: await partnerIds(user.id), online: await onlineSet() }) });
}));

usersRouter.patch('/profile', wrap(async (req, res) => {
  const user = me(req);
  const b = parse(z.object({
    displayName: z.string().trim().min(2).max(60).optional(),
    about: z.string().trim().max(140).optional(),
    avatarFileId: z.string().max(40).nullable().optional(),
    avatarUrl: z.string().max(1_500_000).nullable().optional(),
    privacy: z.object({ profilePhoto: vis, lastSeen: vis, online: vis, status: vis, groups: vis, readReceipts: z.boolean() }).partial().optional(),
    autoDownload: z.object({ wifi: z.boolean(), mobile: z.boolean() }).partial().optional(),
  }), req.body);
  if (b.avatarFileId) {
    const f = await prisma.attachment.findFirst({ where: { id: b.avatarFileId, uploaderId: user.id, purpose: 'AVATAR' } });
    if (!f) throw badRequest('Invalid avatar');
  }
  const p = b.privacy ?? {};
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      displayName: b.displayName,
      about: b.about,
      avatarFileId: b.avatarFileId,
      avatarUrl: b.avatarUrl !== undefined ? b.avatarUrl : undefined,
      privacyProfilePhoto: p.profilePhoto,
      privacyLastSeen: p.lastSeen,
      privacyOnline: p.online,
      privacyStatus: p.status,
      privacyGroups: p.groups,
      readReceipts: p.readReceipts,
      autoDownloadWifi: b.autoDownload?.wifi,
      autoDownloadMobile: b.autoDownload?.mobile,
    },
  });
  const io = getIo();
  if (io) {
    io.emit('user:updated', {
      user: {
        id: updated.id,
        displayName: updated.displayName,
        avatarUrl: updated.avatarUrl,
        avatarFileId: updated.avatarFileId,
        about: updated.about,
      },
    });
  }
  res.json({ user: await selfUser(updated, req.auth!.session.id) });
}));

// ----- block / report -----
usersRouter.get('/blocks', wrap(async (req, res) => {
  const rows = await prisma.block.findMany({ where: { blockerId: me(req).id }, include: { blocked: { select: { id: true, displayName: true } } } });
  res.json({ blocks: rows.map((b) => ({ userId: b.blockedId, displayName: b.blocked.displayName, at: b.createdAt })) });
}));

usersRouter.post('/users/:id/block', wrap(async (req, res) => {
  const user = me(req);
  const targetId = String(req.params.id);
  if (targetId === user.id) throw badRequest('You cannot block yourself');
  const t = await prisma.user.findFirst({ where: { id: targetId, workspaceId: user.workspaceId } });
  if (!t) throw notFound('User not found');
  await prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: user.id, blockedId: targetId } }, update: {}, create: { blockerId: user.id, blockedId: targetId } });
  await audit({ action: 'USER_BLOCKED', actorId: user.id, targetType: 'user', targetId, req });
  res.json({ ok: true });
}));

usersRouter.delete('/users/:id/block', wrap(async (req, res) => {
  await prisma.block.deleteMany({ where: { blockerId: me(req).id, blockedId: String(req.params.id) } });
  res.json({ ok: true });
}));

usersRouter.post('/reports', limiter({ windowMs: 3600_000, max: 30 }), wrap(async (req, res) => {
  const user = me(req);
  const b = parse(z.object({
    targetUserId: z.string().max(40).optional(), messageId: z.string().max(40).optional(),
    reason: z.enum(['spam', 'harassment', 'inappropriate', 'impersonation', 'other']), details: z.string().max(1000).default(''),
  }), req.body);
  if (!b.targetUserId && !b.messageId) throw badRequest('Choose a user or message to report');
  let chatId: string | undefined;
  let target = b.targetUserId;
  if (b.messageId) {
    const { msg } = await requireMessage(b.messageId, user.id); // must be able to see it
    chatId = msg.chatId;
    target ??= msg.senderId;
  }
  const r = await prisma.report.create({ data: { reporterId: user.id, targetUserId: target, messageId: b.messageId, chatId, reason: b.reason, details: b.details } });
  await audit({ action: 'USER_REPORTED', actorId: user.id, targetType: 'report', targetId: r.id, req, metadata: { reason: b.reason } });
  res.status(201).json({ id: r.id });
}));

// ----- push tokens (Firebase Cloud Messaging) -----
usersRouter.post('/push/tokens', wrap(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']) }), req.body);
  await prisma.pushToken.upsert({ where: { token: b.token }, update: { userId: me(req).id, platform: b.platform }, create: { userId: me(req).id, token: b.token, platform: b.platform } });
  res.status(201).json({ ok: true });
}));
usersRouter.delete('/push/tokens', wrap(async (req, res) => {
  const { token } = parse(z.object({ token: z.string().max(4096) }), req.body);
  await prisma.pushToken.deleteMany({ where: { token, userId: me(req).id } });
  res.json({ ok: true });
}));

// ----- capture events (iOS screenshots / recording, web) -----
usersRouter.post('/privacy-events', limiter({ windowMs: 60_000, max: 20 }), wrap(async (req, res) => {
  const user = me(req);
  const b = parse(z.object({ type: z.enum(['screenshot', 'screen_recording']), chatId: z.string().max(40).optional() }), req.body);
  let notify: string[] = [];
  if (b.chatId) {
    const ms = await requireMember(b.chatId, user.id);
    if (ms.chat.isProtected) {
      notify = (await prisma.chatMember.findMany({ where: { chatId: b.chatId, userId: { not: user.id } }, select: { userId: true } })).map((m) => m.userId);
    }
  }
  await audit({ action: b.type === 'screenshot' ? 'SCREENSHOT_DETECTED' : 'SCREEN_RECORDING_DETECTED', actorId: user.id, targetType: 'chat', targetId: b.chatId, req, suspicious: !!b.chatId, metadata: { type: b.type } });
  for (const id of notify) emitToUser(id, 'privacy:event', { chatId: b.chatId, userId: user.id, type: b.type });
  res.status(202).json({ ok: true });
}));

// ----- link previews (SSRF-hardened), GIF search proxy, runtime config -----
const previewCache = new Map<string, { at: number; data: unknown }>();
usersRouter.get('/link-preview', limiter({ windowMs: 60_000, max: 30, key: (r) => r.auth?.user.id ?? r.ip ?? 'x' }), wrap(async (req, res) => {
  const { url } = parse(z.object({ url: z.string().url().max(2000) }), req.query);
  const hit = previewCache.get(url);
  if (hit && Date.now() - hit.at < 3600_000) return res.json(hit.data);
  try {
    const data = await fetchLinkPreview(url);
    if (previewCache.size > 500) previewCache.clear();
    previewCache.set(url, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Preview unavailable');
  }
}));

usersRouter.get('/gifs/search', limiter({ windowMs: 60_000, max: 30 }), wrap(async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().max(60).default('') }), req.query);
  if (!env.GIPHY_API_KEY) return res.json({ provider: null, results: [] }); // key stays on the server; UI falls back to built-in stickers
  const u = new URL(q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
  u.searchParams.set('api_key', env.GIPHY_API_KEY);
  u.searchParams.set('limit', '24');
  u.searchParams.set('rating', 'pg');
  if (q) u.searchParams.set('q', q);
  const r = await fetch(u, { signal: AbortSignal.timeout(5000) });
  const j = (await r.json()) as { data?: { id: string; title: string; images: { fixed_height: { url: string } } }[] };
  res.json({ provider: 'giphy', results: (j.data ?? []).map((g) => ({ id: g.id, title: g.title, url: g.images.fixed_height.url })) });
}));

usersRouter.get('/config', wrap(async (req, res) => {
  const s = await getSettings(me(req).workspaceId);
  res.json({
    callsEnabled: s.callsEnabled, screenShareEnabled: s.screenShareEnabled, watermarkDefault: s.watermarkDefault,
    protectedChat: s.protectedChat, disappearingAllowed: s.disappearing.allowedSeconds,
    maxFileMb: s.storage.maxFileMb, allowedMime: s.storage.allowedMime, deleteForEveryoneSeconds: s.deleteForEveryoneSeconds,
    gifEnabled: !!env.GIPHY_API_KEY, pushEnabled: !!env.FIREBASE_SERVICE_ACCOUNT_JSON, captchaProvider: env.CAPTCHA_PROVIDER,
    e2ee: false, // end-to-end encryption is NOT implemented; the UI must not claim otherwise
  });
}));

usersRouter.get('/calls/ice', wrap(async (req, res) => {
  const user = me(req);
  if (!(await getSettings(user.workspaceId)).callsEnabled) throw badRequest('Calls are disabled by your administrator');
  res.json(turnCredentials(user.id));
}));

usersRouter.get('/calls/history', wrap(async (req, res) => {
  const user = me(req);
  const calls = await prisma.call.findMany({
    where: { OR: [{ callerId: user.id }, { participants: { some: { userId: user.id } } }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      caller: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
      participants: { include: { user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } } },
    },
  });
  res.json({
    calls: calls.map((c) => {
      const isCaller = c.callerId === user.id;
      const otherParticipant = c.participants.find((p) => p.userId !== user.id);
      const peer = isCaller ? (otherParticipant?.user || null) : c.caller;
      const peerId = isCaller ? (otherParticipant?.userId || null) : c.callerId;
      return {
        id: c.id,
        kind: c.kind,
        status: c.status,
        direction: isCaller ? 'outgoing' : 'incoming',
        peerId,
        peer: peer ? { id: peer.id, displayName: peer.displayName, avatarUrl: peer.avatarUrl, email: peer.email } : null,
        createdAt: c.createdAt,
        answeredAt: c.answeredAt,
        endedAt: c.endedAt,
        durationSec: c.durationSec,
        missed: !isCaller && (c.status === 'MISSED' || c.status === 'CANCELLED'),
      };
    }),
  });
}));

usersRouter.post('/calls/end', wrap(async (req, res) => {
  const user = me(req);
  const callId = typeof req.body?.callId === 'string' ? req.body.callId : undefined;
  const result = await endActiveCallForUser(user.id, callId);
  res.json({ ok: true, ...result });
}));
