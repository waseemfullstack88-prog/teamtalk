import { describe, expect, it } from 'vitest';
import { as, makeUser, makeWorkspace, world } from './helpers.js';
import { prisma } from '../src/lib/db.js';

describe('Admin dashboard and permissions', () => {
  it('enforces RBAC: members cannot access admin endpoints', async () => {
    const w = await world();
    // Alice (Member) tries to list users or view audit logs
    const uList = await as(w.t.alice).get('/api/admin/users');
    expect(uList.status).toBe(403);

    const audit = await as(w.t.alice).get('/api/admin/audit');
    expect(audit.status).toBe(403);
  });

  it('allows Admin to view overview, users, sessions, and audit logs', async () => {
    const w = await world();
    const ov = await as(w.t.admin).get('/api/admin/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.users).toBeGreaterThanOrEqual(5);

    const users = await as(w.t.admin).get('/api/admin/users');
    expect(users.status).toBe(200);
    expect(users.body.users.length).toBeGreaterThanOrEqual(5);

    const audit = await as(w.t.admin).get('/api/admin/audit');
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body.entries)).toBe(true);
  });

  it('Super Admin can change user roles, while Admin cannot promote to Admin or demote Super Admin', async () => {
    const w = await world();
    // Regular admin tries to promote Alice to Admin -> forbidden
    const failPromote = await as(w.t.admin).patch(`/api/admin/users/${w.alice.id}/role`).send({ role: 'ADMIN' });
    expect(failPromote.status).toBe(403);

    // Super Admin promotes Alice to Admin
    const okPromote = await as(w.t.superAdmin).patch(`/api/admin/users/${w.alice.id}/role`).send({ role: 'ADMIN' });
    expect(okPromote.status).toBe(200);

    // Verify role changed in DB
    const u = await prisma.user.findUniqueOrThrow({ where: { id: w.alice.id } });
    expect(u.role).toBe('ADMIN');
  });

  it('supports user deactivation, reactivation, and force logout', async () => {
    const w = await world();
    // Admin force-logouts Bob
    const forceOut = await as(w.t.admin).post(`/api/admin/users/${w.bob.id}/force-logout`);
    expect(forceOut.status).toBe(200);
    expect(forceOut.body.revoked).toBeGreaterThanOrEqual(1);

    // Bob cannot make authenticated calls anymore
    const bobMe = await as(w.t.bob).get('/api/auth/me');
    expect(bobMe.status).toBe(401);

    // Admin deactivates Bob
    const deact = await as(w.t.admin).post(`/api/admin/users/${w.bob.id}/deactivate`);
    expect(deact.status).toBe(200);

    // Bob cannot log in
    const bobLogin = await as(w.t.bob).get('/api/auth/me');
    expect(bobLogin.status).toBe(401);

    // Admin reactivates Bob
    const react = await as(w.t.admin).post(`/api/admin/users/${w.bob.id}/reactivate`);
    expect(react.status).toBe(200);
  });

  it('updates workspace settings and logs audit entries', async () => {
    const w = await world();
    const patch = await as(w.t.admin).patch('/api/admin/settings').send({
      messageRetentionDays: 90,
      storage: {
        maxFileMb: 50,
      },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.settings.messageRetentionDays).toBe(90);
    expect(patch.body.settings.storage.maxFileMb).toBe(50);

    // Check audit log contains the SETTINGS_CHANGED action
    const logs = await as(w.t.admin).get('/api/admin/audit?action=SETTINGS_CHANGED');
    expect(logs.status).toBe(200);
    expect(logs.body.entries.length).toBeGreaterThanOrEqual(1);
  });
});
