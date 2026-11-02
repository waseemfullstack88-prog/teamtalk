import { Router } from 'express';
import { z } from 'zod';
import type { Chat, ChatMember, ChatType, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, parse, wrap } from '../lib/http.js';
import { directKeyFor, directPeer, isBlockedBetween, isChatAdmin, isWorkspaceAdmin, partnerIds, requireChatAdmin, requireMember } from '../lib/chatAccess.js';
import { getSettings } from '../lib/settings.js';
import { me, requireAuth } from '../middleware/auth.js';
import { messageInclude, onlineSet, publicUser, serializeMessage, type ViewerCtx } from '../lib/serialize.js';
import { emitToChat, emitToUser, emitToUsers, joinUserToChat, removeUserFromChatRoom } from '../realtime/hub.js';
import { createSystemMessage, forwardMessage, removeMessageContent, totalOthers } from '../services/messages.js';
import { storage } from '../lib/storage.js';

export const chatsRouter = Router();
chatsRouter.use(requireAuth);

type ChatWithMembers = Chat & { members: (ChatMember & { user: User })[] };

async function viewerCtx(userId: string): Promise<ViewerCtx> {
  return { viewerId: userId, partners: await partnerIds(userId), online: await onlineSet() };
}

export async function unreadCount(chatId: string, userId: string, member: ChatMember) {
  return prisma.message.count({
    where: {
      chatId, senderId: { not: userId }, deletedForAllAt: null, type: { not: 'SYSTEM' },
      createdAt: { gt: new Date(Math.max(member.lastReadAt?.getTime() ?? 0, member.clearedAt?.getTime() ?? 0)) },
      deletions: { none: { userId } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

export async function serializeChat(chat: ChatWithMembers, userId: string, ctx: ViewerCtx, opts: { withLast?: boolean } = { withLast: true }) {
  const mine = chat.members.find((m) => m.userId === userId)!;
  let lastMessage = null;
  if (opts.withLast !== false) {
    const last = await prisma.message.findFirst({
      where: {
        chatId: chat.id, deletions: { none: { userId } },
        createdAt: mine.clearedAt ? { gt: mine.clearedAt } : undefined,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' }, include: messageInclude,
    });
    if (last) lastMessage = serializeMessage(last, userId, await totalOthers(chat.id, userId));
  }
  return {
    id: chat.id, type: chat.type, name: chat.name, description: chat.description, avatarFileId: chat.avatarFileId,
    isProtected: chat.isProtected, disappearingSeconds: chat.disappearingSeconds, membersCanInvite: chat.membersCanInvite,
    archivedForAll: chat.archivedForAll, createdAt: chat.createdAt, updatedAt: chat.updatedAt,
    myRole: mine.role, muted: !!mine.mutedUntil && mine.mutedUntil > new Date(), mutedUntil: mine.mutedUntil,
    pinned: mine.pinned, archived: mine.archived, unread: await unreadCount(chat.id, userId, mine),
    members: chat.members.map((m) => ({ ...publicUser(m.user, ctx), role: m.role, joinedAt: m.joinedAt })),
    lastMessage,
  };
}

const chatInclude = { members: { include: { user: true } } } as const;

async function loadChat(chatId: string) {
  return prisma.chat.findUniqueOrThrow({ where: { id: chatId }, include: chatInclude });
}

chatsRouter.get('/', wrap(async (req, res) => {
  const user = me(req);
  const ctx = await viewerCtx(user.id);
  const chats = await prisma.chat.findMany({
    where: { members: { some: { userId: user.id, hidden: false } } },
    include: chatInclude, orderBy: { updatedAt: 'desc' },
  });
  const out = await Promise.all(chats.map((c) => serializeChat(c, user.id, ctx)));
  res.json({ chats: out });
}));

const createSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('DIRECT'), userId: z.string().max(40) }),
  z.object({ type: z.literal('GROUP'), name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(), memberIds: z.array(z.string().max(40)).max(255) }),
  z.object({ type: z.literal('CHANNEL'), name: z.string().trim().min(1).max(80), description: z.string().max(500).optional(), memberIds: z.array(z.string().max(40)).max(1000) }),
]);

/** May `actor` add `target` to a group, given the target's privacy setting? */
async function mayAdd(actor: User, target: User): Promise<boolean> {
  if (target.privacyGroups === 'EVERYONE') return true;
  if (target.privacyGroups === 'NOBODY') return isWorkspaceAdmin(actor);
  return (await partnerIds(actor.id)).has(target.id) || isWorkspaceAdmin(actor);
}

chatsRouter.post('/', wrap(async (req, res) => {
  const user = me(req);
  const b = parse(createSchema, req.body);
  let chat: Chat;
  if (b.type === 'DIRECT') {
    if (b.userId === user.id) throw badRequest('You cannot start a chat with yourself');
    const other = await prisma.user.findFirst({ where: { id: b.userId, workspaceId: user.workspaceId, status: 'ACTIVE' } });
    if (!other) throw notFound('User not found');
    if (await isBlockedBetween(user.id, other.id)) throw forbidden('You cannot message this user');
    const key = directKeyFor(user.id, other.id);
    const existing = await prisma.chat.findUnique({ where: { directKey: key } });
    if (existing) {
      await prisma.chatMember.update({ where: { chatId_userId: { chatId: existing.id, userId: user.id } }, data: { hidden: false } });
      chat = existing;
    } else {
      chat = await prisma.chat.create({
        data: { workspaceId: user.workspaceId, type: 'DIRECT', directKey: key, createdById: user.id, members: { create: [{ userId: user.id }, { userId: other.id }] } },
      });
      await joinUserToChat(user.id, chat.id);
      await joinUserToChat(other.id, chat.id);
    }
  } else {
    if (b.type === 'CHANNEL' && !isWorkspaceAdmin(user)) throw forbidden('Only administrators can create announcement channels');
    const targets = await prisma.user.findMany({ where: { id: { in: b.memberIds, not: user.id }, workspaceId: user.workspaceId, status: 'ACTIVE' } });
    const allowed: User[] = [];
    for (const t of targets) if (await mayAdd(user, t)) allowed.push(t);
    chat = await prisma.chat.create({
      data: {
        workspaceId: user.workspaceId, type: b.type as ChatType, name: b.name, description: b.description ?? '', createdById: user.id,
        members: { create: [{ userId: user.id, role: 'OWNER' }, ...allowed.map((t) => ({ userId: t.id }))] },
      },
    });
    await Promise.all([user, ...allowed].map((u) => joinUserToChat(u.id, chat.id)));
    await createSystemMessage(chat.id, user.id, `${user.displayName} created ${b.type === 'CHANNEL' ? 'this channel' : 'the group'} “${b.name}”`);
  }
  const full = await loadChat(chat.id);
  const ctx = await viewerCtx(user.id);
  const payload = await serializeChat(full, user.id, ctx);
  emitToUsers(full.members.filter((m) => m.userId !== user.id).map((m) => m.userId), 'chat:updated', { chatId: chat.id });
  res.status(201).json({ chat: payload });
}));

chatsRouter.get('/:id', wrap(async (req, res) => {
  const user = me(req);
  await requireMember(String(req.params.id), user.id);
  res.json({ chat: await serializeChat(await loadChat(String(req.params.id)), user.id, await viewerCtx(user.id)) });
}));

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  avatarFileId: z.string().max(40).nullable().optional(),
  membersCanInvite: z.boolean().optional(),
  disappearingSeconds: z.number().int().nullable().optional(),
  isProtected: z.boolean().optional(),
  archivedForAll: z.boolean().optional(),
});

