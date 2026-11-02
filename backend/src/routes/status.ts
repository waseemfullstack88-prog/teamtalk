import { Router } from 'express';
import { z } from 'zod';
import type { User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { badRequest, forbidden, notFound, parse, wrap } from '../lib/http.js';
import { me, requireAuth } from '../middleware/auth.js';
import { canSee, onlineSet } from '../lib/serialize.js';
import { partnerIds } from '../lib/chatAccess.js';
import { emitToUser } from '../realtime/hub.js';
import { storage } from '../lib/storage.js';

export const statusRouter = Router();
statusRouter.use(requireAuth);

const TTL_MS = 24 * 3600_000;

/** Can `viewer` see a status update, honouring the author's status privacy? */
export async function canViewStatusOf(viewer: User, statusId: string): Promise<boolean> {
  const s = await prisma.statusUpdate.findUnique({ where: { id: statusId }, include: { user: true } });
  if (!s || s.expiresAt <= new Date()) return false;
  if (s.userId === viewer.id) return true;
  if (s.user.workspaceId !== viewer.workspaceId) return false;
  const ctx = { viewerId: viewer.id, partners: await partnerIds(viewer.id), online: new Set<string>() };
  return canSee(s.user.privacyStatus, s.userId, ctx);
}

statusRouter.get('/', wrap(async (req, res) => {
  const user = me(req);
  const partners = await partnerIds(user.id);
  const ctx = { viewerId: user.id, partners, online: await onlineSet() };
  const rows = await prisma.statusUpdate.findMany({
    where: { expiresAt: { gt: new Date() }, user: { workspaceId: user.workspaceId, status: 'ACTIVE' } },
    orderBy: { createdAt: 'asc' }, include: { user: true, views: true },
  });
  const media = await prisma.attachment.findMany({ where: { statusId: { in: rows.map((r) => r.id) } } });
  const visible = rows.filter((r) => canSee(r.user.privacyStatus, r.userId, ctx));
  const by = new Map<string, { user: { id: string; displayName: string; avatarFileId: string | null }; updates: unknown[]; mine: boolean }>();
  for (const r of visible) {
    const g = by.get(r.userId) ?? { user: { id: r.userId, displayName: r.user.displayName, avatarFileId: r.user.avatarFileId }, updates: [], mine: r.userId === user.id };
    const f = media.find((m) => m.statusId === r.id);
    g.updates.push({
      id: r.id, kind: r.kind, body: r.body, background: r.background, createdAt: r.createdAt, expiresAt: r.expiresAt,
      fileId: f?.id ?? null, viewed: r.views.some((v) => v.userId === user.id), viewCount: r.userId === user.id ? r.views.length : undefined,
    });
    by.set(r.userId, g);
  }
  res.json({ groups: [...by.values()] });
}));

statusRouter.post('/', wrap(async (req, res) => {
  const user = me(req);
  const b = parse(z.object({
    kind: z.enum(['TEXT', 'IMAGE', 'VIDEO']),
    body: z.string().trim().max(700).default(''),
    background: z.string().max(300).default(''),
    attachmentId: z.string().max(40).optional(),
  }), req.body);
  if (b.kind === 'TEXT' && !b.body) throw badRequest('Write something first');
  if (b.kind !== 'TEXT' && !b.attachmentId) throw badRequest('Attach a photo or video');
  const s = await prisma.statusUpdate.create({ data: { userId: user.id, kind: b.kind, body: b.body, background: b.background, visibility: user.privacyStatus, expiresAt: new Date(Date.now() + TTL_MS) } });
  if (b.attachmentId) {
    const a = await prisma.attachment.updateMany({ where: { id: b.attachmentId, uploaderId: user.id, purpose: 'STATUS', statusId: null, messageId: null, mime: { startsWith: b.kind === 'IMAGE' ? 'image/' : 'video/' } }, data: { statusId: s.id } });
    if (a.count !== 1) {
      await prisma.statusUpdate.delete({ where: { id: s.id } });
      throw badRequest('Invalid attachment');
    }
  }
  res.status(201).json({ id: s.id });
}));

statusRouter.post('/:id/view', wrap(async (req, res) => {
  const user = me(req);
  if (!(await canViewStatusOf(user, String(req.params.id)))) throw notFound();
  const s = await prisma.statusUpdate.findUniqueOrThrow({ where: { id: String(req.params.id) } });
  if (s.userId !== user.id && user.readReceipts) {
    await prisma.statusView.upsert({ where: { statusId_userId: { statusId: s.id, userId: user.id } }, update: {}, create: { statusId: s.id, userId: user.id } });
    emitToUser(s.userId, 'status:viewed', { statusId: s.id, userId: user.id });
  }
  res.json({ ok: true });
}));

statusRouter.get('/:id/views', wrap(async (req, res) => {
  const user = me(req);
  const s = await prisma.statusUpdate.findUnique({ where: { id: String(req.params.id) }, include: { views: { include: { status: false } } } });
  if (!s) throw notFound();
  if (s.userId !== user.id) throw forbidden('Only the author can see who viewed this');
  const users = await prisma.user.findMany({ where: { id: { in: s.views.map((v) => v.userId) } }, select: { id: true, displayName: true } });
  res.json({ views: s.views.map((v) => ({ userId: v.userId, name: users.find((u) => u.id === v.userId)?.displayName, at: v.at })) });
}));

statusRouter.delete('/:id', wrap(async (req, res) => {
  const user = me(req);
  const s = await prisma.statusUpdate.findFirst({ where: { id: String(req.params.id), userId: user.id } });
  if (!s) throw notFound();
  await removeStatusFiles([s.id]);
  await prisma.statusUpdate.delete({ where: { id: s.id } });
  res.json({ ok: true });
}));

export async function removeStatusFiles(ids: string[]) {
  const atts = await prisma.attachment.findMany({ where: { statusId: { in: ids } } });
  for (const a of atts) await storage().remove(a.storageKey).catch(() => undefined);
  await prisma.attachment.deleteMany({ where: { id: { in: atts.map((a) => a.id) } } });
}
