import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, directChat, makeUser, makeWorkspace, PNG, say, world } from './helpers.js';

describe('File upload, private storage and signed URLs', () => {
  it('uploads a file and verifies safe signed URL generation', async () => {
    const w = await world();
    const up = await as(w.t.alice)
      .post('/api/files?purpose=MESSAGE')
      .attach('file', PNG, 'report.png');
    expect(up.status).toBe(201);
    expect(up.body.file.name).toBe('report.png');
    expect(up.body.file.mime).toBe('image/png');
    const fileId = up.body.file.id;

    // Alice requests signed URL
    const urlRes = await as(w.t.alice).get(`/api/files/${fileId}/url`);
    expect(urlRes.status).toBe(200);
    expect(urlRes.body.url).toContain('/api/files/raw/');
    expect(urlRes.body.expiresIn).toBe(60);

    // Verify raw signed download works with signature
    const rawRes = await request(app).get(urlRes.body.url);
    expect(rawRes.status).toBe(200);
    expect(rawRes.headers['content-type']).toBe('image/png');
    expect(rawRes.headers['x-content-type-options']).toBe('nosniff');

    // Without valid signature, raw endpoint rejects with 403
    const badSig = await request(app).get(`/api/files/raw/${urlRes.body.url.split('/')[4]?.split('?')[0]}?exp=9999999999&dl=0&sig=invalidsig`);
    expect(badSig.status).toBe(403);
  });

  it('rejects dangerous executable files', async () => {
    const w = await world();
    const exe = Buffer.from('MZ...fake exe');
    const up = await as(w.t.alice)
      .post('/api/files?purpose=MESSAGE')
      .attach('file', exe, 'malware.exe');
    expect(up.status).toBe(400);
  });

  it('enforces chat boundaries: non-members cannot get signed URLs for chat attachments', async () => {
    const w = await world();
    // Alice uploads PNG
    const up = await as(w.t.alice)
      .post('/api/files?purpose=MESSAGE')
      .attach('file', PNG, 'confidential.png');
    const fileId = up.body.file.id;

    // Alice sends in DM with Bob
    const cid = await directChat(w.t.alice, w.bob.id);
    await as(w.t.alice).post(`/api/chats/${cid}/messages`).send({
      type: 'IMAGE',
      attachmentIds: [fileId],
    });

    // Bob can access signed URL
    const bobUrl = await as(w.t.bob).get(`/api/files/${fileId}/url`);
    expect(bobUrl.status).toBe(200);

    // Carol is NOT in the chat: access denied (404 to avoid leaking existence)
    const carolUrl = await as(w.t.carol).get(`/api/files/${fileId}/url`);
    expect(carolUrl.status).toBe(404);
  });
});
