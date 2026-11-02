import { Router } from 'express';
import { z } from 'zod';
import type { Role, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, parse, wrap } from '../lib/http.js';
import { hasRole, me, requireAuth, requireRole } from '../middleware/auth.js';
import { newToken } from '../lib/secure.js';
import { link, sendMail } from '../lib/mailer.js';
import { getSettings, settingsPatchSchema, updateSettings } from '../lib/settings.js';
import { revokeAllSessions, revokeSession } from '../lib/session.js';
import { deleteChatForEveryone, setProtected } from './chats.js';
import { removeUserFromChatRoom, emitToUser } from '../realtime/hub.js';
import { joinDefaultChats } from '../lib/chatAccess.js';
import { limiter } from '../middleware/limits.js';
import { ZodError } from 'zod';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'), limiter({ windowMs: 60_000, max: 120, key: (r) => r.auth?.user.id ?? r.ip ?? 'x' }));

const RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, SUPER_ADMIN: 3 };

/** Admins may only manage people ranked below them; Super Admins may manage Admins. Never yourself for destructive ops. */
async function loadManageable(actor: User, id: string, opts: { allowSelf?: boolean } = {}): Promise<User> {
  const target = await prisma.user.findFirst({ where: { id, workspaceId: actor.workspaceId } });
  if (!target) throw notFound('User not found');
  if (target.id === actor.id && !opts.allowSelf) throw forbidden('You cannot do that to your own account');
  if (target.id !== actor.id && RANK[target.role] >= RANK[actor.role] && actor.role !== 'SUPER_ADMIN') throw forbidden('You cannot manage a user with an equal or higher role');
  return target;
}

