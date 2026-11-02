import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { Call, User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/db.js';
import { authenticateAccessToken } from '../middleware/auth.js';
import { allowedOrigins, isOriginAllowed } from '../app.js';
import { directPeer, isBlockedBetween, partnerIds, requireMember } from '../lib/chatAccess.js';
import { getSettings } from '../lib/settings.js';
import { sendPush } from '../lib/push.js';
import { deleteMessage, markDelivered, markRead, sendMessage, setReaction } from '../services/messages.js';
import { attachIo, chatRoom, emitToUser, emitToUsers, userRoom } from './hub.js';
import { HttpError } from '../lib/http.js';

/**
 * Socket.IO layer. Every event is authenticated (handshake token bound to a live session), validated with zod,
 * rate limited per socket, and authorised against the database (chat membership / call participation) —
 * never against client-supplied room names.
 */

const RING_TIMEOUT_MS = 45_000;
const ringTimers = new Map<string, NodeJS.Timeout>();

type Ack = (r: { ok: boolean; error?: string; [k: string]: unknown }) => void;

function bucket(socket: Socket, name: string, max: number, windowMs = 10_000): boolean {
  const now = Date.now();
  const store = ((socket.data.rl ??= {}) as Record<string, { n: number; reset: number }>);
  const b = store[name];
  if (!b || b.reset < now) {
    store[name] = { n: 1, reset: now + windowMs };
    return true;
  }
  return ++b.n <= max;
}

const errMsg = (e: unknown) => (e instanceof HttpError ? e.message : e instanceof z.ZodError ? 'Invalid request' : 'Something went wrong');

export function createSocketServer(http: HttpServer): Server {
  const io = new Server(http, {
    path: '/socket.io',
    cors: {
      origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
      credentials: true,
    },
    maxHttpBufferSize: 256 * 1024, // signalling and chat text only; files go through the HTTP upload API
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });
  attachIo(io);

  io.use(async (socket, next) => {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : '';
      const ctx = await authenticateAccessToken(token);
      socket.data.userId = ctx.user.id;
      socket.data.sessionId = ctx.session.id;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => void onConnection(io, socket));
  return io;
}

async function currentUser(socket: Socket): Promise<User> {
  // Re-check on each privileged event: session revocation / deactivation must take effect immediately.
  const s = await prisma.session.findUnique({ where: { id: socket.data.sessionId }, include: { user: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.user.status !== 'ACTIVE') {
    socket.disconnect(true);
    throw new HttpError(401, 'Session has ended');
  }
  return s.user;
}

async function onConnection(io: Server, socket: Socket) {
  const userId = socket.data.userId as string;
  await socket.join([userRoom(userId), `session:${socket.data.sessionId}`]);
  const memberships = await prisma.chatMember.findMany({ where: { userId }, select: { chatId: true } });
  await socket.join(memberships.map((m) => chatRoom(m.chatId)));

  // presence
  const count = (await io.in(userRoom(userId)).fetchSockets()).length;
  if (count === 1) void broadcastPresence(userId, true);
  void deliverBacklog(userId, memberships.map((m) => m.chatId));

  const guard = (name: string, max: number, fn: (user: User, data: unknown) => Promise<Record<string, unknown> | void>) =>
    socket.on(name, async (data: unknown, ack?: Ack) => {
      const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
      if (!bucket(socket, name, max)) return reply({ ok: false, error: 'Slow down' });
      try {
        const user = await currentUser(socket);
        reply({ ok: true, ...((await fn(user, data)) ?? {}) });
      } catch (e) {
        reply({ ok: false, error: errMsg(e) });
      }
    });

  // ---- chat ----
  guard('message:send', 60, async (user, d) => {
    // Robust payload handling: accept both wrapped { chatId, message } and direct { chatId, body, ... }
    const b = z.object({
      chatId: z.string().max(40),
      message: z.unknown().optional(),
    }).passthrough().parse(d);
    const msgData = b.message && typeof b.message === 'object' ? b.message : d;
    return { message: await sendMessage(user, b.chatId, msgData) };
  });
  guard('message:delete', 60, async (user, d) => {
    const { messageId, scope, forAll } = z.object({
      messageId: z.string().max(40),
      scope: z.enum(['me', 'all']).optional(),
      forAll: z.boolean().optional(),
    }).parse(d);
    const finalScope = scope || (forAll ? 'all' : 'me');
    return deleteMessage(user, messageId, finalScope);
  });
  guard('message:reaction', 120, async (user, d) => {
    const { messageId, emoji } = z.object({
      messageId: z.string().max(40),
      emoji: z.string().max(16).nullable(),
    }).parse(d);
    return { reactions: await setReaction(user, messageId, emoji) };
  });
  guard('chat:join', 60, async (user, d) => {
    const { chatId } = z.object({ chatId: z.string().max(40) }).parse(d);
    await requireMember(chatId, user.id);
    await socket.join(chatRoom(chatId));
    return { joined: true };
  });
  guard('message:delivered', 120, async (user, d) => {
    const { chatId, messageIds } = z.object({ chatId: z.string().max(40), messageIds: z.array(z.string().max(40)).max(200) }).parse(d);
    await markDelivered(user.id, chatId, messageIds);
  });
  guard('chat:read', 60, async (user, d) => {
    const { chatId } = z.object({ chatId: z.string().max(40) }).parse(d);
    await markRead(user, chatId);
  });
  guard('typing', 40, async (user, d) => {
    const { chatId, typing } = z.object({ chatId: z.string().max(40), typing: z.boolean() }).parse(d);
    await requireMember(chatId, user.id);
    socket.to(chatRoom(chatId)).emit('typing', { chatId, userId: user.id, name: user.displayName, typing });
  });

  // ---- calls (signalling only; media flows peer-to-peer via WebRTC, relayed by coturn when needed) ----
  guard('call:invite', 10, async (user, d) => {
    const b = z.object({
      calleeId: z.string().max(40).optional(),
      targetUserId: z.string().max(40).optional(),
      kind: z.enum(['AUDIO', 'VIDEO']),
      chatId: z.string().max(40).optional()
    }).parse(d);
    const target = b.calleeId || b.targetUserId;
    if (!target) throw new HttpError(400, 'calleeId is required');
    return startCall(io, user, target, b.kind, b.chatId);
  });
  guard('call:accept', 10, async (user, d) => {
    const { callId } = z.object({ callId: z.string().max(40) }).parse(d);
    const call = await loadCallFor(callId, user.id);
    if (call.callerId === user.id || call.status !== 'RINGING') throw new HttpError(409, 'Call is no longer available');
    await prisma.call.update({ where: { id: callId }, data: { status: 'ACCEPTED', answeredAt: new Date() } });
    await prisma.callParticipant.update({ where: { callId_userId: { callId, userId: user.id } }, data: { joinedAt: new Date(), seen: true } });
    clearRing(callId);
    emitToUser(call.callerId, 'call:accepted', { callId, by: user.id });
    socket.to(userRoom(user.id)).emit('call:handled', { callId, by: 'other-device' }); // stop ringing on my other devices
  });
  guard('call:decline', 10, async (user, d) => {
    const { callId } = z.object({ callId: z.string().max(40).optional() }).parse(d || {});
    await endActiveCallForUser(user.id, callId, 'DECLINED');
    socket.to(userRoom(user.id)).emit('call:handled', { callId, by: 'other-device' });
    return { ok: true };
  });
  guard('call:cancel', 10, async (user, d) => {
    const { callId } = z.object({ callId: z.string().max(40).optional() }).parse(d || {});
    await endActiveCallForUser(user.id, callId, 'CANCELLED');
    return { ok: true };
  });
  guard('call:end', 10, async (user, d) => {
    const { callId } = z.object({ callId: z.string().max(40).optional() }).parse(d || {});
    const res = await endActiveCallForUser(user.id, callId);
    return { ok: true, ...res };
  });
  guard('call:signal', 400, async (user, d) => {
    const b = z.object({
      callId: z.string().max(40),
      to: z.string().max(40).optional(), // reserved for group calls (mesh/SFU): address a specific participant
      data: z.union([
        z.object({ sdp: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string().max(30_000) }) }).strict(),
        z.object({ candidate: z.object({ candidate: z.string().max(2000), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().nullable().optional(), usernameFragment: z.string().nullable().optional() }) }).strict(),
        z.object({ state: z.enum(['video-on', 'video-off', 'audio-on', 'audio-off', 'screen-on', 'screen-off']) }).strict(),
      ]),
    }).parse(d);
    const call = await loadCallFor(b.callId, user.id);
    // Crucial for WebRTC: Allow signaling during RINGING (for SDP offer/ICE) and ACCEPTED (for answer/ICE)
    if (call.status !== 'RINGING' && call.status !== 'ACCEPTED') throw new HttpError(409, 'Call is not active');
    const targets = call.participants.map((p) => p.userId).filter((id) => id !== user.id && (!b.to || id === b.to));
    emitToUsers(targets, 'call:signal', { callId: b.callId, from: user.id, data: b.data });
  });

  socket.on('disconnect', async () => {
    const left = (await io.in(userRoom(userId)).fetchSockets()).length;
    if (left > 0) return;
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    void broadcastPresence(userId, false);
    // dropped connection during a call: give a short grace period before ending it
    setTimeout(async () => {
      try {
        if ((await io.in(userRoom(userId)).fetchSockets()).length > 0) return;
        const active = await prisma.call.findMany({ where: { status: 'ACCEPTED', participants: { some: { userId } } }, include: { participants: true } });
        for (const c of active) await finishCall(c, 'ENDED', 'call:ended');
      } catch (err) {
        console.warn('[Call cleanup on disconnect warning]:', err);
      }
    }, 15_000).unref();
  });
}

async function broadcastPresence(userId: string, online: boolean) {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  if (!u) return;
  const partners = await partnerIds(userId);
  const audience = u.privacyOnline === 'NOBODY' ? [] : [...partners];
  emitToUsers(audience, 'presence:update', { userId, online, lastSeenAt: u.privacyLastSeen === 'NOBODY' || online ? null : new Date() });
}

/** Messages that arrived while the user was offline become "delivered" as soon as they reconnect. */
async function deliverBacklog(userId: string, chatIds: string[]) {
  try {
    for (const chatId of chatIds) {
      const pending = await prisma.message.findMany({ where: { chatId, senderId: { not: userId }, receipts: { none: { userId } }, createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } }, select: { id: true }, take: 200 });
      if (pending.length) await markDelivered(userId, chatId, pending.map((p) => p.id));
    }
  } catch (e) {
    console.error('[socket] backlog delivery failed', e);
  }
}

// ---------------- calls ----------------
type CallFull = Call & { participants: { userId: string }[] };

async function loadCallFor(callId: string, userId: string): Promise<CallFull> {
  const call = await prisma.call.findUnique({ where: { id: callId }, include: { participants: true } });
  if (!call || !call.participants.some((p) => p.userId === userId)) throw new HttpError(404, 'Call not found'); // not a participant => indistinguishable from missing
  return call;
}

function clearRing(callId: string) {
  const t = ringTimers.get(callId);
  if (t) clearTimeout(t);
  ringTimers.delete(callId);
}

async function startCall(io: Server, caller: User, calleeId: string, kind: 'AUDIO' | 'VIDEO', chatId?: string) {
  const settings = await getSettings(caller.workspaceId);
  if (!settings.callsEnabled) throw new HttpError(403, 'Calls are disabled by your administrator');
  if (calleeId === caller.id) throw new HttpError(400, 'You cannot call yourself');
  const callee = await prisma.user.findFirst({ where: { id: calleeId, workspaceId: caller.workspaceId, status: 'ACTIVE' } });
  if (!callee) throw new HttpError(404, 'User not found');
  if (await isBlockedBetween(caller.id, callee.id)) throw new HttpError(403, 'You cannot call this user');
  if (chatId) {
    await requireMember(chatId, caller.id);
    const peer = await directPeer(chatId, caller.id);
    if (peer !== callee.id) throw new HttpError(400, 'Callee is not in this chat');
  }

  // Auto-expire stale calls older than 60s
  await prisma.call.updateMany({
    where: {
      status: 'RINGING',
      createdAt: { lt: new Date(Date.now() - RING_TIMEOUT_MS) },
    },
    data: { status: 'MISSED', endedAt: new Date() },
  });

  // Clear any dangling ringing calls from caller
  await prisma.call.updateMany({
    where: {
      callerId: caller.id,
      status: 'RINGING',
    },
    data: { status: 'CANCELLED', endedAt: new Date() },
  });

  const busy = await prisma.call.count({ where: { status: { in: ['RINGING', 'ACCEPTED'] }, participants: { some: { userId: { in: [caller.id, callee.id] } } } } });
  if (busy) throw new HttpError(409, 'One of you is already in a call');

  const call = await prisma.call.create({
    data: { callerId: caller.id, chatId, kind, participants: { create: [{ userId: caller.id, joinedAt: new Date(), seen: true }, { userId: callee.id }] } },
  });
  emitToUser(callee.id, 'call:incoming', { callId: call.id, kind, from: { id: caller.id, displayName: caller.displayName }, chatId: chatId ?? null });
  const online = (await io.in(userRoom(callee.id)).fetchSockets()).length > 0;
  if (!online) void sendPush(callee.id, `Incoming ${kind === 'VIDEO' ? 'video' : 'voice'} call from ${caller.displayName}`, { kind: 'call', callId: call.id });
  const timer = setTimeout(async () => {
    ringTimers.delete(call.id);
    const fresh = await prisma.call.findUnique({ where: { id: call.id }, include: { participants: true } });
    if (fresh?.status === 'RINGING') await finishCall(fresh, 'MISSED', 'call:missed');
  }, RING_TIMEOUT_MS);
  timer.unref();
  ringTimers.set(call.id, timer);
  return { callId: call.id, calleeOnline: online };
}

export async function endActiveCallForUser(
  userId: string,
  explicitCallId?: string,
  forceStatus?: 'DECLINED' | 'CANCELLED' | 'ENDED'
) {
  let call: CallFull | null = null;
  if (explicitCallId) {
    call = await prisma.call.findUnique({
      where: { id: explicitCallId },
      include: { participants: true },
    });
  }
  if (!call || (call.status !== 'RINGING' && call.status !== 'ACCEPTED')) {
    call = await prisma.call.findFirst({
      where: {
        status: { in: ['RINGING', 'ACCEPTED'] },
        participants: { some: { userId } },
      },
      include: { participants: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (call && (call.status === 'RINGING' || call.status === 'ACCEPTED')) {
    const isCaller = call.callerId === userId;
    const targetStatus: 'DECLINED' | 'CANCELLED' | 'ENDED' =
      forceStatus || (call.status === 'RINGING' ? (isCaller ? 'CANCELLED' : 'DECLINED') : 'ENDED');
    const event =
      targetStatus === 'ENDED' ? 'call:ended' : targetStatus === 'CANCELLED' ? 'call:cancelled' : 'call:declined';
    await finishCall(call, targetStatus, event);
    return { callId: call.id, status: targetStatus };
  }

  // Fallback: cleanup any stale ringing calls for this user
  await prisma.call.updateMany({
    where: {
      status: 'RINGING',
      participants: { some: { userId } },
    },
    data: { status: 'CANCELLED', endedAt: new Date() },
  });

  return { callId: explicitCallId, status: 'ENDED' };
}

export async function finishCall(call: CallFull, status: 'DECLINED' | 'CANCELLED' | 'MISSED' | 'ENDED', event: string) {
  clearRing(call.id);
  const endedAt = new Date();
  const durationSec = status === 'ENDED' && call.answeredAt ? Math.max(0, Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000)) : 0;
  const upd = await prisma.call.updateMany({ where: { id: call.id, status: { in: ['RINGING', 'ACCEPTED'] } }, data: { status, endedAt, durationSec } });
  if (!upd.count) return;
  await prisma.callParticipant.updateMany({ where: { callId: call.id, leftAt: null }, data: { leftAt: endedAt } });
  emitToUsers(call.participants.map((p) => p.userId), event, { callId: call.id, status, durationSec });
}

/** Called on boot: any call left ringing/active by a previous process can never complete. */
export async function failStaleCalls() {
  await prisma.call.updateMany({ where: { status: 'RINGING' }, data: { status: 'MISSED', endedAt: new Date() } });
  await prisma.call.updateMany({ where: { status: 'ACCEPTED' }, data: { status: 'ENDED', endedAt: new Date() } });
}

void env;
