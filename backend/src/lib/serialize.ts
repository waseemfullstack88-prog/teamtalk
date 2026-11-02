import type { Prisma, User, Visibility } from '@prisma/client';
import { prisma } from './db.js';
import { decryptAtRest } from './atrest.js';
import { getIo } from '../realtime/hub.js';

export async function selfUser(user: User, sessionId?: string) {
  const passkeys = await prisma.passkey.count({ where: { userId: user.id } });
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    about: user.about,
    avatarFileId: user.avatarFileId,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    mfaEnabled: !!user.totpEnabledAt,
    passkeyCount: passkeys,
    sessionId,
    privacy: {
      profilePhoto: user.privacyProfilePhoto,
      lastSeen: user.privacyLastSeen,
      online: user.privacyOnline,
      status: user.privacyStatus,
      groups: user.privacyGroups,
      readReceipts: user.readReceipts,
    },
    autoDownload: { wifi: user.autoDownloadWifi, mobile: user.autoDownloadMobile },
  };
}

export interface ViewerCtx {
  viewerId: string;
  partners: Set<string>;
  online: Set<string>;
}

export async function onlineSet(): Promise<Set<string>> {
  const io = getIo();
  if (!io) return new Set();
  const socks = await io.fetchSockets();
  return new Set(socks.map((s) => s.data.userId as string).filter(Boolean));
}

export const canSee = (vis: Visibility, ownerId: string, ctx: ViewerCtx) =>
  ownerId === ctx.viewerId || vis === 'EVERYONE' || (vis === 'CHAT_PARTNERS' && ctx.partners.has(ownerId));

/** A user as seen by another user, honouring that user's privacy settings. */
export function publicUser(u: User, ctx: ViewerCtx) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    about: u.about,
    role: u.role,
    avatarFileId: canSee(u.privacyProfilePhoto, u.id, ctx) ? u.avatarFileId : null,
    avatarUrl: canSee(u.privacyProfilePhoto, u.id, ctx) ? u.avatarUrl : null,
    online: canSee(u.privacyOnline, u.id, ctx) ? ctx.online.has(u.id) : null,
    lastSeenAt: canSee(u.privacyLastSeen, u.id, ctx) ? u.lastSeenAt : null,
  };
}

// ---------- messages ----------
export const messageInclude = {
  attachments: true,
  reactions: true,
  receipts: true,
  stars: true,
  deletions: true,
  poll: { include: { options: { include: { votes: true }, orderBy: { pos: 'asc' } } } },
  replyTo: { select: { id: true, senderId: true, type: true, bodyEnc: true, deletedForAllAt: true, chatId: true } },
} satisfies Prisma.MessageInclude;

export type FullMessage = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

const snippet = (type: string, body: string | null) => (type === 'TEXT' ? (body ?? '').slice(0, 120) : `[${type.toLowerCase()}]`);

export function bodyOf(m: { bodyEnc: string | null; chatId: string; deletedForAllAt: Date | null }): string | null {
  if (m.deletedForAllAt || !m.bodyEnc) return null;
  try {
    return decryptAtRest(m.bodyEnc, m.chatId);
  } catch {
    return null;
  }
}

export function serializeMessage(m: FullMessage, viewerId: string, totalOthers: number) {
  const deleted = !!m.deletedForAllAt;
  const body = bodyOf(m);
  const others = m.receipts.filter((r) => r.userId !== viewerId);
  const delivered = others.length;
  const read = others.filter((r) => r.state === 'READ').length;
  const status = m.senderId === viewerId ? (totalOthers > 0 && read >= totalOthers ? 'read' : totalOthers > 0 && delivered >= totalOthers ? 'delivered' : 'sent') : undefined;
  return {
    id: m.id,
    chatId: m.chatId,
    senderId: m.senderId,
    clientId: m.clientId ?? undefined,
    type: deleted ? 'SYSTEM' : m.type,
    body: deleted ? null : body,
    meta: deleted ? {} : m.meta,
    deletedForAll: deleted,
    forwarded: deleted ? false : m.forwarded,
    editedAt: m.editedAt,
    createdAt: m.createdAt,
    expiresAt: m.expiresAt,
    pinned: !!m.pinnedAt && !deleted,
    starred: m.stars.some((s) => s.userId === viewerId),
    replyTo: m.replyTo
      ? { id: m.replyTo.id, senderId: m.replyTo.senderId, type: m.replyTo.type, snippet: m.replyTo.deletedForAllAt ? 'Message deleted' : snippet(m.replyTo.type, bodyOf(m.replyTo)) }
      : null,
    attachments: deleted ? [] : m.attachments.map((a) => ({ id: a.id, name: a.originalName, mime: a.mime, size: a.size, createdAt: a.createdAt, scanStatus: a.scanStatus, url: `/api/files/${a.id}/view` })),
    reactions: Object.values(
      m.reactions.reduce<Record<string, { emoji: string; userIds: string[] }>>((acc, r) => {
        (acc[r.emoji] ??= { emoji: r.emoji, userIds: [] }).userIds.push(r.userId);
        return acc;
      }, {}),
    ),
    poll: m.poll && !deleted
      ? {
          id: m.poll.id, question: m.poll.question, multiple: m.poll.multiple, closed: !!m.poll.closedAt,
          options: m.poll.options.map((o) => ({ id: o.id, text: o.text, votes: o.votes.length, voted: o.votes.some((v) => v.userId === viewerId) })),
        }
      : null,
    status,
    receipts: m.senderId === viewerId ? m.receipts.map((r) => ({ userId: r.userId, state: r.state, at: r.at })) : undefined,
  };
}
