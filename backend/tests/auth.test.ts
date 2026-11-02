import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { authenticator } from 'otplib';
import { app, as, login, lastMailTo, makeUser, makeWorkspace, PASSWORD, tokenFromMail, uniq, world } from './helpers.js';
import { prisma } from '../src/lib/db.js';
import { env } from '../src/config/env.js';
import { setCaptchaVerifier } from '../src/lib/captcha.js';
import { sha256 } from '../src/lib/secure.js';

const dev = () => `dev-${uniq()}-abcdefgh`;

describe('invite-only signup, e-mail verification and activation', () => {
  it('rejects registration without a valid invite and never allows open sign-up', async () => {
    const r = await request(app).post('/api/auth/register').send({ token: 'x'.repeat(40), displayName: 'Mallory', password: PASSWORD });
    expect(r.status).toBe(400);
    expect((await request(app).get('/api/auth/invite/nonexistent-token-value')).status).toBe(404);
  });

  it('full flow: admin invites -> register -> cannot login until verified -> verify -> login', async () => {
    const w = await world();
    const email = `new-${uniq()}@example.test`;
    const inv = await as(w.t.admin).post('/api/admin/invites').send({ email });
    expect(inv.status).toBe(201);
    const token = tokenFromMail(email);

    const reg = await request(app).post('/api/auth/register').send({ token, displayName: 'Newbie Person', password: PASSWORD });
    expect(reg.status).toBe(201);

    const early = await request(app).post('/api/auth/login').send({ email, password: PASSWORD, deviceId: dev() });
    expect(early.status).toBe(403); // account not active before e-mail verification

    const vtoken = tokenFromMail(email);
    expect((await request(app).post('/api/auth/verify-email').send({ token: vtoken })).status).toBe(200);
    expect((await request(app).post('/api/auth/verify-email').send({ token: vtoken })).status).toBe(400); // single use

    const ok = await request(app).post('/api/auth/login').send({ email, password: PASSWORD, deviceId: dev() });
    expect(ok.status).toBe(200);
    expect(ok.body.user.status).toBe('ACTIVE');
    expect(ok.body.user.role).toBe('MEMBER');
    expect(JSON.stringify(ok.body)).not.toContain('passwordHash');
  });

  it('invites are single-use, revocable and expire', async () => {
    const w = await world();
    const email = `a-${uniq()}@example.test`;
    await as(w.t.admin).post('/api/admin/invites').send({ email });
    const token = tokenFromMail(email);
    expect((await request(app).post('/api/auth/register').send({ token, displayName: 'First', password: PASSWORD })).status).toBe(201);
    expect((await request(app).post('/api/auth/register').send({ token, displayName: 'Second', password: PASSWORD })).status).toBe(400);

    const e2 = `b-${uniq()}@example.test`;
    const inv = await as(w.t.admin).post('/api/admin/invites').send({ email: e2 });
    const t2 = tokenFromMail(e2);
    expect((await as(w.t.admin).delete(`/api/admin/invites/${inv.body.invite.id}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/register').send({ token: t2, displayName: 'Revoked', password: PASSWORD })).status).toBe(400);

    const e3 = `c-${uniq()}@example.test`;
    const inv3 = await as(w.t.admin).post('/api/admin/invites').send({ email: e3 });
    const t3 = tokenFromMail(e3);
    await prisma.invite.update({ where: { id: inv3.body.invite.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/auth/register').send({ token: t3, displayName: 'Late', password: PASSWORD })).status).toBe(400);
  });

  it('enforces strong passwords', async () => {
    const w = await world();
    const email = `weak-${uniq()}@example.test`;
    await as(w.t.admin).post('/api/admin/invites').send({ email });
    const token = tokenFromMail(email);
    for (const pw of ['short1!A', 'alllowercase123!', 'NoDigitsHere!!!!', 'NoSymbols123456Aa', `${email.split('@')[0]}Aa1!xx`]) {
      const r = await request(app).post('/api/auth/register').send({ token, displayName: 'Weak Pw', password: pw });
      expect(r.status, pw).toBe(400);
    }
  });

  it('stores invite tokens and passwords only as hashes', async () => {
    const w = await world();
    const email = `h-${uniq()}@example.test`;
    await as(w.t.admin).post('/api/admin/invites').send({ email });
    const token = tokenFromMail(email);
    const row = await prisma.invite.findFirst({ where: { email } });
    expect(row?.tokenHash).toBe(sha256(token));
    expect(row?.tokenHash).not.toContain(token);
    const u = await prisma.user.findUnique({ where: { id: w.alice.id } });
    expect(u?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('can require admin approval after e-mail verification', async () => {
    const w = await world();
    await as(w.t.admin).patch('/api/admin/settings').send({ requireApproval: true });
    const email = `appr-${uniq()}@example.test`;
    await as(w.t.admin).post('/api/admin/invites').send({ email });
    await request(app).post('/api/auth/register').send({ token: tokenFromMail(email), displayName: 'Needs Approval', password: PASSWORD });
    const v = await request(app).post('/api/auth/verify-email').send({ token: tokenFromMail(email) });
    expect(v.body.status).toBe('PENDING_APPROVAL');
    expect((await request(app).post('/api/auth/login').send({ email, password: PASSWORD, deviceId: dev() })).status).toBe(403);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect((await as(w.t.admin).post(`/api/admin/users/${u.id}/approve`)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email, password: PASSWORD, deviceId: dev() })).status).toBe(200);
  });
});

describe('login, lockout, CAPTCHA, sessions and devices', () => {
  it('rejects bad credentials with a generic message (no user enumeration)', async () => {
    const w = await world();
    const a = await request(app).post('/api/auth/login').send({ email: w.alice.email, password: 'Wrong-Password-1!', deviceId: dev() });
    const b = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'Wrong-Password-1!', deviceId: dev() });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('locks the account after repeated failures and logs suspicious events', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login').send({ email: u.email, password: 'Nope-Nope-123!', deviceId: dev() })).status).toBe(401);
    }
    const locked = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
    expect(locked.status).toBe(423); // even the correct password is refused while locked
    const logs = await prisma.auditLog.findMany({ where: { actorId: u.id } });
    expect(logs.some((l) => l.action === 'LOGIN_LOCKED')).toBe(true);
    expect(logs.some((l) => l.action === 'LOGIN_FAILED' && l.suspicious)).toBe(true);
    await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() })).status).toBe(200);
  });

  it('CAPTCHA hook is demanded after repeated failures when enabled', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    const old = env.CAPTCHA_PROVIDER;
    (env as { CAPTCHA_PROVIDER: string }).CAPTCHA_PROVIDER = 'turnstile';
    setCaptchaVerifier(async (t) => t === 'good');
    try {
      for (let i = 0; i < env.CAPTCHA_AFTER_FAILURES; i++) await request(app).post('/api/auth/login').send({ email: u.email, password: 'Nope-Nope-123!', deviceId: dev() });
      const need = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
      expect(need.status).toBe(428);
      const bad = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev(), captchaToken: 'bad' });
      expect(bad.status).toBe(428);
      const good = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev(), captchaToken: 'good' });
      expect(good.status).toBe(200);
    } finally {
      setCaptchaVerifier(null);
      (env as { CAPTCHA_PROVIDER: string }).CAPTCHA_PROVIDER = old;
    }
  });

  it('sends a new-device alert and audit entry, and lists devices with remote logout', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    const first = await login(u);
    const before = lastMailTo(u.email);
    const second = await login(u); // different deviceId
    expect(second.res.body.newDevice).toBe(true);
    expect(lastMailTo(u.email)?.subject).toMatch(/New sign-in/);
    expect(lastMailTo(u.email)).not.toBe(before);
    expect((await prisma.auditLog.count({ where: { actorId: u.id, action: 'LOGIN_NEW_DEVICE' } }))).toBe(1);
    const same = await login(u, first.deviceId); // known device: no alert
    expect(same.res.body.newDevice).toBe(false);

    const list = await as(first.token).get('/api/auth/sessions');
    expect(list.body.sessions.length).toBe(3);
    const other = list.body.sessions.find((s: { current: boolean; id: string }) => !s.current)!;
    const target = (await prisma.session.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'asc' } }))[1]!;
    expect((await as(second.token).get('/api/auth/me')).status).toBe(200);
    const rm = await as(first.token).delete(`/api/auth/sessions/${target.id}`);
    expect(rm.status).toBe(200);
    expect((await as(second.token).get('/api/auth/me')).status).toBe(401); // remote logout is immediate
    void other;
  });

  it('cannot revoke another user\'s session', async () => {
    const w = await world();
    const s = await prisma.session.findFirstOrThrow({ where: { userId: w.bob.id } });
    expect((await as(w.t.alice).delete(`/api/auth/sessions/${s.id}`)).status).toBe(404);
  });

  it('rotates refresh tokens, requires CSRF for cookie clients, and detects token reuse', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    const agent = request.agent(app);
    const l = await agent.post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
    const setCookie = (l.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/tt_refresh=.*HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const csrf = l.body.csrfToken as string;

    expect((await agent.post('/api/auth/refresh')).status).toBe(403); // no CSRF header
    const oldCookie = (l.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tt_refresh='))!.split(';')[0]!;
    const r1 = await agent.post('/api/auth/refresh').set('x-csrf-token', csrf);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();

    // replaying the old (rotated) refresh token revokes the whole session
    const replay = await request(app).post('/api/auth/refresh').set('Cookie', [oldCookie, `tt_csrf=${csrf}`]).set('x-csrf-token', csrf);
    expect(replay.status).toBe(401);
    expect((await as(r1.body.accessToken).get('/api/auth/me')).status).toBe(401);
    expect(await prisma.auditLog.count({ where: { actorId: u.id, action: 'REFRESH_TOKEN_REUSE' } })).toBe(1);
  });

  it('rejects forged, expired-session and wrong-purpose tokens', async () => {
    const w = await world();
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await as('garbage.token.value').get('/api/auth/me')).status).toBe(401);
    await prisma.session.updateMany({ where: { userId: w.alice.id }, data: { revokedAt: new Date() } });
    expect((await as(w.t.alice).get('/api/auth/me')).status).toBe(401);
    // an MFA token must not work as an access token
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    await prisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpSecretEnc: 'x' } });
    const step1 = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
    expect(step1.body.mfaRequired).toBe(true);
    expect((await as(step1.body.mfaToken).get('/api/auth/me')).status).toBe(401);
  });
});

describe('password reset', () => {
  it('uses expiring, single-use tokens, does not reveal accounts, and logs out other sessions', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    const s = await login(u);
    const unknown = await request(app).post('/api/auth/forgot').send({ email: 'ghost@example.test' });
    expect(unknown.status).toBe(200);
    await request(app).post('/api/auth/forgot').send({ email: u.email });
    const token = tokenFromMail(u.email);
    const weak = await request(app).post('/api/auth/reset').send({ token, password: 'weak' });
    expect(weak.status).toBe(400);
    const NEW = 'An0ther!Strong#Phrase9';
    expect((await request(app).post('/api/auth/reset').send({ token, password: NEW })).status).toBe(200);
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'Third!Strong#Phrase99' })).status).toBe(400); // single use
    expect((await as(s.token).get('/api/auth/me')).status).toBe(401); // existing sessions revoked
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: NEW, deviceId: dev() })).status).toBe(200);

    await request(app).post('/api/auth/forgot').send({ email: u.email });
    const t2 = tokenFromMail(u.email);
    await prisma.authToken.updateMany({ where: { tokenHash: sha256(t2) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/auth/reset').send({ token: t2, password: 'Fourth!Strong#Phrase99' })).status).toBe(400); // expired
  });

  it('a newer reset request invalidates the previous link', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    await request(app).post('/api/auth/forgot').send({ email: u.email });
    const first = tokenFromMail(u.email);
    await request(app).post('/api/auth/forgot').send({ email: u.email });
    expect((await request(app).post('/api/auth/reset').send({ token: first, password: 'Fifth!Strong#Phrase99' })).status).toBe(400);
  });
});

describe('two-factor authentication (authenticator app)', () => {
  it('enrol, require code at login, accept a recovery code once, and disable', async () => {
    const ws = await makeWorkspace();
    const u = await makeUser(ws);
    const { token } = await login(u);
    const setup = await as(token).post('/api/auth/2fa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png/);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.totpSecretEnc).toBeTruthy();
    expect(stored.totpSecretEnc).not.toContain(setup.body.secret); // encrypted at rest

    expect((await as(token).post('/api/auth/2fa/enable').send({ code: '000000' })).status).toBe(400);
    const en = await as(token).post('/api/auth/2fa/enable').send({ code: authenticator.generate(setup.body.secret) });
    expect(en.status).toBe(200);
    expect(en.body.recoveryCodes).toHaveLength(8);

    const step1 = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
    expect(step1.body.mfaRequired).toBe(true);
    expect(step1.body.accessToken).toBeUndefined();
    expect((await request(app).post('/api/auth/login/2fa').send({ mfaToken: step1.body.mfaToken, code: '123456' })).status).toBe(401);
    const ok = await request(app).post('/api/auth/login/2fa').send({ mfaToken: step1.body.mfaToken, code: authenticator.generate(setup.body.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();

    const rec = en.body.recoveryCodes[0] as string;
    const s2 = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
    expect((await request(app).post('/api/auth/login/2fa').send({ mfaToken: s2.body.mfaToken, code: rec })).status).toBe(200);
    const s3 = await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() });
    expect((await request(app).post('/api/auth/login/2fa').send({ mfaToken: s3.body.mfaToken, code: rec })).status).toBe(401); // single use

    const dis = await as(ok.body.accessToken).post('/api/auth/2fa/disable').send({ password: u.password, code: authenticator.generate(setup.body.secret) });
    expect(dis.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: u.password, deviceId: dev() })).body.mfaRequired).toBeUndefined();
  });
});

describe('passkeys', () => {
  it('requires authentication to register and issues WebAuthn challenges', async () => {
    const w = await world();
    expect((await request(app).post('/api/auth/passkeys/register/options')).status).toBe(401);
    const o = await as(w.t.alice).post('/api/auth/passkeys/register/options');
    expect(o.status).toBe(200);
    expect(o.body.options.challenge).toBeTruthy();
    expect(o.body.options.rp.id).toBe(env.WEBAUTHN_RP_ID);
    // a bad assertion must be rejected, and the challenge is single use
    const bad = await request(app).post('/api/auth/passkeys/login/verify').send({ challengeId: 'nope', response: { id: 'x' }, deviceId: dev() });
    expect(bad.status).toBe(400);
    const lo = await request(app).post('/api/auth/passkeys/login/options');
    const unknown = await request(app).post('/api/auth/passkeys/login/verify').send({ challengeId: lo.body.challengeId, response: { id: 'unknown-credential' }, deviceId: dev() });
    expect(unknown.status).toBe(401);
  });
});
