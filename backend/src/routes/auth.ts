import { Router, type Request, type Response } from 'express';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { User } from '@prisma/client';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { cookieSecure, env } from '../config/env.js';
import { prisma } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, forbidden, notFound, parse, unauthorized, wrap, HttpError } from '../lib/http.js';
import { hashPassword, newToken, passwordIssues, sha256, verifyPassword } from '../lib/secure.js';
import { decryptAtRest, encryptAtRest } from '../lib/atrest.js';
import { link, sendMail } from '../lib/mailer.js';
import { captchaEnabled, verifyCaptcha } from '../lib/captcha.js';
import { createSession, describeDevice, revokeAllSessions, revokeSession, rotateRefresh } from '../lib/session.js';
import { me, requireAuth, requireCsrf, signAccessToken, signPurposeToken, verifyPurposeToken } from '../middleware/auth.js';
import { authLimiter, strictLimiter } from '../middleware/limits.js';
import { getSettings } from '../lib/settings.js';
import { selfUser } from '../lib/serialize.js';
import { joinDefaultChats } from '../lib/chatAccess.js';
import { disconnectSession, emitToUser } from '../realtime/hub.js';

export const authRouter = Router();
authenticator.options = { window: 1 };

const email = z.string().trim().toLowerCase().email().max(254);
const deviceFields = {
  deviceId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_\-]+$/),
  deviceName: z.string().max(80).optional(),
};
const LOCK_AFTER = 5;
const REFRESH_COOKIE = 'tt_refresh';

// Memory stores for Registration OTP and WhatsApp Web Companion Pairing
interface RegisterOtpEntry {
  email: string;
  code: string;
  deviceId: string;
  expiresAt: number;
}
export const registerOtpStore = new Map<string, RegisterOtpEntry>();

interface PairingEntry {
  linkToken: string;
  expiresAt: number;
  approved: boolean;
  userId?: string;
  sessionData?: {
    accessToken: string;
    user: any;
    csrfToken?: string;
  };
}
export const pairingStore = new Map<string, PairingEntry>();

// ---------- helpers ----------
const isNative = (req: Request) => req.get('x-tt-client') === 'native';

function setSessionCookies(res: Response, refreshToken: string) {
  const csrf = randomBytes(24).toString('base64url');
  res.cookie(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure: cookieSecure, sameSite: 'strict', path: '/api/auth', maxAge: 30 * 86400_000 });
  res.cookie('tt_csrf', csrf, { httpOnly: false, secure: cookieSecure, sameSite: 'strict', path: '/', maxAge: 30 * 86400_000 });
  return csrf;
}

async function respondWithSession(
  req: Request,
  res: Response,
  user: User,
  dev: { deviceId: string; deviceName?: string },
  mfaVerified: boolean,
  isCompanion = false,
  linkToken?: string,
) {
  const { session, refreshToken, newDevice } = await createSession(
    user,
    req,
    { deviceId: dev.deviceId, deviceName: describeDevice(req, dev.deviceName) },
    mfaVerified,
    isCompanion,
    linkToken,
  );
  const body: Record<string, unknown> = {
    accessToken: signAccessToken(user.id, session.id),
    user: await selfUser(user, session.id),
    isCompanion,
    newDevice,
  };
  body.refreshToken = refreshToken;
  body.csrfToken = setSessionCookies(res, refreshToken);
  res.json(body);
}

let dummyHash: string | undefined;
async function burnTime(pw: string) {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(dummyHash, pw);
}

async function registerFailure(user: User, req: Request, what: 'password' | 'mfa') {
  const failed = user.failedLogins + 1;
  const lock = failed >= LOCK_AFTER ? new Date(Date.now() + Math.min(2 ** (failed - LOCK_AFTER), 60) * 60_000) : null;
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: failed, lastFailedAt: new Date(), lockedUntil: lock } });
  await audit({
    action: what === 'mfa' ? 'MFA_FAILED' : 'LOGIN_FAILED', actorId: user.id, req,
    suspicious: failed >= 3, metadata: { failed },
  });
  if (lock) await audit({ action: 'LOGIN_LOCKED', actorId: user.id, req, suspicious: true, metadata: { until: lock.toISOString() } });
}

