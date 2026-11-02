import request from 'supertest';
import type { Role, User, UserStatus, Workspace } from '@prisma/client';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/secure.js';
import { outbox } from '../src/lib/mailer.js';
import { defaultSettings } from '../src/lib/settings.js';

export const app = createApp();
export const PASSWORD = 'Str0ng!Passphrase#2026';

let counter = 0;
export const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeWorkspace(settings: Record<string, unknown> = {}): Promise<Workspace> {
  return prisma.workspace.create({ data: { name: `ws-${uniq()}`, settings: { ...defaultSettings(), ...settings } } });
}

export async function makeUser(ws: Workspace, o: { role?: Role; status?: UserStatus; name?: string; email?: string; password?: string } = {}): Promise<User & { password: string }> {
  const id = uniq();
  const password = o.password ?? PASSWORD;
  const u = await prisma.user.create({
    data: {
      workspaceId: ws.id, email: (o.email ?? `u${id}@example.test`).toLowerCase(), displayName: o.name ?? `User ${id}`,
      passwordHash: await hashPassword(password), role: o.role ?? 'MEMBER', status: o.status ?? 'ACTIVE', emailVerifiedAt: new Date(),
    },
  });
  return { ...u, password };
}

export async function login(u: { email: string; password: string }, deviceId = `dev-${uniq()}-abcdefgh`) {
  const res = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId });
  return { res, token: res.body.accessToken as string, deviceId };
}

/** Authenticated supertest helpers. */
export const as = (token: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  put: (url: string) => request(app).put(url).set('Authorization', `Bearer ${token}`),
  patch: (url: string) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
});

export async function world() {
  const ws = await makeWorkspace();
  const superAdmin = await makeUser(ws, { role: 'SUPER_ADMIN', name: 'Sue Super' });
  const admin = await makeUser(ws, { role: 'ADMIN', name: 'Adam Admin' });
  const alice = await makeUser(ws, { name: 'Alice' });
  const bob = await makeUser(ws, { name: 'Bob' });
  const carol = await makeUser(ws, { name: 'Carol' });
  const t = {
    superAdmin: (await login(superAdmin)).token,
    admin: (await login(admin)).token,
    alice: (await login(alice)).token,
    bob: (await login(bob)).token,
    carol: (await login(carol)).token,
  };
  return { ws, superAdmin, admin, alice, bob, carol, t };
}

export const lastMailTo = (email: string) => [...outbox].reverse().find((m) => m.to === email);
export const tokenFromMail = (email: string) => {
  const m = lastMailTo(email)?.text.match(/#token=([A-Za-z0-9_\-%]+)/);
  if (!m) throw new Error(`No token mail for ${email}`);
  return decodeURIComponent(m[1]!);
};

export async function directChat(token: string, otherId: string): Promise<string> {
  const r = await as(token).post('/api/chats').send({ type: 'DIRECT', userId: otherId });
  if (r.status !== 201) throw new Error(`direct chat failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.chat.id;
}

export async function groupChat(token: string, name: string, memberIds: string[]): Promise<string> {
  const r = await as(token).post('/api/chats').send({ type: 'GROUP', name, memberIds });
  if (r.status !== 201) throw new Error(`group failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.chat.id;
}

export async function say(token: string, chatId: string, body: string) {
  const r = await as(token).post(`/api/chats/${chatId}/messages`).send({ body });
  if (r.status !== 201) throw new Error(`send failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.message as { id: string };
}

/** Smallest valid PNG. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
