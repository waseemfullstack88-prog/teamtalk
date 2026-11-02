import { io, Socket } from 'socket.io-client';
import { getAuthToken, getServerUrl } from './api';

let socket: Socket | null = null;
type Listener = (data: any) => void;
const listeners = new Map<string, Set<Listener>>();

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  const token = getAuthToken();
  const serverBase = getServerUrl();
  const socketHost = serverBase || (typeof window !== 'undefined' ? window.location.origin : '');

  socket = io(socketHost, {
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    console.log('[TeamTalk Realtime] Connected with id:', socket?.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('[TeamTalk Realtime] Disconnected:', reason);
  });

  socket.on('connect_error', (err) => {
    console.warn('[TeamTalk Realtime] Connection error:', err.message);
  });

  // Relay all registered events to subscribers
  const registeredEvents = [
    'message:new',
    'message:updated',
    'message:deleted',
    'message:reactions',
    'presence:update',
    'typing',
    'receipt:update',
    'chat:read',
    'chat:updated',
    'chat:deleted',
    'call:incoming',
    'call:accepted',
    'call:declined',
    'call:cancelled',
    'call:missed',
    'call:ended',
    'call:signal',
    'privacy:event',
  ];

  registeredEvents.forEach((event) => {
    socket?.on(event, (data) => {
      const set = listeners.get(event);
      if (set) {
        set.forEach((fn) => {
          try {
            fn(data);
          } catch (e) {
            console.error(`[Realtime listener error for ${event}]:`, e);
          }
        });
      }
    });
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function onSocketEvent(event: string, callback: Listener): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(callback);

  return () => {
    listeners.get(event)?.delete(callback);
  };
}

export function emitSocket(event: string, data: any, ack?: (res: any) => void) {
  if (!socket?.connected) {
    connectSocket();
  }
  socket?.emit(event, data, ack);
}
