import { describe, expect, it } from 'vitest';
import { as, directChat, groupChat, makeUser, makeWorkspace, say, world } from './helpers.js';
import { prisma } from '../src/lib/db.js';

describe('Chat creation, management and access control', () => {
  it('creates direct chats and prevents self-messaging or duplicates', async () => {
    const w = await world();
    // Cannot DM yourself
    const self = await as(w.t.alice).post('/api/chats').send({ type: 'DIRECT', userId: w.alice.id });
    expect(self.status).toBe(400);

    // DM with Bob
    const c1 = await directChat(w.t.alice, w.bob.id);
    expect(c1).toBeTruthy();

    // Re-creating the same DM returns the existing chat
    const c2 = await directChat(w.t.alice, w.bob.id);
    expect(c2).toBe(c1);

    // Bob also sees the same chat
    const bobChats = await as(w.t.bob).get('/api/chats');
    expect(bobChats.body.chats.some((c: { id: string }) => c.id === c1)).toBe(true);

    // Non-member Carol cannot access it (returns 404 to avoid leaking existence)
    const carolGet = await as(w.t.carol).get(`/api/chats/${c1}`);
    expect(carolGet.status).toBe(404);
  });

  it('respects block controls: blocked users cannot start DMs or message each other', async () => {
    const w = await world();
    // Alice blocks Bob
    const blk = await as(w.t.alice).post(`/api/users/${w.bob.id}/block`);
    expect(blk.status).toBe(200);

    // Bob cannot create DM with Alice
    const dm = await as(w.t.bob).post('/api/chats').send({ type: 'DIRECT', userId: w.alice.id });
    expect(dm.status).toBe(403);

    // Alice unblocks Bob
    const unblk = await as(w.t.alice).delete(`/api/users/${w.bob.id}/block`);
    expect(unblk.status).toBe(200);

    // Now DM succeeds
    const ok = await directChat(w.t.alice, w.bob.id);
    expect(ok).toBeTruthy();
  });

  it('creates and manages group chats with permissions', async () => {
    const w = await world();
    const gid = await groupChat(w.t.alice, 'Project Apollo', [w.bob.id]);
    expect(gid).toBeTruthy();

    // Alice is OWNER
    const getChat = await as(w.t.alice).get(`/api/chats/${gid}`);
    expect(getChat.body.chat.myRole).toBe('OWNER');
    expect(getChat.body.chat.members.length).toBe(2);

    // Bob is MEMBER, cannot rename group without admin rights
    const bobRename = await as(w.t.bob).patch(`/api/chats/${gid}`).send({ name: 'Hacked Name' });
    expect(bobRename.status).toBe(403);

    // Alice promotes Bob to ADMIN
    const promote = await as(w.t.alice).patch(`/api/chats/${gid}/members/${w.bob.id}`).send({ role: 'ADMIN' });
    expect(promote.status).toBe(200);

    // Now Bob can rename
    const bobRenameOk = await as(w.t.bob).patch(`/api/chats/${gid}`).send({ name: 'Project Apollo 2' });
    expect(bobRenameOk.status).toBe(200);
    expect(bobRenameOk.body.chat.name).toBe('Project Apollo 2');

    // Add Carol
    const addCarol = await as(w.t.alice).post(`/api/chats/${gid}/members`).send({ userIds: [w.carol.id] });
    expect(addCarol.status).toBe(200);
    expect(addCarol.body.added).toContain(w.carol.id);

    // Member leaves
    const leave = await as(w.t.carol).delete(`/api/chats/${gid}/members/${w.carol.id}`);
    expect(leave.status).toBe(200);
  });

  it('enforces announcement channel restrictions: only admins can post', async () => {
    const w = await world();
    // Member cannot create channel
    const failChan = await as(w.t.alice).post('/api/chats').send({ type: 'CHANNEL', name: 'Announcements', memberIds: [w.bob.id] });
    expect(failChan.status).toBe(403);

    // Admin creates channel with Alice and Bob
    const chRes = await as(w.t.admin).post('/api/chats').send({ type: 'CHANNEL', name: 'Company News', memberIds: [w.alice.id, w.bob.id] });
    expect(chRes.status).toBe(201);
    const chId = chRes.body.chat.id;

    // Alice (regular member) cannot post
    const alicePost = await as(w.t.alice).post(`/api/chats/${chId}/messages`).send({ body: 'Hello everyone' });
    expect(alicePost.status).toBe(403);

    // Admin CAN post
    const adminPost = await as(w.t.admin).post(`/api/chats/${chId}/messages`).send({ body: 'All hands meeting at 3 PM' });
    expect(adminPost.status).toBe(201);
  });

  it('supports pin, mute, and archive preferences per user', async () => {
    const w = await world();
    const gid = await groupChat(w.t.alice, 'Team Standup', [w.bob.id]);

    // Pin chat
    const pin = await as(w.t.alice).put(`/api/chats/${gid}/prefs`).send({ pinned: true });
    expect(pin.status).toBe(200);

    // Mute chat forever
    const mute = await as(w.t.alice).put(`/api/chats/${gid}/prefs`).send({ muteForever: true });
    expect(mute.status).toBe(200);

    // Archive chat
    const arch = await as(w.t.alice).put(`/api/chats/${gid}/prefs`).send({ archived: true });
    expect(arch.status).toBe(200);

    const check = await as(w.t.alice).get(`/api/chats/${gid}`);
    expect(check.body.chat.pinned).toBe(true);
    expect(check.body.chat.muted).toBe(true);
    expect(check.body.chat.archived).toBe(true);
  });

  it('supports disappearing messages configuration', async () => {
    const w = await world();
    const gid = await groupChat(w.t.alice, 'Temporary Chat', [w.bob.id]);

    // Alice sets 3600 seconds (1 hour) disappearing messages
    const setDisp = await as(w.t.alice).patch(`/api/chats/${gid}`).send({ disappearingSeconds: 3600 });
    expect(setDisp.status).toBe(200);
    expect(setDisp.body.chat.disappearingSeconds).toBe(3600);

    // Alice sends a message, verify expiresAt is set
    const m = await say(w.t.alice, gid, 'This message will self-destruct');
    const msgInDb = await prisma.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(msgInDb.expiresAt).not.toBeNull();
  });
});
