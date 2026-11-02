import type { Chat, ChatMember, User } from '@prisma/client';
import { prisma } from './db.js';
import { forbidden, notFound } from './http.js';
import { hasRole } from '../middleware/auth.js';
import { joinUserToChat } from '../realtime/hub.js';

export type Membership = { chat: Chat; member: ChatMember };

/**
 * Central access check used by every chat/message/file/socket path.
 * Non-members get 404 (not 403) so the existence of private chats is not leaked.
 */
export async function requireMember(chatId: string, userId: string): Promise<Membership> {
  const member = await prisma.chatMember.findUnique({ where: { chatId_userId: { chatId, userId } }, include: { chat: true } });
  if (!member || member.chat.workspaceId == null) throw notFound('Chat not found');
  const { chat, ...m } = member;
  return { chat, member: m };
}

export const isChatAdmin = (m: ChatMember) => m.role === 'OWNER' || m.role === 'ADMIN';

export function requireChatAdmin({ member }: Membership) {
  if (!isChatAdmin(member)) throw forbidden('Only group admins can do that');
}

/** DM/groups: any member may post. Announcement channels: only channel admins. */
export function canPost({ chat, member }: Membership): boolean {
  return chat.type === 'CHANNEL' ? isChatAdmin(member) : true;
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const n = await prisma.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
  return n > 0;
}

export async function directPeer(chatId: string, userId: string): Promise<string | null> {
  const other = await prisma.chatMember.findFirst({ where: { chatId, userId: { not: userId } }, select: { userId: true } });
  return other?.userId ?? null;
}

/** Ids of everyone who shares at least one chat with the user. Used for CHAT_PARTNERS privacy. */
export async function partnerIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.chatMember.findMany({
    where: { userId: { not: userId }, chat: { members: { some: { userId } } } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return new Set(rows.map((r) => r.userId));
}

export async function joinDefaultChats(userId: string, workspaceId: string) {
  const chats = await prisma.chat.findMany({ where: { workspaceId, isDefault: true }, select: { id: true } });
  for (const c of chats) {
    await prisma.chatMember.upsert({ where: { chatId_userId: { chatId: c.id, userId } }, update: {}, create: { chatId: c.id, userId } });
    await joinUserToChat(userId, c.id);
  }
}

export const directKeyFor = (a: string, b: string) => [a, b].sort().join(':');

/** Workspace admins may manage chat metadata (not read messages) through the admin API. */
export const isWorkspaceAdmin = (u: User) => hasRole(u.role, 'ADMIN');
