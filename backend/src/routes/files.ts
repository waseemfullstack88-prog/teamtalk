import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Attachment, User } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { badRequest, forbidden, notFound, parse, wrap } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { isDangerousExtension, mimeConsistent, safeFilename, scanBuffer } from '../lib/filesafety.js';
import { newStorageKey, storage, verifyLocalSignature } from '../lib/storage.js';
import { env } from '../config/env.js';
import { me, requireAuth } from '../middleware/auth.js';
import { uploadLimiter } from '../middleware/limits.js';
import { requireMember } from '../lib/chatAccess.js';
import { canViewStatusOf } from './status.js';

export const filesRouter = Router();

/**
 * Public (unauthenticated) leaf: the HMAC-signed, short-lived URL IS the credential. It is minted only after
 * an access check in GET /files/:id/url. Declared before the auth middleware on purpose.
 */
const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime)|audio\/|application\/pdf$)/;

filesRouter.get('/raw/:key', wrap(async (req, res) => {
  const key = String(req.params.key);
  const q = { key, exp: String(req.query.exp ?? ''), dl: String(req.query.dl ?? '0'), sig: String(req.query.sig ?? '') };
  if (!/^[a-f0-9]{48}$/.test(key) || !verifyLocalSignature(q)) throw forbidden('This link has expired');
  const att = await prisma.attachment.findFirst({ where: { storageKey: key } });
  const st = storage();
  if (!att || !st.stream) throw notFound();
  const download = q.dl === '1' || !INLINE_SAFE.test(att.mime);
  res.setHeader('Content-Type', att.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(att.originalName)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

  const range = req.headers.range;
  if (range && range.startsWith('bytes=')) {
    const total = att.size;
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (isNaN(start) || start >= total || end >= total || start > end) {
      res.setHeader('Content-Range', `bytes */${total}`);
      res.status(416).end('Requested Range Not Satisfiable');
      return;
    }
    const chunkSize = (end - start) + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(chunkSize));
    st.stream(key, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else {
    res.setHeader('Content-Length', String(att.size));
    st.stream(key).on('error', () => res.destroy()).pipe(res);
  }
}));

filesRouter.get('/:id/view', wrap(async (req, res) => {
  const fileId = String(req.params.id);
  const att = await prisma.attachment.findUnique({ where: { id: fileId } });
  if (!att) throw notFound('File not found');
  const st = storage();
  if (!st.stream) throw notFound();

  const download = req.query.download === '1' || req.query.dl === '1';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', att.mime);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(att.originalName)}`);

  const range = req.headers.range;
  if (range && range.startsWith('bytes=')) {
    const total = att.size;
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;

    if (isNaN(start) || start >= total || end >= total || start > end) {
      res.setHeader('Content-Range', `bytes */${total}`);
      res.status(416).end('Requested Range Not Satisfiable');
      return;
    }

    const chunkSize = (end - start) + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
    res.setHeader('Content-Length', String(chunkSize));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    st.stream(att.storageKey, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else {
    res.status(200);
    res.setHeader('Content-Length', String(att.size));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    st.stream(att.storageKey).on('error', () => res.destroy()).pipe(res);
  }
}));

filesRouter.use(requireAuth);

export async function canAccessAttachment(user: User, att: Attachment, intent: 'view' | 'download'): Promise<{ ok: boolean; protectedChat?: boolean }> {
  if (att.purpose === 'AVATAR') {
    const owner = await prisma.user.findUnique({ where: { id: att.uploaderId }, select: { workspaceId: true } });
    return { ok: owner?.workspaceId === user.workspaceId };
  }
  if (att.uploaderId === user.id && !att.messageId && !att.statusId) return { ok: true };
  if (att.statusId) return { ok: await canViewStatusOf(user, att.statusId) };
  if (att.messageId) {
    const msg = await prisma.message.findUnique({ where: { id: att.messageId }, include: { deletions: true, chat: true } });
    if (!msg || msg.deletedForAllAt || msg.deletions.some((d) => d.userId === user.id)) return { ok: false };
    if (msg.expiresAt && msg.expiresAt <= new Date()) return { ok: false };
    const ms = await requireMember(msg.chatId, user.id).catch(() => null);
    if (!ms) return { ok: false };
    if (ms.member.clearedAt && msg.createdAt <= ms.member.clearedAt) return { ok: false };
    if (intent === 'download' && msg.chat.isProtected) return { ok: false, protectedChat: true };
    return { ok: true };
  }
  return { ok: false };
}

filesRouter.get('/:id/url', wrap(async (req, res) => {
  const user = me(req);
  const download = req.query.download === '1';
  const att = await prisma.attachment.findUnique({ where: { id: String(req.params.id) } });
  if (!att) throw notFound('File not found');
  const access = await canAccessAttachment(user, att, download ? 'download' : 'view');
  if (!access.ok) {
    if (access.protectedChat) {
      await audit({ action: 'PROTECTED_CHAT_DENIED', actorId: user.id, targetType: 'file', targetId: att.id, req, metadata: { op: 'download' } });
      throw forbidden('Downloads are disabled in Protected Chats');
    }
    throw notFound('File not found'); // do not reveal existence
  }
  if (att.scanStatus === 'INFECTED') throw forbidden('This file was blocked by the security scan');
  if (download || att.purpose === 'MESSAGE') {
    await audit({ action: 'FILE_ACCESS', actorId: user.id, targetType: 'file', targetId: att.id, req, metadata: { download, name: att.originalName } });
  }
  const url = await storage().signedUrl(att.storageKey, { name: att.originalName, mime: att.mime, download, ttl: env.SIGNED_URL_TTL_SECONDS });
  res.json({ url, expiresIn: env.SIGNED_URL_TTL_SECONDS, name: att.originalName, mime: att.mime, size: att.size });
}));

filesRouter.post('/', uploadLimiter, wrap(async (req, res) => {
  const user = me(req);
  const settings = await getSettings(user.workspaceId);
  const purpose = z.enum(['MESSAGE', 'AVATAR', 'STATUS']).default('MESSAGE').parse(req.query.purpose);
  const maxBytes = (purpose === 'AVATAR' ? Math.min(5, settings.storage.maxFileMb) : settings.storage.maxFileMb) * 1024 * 1024;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 5 } }).single('file');
  await new Promise<void>((resolve, reject) => upload(req, res, (e) => (e ? reject(e) : resolve())));
  const f = req.file;
  if (!f) throw badRequest('No file uploaded');

  const name = safeFilename(f.originalname);
  const mime = f.mimetype.split(';')[0]!.trim().toLowerCase();
  const reject = async (why: string) => {
    await audit({ action: 'FILE_REJECTED', actorId: user.id, req, metadata: { name, mime, why } });
    throw badRequest(why);
  };
  if (!settings.storage.allowedMime.includes(mime)) await reject('This file type is not allowed by your administrator');
  if (isDangerousExtension(name)) await reject('This file extension is not allowed');
  if (purpose === 'AVATAR' && !/^image\/(jpeg|png|webp)$/.test(mime)) await reject('Profile pictures must be JPEG, PNG or WebP');
  if (!mimeConsistent(mime, f.buffer)) await reject('File contents do not match the declared type');

  const used = await prisma.attachment.aggregate({ _sum: { size: true } });
  if ((used._sum.size ?? 0) + f.size > settings.storage.workspaceQuotaGb * 1024 ** 3) await reject('Workspace storage quota exceeded');

  const scan = await scanBuffer(f.buffer).catch(() => 'SKIPPED' as const);
  if (scan === 'INFECTED') await reject('The file failed the virus scan and was rejected');

  const key = newStorageKey();
  await storage().put(key, f.buffer, mime);
  const att = await prisma.attachment.create({
    data: { uploaderId: user.id, purpose, storageKey: key, originalName: name, mime, size: f.size, sha256: createHash('sha256').update(f.buffer).digest('hex'), scanStatus: scan === 'CLEAN' ? 'CLEAN' : 'SKIPPED' },
  });
  res.status(201).json({ file: { id: att.id, name: att.originalName, mime: att.mime, size: att.size, scanStatus: att.scanStatus, createdAt: att.createdAt } });
}));
