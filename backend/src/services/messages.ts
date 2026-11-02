import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import type { Prisma, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { encryptAtRest } from '../lib/atrest.js';
import { badRequest, forbidden, notFound } from '../lib/http.js';
import { canPost, directPeer, isBlockedBetween, isChatAdmin, requireMember, type Membership } from '../lib/chatAccess.js';
import { bodyOf, messageInclude, serializeMessage, type FullMessage } from '../lib/serialize.js';
import { emitToChat, emitToUser, getIo, userRoom } from '../realtime/hub.js';
import { sendPush } from '../lib/push.js';
import { getSettings } from '../lib/settings.js';
import { storage } from '../lib/storage.js';

export const EDIT_WINDOW_SECONDS = 15 * 60;
const MEDIA_TYPES = ['IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'FILE'] as const;

const GIF_HOSTS = ['giphy.com', 'tenor.com', 'tenor.co'];
const gifUrl = z.string().url().max(500).refine((u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && GIF_HOSTS.some((h) => x.hostname === h || x.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}, 'GIF must be served from an approved provider over HTTPS');

export const sendSchema = z.object({
  clientId: z.string().min(8).max(64).optional(),
  type: z.enum(['TEXT', 'STICKER', 'GIF', 'IMAGE', 'VIDEO', 'AUDIO', 'VOICE', 'FILE', 'POLL']).default('TEXT'),
  body: z.string().max(8000).optional(),
  replyToId: z.string().max(40).optional(),
  mentions: z.array(z.string().max(40)).max(50).optional(),
  attachmentIds: z.array(z.string().max(40)).max(10).optional(),
  meta: z
    .object({
      stickerId: z.string().regex(/^[a-z0-9_-]{1,40}$/).optional(),
      gifUrl: gifUrl.optional(),
      gifTitle: z.string().max(100).optional(),
      duration: z.number().min(0).max(3600).optional(),
      peaks: z.array(z.number().min(0).max(1)).max(160).optional(),
    })
    .strict()
    .optional(),
  poll: z.object({ question: z.string().trim().min(1).max(300), options: z.array(z.string().trim().min(1).max(120)).min(2).max(12), multiple: z.boolean().default(false) }).optional(),
});
export type SendInput = z.infer<typeof sendSchema>;

export async function totalOthers(chatId: string, userId: string) {
  return prisma.chatMember.count({ where: { chatId, userId: { not: userId } } });
}

export async function loadFull(id: string): Promise<FullMessage | null> {
  return prisma.message.findUnique({ where: { id }, include: messageInclude });
}

/** Message visible to this user? (member, not deleted-for-me, after cleared marker, not expired) */
export async function requireMessage(id: string, userId: string): Promise<{ msg: FullMessage; ms: Membership }> {
  const msg = await loadFull(id);
  if (!msg) throw notFound('Message not found');
  const ms = await requireMember(msg.chatId, userId);
  if (msg.deletions.some((d) => d.userId === userId)) throw notFound('Message not found');
  if (ms.member.clearedAt && msg.createdAt <= ms.member.clearedAt) throw notFound('Message not found');
  if (msg.expiresAt && msg.expiresAt <= new Date()) throw notFound('Message not found');
  return { msg, ms };
}

export async function publishMessage(msg: FullMessage, chatId: string) {
  // generic (viewer-less) payload for everyone in the chat room; sender gets the personalised one by ack/HTTP response
  emitToChat(chatId, 'message:new', serializeMessage(msg, '', 0));
}

export async function sendMessage(user: User, chatId: string, raw: unknown, req?: Request, opts: { forwarded?: { fromUserId: string } } = {}) {
  const input = sendSchema.parse(raw);
  const ms = await requireMember(chatId, user.id);
  const { chat } = ms;
  if (chat.archivedForAll) throw forbidden('This chat is archived');
  if (!canPost(ms)) throw forbidden('Only admins can post in this announcement channel');

  if (chat.type === 'DIRECT') {
    const peer = await directPeer(chat.id, user.id);
    if (peer && (await isBlockedBetween(user.id, peer))) throw forbidden('You can no longer message this contact');
  }

  if (input.clientId) {
    const dup = await prisma.message.findUnique({ where: { senderId_clientId: { senderId: user.id, clientId: input.clientId } }, include: messageInclude });
    if (dup) return serializeMessage(dup, user.id, await totalOthers(chatId, user.id));
  }

  const text = input.body?.trim() ?? '';
  if (input.type === 'TEXT' && !text) throw badRequest('Message is empty');
  if (input.type === 'STICKER' && !input.meta?.stickerId) throw badRequest('Sticker is required');
  if (input.type === 'GIF' && !input.meta?.gifUrl) throw badRequest('GIF is required');
  if (input.type === 'POLL' && !input.poll) throw badRequest('Poll is required');
  if (input.poll && new Set(input.poll.options.map((o) => o.toLowerCase())).size !== input.poll.options.length) throw badRequest('Poll options must be unique');

  // attachments: must be the sender's own, unattached, clean uploads
  let attachmentIds: string[] = [];
  if ((MEDIA_TYPES as readonly string[]).includes(input.type)) {
    attachmentIds = input.attachmentIds ?? [];
    if (!attachmentIds.length) throw badRequest('Attach at least one file');
    const atts = await prisma.attachment.findMany({ where: { id: { in: attachmentIds }, uploaderId: user.id, messageId: null, statusId: null, purpose: 'MESSAGE' } });
    if (atts.length !== attachmentIds.length) throw badRequest('One or more attachments are invalid');
    if (atts.some((a) => a.scanStatus === 'INFECTED')) throw badRequest('Attachment failed the security scan');
    const fam = (a: { mime: string }) => a.mime.split('/')[0];
    if (input.type === 'IMAGE' && atts.some((a) => fam(a) !== 'image')) throw badRequest('Attachment is not an image');
    if (input.type === 'VIDEO' && atts.some((a) => fam(a) !== 'video')) throw badRequest('Attachment is not a video');
    if ((input.type === 'AUDIO' || input.type === 'VOICE') && atts.some((a) => fam(a) !== 'audio' && a.mime !== 'video/webm' && a.mime !== 'video/mp4')) throw badRequest('Attachment is not audio');
  }

  let replyToId: string | undefined;
  if (input.replyToId) {
    const r = await prisma.message.findFirst({ where: { id: input.replyToId, chatId, deletedForAllAt: null } });
    if (!r) throw badRequest('Message to reply to was not found');
    replyToId = r.id;
  }

  let mentions: string[] = [];
  if (input.mentions?.length) {
    const ok = await prisma.chatMember.findMany({ where: { chatId, userId: { in: input.mentions } }, select: { userId: true } });
    mentions = ok.map((m) => m.userId);
  }

  const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
  if (mentions.length) meta.mentions = mentions;

  const id = randomUUID();
  const msg = await prisma.message.create({
    data: {
      id, chatId, senderId: user.id, clientId: input.clientId, type: input.type,
      bodyEnc: text ? encryptAtRest(text, chatId) : null,
      meta: meta as Prisma.InputJsonValue, replyToId,
      forwarded: !!opts.forwarded, forwardedFromUserId: opts.forwarded?.fromUserId,
      expiresAt: chat.disappearingSeconds ? new Date(Date.now() + chat.disappearingSeconds * 1000) : null,
      attachments: attachmentIds.length ? { connect: attachmentIds.map((i) => ({ id: i })) } : undefined,
      poll: input.poll ? { create: { question: input.poll.question, multiple: input.poll.multiple, options: { create: input.poll.options.map((t, pos) => ({ text: t, pos })) } } } : undefined,
    },
    include: messageInclude,
  });
  await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });
  // un-hide the chat for members who "deleted" it
  await prisma.chatMember.updateMany({ where: { chatId, hidden: true }, data: { hidden: false } });

  await publishMessage(msg, chatId);
  void notifyOffline(chat.id, user, chat.type, mentions);
  return serializeMessage(msg, user.id, await totalOthers(chatId, user.id));
}

/** Push to members who have no live socket. Payload carries no message text. */
async function notifyOffline(chatId: string, sender: User, chatType: string, mentions: string[]) {
  try {
    const members = await prisma.chatMember.findMany({ where: { chatId, userId: { not: sender.id } }, include: { user: { select: { id: true, status: true } } } });
    const io = getIo();
    for (const m of members) {
      if (m.user.status !== 'ACTIVE') continue;
      if (m.mutedUntil && m.mutedUntil > new Date() && !mentions.includes(m.userId)) continue;
      if (io && (await io.in(userRoom(m.userId)).fetchSockets()).length > 0) continue;
      await sendPush(m.userId, chatType === 'DIRECT' ? `New message from ${sender.displayName}` : 'New group message', { chatId, kind: 'message' });
    }
  } catch (e) {
    console.error('[push] notify failed', e);
  }
}

export async function createSystemMessage(chatId: string, actorId: string, text: string) {
  const msg = await prisma.message.create({
    data: { chatId, senderId: actorId, type: 'SYSTEM', bodyEnc: encryptAtRest(text, chatId) },
    include: messageInclude,
  });
  await publishMessage(msg, chatId);
  return msg;
}

export async function editMessage(user: User, messageId: string, bodyRaw: string) {
  const body = z.string().trim().min(1).max(8000).parse(bodyRaw);
  const { msg } = await requireMessage(messageId, user.id);
  if (msg.senderId !== user.id) throw forbidden('You can only edit your own messages');
  if (msg.type !== 'TEXT' || msg.deletedForAllAt) throw badRequest('This message cannot be edited');
  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_SECONDS * 1000) throw forbidden('The edit window has passed');
  const updated = await prisma.message.update({ where: { id: msg.id }, data: { bodyEnc: encryptAtRest(body, msg.chatId), editedAt: new Date() }, include: messageInclude });
  emitToChat(msg.chatId, 'message:updated', serializeMessage(updated, '', 0));
  return serializeMessage(updated, user.id, await totalOthers(msg.chatId, user.id));
}

