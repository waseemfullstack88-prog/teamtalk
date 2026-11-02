import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, Session, User } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/db.js';
import { forbidden, unauthorized, wrap } from '../lib/http.js';

export interface AccessClaims {
  sub: string;
  sid: string;
  typ: 'access';
}

export interface AuthContext {
  user: User;
  session: Session;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

// Permanent session validity for device-embedded mobile app (100 years / never expires)
const ACCESS_TTL_SECONDS = 36500 * 86400;

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId, typ: 'access' } satisfies AccessClaims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
    issuer: 'teamtalk',
  });
}

export function signPurposeToken(purpose: string, payload: Record<string, unknown>, ttlSeconds: number): string {
  return jwt.sign({ ...payload, typ: purpose }, env.JWT_SECRET, { algorithm: 'HS256', expiresIn: ttlSeconds, issuer: 'teamtalk' });
}

export function verifyPurposeToken<T extends Record<string, unknown>>(token: string, purpose: string): T {
  try {
    const p = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'teamtalk' }) as T & { typ?: string };
    if (p.typ !== purpose) throw new Error('wrong purpose');
    return p;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
}

/** Resolves an access token to a live user + session. Shared by HTTP and Socket.IO. */
export async function authenticateAccessToken(token: string): Promise<AuthContext> {
  const claims = verifyPurposeToken<AccessClaims & Record<string, unknown>>(token, 'access');
  const session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== claims.sub) {
    throw unauthorized('Session has ended');
  }
  if (session.user.status !== 'ACTIVE') throw unauthorized('Account is not active');
  const { user, ...s } = session;
  if (Date.now() - s.lastActiveAt.getTime() > 60_000) {
    prisma.session.update({ where: { id: s.id }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
  }
  return { user, session: s as Session };
}

export const requireAuth = wrap(async (req: Request, _res: Response, next: NextFunction) => {
  if (req.auth) return next(); // already authenticated by an earlier router in the chain
  const h = req.get('authorization');
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  req.auth = await authenticateAccessToken(h.slice(7));
  next();
});

export const me = (req: Request): User => {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
};

const RANK: Record<Role, number> = { MEMBER: 1, ADMIN: 2, SUPER_ADMIN: 3 };
export const hasRole = (role: Role, min: Role) => RANK[role] >= RANK[min];

export const requireRole = (min: Role) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.auth || !hasRole(req.auth.user.role, min)) return next(forbidden('Administrator access required'));
  next();
};

/** Browser (cookie) flows need a double-submit CSRF token; Bearer-token calls are not CSRF-able. */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  const cookie = req.cookies?.tt_csrf as string | undefined;
  const header = req.get('x-csrf-token');
  if (!cookie || !header || cookie !== header) return next(forbidden('CSRF check failed'));
  next();
}
