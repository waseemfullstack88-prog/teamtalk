import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * coturn "use-auth-secret" (TURN REST API) credentials: username = "<expiry>:<userId>",
 * credential = base64(HMAC-SHA1(secret, username)). coturn must run with
 * `--use-auth-secret --static-auth-secret=$TURN_SECRET`. Credentials expire automatically.
 */
export function turnCredentials(userId: string, now = Date.now()) {
  const expiry = Math.floor(now / 1000) + env.TURN_TTL_SECONDS;
  const username = `${expiry}:${userId}`;
  const credential = createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
  const urls = env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean);
  const stun = urls.filter((u) => u.startsWith('stun'));
  const turn = urls.filter((u) => u.startsWith('turn'));
  return {
    ttl: env.TURN_TTL_SECONDS,
    iceServers: [
      ...(stun.length ? [{ urls: stun }] : []),
      ...(turn.length ? [{ urls: turn, username, credential }] : []),
    ],
  };
}