adminRouter.get('/overview', wrap(async (req, res) => {
  const ws = me(req).workspaceId;
  const [users, pending, invites, chats, sessions, reports, suspicious] = await Promise.all([
    prisma.user.count({ where: { workspaceId: ws, status: 'ACTIVE' } }),
    prisma.user.count({ where: { workspaceId: ws, status: { in: ['PENDING_APPROVAL', 'PENDING_VERIFICATION'] } } }),
    prisma.invite.count({ where: { workspaceId: ws, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.chat.count({ where: { workspaceId: ws, type: { not: 'DIRECT' } } }),
    prisma.session.count({ where: { user: { workspaceId: ws }, revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.report.count({ where: { resolvedAt: null } }),
    prisma.auditLog.count({ where: { suspicious: true, createdAt: { gt: new Date(Date.now() - 7 * 86400_000) } } }),
  ]);
  res.json({ users, pending, invites, groups: chats, sessions, openReports: reports, suspiciousEvents7d: suspicious });
}));

// ----- invites -----
adminRouter.get('/invites', wrap(async (req, res) => {
  const list = await prisma.invite.findMany({ where: { workspaceId: me(req).workspaceId }, orderBy: { createdAt: 'desc' }, take: 200, include: { createdBy: { select: { displayName: true } } } });
  res.json({
    invites: list.map((i) => ({
      id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt, createdBy: i.createdBy.displayName,
      status: i.usedAt ? 'used' : i.revokedAt ? 'revoked' : i.expiresAt < new Date() ? 'expired' : 'pending',
    })),
  });
}));

adminRouter.post('/invites', wrap(async (req, res) => {
  const actor = me(req);
  const b = parse(z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['MEMBER', 'ADMIN']).default('MEMBER') }), req.body);
  if (b.role === 'ADMIN' && actor.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can invite administrators');
  if (await prisma.user.findUnique({ where: { email: b.email } })) throw conflict('A user with this e-mail already exists');
  const settings = await getSettings(actor.workspaceId);
  await prisma.invite.updateMany({ where: { workspaceId: actor.workspaceId, email: b.email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const t = newToken();
  const inv = await prisma.invite.create({
    data: { workspaceId: actor.workspaceId, email: b.email, role: b.role, tokenHash: t.hash, createdById: actor.id, expiresAt: new Date(Date.now() + settings.inviteExpiryHours * 3600_000) },
  });
  await audit({ action: 'INVITE_CREATED', actorId: actor.id, targetType: 'invite', targetId: inv.id, req, metadata: { email: b.email, role: b.role } });
  await sendMail({
    to: b.email, subject: `${actor.displayName} invited you to TeamTalk`,
    text: `You have been invited to join the team on TeamTalk.\n\nCreate your account (valid ${settings.inviteExpiryHours} hours, single use):\n${link('/register', { token: t.token })}\n`,
  });
  res.status(201).json({ invite: { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt } });
}));

adminRouter.delete('/invites/:id', wrap(async (req, res) => {
  const actor = me(req);
  const inv = await prisma.invite.findFirst({ where: { id: String(req.params.id), workspaceId: actor.workspaceId } });
  if (!inv) throw notFound();
  if (inv.usedAt) throw badRequest('This invite was already used');
  await prisma.invite.update({ where: { id: inv.id }, data: { revokedAt: new Date() } });
  await audit({ action: 'INVITE_REVOKED', actorId: actor.id, targetType: 'invite', targetId: inv.id, req, metadata: { email: inv.email } });
  res.json({ ok: true });
}));

// ----- users -----
adminRouter.get('/users', wrap(async (req, res) => {
  const users = await prisma.user.findMany({ where: { workspaceId: me(req).workspaceId }, orderBy: { createdAt: 'desc' }, take: 500, include: { _count: { select: { sessions: { where: { revokedAt: null } } } } } });
  res.json({
    users: users.map((u) => ({
      id: u.id, email: u.email, displayName: u.displayName, role: u.role, status: u.status, mfaEnabled: !!u.totpEnabledAt,
      lastSeenAt: u.lastSeenAt, createdAt: u.createdAt, activeSessions: u._count.sessions, locked: !!u.lockedUntil && u.lockedUntil > new Date(),
    })),
  });
}));

adminRouter.post('/users/:id/approve', wrap(async (req, res) => {
  const actor = me(req);
  const t = await loadManageable(actor, String(req.params.id));
  if (t.status !== 'PENDING_APPROVAL') throw badRequest('This user is not waiting for approval');
  await prisma.user.update({ where: { id: t.id }, data: { status: 'ACTIVE' } });
  await joinDefaultChats(t.id, t.workspaceId);
  await audit({ action: 'USER_APPROVED', actorId: actor.id, targetType: 'user', targetId: t.id, req });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/deactivate', wrap(async (req, res) => {
  const actor = me(req);
  const t = await loadManageable(actor, String(req.params.id));
  await prisma.user.update({ where: { id: t.id }, data: { status: 'DEACTIVATED' } });
  await revokeAllSessions(t.id);
  await audit({ action: 'USER_DEACTIVATED', actorId: actor.id, targetType: 'user', targetId: t.id, req });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/reactivate', wrap(async (req, res) => {
  const actor = me(req);
  const t = await loadManageable(actor, String(req.params.id));
  if (t.status !== 'DEACTIVATED' || !t.emailVerifiedAt) throw badRequest('Only deactivated users can be reactivated');
  await prisma.user.update({ where: { id: t.id }, data: { status: 'ACTIVE', failedLogins: 0, lockedUntil: null } });
  await audit({ action: 'USER_REACTIVATED', actorId: actor.id, targetType: 'user', targetId: t.id, req });
  res.json({ ok: true });
}));

adminRouter.delete('/users/:id', wrap(async (req, res) => {
  const actor = me(req);
  const t = await loadManageable(actor, String(req.params.id));
  if (t.role === 'SUPER_ADMIN' && (await prisma.user.count({ where: { workspaceId: t.workspaceId, role: 'SUPER_ADMIN', status: 'ACTIVE' } })) <= 1) throw forbidden('The last Super Admin cannot be removed');
  const memberships = await prisma.chatMember.findMany({ where: { userId: t.id }, select: { chatId: true } });
  await revokeAllSessions(t.id);
  // Messages reference the sender, so the account is anonymised rather than hard-deleted.
  await prisma.$transaction([
    prisma.chatMember.deleteMany({ where: { userId: t.id } }),
    prisma.passkey.deleteMany({ where: { userId: t.id } }),
    prisma.pushToken.deleteMany({ where: { userId: t.id } }),
    prisma.statusUpdate.deleteMany({ where: { userId: t.id } }),
    prisma.recoveryCode.deleteMany({ where: { userId: t.id } }),
    prisma.user.update({ where: { id: t.id }, data: { status: 'DEACTIVATED', email: `removed+${t.id}@invalid.local`, displayName: 'Removed user', about: '', avatarFileId: null, totpSecretEnc: null, totpEnabledAt: null } }),
  ]);
  await Promise.all(memberships.map((m) => removeUserFromChatRoom(t.id, m.chatId)));
  await audit({ action: 'USER_REMOVED', actorId: actor.id, targetType: 'user', targetId: t.id, req, metadata: { email: t.email } });
  res.json({ ok: true });
}));

adminRouter.patch('/users/:id/role', wrap(async (req, res) => {
  const actor = me(req);
  const { role } = parse(z.object({ role: z.enum(['SUPER_ADMIN', 'ADMIN', 'MEMBER']) }), req.body);
  const t = await loadManageable(actor, String(req.params.id));
  if ((role !== 'MEMBER' || t.role !== 'MEMBER') && actor.role !== 'SUPER_ADMIN') throw forbidden('Only a Super Admin can grant or revoke administrator roles');
  if (t.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN' && (await prisma.user.count({ where: { workspaceId: t.workspaceId, role: 'SUPER_ADMIN', status: 'ACTIVE' } })) <= 1) throw forbidden('There must be at least one Super Admin');
  await prisma.user.update({ where: { id: t.id }, data: { role } });
  await audit({ action: 'ROLE_CHANGED', actorId: actor.id, targetType: 'user', targetId: t.id, req, suspicious: role !== 'MEMBER', metadata: { from: t.role, to: role } });
  res.json({ ok: true });
}));

// ----- sessions -----
adminRouter.get('/sessions', wrap(async (req, res) => {
  const list = await prisma.session.findMany({ where: { user: { workspaceId: me(req).workspaceId }, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActiveAt: 'desc' }, take: 300, include: { user: { select: { id: true, displayName: true, email: true } } } });
  res.json({ sessions: list.map((s) => ({ id: s.id, user: s.user, deviceName: s.deviceName, ip: s.ip, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt })) });
}));

adminRouter.delete('/sessions/:id', wrap(async (req, res) => {
  const actor = me(req);
  const s = await prisma.session.findFirst({ where: { id: String(req.params.id), user: { workspaceId: actor.workspaceId } }, include: { user: true } });
  if (!s) throw notFound();
  if (s.userId !== actor.id && RANK[s.user.role] >= RANK[actor.role] && actor.role !== 'SUPER_ADMIN') throw forbidden('You cannot manage this user');
  await revokeSession(s.id);
  await audit({ action: 'SESSION_REVOKED', actorId: actor.id, targetType: 'session', targetId: s.id, req, metadata: { user: s.userId, by: 'admin' } });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/force-logout', wrap(async (req, res) => {
  const actor = me(req);
  const t = await loadManageable(actor, String(req.params.id), { allowSelf: true });
  const n = await revokeAllSessions(t.id);
  await audit({ action: 'SESSIONS_FORCE_LOGOUT', actorId: actor.id, targetType: 'user', targetId: t.id, req, metadata: { count: n } });
  res.json({ ok: true, revoked: n });
}));

// ----- groups & channels (metadata only; admins cannot read messages) -----
adminRouter.get('/chats', wrap(async (req, res) => {
  const chats = await prisma.chat.findMany({ where: { workspaceId: me(req).workspaceId, type: { not: 'DIRECT' } }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { members: true } } } });
  res.json({ chats: chats.map((c) => ({ id: c.id, type: c.type, name: c.name, members: c._count.members, isProtected: c.isProtected, isDefault: c.isDefault, archivedForAll: c.archivedForAll, disappearingSeconds: c.disappearingSeconds, createdAt: c.createdAt })) });
}));

adminRouter.patch('/chats/:id', wrap(async (req, res) => {
  const actor = me(req);
  const b = parse(z.object({ name: z.string().trim().min(1).max(80).optional(), archivedForAll: z.boolean().optional(), isDefault: z.boolean().optional(), isProtected: z.boolean().optional(), disappearingSeconds: z.number().int().nullable().optional() }), req.body);
  const chat = await prisma.chat.findFirst({ where: { id: String(req.params.id), workspaceId: actor.workspaceId, type: { not: 'DIRECT' } } });
  if (!chat) throw notFound();
  const settings = await getSettings(actor.workspaceId);
  if (b.disappearingSeconds !== undefined && b.disappearingSeconds !== null && !settings.disappearing.allowedSeconds.includes(b.disappearingSeconds)) throw badRequest('Not an allowed disappearing-message time');
  if (b.isProtected !== undefined) await setProtected(chat.id, b.isProtected, actor, req);
  const protectedNow = b.isProtected ?? chat.isProtected;
  if (b.disappearingSeconds === null && protectedNow) throw forbidden('Disappearing messages cannot be turned off in a Protected Chat');
  await prisma.chat.update({ where: { id: chat.id }, data: { name: b.name, archivedForAll: b.archivedForAll, isDefault: b.isDefault, disappearingSeconds: b.disappearingSeconds } });
  await audit({ action: 'SETTINGS_CHANGED', actorId: actor.id, targetType: 'chat', targetId: chat.id, req, metadata: { admin: true, ...b } });
  res.json({ ok: true });
}));

adminRouter.delete('/chats/:id', wrap(async (req, res) => {
  const actor = me(req);
  const chat = await prisma.chat.findFirst({ where: { id: String(req.params.id), workspaceId: actor.workspaceId, type: { not: 'DIRECT' } } });
  if (!chat) throw notFound();
  await deleteChatForEveryone(chat.id, actor, req);
  res.json({ ok: true });
}));

// ----- settings -----
adminRouter.get('/settings', wrap(async (req, res) => {
  res.json({ settings: await getSettings(me(req).workspaceId) });
}));

adminRouter.patch('/settings', wrap(async (req, res) => {
  const actor = me(req);
  const patch = parse(settingsPatchSchema, req.body);
  try {
    const { before, after } = await updateSettings(actor.workspaceId, patch);
    const changed = Object.keys(after).filter((k) => JSON.stringify((after as Record<string, unknown>)[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
    await audit({ action: 'SETTINGS_CHANGED', actorId: actor.id, targetType: 'workspace', targetId: actor.workspaceId, req, metadata: { changed } });
    res.json({ settings: after });
  } catch (e) {
    if (e instanceof ZodError) throw badRequest('Invalid settings', e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    throw e;
  }
}));

// ----- audit log & reports -----
adminRouter.get('/audit', wrap(async (req, res) => {
  const q = parse(z.object({ action: z.string().max(40).optional(), suspicious: z.enum(['true', 'false']).optional(), actorId: z.string().max(40).optional(), before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
  const rows = await prisma.auditLog.findMany({
    where: { action: q.action, actorId: q.actorId, suspicious: q.suspicious ? q.suspicious === 'true' : undefined, createdAt: q.before ? { lt: new Date(q.before) } : undefined },
    orderBy: { createdAt: 'desc' }, take: q.limit,
  });
  const ids = [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  res.json({ entries: rows.map((r) => ({ ...r, actorName: users.find((u) => u.id === r.actorId)?.displayName ?? null })) });
}));

adminRouter.get('/reports', wrap(async (_req, res) => {
  const rows = await prisma.report.findMany({ orderBy: [{ resolvedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }], take: 200, include: { reporter: { select: { displayName: true } } } });
  const ids = rows.map((r) => r.targetUserId).filter(Boolean) as string[];
  const targets = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  res.json({ reports: rows.map((r) => ({ id: r.id, reason: r.reason, details: r.details, reporter: r.reporter.displayName, target: targets.find((t) => t.id === r.targetUserId)?.displayName ?? null, targetUserId: r.targetUserId, hasMessage: !!r.messageId, createdAt: r.createdAt, resolvedAt: r.resolvedAt })) });
}));

adminRouter.post('/reports/:id/resolve', wrap(async (req, res) => {
  const actor = me(req);
  const r = await prisma.report.updateMany({ where: { id: String(req.params.id), resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actor.id } });
  if (!r.count) throw notFound();
  await audit({ action: 'REPORT_RESOLVED', actorId: actor.id, targetType: 'report', targetId: String(req.params.id), req });
  res.json({ ok: true });
}));

void [hasRole, emitToUser];