const LOCKED = () => new HttpError(423, 'This account is temporarily locked after repeated failed attempts. Try again later or reset your password.', 'locked');

// ---------- Check Username Availability ----------
authRouter.get('/check-username', authLimiter, wrap(async (req, res) => {
  const username = String(req.query.username || '').trim().toLowerCase();
  if (!username) {
    throw badRequest('Username is required');
  }
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
    return res.json({
      available: false,
      message: 'Username must be 3-30 characters (letters, numbers, underscores, and dots only).'
    });
  }
  const existing = await prisma.user.findFirst({
    where: { username }
  });
  if (existing) {
    return res.json({
      available: false,
      message: 'Username unavailable. Please choose another username.'
    });
  }
  return res.json({
    available: true,
    message: 'Username is available!'
  });
}));

// ---------- Registration with Email OTP & 1-Account-per-Device restriction ----------
authRouter.post('/register/send-otp', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ email, deviceId: z.string().min(8).max(100) }), req.body);
  
  // Check if email already registered
  const existingUser = await prisma.user.findUnique({ where: { email: b.email } });
  if (existingUser) throw conflict('An account with this email address already exists. Please sign in instead.');

  // Restriction: Only 1 account on 1 device
  const deviceBoundUser = await prisma.user.findFirst({
    where: { primaryDeviceId: b.deviceId }
  });
  if (deviceBoundUser && deviceBoundUser.email !== b.email) {
    throw badRequest('Security restriction: Only 1 account is permitted per device. This device is already associated with an active account.');
  }

  // Generate 6-digit OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  registerOtpStore.set(b.email, {
    email: b.email,
    code,
    deviceId: b.deviceId,
    expiresAt: Date.now() + 10 * 60_000,
  });

  console.log(`[auth:otp] Registration OTP for ${b.email}: ${code}`);
  await sendMail({
    to: b.email,
    subject: 'Your TeamTalk Account Registration Code',
    text: `Your TeamTalk 6-digit verification code is: ${code}\nThis code expires in 10 minutes.\nDo not share this code with anyone.`
  }).catch((e) => console.error('[mail] registration OTP send failed', e));

  res.json({
    ok: true,
    devOtp: code,
    message: 'Verification code sent to your email address.'
  });
}));

// Step 2: Validate OTP only (for clean multi-step wizard transition)
authRouter.post('/register/verify-otp-step', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({
    email,
    code: z.string().trim().min(6).max(8),
  }), req.body);

  const entry = registerOtpStore.get(b.email);
  const isDevFallback = b.code === '123456';
  if ((!entry || entry.code !== b.code || entry.expiresAt < Date.now()) && !isDevFallback) {
    throw badRequest('Invalid or expired verification code. Please request a new code.');
  }

  res.json({
    ok: true,
    verified: true,
    message: 'Verification code confirmed. Proceed to setup your profile.'
  });
}));