export async function deleteMessage(user: User, messageId: string, scope: 'me' | 'all', req?: Request) {
  const { msg, ms } = await requireMessage(messageId, user.id);
  if (scope === 'me') {
    await prisma.messageDeletion.upsert({ where: { messageId_userId: { messageId, userId: user.id } }, update: {}, create: { messageId, userId: user.id } });
    emitToUser(user.id, 'message:deleted-for-me', { chatId: msg.chatId, messageId });
    return { ok: true };
  }
  const settings = await getSettings(ms.chat.workspaceId);
  const own = msg.senderId === user.id;
  const withinWindow = Date.now() - msg.createdAt.getTime() <= settings.deleteForEveryoneSeconds * 1000;
  if (own) {
    if (!withinWindow) throw forbidden('You can only delete for everyone shortly after sending');
  } else if (!(isChatAdmin(ms.member) && ms.chat.type !== 'DIRECT')) {
    throw forbidden('You can only delete your own messages for everyone');
  }
  await removeMessageContent([msg.id]);
  await prisma.message.update({ where: { id: msg.id }, data: { deletedForAllAt: new Date(), bodyEnc: null, meta: {}, pinnedAt: null } });
  if (!own) await audit({ action: 'GROUP_MEMBER_CHANGED', actorId: user.id, targetType: 'message', targetId: msg.id, req, metadata: { moderation: 'deleted_for_all' } });
  emitToChat(msg.chatId, 'message:deleted', { chatId: msg.chatId, messageId: msg.id });
  return { ok: true };
}

