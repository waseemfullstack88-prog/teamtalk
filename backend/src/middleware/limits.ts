import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Per-IP limiter. In-memory per process; for multiple API replicas swap the store for
 * `rate-limit-redis` (see README). Disabled only via RATE_LIMIT_DISABLED (tests).
 */
export const limiter = (opts: { windowMs: number; max: number; key?: (req: Request) => string; message?: string }) =>
  rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.RATE_LIMIT_DISABLED,
    keyGenerator: opts.key ?? ((req) => req.ip ?? 'unknown'),
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'rate_limited', message: opts.message ?? 'Too many requests. Please slow down and try again shortly.' } }),
  });

export const globalLimiter = limiter({ windowMs: 60_000, max: 600 });
export const authLimiter = limiter({ windowMs: 15 * 60_000, max: 30, message: 'Too many attempts. Try again in a few minutes.' });
export const strictLimiter = limiter({ windowMs: 60 * 60_000, max: 10, message: 'Too many requests. Try again later.' });
export const uploadLimiter = limiter({ windowMs: 60_000, max: 60 });