/** Shared by the chat route and the admin API (admins can protect chats they are not a member of). */
export async function setProtected(chatId: string, enabled: boolean, actor: User, req?: import('express').Request) {
  if (!isWorkspaceAdmin(actor)) throw forbidden('Only administrators can change Protected Chat mode');
  const chat = await prisma.chat.findFirst({ where: { id: chatId, workspaceId: actor.workspaceId } });
  if (!chat) throw notFound('Chat not found');
  const settings = await getSettings(chat.workspaceId);
  if (enabled && !settings.protectedChat.allowed) throw forbidden('Protected Chat is disabled by workspace policy');
  const data: { isProtected: boolean; disappearingSeconds?: number } = { isProtected: enabled };
  if (enabled && (!chat.disappearingSeconds || chat.disappearingSeconds > settings.protectedChat.forceDisappearingSeconds)) {
    data.disappearingSeconds = settings.protectedChat.forceDisappearingSeconds;
  }
  await prisma.chat.update({ where: { id: chat.id }, data });
  await audit({ action: 'CHAT_PROTECTED_CHANGED', actorId: actor.id, targetType: 'chat', targetId: chat.id, req, metadata: { enabled } });
  await createSystemMessage(chat.id, actor.id, enabled ? 'An administrator turned on Protected Chat: forwarding and export are disabled, messages disappear, and screen-capture protection is enforced where supported.' : 'An administrator turned off Protected Chat.');
  emitToChat(chat.id, 'chat:updated', { chatId: chat.id });
}

