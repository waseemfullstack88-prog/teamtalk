import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Encryption at rest for sensitive columns (message bodies, TOTP secrets).
 *
 * Uses the standard AES-256-GCM primitive from Node's crypto (OpenSSL) with a random 96-bit
 * IV per value. No custom cryptography. The key comes from DATA_ENCRYPTION_KEY and is never
 * stored in the database, so database dumps and backups contain only ciphertext.
 *
 * IMPORTANT: this is server-side encryption. The server can decrypt messages, so this is NOT
 * end-to-end encryption.
 */
const key = () => Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');

export function encryptAtRest(plain: string, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${ct.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptAtRest(payload: string, aad = ''): string {
  const [v, iv, ct, tag] = payload.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('Unsupported ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
