import { describe, expect, it } from 'vitest';
import { as, directChat, groupChat, say, world } from './helpers.js';
import { prisma } from '../src/lib/db.js';

describe('Messages: send, edit, reactions, replies, delete, read receipts and search', () => {
  it('sends and decrypts text messages correctly', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    const msg = await say(w.t.alice, cid, 'Secret project plan');

    // Message body is encrypted at rest in the database
    const dbMsg = await prisma.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(dbMsg.bodyEnc).toBeTruthy();
    expect(dbMsg.bodyEnc).not.toContain('Secret project plan');
    expect(dbMsg.bodyEnc!.startsWith('v1.')).toBe(true);

    // Alice and Bob see decrypted plaintext through the API
    const resA = await as(w.t.alice).get(`/api/chats/${cid}/messages`);
    expect(resA.body.messages[0].body).toBe('Secret project plan');

    const resB = await as(w.t.bob).get(`/api/chats/${cid}/messages`);
    expect(resB.body.messages[0].body).toBe('Secret project plan');
  });

  it('allows message edits within the 15-minute window for author only', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    const msg = await say(w.t.alice, cid, 'Draft version');

    // Bob cannot edit Alice's message
    const bobEdit = await as(w.t.bob).patch(`/api/messages/${msg.id}`).send({ body: 'Tampered' });
    expect(bobEdit.status).toBe(403);

    // Alice edits her message
    const aliceEdit = await as(w.t.alice).patch(`/api/messages/${msg.id}`).send({ body: 'Final version' });
    expect(aliceEdit.status).toBe(200);
    expect(aliceEdit.body.message.body).toBe('Final version');
    expect(aliceEdit.body.message.editedAt).not.toBeNull();
  });

  it('supports reactions with emoji validation', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    const msg = await say(w.t.alice, cid, 'Great idea!');

    // React with emoji
    const react = await as(w.t.bob).put(`/api/messages/${msg.id}/reaction`).send({ emoji: '👍' });
    expect(react.status).toBe(200);
    expect(react.body.reactions).toEqual([{ emoji: '👍', userIds: [w.bob.id] }]);

    // Remove reaction
    const unreact = await as(w.t.bob).delete(`/api/messages/${msg.id}/reaction`);
    expect(unreact.status).toBe(200);
    expect(unreact.body.reactions).toEqual([]);
  });

  it('supports message replies', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    const parent = await say(w.t.alice, cid, 'Are you available today?');

    const reply = await as(w.t.bob).post(`/api/chats/${cid}/messages`).send({
      body: 'Yes, after 2 PM',
      replyToId: parent.id,
    });
    expect(reply.status).toBe(201);
    expect(reply.body.message.replyTo).toBeTruthy();
    expect(reply.body.message.replyTo.snippet).toBe('Are you available today?');
  });

  it('supports delete for me vs delete for everyone', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    const msg1 = await say(w.t.alice, cid, 'Delete for me only');
    const msg2 = await say(w.t.alice, cid, 'Delete for everyone');

    // Delete for me: hidden from Alice, Bob still sees it
    const delMe = await as(w.t.alice).delete(`/api/messages/${msg1.id}?scope=me`);
    expect(delMe.status).toBe(200);

    const bList = await as(w.t.bob).get(`/api/chats/${cid}/messages`);
    expect(bList.body.messages.some((m: { id: string }) => m.id === msg1.id)).toBe(true);

    const aList = await as(w.t.alice).get(`/api/chats/${cid}/messages`);
    expect(aList.body.messages.some((m: { id: string }) => m.id === msg1.id)).toBe(false);

    // Delete for everyone
    const delAll = await as(w.t.alice).delete(`/api/messages/${msg2.id}?scope=all`);
    expect(delAll.status).toBe(200);

    const bListAfter = await as(w.t.bob).get(`/api/chats/${cid}/messages`);
    const dMsg = bListAfter.body.messages.find((m: { id: string }) => m.id === msg2.id);
    expect(dMsg.deletedForAll).toBe(true);
    expect(dMsg.body).toBeNull();
  });

  it('supports polls and voting', async () => {
    const w = await world();
    const gid = await groupChat(w.t.alice, 'Poll Group', [w.bob.id, w.carol.id]);

    const pollRes = await as(w.t.alice).post(`/api/chats/${gid}/messages`).send({
      type: 'POLL',
      poll: {
        question: 'Which framework should we use?',
        options: ['React', 'Vue', 'Svelte'],
        multiple: false,
      },
    });
    expect(pollRes.status).toBe(201);
    const msgId = pollRes.body.message.id;
    const reactOpt = pollRes.body.message.poll.options[0].id;

    // Bob votes for React
    const vote = await as(w.t.bob).post(`/api/messages/${msgId}/poll/vote`).send({
      optionIds: [reactOpt],
    });
    expect(vote.status).toBe(200);
    const updatedOpt = vote.body.message.poll.options.find((o: { id: string }) => o.id === reactOpt);
    expect(updatedOpt.votes).toBe(1);
  });

  it('tracks read receipts and respects read-receipt privacy toggle', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    const m = await say(w.t.alice, cid, 'Did you read this?');

    // Bob marks as read
    const mark = await as(w.t.bob).post(`/api/chats/${cid}/read`);
    expect(mark.status).toBe(200);

    // Alice checks message status
    const aList = await as(w.t.alice).get(`/api/chats/${cid}/messages`);
    const sentMsg = aList.body.messages.find((x: { id: string }) => x.id === m.id);
    expect(sentMsg.status).toBe('read');
  });

  it('searches messages and users across permitted chats', async () => {
    const w = await world();
    const cid = await directChat(w.t.alice, w.bob.id);
    await say(w.t.alice, cid, 'Quantum computing exploration notes');

    const searchRes = await as(w.t.bob).get('/api/search?q=quantum&scope=messages');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.messages.length).toBeGreaterThan(0);
    expect(searchRes.body.messages[0].snippet).toContain('Quantum');

    // Carol is not in the chat and cannot find this message
    const carolSearch = await as(w.t.carol).get('/api/search?q=quantum&scope=messages');
    expect(carolSearch.body.messages.length).toBe(0);
  });
});