chatsRouter.patch('/:id', wrap(async (req, res) => {
  const user = me(req);
  const b = parse(patchSchema, req.body);
  const ms = await requireMember(String(req.params.id), user.id);
  const { chat } = ms;
  const settings = await getSettings(chat.workspaceId);

  const metaChange = b.name !== undefined || b.description !== undefined || b.avatarFileId !== undefined || b.membersCanInvite !== undefined || b.archivedForAll !== undefined;
  if (metaChange) {
    if (chat.type === 'DIRECT') throw badRequest('Direct chats have no group settings');
    requireChatAdmin(ms);
  }
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.description !== undefined) data.description = b.description;
  if (b.membersCanInvite !== undefined) data.membersCanInvite = b.membersCanInvite;
  if (b.archivedForAll !== undefined) data.archivedForAll = b.archivedForAll;
  if (b.avatarFileId !== undefined) {
    if (b.avatarFileId) {
      const f = await prisma.attachment.findFirst({ where: { id: b.avatarFileId, uploaderId: user.id, purpose: 'AVATAR' } });
      if (!f) throw badRequest('Invalid avatar');
    }
    data.avatarFileId = b.avatarFileId;
  }
  if (b.disappearingSeconds !== undefined) {
    if (chat.type !== 'DIRECT') requireChatAdmin(ms);
    const v = b.disappearingSeconds;
    if (v !== null && !settings.disappearing.allowedSeconds.includes(v)) throw badRequest('That disappearing-message time is not allowed by your administrator');
    if (v === null && chat.isProtected) throw forbidden('Disappearing messages cannot be turned off in a Protected Chat');
    data.disappearingSeconds = v;
  }
  if (b.isProtected !== undefined && b.isProtected !== chat.isProtected) await setProtected(chat.id, b.isProtected, user, req);
  if (Object.keys(data).length) {
    await prisma.chat.update({ where: { id: chat.id }, data });
    if (b.name !== undefined && b.name !== chat.name) await createSystemMessage(chat.id, user.id, `${user.displayName} renamed the chat to “${b.name}”`);
    if (b.disappearingSeconds !== undefined) await createSystemMessage(chat.id, user.id, b.disappearingSeconds ? `${user.displayName} turned on disappearing messages` : `${user.displayName} turned off disappearing messages`);
    emitToChat(chat.id, 'chat:updated', { chatId: chat.id });
  }
  res.json({ chat: await serializeChat(await loadChat(chat.id), user.id, await viewerCtx(user.id)) });
}));

// per-user preferences: mute, pin, archive
chatsRouter.put('/:id/prefs', wrap(async (req, res) => {
  const user = me(req);
  const b = parse(z.object({
    mutedUntil: z.string().datetime().nullable().optional(),
    muteForever: z.boolean().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  }), req.body);
  await requireMember(String(req.params.id), user.id);
  const data: Record<string, unknown> = {};
  if (b.muteForever) data.mutedUntil = new Date('2999-01-01');
  else if (b.mutedUntil !== undefined) data.mutedUntil = b.mutedUntil ? new Date(b.mutedUntil) : null;
  if (b.pinned !== undefined) {
    if (b.pinned && (await prisma.chatMember.count({ where: { userId: user.id, pinned: true } })) >= 5) throw badRequest('You can pin up to 5 chats');
    data.pinned = b.pinned;
  }
  if (b.archived !== undefined) data.archived = b.archived;
  await prisma.chatMember.update({ where: { chatId_userId: { chatId: String(req.params.id), userId: user.id } }, data });
  emitToUser(user.id, 'chat:updated', { chatId: String(req.params.id) });
  res.json({ ok: true });
}));