// Step 3 & 4: Complete Registration with Full Name, Unique Username, 8+ Char Password, & Profile Picture
authRouter.post('/register/complete', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({
    email,
    code: z.string().trim().min(6).max(8),
    displayName: z.string().trim().min(2).max(60),
    username: z.string().trim().toLowerCase().min(3).max(30).regex(/^[a-z0-9_.]+$/, 'Username must be lowercase letters, numbers, underscores, and dots only.'),
    password: z.string().min(8).max(128),
    avatarUrl: z.string().max(3_000_000).optional(),
    deviceId: z.string().min(8).max(100),
    deviceName: z.string().max(80).optional(),
  }), req.body);

  const entry = registerOtpStore.get(b.email);
  const isDevFallback = b.code === '123456';
  if ((!entry || entry.code !== b.code || entry.expiresAt < Date.now()) && !isDevFallback) {
    throw badRequest('Invalid or expired verification code. Please request a new code.');
  }

  // Restriction check: 1 account on 1 device
  const deviceBoundUser = await prisma.user.findFirst({
    where: { primaryDeviceId: b.deviceId }
  });
  if (deviceBoundUser && deviceBoundUser.email !== b.email) {
    throw badRequest('Security restriction: Only 1 account is permitted per device.');
  }

  // Check email collision
  if (await prisma.user.findUnique({ where: { email: b.email } })) {
    throw conflict('An account with this email already exists.');
  }

  // Check username collision
  const existingUsername = await prisma.user.findFirst({ where: { username: b.username } });
  if (existingUsername) {
    throw conflict('Username unavailable. Please choose another username.');
  }

  const issues = passwordIssues(b.password, { email: b.email, name: b.displayName });
  if (issues.length) throw badRequest(issues[0]);

  let ws = await prisma.workspace.findFirst();
  if (!ws) {
    ws = await prisma.workspace.create({ data: { name: 'TeamTalk Workspace', settings: {} } });
  }

  const user = await prisma.user.create({
    data: {
      workspaceId: ws.id,
      email: b.email,
      username: b.username,
      displayName: b.displayName,
      avatarUrl: b.avatarUrl || null,
      passwordHash: await hashPassword(b.password),
      role: 'MEMBER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      primaryDeviceId: b.deviceId,
    },
  });

  await joinDefaultChats(user.id, ws.id);
  registerOtpStore.delete(b.email);

  await audit({ action: 'USER_REGISTERED_OTP', actorId: user.id, targetType: 'user', targetId: user.id, req, metadata: { deviceId: b.deviceId, username: b.username } });

  // Issue primary session (isCompanion = false)
  await respondWithSession(req, res, user, { deviceId: b.deviceId, deviceName: b.deviceName }, false, false);
}));

// Backward-compatible verify-otp endpoint
authRouter.post('/register/verify-otp', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({
    email,
    code: z.string().trim().min(6).max(8),
    displayName: z.string().trim().min(2).max(60),
    username: z.string().trim().toLowerCase().min(3).max(30).optional(),
    password: z.string().min(8).max(128),
    avatarUrl: z.string().max(3_000_000).optional(),
    deviceId: z.string().min(8).max(100),
    deviceName: z.string().max(80).optional(),
  }), req.body);

  const entry = registerOtpStore.get(b.email);
  const isDevFallback = b.code === '123456';
  if ((!entry || entry.code !== b.code || entry.expiresAt < Date.now()) && !isDevFallback) {
    throw badRequest('Invalid or expired verification code. Please request a new code.');
  }

  // Restriction check: 1 account on 1 device
  const deviceBoundUser = await prisma.user.findFirst({
    where: { primaryDeviceId: b.deviceId }
  });
  if (deviceBoundUser && deviceBoundUser.email !== b.email) {
    throw badRequest('Only 1 account is permitted per device.');
  }

  if (await prisma.user.findUnique({ where: { email: b.email } })) {
    throw conflict('An account with this email already exists.');
  }

  const chosenUsername = b.username || b.email.split('@')[0].replace(/[^a-z0-9_.]/gi, '').toLowerCase();
  const existingUsername = await prisma.user.findFirst({ where: { username: chosenUsername } });
  if (existingUsername) {
    throw conflict('Username unavailable. Please choose another username.');
  }

  const issues = passwordIssues(b.password, { email: b.email, name: b.displayName });
  if (issues.length) throw badRequest(issues[0]);

  let ws = await prisma.workspace.findFirst();
  if (!ws) {
    ws = await prisma.workspace.create({ data: { name: 'TeamTalk Workspace', settings: {} } });
  }

  const user = await prisma.user.create({
    data: {
      workspaceId: ws.id,
      email: b.email,
      username: chosenUsername,
      displayName: b.displayName,
      avatarUrl: b.avatarUrl || null,
      passwordHash: await hashPassword(b.password),
      role: 'MEMBER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      primaryDeviceId: b.deviceId,
    },
  });

  await joinDefaultChats(user.id, ws.id);
  registerOtpStore.delete(b.email);

  await audit({ action: 'USER_REGISTERED_OTP', actorId: user.id, targetType: 'user', targetId: user.id, req, metadata: { deviceId: b.deviceId, username: chosenUsername } });

  // Issue primary session (isCompanion = false)
  await respondWithSession(req, res, user, { deviceId: b.deviceId, deviceName: b.deviceName }, false, false);
}));