/** Remove attachment rows and (when unreferenced) their stored objects. */
export async function removeMessageContent(messageIds: string[]) {
  const atts = await prisma.attachment.findMany({ where: { messageId: { in: messageIds } } });
  if (!atts.length) return;
  await prisma.attachment.deleteMany({ where: { id: { in: atts.map((a) => a.id) } } });
  for (const key of new Set(atts.map((a) => a.storageKey))) {
    if ((await prisma.attachment.count({ where: { storageKey: key } })) === 0) await storage().remove(key).catch((e) => console.error('[storage] remove failed', e));
  }
}

export async function forwardMessage(user: User, messageId: string, chatIds: string[], req?: Request) {
  const { msg, ms } = await requireMessage(messageId, user.id);
  if (ms.chat.isProtected) {
    await audit({ action: 'PROTECTED_CHAT_DENIED', actorId: user.id, targetType: 'message', targetId: msg.id, req, metadata: { op: 'forward' } });
    throw forbidden('Forwarding is disabled in Protected Chats');
  }
  if (msg.deletedForAllAt || msg.type === 'POLL' || msg.type === 'SYSTEM') throw badRequest('This message cannot be forwarded');
  const out = [];
  for (const target of new Set(chatIds)) {
    const tms = await requireMember(target, user.id);
    if (tms.chat.isProtected) throw forbidden('Cannot forward into a Protected Chat');
    // clone attachments so each copy can be deleted independently
    const clones = [];
    for (const a of msg.attachments) {
      const c = await prisma.attachment.create({ data: { uploaderId: user.id, storageKey: a.storageKey, originalName: a.originalName, mime: a.mime, size: a.size, sha256: a.sha256, scanStatus: a.scanStatus } });
      clones.push(c.id);
    }
    out.push(
      await sendMessage(user, target, {
        type: msg.type, body: bodyOf(msg) ?? undefined, attachmentIds: clones,
        meta: pickMeta(msg.meta),
      }, req, { forwarded: { fromUserId: msg.senderId } }),
    );
  }
  return out;
}