chatsRouter.delete('/:id', wrap(async (req, res) => {
  const user = me(req);
  const ms = await requireMember(String(req.params.id), user.id);
  const scope = z.enum(['me', 'all']).default('me').parse(req.query.scope);
  if (scope === 'me' || ms.chat.type === 'DIRECT') {
    await prisma.chatMember.update({ where: { chatId_userId: { chatId: ms.chat.id, userId: user.id } }, data: { hidden: true, clearedAt: new Date(), pinned: false } });
    emitToUser(user.id, 'chat:updated', { chatId: ms.chat.id, removed: true });
    return res.json({ ok: true, scope: 'me' });
  }
  if (ms.member.role !== 'OWNER' && !isWorkspaceAdmin(user)) throw forbidden('Only the group owner or an administrator can delete this group for everyone');
  await deleteChatForEveryone(ms.chat.id, user, req);
  res.json({ ok: true, scope: 'all' });
}));

export async function deleteChatForEveryone(chatId: string, actor: User, req?: import('express').Request) {
  const members = await prisma.chatMember.findMany({ where: { chatId }, select: { userId: true } });
  const msgs = await prisma.message.findMany({ where: { chatId }, select: { id: true } });
  await removeMessageContent(msgs.map((m) => m.id));
  emitToChat(chatId, 'chat:deleted', { chatId });
  await prisma.chat.delete({ where: { id: chatId } });
  await Promise.all(members.map((m) => removeUserFromChatRoom(m.userId, chatId)));
  await audit({ action: 'CHAT_DELETED', actorId: actor.id, targetType: 'chat', targetId: chatId, req });
  void storage;
}

// ----- members -----
chatsRouter.post('/:id/members', wrap(async (req, res) => {
  const user = me(req);
  const { userIds } = parse(z.object({ userIds: z.array(z.string().max(40)).min(1).max(100) }), req.body);
  const ms = await requireMember(String(req.params.id), user.id);
  if (ms.chat.type === 'DIRECT') throw badRequest('Cannot add people to a direct chat');
  if (!isChatAdmin(ms.member) && !ms.chat.membersCanInvite) throw forbidden('Only group admins can add members');
  const targets = await prisma.user.findMany({ where: { id: { in: userIds }, workspaceId: user.workspaceId, status: 'ACTIVE' } });
  const added: string[] = [];
  const skipped: string[] = [];
  for (const t of targets) {
    if (!(await mayAdd(user, t))) { skipped.push(t.id); continue; }
    const r = await prisma.chatMember.createMany({ data: [{ chatId: ms.chat.id, userId: t.id }], skipDuplicates: true });
    if (r.count) { added.push(t.id); await joinUserToChat(t.id, ms.chat.id); }
  }
  if (added.length) {
    await audit({ action: 'GROUP_MEMBER_CHANGED', actorId: user.id, targetType: 'chat', targetId: ms.chat.id, req, metadata: { added } });
    await createSystemMessage(ms.chat.id, user.id, `${user.displayName} added ${added.length} member${added.length > 1 ? 's' : ''}`);
    emitToUsers(added, 'chat:updated', { chatId: ms.chat.id });
    emitToChat(ms.chat.id, 'chat:updated', { chatId: ms.chat.id });
  }
  res.json({ added, skipped });
}));