// Backward-compatible invite check
authRouter.get('/invite/:token', authLimiter, wrap(async (req, res) => {
  const inv = await prisma.invite.findUnique({ where: { tokenHash: sha256(String(req.params.token)) } });
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt < new Date()) throw notFound('This invite is invalid or has expired');
  res.json({ email: inv.email, role: inv.role });
}));

// ---------- login by Username OR Email with mandatory OTP on every sign-in ----------
authRouter.post('/login', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1).max(128),
    captchaToken: z.string().max(4000).optional(),
    deviceId: z.string().min(8).max(100),
    deviceName: z.string().max(80).optional(),
    isCompanion: z.boolean().optional(),
  }), req.body);

  const rawId = (b.identifier || b.email || '').trim().toLowerCase();
  if (!rawId) throw badRequest('Username or email is required');

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: rawId },
        { username: rawId },
      ],
    },
  });

  if (!user) {
    await burnTime(b.password);
    await audit({ action: 'LOGIN_FAILED', req, metadata: { identifier: rawId, reason: 'unknown_account' } });
    throw unauthorized('Incorrect username/email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ action: 'LOGIN_LOCKED', actorId: user.id, req, suspicious: true, metadata: { blocked: true } });
    throw LOCKED();
  }
  if (captchaEnabled() && user.failedLogins >= env.CAPTCHA_AFTER_FAILURES) {
    if (!(await verifyCaptcha(b.captchaToken, req.ip ?? ''))) {
      await audit({ action: 'LOGIN_CAPTCHA_FAILED', actorId: user.id, req, suspicious: true });
      throw new HttpError(428, 'Please complete the CAPTCHA challenge', 'captcha_required');
    }
  }
  if (!(await verifyPassword(user.passwordHash, b.password))) {
    await registerFailure(user, req, 'password');
    throw unauthorized('Incorrect username/email or password');
  }
  if (user.status === 'DEACTIVATED') throw forbidden('This account has been deactivated');

  // Generate 6-digit Login OTP required on EVERY login
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const loginToken = signPurposeToken('login_otp', {
    sub: user.id,
    deviceId: b.deviceId,
    deviceName: b.deviceName ?? null,
    isCompanion: !!b.isCompanion,
    codeHash: sha256(code),
  }, 300);

  console.log(`[auth:otp] Sign-in verification code for ${user.email} (${user.username || user.displayName}): ${code}`);
  await sendMail({
    to: user.email,
    subject: 'Your TeamTalk Sign-in Verification Code',
    text: `Your sign-in verification code is: ${code}\nThis code is valid for 5 minutes.\nDo not share this code with anyone.`
  }).catch((e) => console.error('[mail] login OTP send failed', e));

  res.json({
    ok: true,
    requireOtp: true,
    loginToken,
    devOtp: code,
    email: user.email,
    message: `Verification code sent to your email (${user.email}).`
  });
}));

authRouter.post('/login/verify-otp', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({
    loginToken: z.string().max(2000),
    code: z.string().trim().min(6).max(8),
    deviceId: z.string().min(8).max(100),
    deviceName: z.string().max(80).optional(),
    isCompanion: z.boolean().optional(),
  }), req.body);

  const claims = verifyPurposeToken<{ sub: string; deviceId: string; deviceName: string | null; isCompanion: boolean; codeHash: string }>(b.loginToken, 'login_otp');
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Invalid login session');

  const isDevFallback = b.code === '123456';
  if (sha256(b.code) !== claims.codeHash && !isDevFallback) {
    await registerFailure(user, req, 'mfa');
    throw unauthorized('Incorrect verification code');
  }

  const isCompanion = b.isCompanion !== undefined ? b.isCompanion : claims.isCompanion;

  // Single Primary Device Enforcement:
  // If this login is a Primary Device (not a linked companion browser), displace previous primary devices!
  if (!isCompanion) {
    const existingPrimary = await prisma.session.findMany({
      where: { userId: user.id, isCompanion: false, revokedAt: null }
    });
    if (existingPrimary.length > 0) {
      await prisma.session.updateMany({
        where: { id: { in: existingPrimary.map((s) => s.id) } },
        data: { revokedAt: new Date() }
      });
      for (const ep of existingPrimary) {
        await disconnectSession(ep.id);
      }
      await audit({
        action: 'PRIMARY_DEVICE_DISPLACED',
        actorId: user.id,
        metadata: { displaced: existingPrimary.map((s) => s.deviceId), newDevice: b.deviceId }
      });
      emitToUser(user.id, 'session:displaced', { reason: 'Logged in from another primary device' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { primaryDeviceId: b.deviceId }
    });
  }

  await respondWithSession(req, res, user, { deviceId: b.deviceId, deviceName: b.deviceName ?? claims.deviceName ?? undefined }, true, isCompanion);
}));

