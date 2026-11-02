import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isProd } from './config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { errorHandler, notFound } from './lib/http.js';
import { globalLimiter } from './middleware/limits.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { chatsRouter } from './routes/chats.js';
import { filesRouter } from './routes/files.js';
import { messagesRouter } from './routes/messages.js';
import { statusRouter } from './routes/status.js';
import { usersRouter } from './routes/users.js';

export function allowedOrigins(): string[] {
  return [env.APP_URL, ...(env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])].map((o) => o.replace(/\/$/, ''));
}

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true;
  if (origin.startsWith('capacitor://')) return true;
  const origins = allowedOrigins();
  if (origins.includes(origin)) return true;
  if (!isProd) {
    // In development, permit localhost, 127.0.0.1 on any port, and LAN IPs (for mobile testing)
    if (
      /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(
        origin
      )
    ) {
      return true;
    }
  }
  return false;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY);

  // Security headers. The API serves JSON/files only, so CSP is maximally strict; the web UI's own CSP lives in
  // frontend/nginx.conf (and the Vite dev server for local development).
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] } },
      hsts: isProd ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  if (isProd) {
    // all production traffic must be HTTPS (terminated at the reverse proxy)
    app.use((req, res, next) => (req.secure ? next() : res.redirect(308, `https://${req.hostname}${req.originalUrl}`)));
  }

  app.use(
    cors({
      origin: (origin, cb) => (isOriginAllowed(origin) ? cb(null, true) : cb(new Error('CORS origin not allowed'))),
      credentials: true,
      allowedHeaders: ['content-type', 'authorization', 'x-csrf-token', 'x-tt-client', 'range'],
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Disposition'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ limit: '15mb', extended: true }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', globalLimiter);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  // One-click Direct APK Download for Android test devices
  app.get('/download', (_req, res) => {
    const apkPath = path.resolve(__dirname, '../../TeamTalk-latest.apk');
    if (fs.existsSync(apkPath)) {
      res.download(apkPath, 'TeamTalk.apk');
    } else {
      res.status(404).send('APK not found. Please assemble APK first.');
    }
  });

  // Order matters: routers with public leaves (files/raw) and path-specific routers come before the /api-wide ones.
  app.use('/api/auth', authRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/status', statusRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/chats', chatsRouter);
  app.use('/api', messagesRouter);
  app.use('/api', usersRouter);

  app.use('/api', (_req, _res, next) => next(notFound('Route not found')));
  app.use(errorHandler);
  return app;
}
