import { env } from '../config/env.js';

/**
 * CAPTCHA hook. With CAPTCHA_PROVIDER=none the hook is disabled (verification always passes) and the
 * API never demands a token. With turnstile/hcaptcha, tokens are verified server-side after
 * CAPTCHA_AFTER_FAILURES failed logins for the same account or IP. Requires an external account/keys.
 */
export const captchaEnabled = () => env.CAPTCHA_PROVIDER !== 'none';

type Verifier = (token: string, ip: string) => Promise<boolean>;
let override: Verifier | null = null;
/** Test hook. */
export const setCaptchaVerifier = (v: Verifier | null) => (override = v);

export async function verifyCaptcha(token: string | undefined, ip: string): Promise<boolean> {
  if (override) return override(token ?? '', ip);
  if (!captchaEnabled()) return true;
  if (!token || !env.CAPTCHA_SECRET) return false;
  const url =
    env.CAPTCHA_PROVIDER === 'turnstile'
      ? 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
      : 'https://hcaptcha.com/siteverify';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.CAPTCHA_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const j = (await res.json()) as { success?: boolean };
    return j.success === true;
  } catch {
    return false;
  }
}