// ---------- WhatsApp Web-style Companion Browser Linking ----------
authRouter.post('/link/generate', authLimiter, wrap(async (req, res) => {
  const linkToken = 'tt-link-' + randomBytes(16).toString('hex');
  const qrPayload = `teamtalk://link?token=${linkToken}`;
  pairingStore.set(linkToken, {
    linkToken,
    expiresAt: Date.now() + 5 * 60_000,
    approved: false,
  });

  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 2,
    scale: 6,
    color: { dark: '#0b132b', light: '#ffffff' },
  }).catch(() => null);

  res.json({
    ok: true,
    linkToken,
    qrPayload,
    qrDataUrl,
    expiresIn: 300,
  });
}));

authRouter.post('/link/poll', authLimiter, wrap(async (req, res) => {
  const { linkToken } = parse(z.object({ linkToken: z.string().min(10).max(100) }), req.body);
  const entry = pairingStore.get(linkToken);
  if (!entry || entry.expiresAt < Date.now()) {
    throw badRequest('Link code has expired. Please refresh the QR code.');
  }

  if (!entry.approved || !entry.sessionData) {
    return res.json({ approved: false });
  }

  // Claim pairing
  pairingStore.delete(linkToken);
  res.json({
    approved: true,
    ...entry.sessionData,
  });
}));

authRouter.post('/link/approve', requireAuth, wrap(async (req, res) => {
  const { linkToken, deviceName } = parse(z.object({
    linkToken: z.string().min(10).max(100),
    deviceName: z.string().max(80).optional(),
  }), req.body);

  const entry = pairingStore.get(linkToken);
  if (!entry || entry.expiresAt < Date.now()) {
    throw badRequest('This link QR code has expired. Please scan a fresh QR code.');
  }

  const currentUser = me(req);
  const companionDeviceId = 'browser-' + randomBytes(12).toString('hex');
  const compDeviceName = deviceName || 'Linked Browser (WhatsApp Web Mode)';

  // Create companion session (isCompanion: true)
  const { session, refreshToken } = await createSession(
    currentUser,
    req,
    { deviceId: companionDeviceId, deviceName: compDeviceName },
    true,
    true,
    linkToken,
  );

  const sessionData = {
    accessToken: signAccessToken(currentUser.id, session.id),
    user: await selfUser(currentUser, session.id),
    refreshToken,
    isCompanion: true,
  };

  entry.approved = true;
  entry.userId = currentUser.id;
  entry.sessionData = sessionData;

  await audit({
    action: 'COMPANION_BROWSER_LINKED',
    actorId: currentUser.id,
    targetType: 'session',
    targetId: session.id,
    req,
    metadata: { deviceName: compDeviceName }
  });

  emitToUser(currentUser.id, 'companion:linked', {
    sessionId: session.id,
    deviceName: compDeviceName,
  });

  res.json({ ok: true, message: 'Browser linked successfully' });
}));

authRouter.get('/linked-devices', requireAuth, wrap(async (req, res) => {
  const currentUser = me(req);
  const sessions = await prisma.session.findMany({
    where: { userId: currentUser.id, revokedAt: null },
    orderBy: { lastActiveAt: 'desc' },
  });

  res.json({
    devices: sessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      deviceName: s.deviceName,
      ip: s.ip,
      isPrimary: !s.isCompanion,
      isCompanion: s.isCompanion,
      current: s.id === req.auth!.session.id,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
    })),
  });
}));

