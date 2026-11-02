import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { safeEqual } from './secure.js';

/**
 * Private object storage. Objects are never publicly readable; clients receive short-lived
 * signed URLs only after the API has verified access to the owning chat/status/avatar.
 *   local: files on disk, served by GET /api/files/raw/:key with an HMAC-signed, expiring URL
 *   s3:    S3-compatible (MinIO in docker-compose) with presigned GET URLs
 */
export interface Storage {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Returns a URL valid for ttlSeconds. */
  signedUrl(key: string, opts: { name: string; mime: string; download: boolean; ttl: number }): Promise<string>;
  /** Local driver only: stream the object for an already verified signed request. */
  stream?(key: string, options?: { start?: number; end?: number }): fs.ReadStream;
  filePath?(key: string): string;
}

export function newStorageKey(): string {
  return randomBytes(24).toString('hex'); // no user supplied data in the key
}

const sign = (payload: string) => createHmac('sha256', env.FILE_SIGNING_SECRET).update(payload).digest('base64url');

export function verifyLocalSignature(q: { key: string; exp: string; dl: string; sig: string }): boolean {
  const exp = Number(q.exp);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return safeEqual(sign(`${q.key}|${q.exp}|${q.dl}`), q.sig);
}

class LocalStorage implements Storage {
  private root = path.resolve(env.LOCAL_STORAGE_DIR);
  constructor() {
    fs.mkdirSync(this.root, { recursive: true });
  }
  private file(key: string) {
    if (!/^[a-f0-9]{48}$/.test(key)) throw new Error('bad key');
    return path.join(this.root, key);
  }
  async put(key: string, data: Buffer) {
    await fs.promises.writeFile(this.file(key), data, { mode: 0o600 });
  }
  async remove(key: string) {
    await fs.promises.rm(this.file(key), { force: true });
  }
  async signedUrl(key: string, o: { download: boolean; ttl: number }) {
    const exp = String(Math.floor(Date.now() / 1000) + o.ttl);
    const dl = o.download ? '1' : '0';
    const sig = sign(`${key}|${exp}|${dl}`);
    return `/api/files/raw/${key}?exp=${exp}&dl=${dl}&sig=${sig}`;
  }
  filePath(key: string) {
    return this.file(key);
  }
  stream(key: string, options?: { start?: number; end?: number }) {
    return fs.createReadStream(this.file(key), options);
  }
}

class S3Storage implements Storage {
  private client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } : undefined,
  });
  async put(key: string, data: Buffer, mime: string) {
    await this.client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: data, ContentType: mime, ServerSideEncryption: undefined }));
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }
  async signedUrl(key: string, o: { name: string; mime: string; download: boolean; ttl: number }) {
    const safe = o.name.replace(/[^\w.\- ]/g, '_');
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        ResponseContentType: o.mime,
        ResponseContentDisposition: `${o.download ? 'attachment' : 'inline'}; filename="${safe}"`,
      }),
      { expiresIn: o.ttl },
    );
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  instance ??= env.STORAGE_DRIVER === 's3' ? new S3Storage() : new LocalStorage();
  return instance;
}

export { Readable, pipeline };
