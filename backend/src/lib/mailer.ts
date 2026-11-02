import nodemailer, { type Transporter } from 'nodemailer';
import { env, isProd } from '../config/env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** In tests/dev without SMTP, mails are captured here so they can be inspected (never in production). */
export const outbox: Mail[] = [];

let transport: Transporter | null = null;

export async function sendMail(mail: Mail): Promise<void> {
  if (!env.SMTP_URL) {
    if (isProd) throw new Error('SMTP not configured');
    outbox.push(mail);
    if (env.NODE_ENV === 'development') console.log(`\n[mail:dev] to=${mail.to}\n${mail.subject}\n${mail.text}\n`);
    return;
  }
  transport ??= nodemailer.createTransport(env.SMTP_URL);
  await transport.sendMail({ from: env.MAIL_FROM, ...mail });
}

export const link = (path: string, params: Record<string, string>) => {
  const u = new URL(path, env.APP_URL);
  for (const [k, v] of Object.entries(params)) u.hash = `${k}=${encodeURIComponent(v)}`; // fragment: never sent to servers/logs
  return u.toString();
};