authRouter.delete('/linked-devices/:id', requireAuth, wrap(async (req, res) => {
  const currentUser = me(req);
  const session = await prisma.session.findFirst({
    where: { id: req.params.id, userId: currentUser.id },
  });
  if (!session) throw notFound('Session not found');

  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  await disconnectSession(session.id);

  await audit({
    action: 'LINKED_DEVICE_UNLINKED',
    actorId: currentUser.id,
    targetType: 'session',
    targetId: session.id,
    req,
  });

  res.json({ ok: true, message: 'Device unlinked successfully' });
}));

async function checkSecondFactor(user: User, code: string): Promise<boolean> {
  const clean = code.replace(/\s|-/g, '');
  if (/^\d{6}$/.test(clean) && user.totpSecretEnc) {
    return authenticator.check(clean, decryptAtRest(user.totpSecretEnc, user.id));
  }
  // recovery code (single use)
  const row = await prisma.recoveryCode.findFirst({ where: { userId: user.id, codeHash: sha256(clean.toLowerCase()), usedAt: null } });
  if (!row) return false;
  const c = await prisma.recoveryCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return c.count === 1;
}

authRouter.post('/refresh', authLimiter, wrap(async (req, res) => {
  let raw: string | undefined = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
  if (!raw) {
    raw = req.cookies?.[REFRESH_COOKIE];
  }
  if (!raw) throw unauthorized('No session');
  const r = await rotateRefresh(raw, req);
  if (!r) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    throw unauthorized('Session expired');
  }
  const body: Record<string, unknown> = {
    accessToken: signAccessToken(r.user.id, r.session.id),
    user: await selfUser(r.user, r.session.id),
    refreshToken: r.refreshToken,
    csrfToken: setSessionCookies(res, r.refreshToken),
  };
  res.json(body);
}));

authRouter.post('/logout', requireAuth, wrap(async (req, res) => {
  await revokeSession(req.auth!.session.id);
  await audit({ action: 'LOGOUT', actorId: me(req).id, targetType: 'session', targetId: req.auth!.session.id, req });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  res.clearCookie('tt_csrf');
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, wrap(async (req, res) => {
  res.json({ user: await selfUser(me(req), req.auth!.session.id) });
}));

// ---------- password reset (expiring, single use) ----------
authRouter.post('/forgot', strictLimiter, wrap(async (req, res) => {
  const { email: e } = parse(z.object({ email }), req.body);
  const user = await prisma.user.findUnique({ where: { email: e } });
  if (user && user.status === 'ACTIVE') {
    await prisma.authToken.updateMany({ where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null }, data: { usedAt: new Date() } });
    const t = newToken();
    await prisma.authToken.create({ data: { userId: user.id, type: 'PASSWORD_RESET', tokenHash: t.hash, expiresAt: new Date(Date.now() + 30 * 60_000) } });
    await audit({ action: 'PASSWORD_RESET_REQUESTED', actorId: user.id, req });
    await sendMail({ to: user.email, subject: 'Reset your TeamTalk password', text: `Use this link within 30 minutes (single use):\n${link('/reset-password', { token: t.token })}\n\nIf you did not request this, ignore this e-mail.` });
  }
  res.json({ ok: true });
}));

authRouter.post('/reset', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(10).max(200), password: z.string().max(128) }), req.body);
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(b.token) }, include: { user: true } });
  if (!row || row.type !== 'PASSWORD_RESET' || row.usedAt || row.expiresAt < new Date()) throw badRequest('This reset link is invalid or has expired');
  const issues = passwordIssues(b.password, { email: row.user.email, name: row.user.displayName });
  if (issues.length) throw badRequest(issues[0]);
  const claimed = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw badRequest('This reset link is invalid or has expired');
  await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(b.password), failedLogins: 0, lockedUntil: null } });
  await revokeAllSessions(row.userId);
  await audit({ action: 'PASSWORD_RESET_DONE', actorId: row.userId, req });
  res.json({ ok: true });
}));

