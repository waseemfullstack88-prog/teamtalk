import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// Load .env if present and not yet loaded
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  APP_URL: z.string().url().default('http://localhost:5173'),
  ALLOWED_ORIGINS: z.string().optional(), // comma separated, extra origins (e.g. capacitor://localhost)
  TRUST_PROXY: z.coerce.number().default(0),

  // secrets (all required in production, >= 32 chars)
  JWT_SECRET: z.string().min(32),
  DATA_ENCRYPTION_KEY: z.string().min(32), // base64 of 32 random bytes
  FILE_SIGNING_SECRET: z.string().min(32),
  TURN_SECRET: z.string().min(16),
  TURN_URLS: z.string().default('stun:localhost:3478,turn:localhost:3478'),
  TURN_TTL_SECONDS: z.coerce.number().default(3600),

  // storage
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('teamtalk-private'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  SIGNED_URL_TTL_SECONDS: z.coerce.number().default(60),

  // mail
  SMTP_URL: z.string().optional(), // e.g. smtp://user:pass@host:587 ; empty => log to console (dev only)
  MAIL_FROM: z.string().default('TeamTalk <no-reply@teamtalk.local>'),

  // push
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // bot defence
  CAPTCHA_PROVIDER: z.enum(['none', 'turnstile', 'hcaptcha']).default('none'),
  CAPTCHA_SECRET: z.string().optional(),
  CAPTCHA_AFTER_FAILURES: z.coerce.number().default(3),

  // scanning / gifs
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),
  GIPHY_API_KEY: z.string().optional(),

  // webauthn
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('TeamTalk'),
  WEBAUTHN_ORIGIN: z.string().default('http://localhost:5173'),

  COOKIE_SECURE: bool,
  RATE_LIMIT_DISABLED: bool,
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const weak = ['change-me', 'changeme', 'secret', 'password', 'dev-'];
    for (const k of ['JWT_SECRET', 'DATA_ENCRYPTION_KEY', 'FILE_SIGNING_SECRET', 'TURN_SECRET'] as const) {
      if (weak.some((w) => env[k].toLowerCase().includes(w))) {
        throw new Error(`${k} looks like a placeholder; set a strong random value for production.`);
      }
    }
    if (!env.APP_URL.startsWith('https://')) throw new Error('APP_URL must be https:// in production.');
    if (env.SMTP_URL === undefined) throw new Error('SMTP_URL is required in production.');
  }
  const key = Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be base64 of exactly 32 bytes.');
  return env;
}

export const env: Env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
export const cookieSecure = env.COOKIE_SECURE || isProd;
