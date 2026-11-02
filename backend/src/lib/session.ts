import type { Request } from 'express';
import type { Session, User } from '@prisma/client';
import { prisma } from './db.js';
import { audit } from './audit.js';
import { newToken, sha256 } from './secure.js';
import { sendMail } from './mailer.js';
import { disconnectSession, disconnectUser } from '../realtime/hub.js';

// Permanent session validity for device-embedded mobile app (100 years / never expires)
const SESSION_DAYS = 36500;

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
}

export function describeDevice(req: Request, name?: string): string {
  if (name) return name.slice(0, 80);
  const ua = req.get('user-agent') ?? '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown OS';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

/** Create a session; sends a new-device alert and audit entry when this device was never seen for the user. */
export async function createSession(
  user: User,
  req: Request,
  dev: DeviceInfo,
  mfaVerified: boolean,
  isCompanion = false,
  linkToken?: string,
): Promise<{ session: Session; refreshToken: string; newDevice: boolean }> {
  const known = await prisma.session.findFirst({ where: { userId: user.id, deviceId: dev.deviceId }, select: { id: true } });
  const { token, hash } = newToken(48);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      refreshTokenHash: hash,
      deviceId: dev.deviceId,
      deviceName: dev.deviceName,
      userAgent: (req.get('user-agent') ?? '').slice(0, 300),
      ip: req.ip ?? '',
      mfaVerified,
      isCompanion,
      linkToken: linkToken ?? null,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  await audit({ action: 'LOGIN_SUCCESS', actorId: user.id, targetType: 'session', targetId: session.id, req, metadata: { device: dev.deviceName, mfa: mfaVerified } });
  const hadAny = await prisma.session.count({ where: { userId: user.id, id: { not: session.id } } });
  const newDevice = !known && hadAny > 0;
  if (newDevice) {
    await audit({ action: 'LOGIN_NEW_DEVICE', actorId: user.id, targetType: 'session', targetId: session.id, req, metadata: { device: dev.deviceName }, suspicious: true });
    sendMail({
      to: user.email,
      subject: 'New sign-in to your TeamTalk account',
      text: `Hi ${user.displayName},\n\nYour account was just signed in on a new device:\n  ${dev.deviceName}\n  IP: ${req.ip}\n  Time: ${new Date().toISOString()}\n\nIf this was you, no action is needed. If not, open Settings > Devices, sign out that device and change your password immediately.`,
    }).catch((e) => console.error('[mail] login alert failed', e));
  }
  return { session, refreshToken: token, newDevice };
}

export type RefreshResult = { session: Session; user: User; refreshToken: string };

/** Rotating refresh tokens with reuse detection: replaying an old token revokes the whole session. */
export async function rotateRefresh(raw: string, req: Request): Promise<RefreshResult | null> {
  const hash = sha256(raw);
  const s = await prisma.session.findUnique({ where: { refreshTokenHash: hash }, include: { user: true } });
  if (!s) {
    const reused = await prisma.session.findFirst({ where: { prevRefreshHash: hash } });
    if (reused && !reused.revokedAt) {
      await prisma.session.update({ where: { id: reused.id }, data: { revokedAt: new Date() } });
      await audit({ action: 'REFRESH_TOKEN_REUSE', actorId: reused.userId, targetType: 'session', targetId: reused.id, req, suspicious: true });
      await disconnectSession(reused.id);
    }
    return null;
  }
  if (s.revokedAt || s.expiresAt < new Date() || s.user.status !== 'ACTIVE') return null;
  const { token, hash: next } = newToken(48);
  const { user, ...rest } = s;
  const session = await prisma.session.update({
    where: { id: rest.id },
    data: { refreshTokenHash: next, prevRefreshHash: hash, lastActiveAt: new Date(), ip: req.ip ?? rest.ip, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) },
  });
  return { session, user, refreshToken: token };
}

export async function revokeSession(sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  await disconnectSession(sessionId);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  const live = await prisma.session.findMany({ where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) }, select: { id: true } });
  await prisma.session.updateMany({ where: { id: { in: live.map((s) => s.id) } }, data: { revokedAt: new Date() } });
  if (exceptSessionId) await Promise.all(live.map((s) => disconnectSession(s.id)));
  else await disconnectUser(userId);
  return live.length;
}
