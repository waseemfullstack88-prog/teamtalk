import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import argon2 from '@node-rs/argon2';
import { z } from 'zod';

/** Opaque random token. Only the SHA-256 hash is stored in the database. */
export function newToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString('base64url');
  return { token, hash: sha256(token) };
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Argon2id (algorithm = 2) with OWASP-recommended minimum parameters.
const ARGON_OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argon2.hash(pw, ARGON_OPTS);
export async function verifyPassword(hash: string, pw: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

// A compact deny-list of very common passwords. Production deployments should additionally
// check against a breached-password service (e.g. HIBP k-anonymity API).
const COMMON = new Set(
  [
    'password123!', 'passw0rd!234', 'qwerty123456', 'letmein12345', 'welcome12345',
    'administrator1', 'iloveyou1234', 'teamtalk12345', 'changeme1234',
  ].map((s) => s.toLowerCase()),
);

export function passwordIssues(pw: string, _context: { email?: string; name?: string } = {}): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push('Password must be at least 8 characters long.');
  if (pw.length > 128) issues.push('Use at most 128 characters.');
  if (!/[A-Za-z]/.test(pw)) issues.push('Password must contain at least one letter.');
  if (!/[0-9]/.test(pw)) issues.push('Password must contain at least one number.');
  return issues;
}

export const passwordSchema = z.string().max(128);