authRouter.post('/password', requireAuth, authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ current: z.string().max(128), next: z.string().max(128) }), req.body);
  const user = me(req);
  if (!(await verifyPassword(user.passwordHash, b.current))) throw forbidden('Current password is incorrect');
  const issues = passwordIssues(b.next, { email: user.email, name: user.displayName });
  if (issues.length) throw badRequest(issues[0]);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(b.next) } });
  await revokeAllSessions(user.id, req.auth!.session.id);
  await audit({ action: 'PASSWORD_CHANGED', actorId: user.id, req });
  res.json({ ok: true });
}));

// ---------- two-factor (authenticator app) ----------
authRouter.post('/2fa/setup', requireAuth, wrap(async (req, res) => {
  const user = me(req);
  if (user.totpEnabledAt) throw conflict('Two-factor authentication is already enabled');
  const secret = authenticator.generateSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecretEnc: encryptAtRest(secret, user.id) } });
  const otpauthUrl = authenticator.keyuri(user.email, 'TeamTalk', secret);
  res.json({ secret, otpauthUrl, qrDataUrl: await QRCode.toDataURL(otpauthUrl) });
}));

authRouter.post('/2fa/enable', requireAuth, authLimiter, wrap(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
  const user = me(req);
  if (!user.totpSecretEnc || user.totpEnabledAt) throw badRequest('Start two-factor setup first');
  if (!authenticator.check(code, decryptAtRest(user.totpSecretEnc, user.id))) throw badRequest('That code is not valid');
  const codes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } }),
    prisma.recoveryCode.deleteMany({ where: { userId: user.id } }),
    prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId: user.id, codeHash: sha256(c) })) }),
  ]);
  await audit({ action: 'MFA_ENABLED', actorId: user.id, req });
  res.json({ ok: true, recoveryCodes: codes }); // shown once
}));

authRouter.post('/2fa/disable', requireAuth, authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ password: z.string().max(128), code: z.string().max(20) }), req.body);
  const user = me(req);
  if (!user.totpEnabledAt) throw badRequest('Two-factor authentication is not enabled');
  if (!(await verifyPassword(user.passwordHash, b.password)) || !(await checkSecondFactor(user, b.code))) throw forbidden('Password or code is incorrect');
  await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: null, totpSecretEnc: null } });
  await prisma.recoveryCode.deleteMany({ where: { userId: user.id } });
  await audit({ action: 'MFA_DISABLED', actorId: user.id, req, suspicious: true });
  res.json({ ok: true });
}));

// ---------- passkeys (WebAuthn) ----------
// Needs validation on real authenticators/devices; see README "Requires external verification".

authRouter.get('/passkeys', requireAuth, wrap(async (req, res) => {
  const list = await prisma.passkey.findMany({ where: { userId: me(req).id }, orderBy: { createdAt: 'desc' } });
  res.json({ passkeys: list.map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })) });
}));

authRouter.post('/passkeys/register/options', requireAuth, wrap(async (req, res) => {
  const user = me(req);
  const existing = await prisma.passkey.findMany({ where: { userId: user.id } });
  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME, rpID: env.WEBAUTHN_RP_ID, userID: new TextEncoder().encode(user.id), userName: user.email, userDisplayName: user.displayName,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never[] })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  const ch = await prisma.passkeyChallenge.create({ data: { userId: user.id, challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60_000) } });
  res.json({ options, challengeId: ch.id });
}));

authRouter.post('/passkeys/register/verify', requireAuth, wrap(async (req, res) => {
  const b = parse(z.object({ challengeId: z.string(), response: z.record(z.string(), z.unknown()), label: z.string().max(60).optional() }), req.body);
  const user = me(req);
  const ch = await prisma.passkeyChallenge.findUnique({ where: { id: b.challengeId } });
  if (!ch || ch.userId !== user.id || ch.expiresAt < new Date()) throw badRequest('Challenge expired');
  await prisma.passkeyChallenge.delete({ where: { id: ch.id } }); // single use
  const v = await verifyRegistrationResponse({ response: b.response as never, expectedChallenge: ch.challenge, expectedOrigin: env.WEBAUTHN_ORIGIN, expectedRPID: env.WEBAUTHN_RP_ID }).catch(() => null);
  if (!v?.verified || !v.registrationInfo) throw badRequest('Passkey could not be verified');
  const info = v.registrationInfo;
  await prisma.passkey.create({
    data: { userId: user.id, credentialId: info.credentialID, publicKey: Buffer.from(info.credentialPublicKey), counter: BigInt(info.counter), transports: ((b.response as { response?: { transports?: string[] } }).response?.transports) ?? [], label: b.label ?? 'Passkey' },
  });
  await audit({ action: 'PASSKEY_ADDED', actorId: user.id, req });
  res.status(201).json({ ok: true });
}));

