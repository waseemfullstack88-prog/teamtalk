import type { Server } from 'socket.io';

/**
 * Thin façade over Socket.IO so HTTP routes/services can publish real-time events without importing the
 * socket server (keeps routes testable and lets the app run with the socket layer detached).
 */
let io: Server | null = null;
export const attachIo = (server: Server | null) => (io = server);
export const getIo = () => io;

export const userRoom = (id: string) => `user:${id}`;
export const chatRoom = (id: string) => `chat:${id}`;

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(userRoom(userId)).emit(event, payload);
}
export function emitToChat(chatId: string, event: string, payload: unknown) {
  io?.to(chatRoom(chatId)).emit(event, payload);
}
export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io || userIds.length === 0) return;
  io.to(userIds.map(userRoom)).emit(event, payload);
}

/** Keep socket room membership in sync with DB membership changes. */
export async function joinUserToChat(userId: string, chatId: string) {
  await io?.in(userRoom(userId)).socketsJoin(chatRoom(chatId));
}
export async function removeUserFromChatRoom(userId: string, chatId: string) {
  await io?.in(userRoom(userId)).socketsLeave(chatRoom(chatId));
}

/** Immediately drop sockets of a revoked session (remote logout / force logout). */
export async function disconnectSession(sessionId: string) {
  await io?.in(`session:${sessionId}`).disconnectSockets(true);
}
export async function disconnectUser(userId: string) {
  await io?.in(userRoom(userId)).disconnectSockets(true);
}

export async function isOnline(userId: string): Promise<boolean> {
  if (!io) return false;
  return (await io.in(userRoom(userId)).fetchSockets()).length > 0;
}