chatsRouter.delete('/:id/members/:userId', wrap(async (req, res) => {
  const user = me(req);
  const targetId = String(req.params.userId);
  const ms = await requireMember(String(req.params.id), user.id);
  if (ms.chat.type === 'DIRECT') throw badRequest('Cannot remove people from a direct chat');
  const self = targetId === user.id;
  const target = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: ms.chat.id, userId: targetId } } });
  if (!target) throw notFound('Member not found');
  if (!self) {
    requireChatAdmin(ms);
    if (target.role === 'OWNER' || (target.role === 'ADMIN' && ms.member.role !== 'OWNER')) throw forbidden('You cannot remove this member');
  }
  await prisma.chatMember.delete({ where: { chatId_userId: { chatId: ms.chat.id, userId: targetId } } });
  if (self && target.role === 'OWNER') {
    const next = await prisma.chatMember.findFirst({ where: { chatId: ms.chat.id }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }] });
    if (next) await prisma.chatMember.update({ where: { chatId_userId: { chatId: ms.chat.id, userId: next.userId } }, data: { role: 'OWNER' } });
  }
  await audit({ action: 'GROUP_MEMBER_CHANGED', actorId: user.id, targetType: 'chat', targetId: ms.chat.id, req, metadata: { removed: targetId } });
  await createSystemMessage(ms.chat.id, user.id, self ? `${user.displayName} left` : `${user.displayName} removed a member`);
  emitToUser(targetId, 'chat:updated', { chatId: ms.chat.id, removed: true });
  await removeUserFromChatRoom(targetId, ms.chat.id);
  emitToChat(ms.chat.id, 'chat:updated', { chatId: ms.chat.id });
  res.json({ ok: true });
}));

chatsRouter.patch('/:id/members/:userId', wrap(async (req, res) => {
  const user = me(req);
  const { role } = parse(z.object({ role: z.enum(['ADMIN', 'MEMBER']) }), req.body);
  const ms = await requireMember(String(req.params.id), user.id);
  requireChatAdmin(ms);
  const target = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId: ms.chat.id, userId: String(req.params.userId) } } });
  if (!target || ms.chat.type === 'DIRECT') throw notFound('Member not found');
  if (target.role === 'OWNER') throw forbidden('The owner role cannot be changed');
  if (target.role === 'ADMIN' && role === 'MEMBER' && ms.member.role !== 'OWNER') throw forbidden('Only the owner can demote admins');
  await prisma.chatMember.update({ where: { chatId_userId: { chatId: ms.chat.id, userId: target.userId } }, data: { role } });
  await audit({ action: 'GROUP_MEMBER_CHANGED', actorId: user.id, targetType: 'chat', targetId: ms.chat.id, req, metadata: { user: target.userId, role } });
  emitToChat(ms.chat.id, 'chat:updated', { chatId: ms.chat.id });
  res.json({ ok: true });
}));

// ----- shared media / docs / links (media gallery) -----
chatsRouter.get('/:id/shared', wrap(async (req, res) => {
  const user = me(req);
  const ms = await requireMember(String(req.params.id), user.id);
  const kind = z.enum(['media', 'docs', 'links']).parse(req.query.kind);
  const base = {
    message: { chatId: ms.chat.id, deletedForAllAt: null, deletions: { none: { userId: user.id } }, createdAt: ms.member.clearedAt ? { gt: ms.member.clearedAt } : undefined, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  };
  if (kind === 'links') {
    const msgs = await prisma.message.findMany({ where: { ...base.message, type: 'TEXT' }, orderBy: { createdAt: 'desc' }, take: 500, include: messageInclude });
    const links: { url: string; messageId: string; senderId: string; at: Date }[] = [];
    for (const m of msgs) {
      const s = serializeMessage(m, user.id, 0);
      for (const url of s.body?.match(/https?:\/\/[^\s<>"']+/g) ?? []) links.push({ url, messageId: m.id, senderId: m.senderId, at: m.createdAt });
    }
    return res.json({ items: links.slice(0, 100) });
  }
  const mimeFilter = kind === 'media' ? { OR: [{ mime: { startsWith: 'image/' } }, { mime: { startsWith: 'video/' } }] } : { NOT: [{ mime: { startsWith: 'image/' } }, { mime: { startsWith: 'video/' } }, { mime: { startsWith: 'audio/' } }] };
  const items = await prisma.attachment.findMany({ where: { ...base, ...mimeFilter }, orderBy: { createdAt: 'desc' }, take: 100, include: { message: { select: { id: true, senderId: true, createdAt: true } } } });
  res.json({ items: items.map((a) => ({ id: a.id, name: a.originalName, mime: a.mime, size: a.size, createdAt: a.createdAt, messageId: a.messageId, senderId: a.message?.senderId })) });
}));

void [conflict, forwardMessage];
