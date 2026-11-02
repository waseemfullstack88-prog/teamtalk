import { prisma } from './db.js';
import { env } from '../config/env.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

/**
 * Firebase Cloud Messaging. Requires an external Firebase project and FIREBASE_SERVICE_ACCOUNT_JSON.
 * Without it, push is disabled (sendPush is a no-op that returns false).
 * Payloads NEVER contain message text, only a generic notice, so content never transits Google servers.
 */
let messaging: Messaging | null | undefined;

function getFcm(): Messaging | null {
  if (messaging !== undefined) return messaging;
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return (messaging = null);
  try {
    const app = initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
    messaging = getMessaging(app);
  } catch (e) {
    console.error('[push] Firebase init failed', e);
    messaging = null;
  }
  return messaging;
}

export const pushEnabled = () => !!env.FIREBASE_SERVICE_ACCOUNT_JSON;

/** Test hook so tests can observe pushes without Firebase. */
export const pushLog: { userId: string; title: string; data: Record<string, string> }[] = [];

export async function sendPush(userId: string, title: string, data: Record<string, string>): Promise<boolean> {
  if (env.NODE_ENV === 'test') {
    pushLog.push({ userId, title, data });
    return true;
  }
  const m = getFcm();
  if (!m) return false;
  const tokens = await prisma.pushToken.findMany({ where: { userId } });
  if (!tokens.length) return false;
  const res = await m.sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title, body: 'Open TeamTalk to view' },
    data,
    android: { priority: 'high' },
  });
  const dead = res.responses
    .map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error?.code ?? '') ? tokens[i]!.token : null))
    .filter(Boolean) as string[];
  if (dead.length) await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
  return res.responses.some((r) => r.success);
}
