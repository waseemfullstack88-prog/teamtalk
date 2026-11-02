import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/db.js';
import { hashPassword, passwordIssues } from '../src/lib/secure.js';
import { encryptAtRest } from '../src/lib/atrest.js';
import { defaultSettings } from '../src/lib/settings.js';

/**
 * Bootstrap script.
 *   Always:  creates the workspace and the first Super Admin (the only account that exists outside of invites).
 *   SEED_DEMO=true: also creates demo members, chats and sample messages for local evaluation. NEVER use in production.
 *
 * Env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (generated and printed once when omitted), SEED_WORKSPACE_NAME, SEED_DEMO
 */
const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@teamtalk.local').toLowerCase();
let password = process.env.SEED_ADMIN_PASSWORD;
let generated = false;
if (!password) {
  password = `${randomBytes(9).toString('base64url')}aA1!`;
  generated = true;
}
const issues = passwordIssues(password, { email });
if (issues.length) {
  console.error('SEED_ADMIN_PASSWORD is too weak:', issues.join(' '));
  process.exit(1);
}

const wsName = process.env.SEED_WORKSPACE_NAME ?? 'TeamTalk Workspace';
let ws = await prisma.workspace.findFirst();
ws ??= await prisma.workspace.create({ data: { name: wsName, settings: defaultSettings() } });

let admin = await prisma.user.findUnique({ where: { email } });
if (!admin) {
  admin = await prisma.user.create({
    data: { workspaceId: ws.id, email, displayName: 'Super Admin', passwordHash: await hashPassword(password), role: 'SUPER_ADMIN', status: 'ACTIVE', emailVerifiedAt: new Date() },
  });
  console.log(`Created Super Admin ${email}`);
  if (generated) console.log(`Generated password (shown once): ${password}`);
} else console.log(`Super Admin ${email} already exists`);

let general = await prisma.chat.findFirst({ where: { workspaceId: ws.id, isDefault: true } });
general ??= await prisma.chat.create({
  data: { workspaceId: ws.id, type: 'GROUP', name: 'General', description: 'Company-wide chat', isDefault: true, createdById: admin.id, members: { create: [{ userId: admin.id, role: 'OWNER' }] } },
});
let ann = await prisma.chat.findFirst({ where: { workspaceId: ws.id, type: 'CHANNEL', name: 'Announcements' } });
ann ??= await prisma.chat.create({
  data: { workspaceId: ws.id, type: 'CHANNEL', name: 'Announcements', description: 'Only admins can post here', isDefault: true, createdById: admin.id, members: { create: [{ userId: admin.id, role: 'OWNER' }] } },
});

if (process.env.SEED_DEMO === 'true') {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const demoPw = await hashPassword('Demo-Passw0rd!2026');
  const people = [['Amina Khan', 'amina@teamtalk.local'], ['Bilal Ahmed', 'bilal@teamtalk.local'], ['Sara Malik', 'sara@teamtalk.local']] as const;
  const users = [];
  for (const [name, mail] of people) {
    users.push(await prisma.user.upsert({ where: { email: mail }, update: {}, create: { workspaceId: ws.id, email: mail, displayName: name, passwordHash: demoPw, status: 'ACTIVE', emailVerifiedAt: new Date() } }));
  }
  for (const c of [general, ann]) {
    for (const u of users) await prisma.chatMember.upsert({ where: { chatId_userId: { chatId: c.id, userId: u.id } }, update: {}, create: { chatId: c.id, userId: u.id } });
  }
  const key = [admin.id, users[0]!.id].sort().join(':');
  const dm = await prisma.chat.upsert({
    where: { directKey: key }, update: {},
    create: { workspaceId: ws.id, type: 'DIRECT', directKey: key, members: { create: [{ userId: admin.id }, { userId: users[0]!.id }] } },
  });
  if ((await prisma.message.count({ where: { chatId: dm.id } })) === 0) {
    const lines = [[users[0]!.id, 'Morning! Did you see the Q3 plan draft?'], [admin.id, 'Yes — looks solid. Can you add the timeline slide?'], [users[0]!.id, 'On it. I will share it before lunch.']] as const;
    for (const [sender, text] of lines) await prisma.message.create({ data: { chatId: dm.id, senderId: sender, bodyEnc: encryptAtRest(text, dm.id) } });
  }
  console.log('Demo members created (password: Demo-Passw0rd!2026): ' + people.map((p) => p[1]).join(', '));
}
await prisma.$disconnect();