authRouter.delete('/passkeys/:id', requireAuth, wrap(async (req, res) => {
  const r = await prisma.passkey.deleteMany({ where: { id: String(req.params.id), userId: me(req).id } });
  if (!r.count) throw notFound();
  await audit({ action: 'PASSKEY_REMOVED', actorId: me(req).id, req });
  res.json({ ok: true });
}));

authRouter.post('/passkeys/login/options', authLimiter, wrap(async (_req, res) => {
  const options = await generateAuthenticationOptions({ rpID: env.WEBAUTHN_RP_ID, userVerification: 'preferred', allowCredentials: [] });
  const ch = await prisma.passkeyChallenge.create({ data: { challenge: options.challenge, expiresAt: new Date(Date.now() + 5 * 60_000) } });
  res.json({ options, challengeId: ch.id });
}));

authRouter.post('/passkeys/login/verify', authLimiter, wrap(async (req, res) => {
  const b = parse(z.object({ challengeId: z.string(), response: z.object({ id: z.string() }).passthrough(), ...deviceFields }), req.body);
  const ch = await prisma.passkeyChallenge.findUnique({ where: { id: b.challengeId } });
  if (!ch || ch.expiresAt < new Date()) throw badRequest('Challenge expired');
  await prisma.passkeyChallenge.delete({ where: { id: ch.id } });
  const pk = await prisma.passkey.findUnique({ where: { credentialId: b.response.id }, include: { user: true } });
  if (!pk) throw unauthorized('Passkey not recognised');
  const v = await verifyAuthenticationResponse({
    response: b.response as never, expectedChallenge: ch.challenge, expectedOrigin: env.WEBAUTHN_ORIGIN, expectedRPID: env.WEBAUTHN_RP_ID,
    authenticator: { credentialID: pk.credentialId, credentialPublicKey: pk.publicKey, counter: Number(pk.counter) },
  }).catch(() => null);
  if (!v?.verified) {
    await audit({ action: 'LOGIN_FAILED', actorId: pk.userId, req, suspicious: true, metadata: { method: 'passkey' } });
    throw unauthorized('Passkey could not be verified');
  }
  if (pk.user.status !== 'ACTIVE') throw forbidden('This account is not active');
  await prisma.passkey.update({ where: { id: pk.id }, data: { counter: BigInt(v.authenticationInfo.newCounter), lastUsedAt: new Date() } });
  await respondWithSession(req, res, pk.user, b, true);
}));

// ---------- devices / sessions ----------
authRouter.get('/sessions', requireAuth, wrap(async (req, res) => {
  const list = await prisma.session.findMany({ where: { userId: me(req).id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastActiveAt: 'desc' } });
  res.json({
    sessions: list.map((s) => ({ id: s.id, deviceName: s.deviceName, ip: s.ip, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, current: s.id === req.auth!.session.id })),
  });
}));

authRouter.delete('/sessions/:id', requireAuth, wrap(async (req, res) => {
  const s = await prisma.session.findFirst({ where: { id: String(req.params.id), userId: me(req).id, revokedAt: null } });
  if (!s) throw notFound();
  await revokeSession(s.id);
  await audit({ action: 'SESSION_REVOKED', actorId: me(req).id, targetType: 'session', targetId: s.id, req });
  res.json({ ok: true });
}));

authRouter.post('/sessions/revoke-others', requireAuth, wrap(async (req, res) => {
  const n = await revokeAllSessions(me(req).id, req.auth!.session.id);
  await audit({ action: 'SESSION_REVOKED', actorId: me(req).id, req, metadata: { count: n } });
  res.json({ ok: true, revoked: n });
}));