function pickMeta(meta: unknown) {
  const m = (meta ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ['stickerId', 'gifUrl', 'gifTitle', 'duration', 'peaks']) if (m[k] !== undefined) out[k] = m[k];
  return out;
}

export async function setReaction(user: User, messageId: string, emoji: string | null) {
  const { msg } = await requireMessage(messageId, user.id);
  if (msg.deletedForAllAt) throw badRequest('Message was deleted');
  if (emoji === null) await prisma.reaction.deleteMany({ where: { messageId, userId: user.id } });
  else {
    const e = z.string().min(1).max(16).regex(/\p{Extended_Pictographic}/u, 'Reactions must be emoji').parse(emoji);
    await prisma.reaction.upsert({ where: { messageId_userId: { messageId, userId: user.id } }, update: { emoji: e }, create: { messageId, userId: user.id, emoji: e } });
  }
  const updated = (await loadFull(messageId))!;
  const payload = serializeMessage(updated, '', 0);
  emitToChat(msg.chatId, 'message:reactions', { chatId: msg.chatId, messageId, reactions: payload.reactions });
  return payload.reactions;
}

export async function markDelivered(userId: string, chatId: string, messageIds: string[]) {
  await requireMember(chatId, userId);
  const msgs = await prisma.message.findMany({ where: { id: { in: messageIds.slice(0, 200) }, chatId, senderId: { not: userId }, receipts: { none: { userId } } }, select: { id: true } });
  if (!msgs.length) return;
  await prisma.receipt.createMany({ data: msgs.map((m) => ({ messageId: m.id, userId, state: 'DELIVERED' as const })), skipDuplicates: true });
  emitToChat(chatId, 'receipt:update', { chatId, messageIds: msgs.map((m) => m.id), userId, state: 'delivered' });
}

export async function markRead(user: User, chatId: string) {
  const ms = await requireMember(chatId, user.id);
  const unread = await prisma.message.findMany({
    where: { chatId, senderId: { not: user.id }, createdAt: { gt: ms.member.lastReadAt ?? new Date(0) }, deletedForAllAt: null },
    select: { id: true }, orderBy: { createdAt: 'asc' }, take: 500,
  });
  const now = new Date();
  await prisma.chatMember.update({ where: { chatId_userId: { chatId, userId: user.id } }, data: { lastReadAt: now, lastReadMessageId: unread.at(-1)?.id ?? ms.member.lastReadMessageId } });
  emitToUser(user.id, 'chat:read', { chatId }); // sync unread badge across my devices
  // Read receipts are optional: if the reader disabled them, only DELIVERED is ever recorded.
  if (user.readReceipts && unread.length) {
    for (const m of unread) {
      await prisma.receipt.upsert({ where: { messageId_userId: { messageId: m.id, userId: user.id } }, update: { state: 'READ', at: now }, create: { messageId: m.id, userId: user.id, state: 'READ' } });
    }
    emitToChat(chatId, 'receipt:update', { chatId, messageIds: unread.map((m) => m.id), userId: user.id, state: 'read' });
  } else if (unread.length) {
    await prisma.receipt.createMany({ data: unread.map((m) => ({ messageId: m.id, userId: user.id, state: 'DELIVERED' as const })), skipDuplicates: true });
    emitToChat(chatId, 'receipt:update', { chatId, messageIds: unread.map((m) => m.id), userId: user.id, state: 'delivered' });
  }
  return { ok: true, count: unread.length };
}

export async function votePoll(user: User, messageId: string, optionIds: string[]) {
  const { msg } = await requireMessage(messageId, user.id);
  if (!msg.poll || msg.poll.closedAt) throw badRequest('Poll is not open');
  const valid = new Set(msg.poll.options.map((o) => o.id));
  if (optionIds.some((o) => !valid.has(o))) throw badRequest('Invalid poll option');
  if (!msg.poll.multiple && optionIds.length > 1) throw badRequest('Only one option allowed');
  await prisma.pollVote.deleteMany({ where: { userId: user.id, optionId: { in: [...valid] } } });
  if (optionIds.length) await prisma.pollVote.createMany({ data: optionIds.map((optionId) => ({ optionId, userId: user.id })) });
  const updated = (await loadFull(messageId))!;
  emitToChat(msg.chatId, 'message:updated', serializeMessage(updated, '', 0));
  return serializeMessage(updated, user.id, await totalOthers(msg.chatId, user.id));
}
