import type { Chat, Message, User, StatusGroup, CallHistoryItem, Attachment } from '../types';

let accessToken: string | null = localStorage.getItem('tt_token');
let currentUserId: string | null = localStorage.getItem('tt_user_id');
let refreshToken: string | null = localStorage.getItem('tt_refresh_token');

export function setAuthToken(token: string | null, userId?: string | null, newRefreshToken?: string | null) {
  if (token) {
    accessToken = token;
    localStorage.setItem('tt_token', token);
    if (userId) {
      currentUserId = userId;
      localStorage.setItem('tt_user_id', userId);
    }
    if (newRefreshToken) {
      refreshToken = newRefreshToken;
      localStorage.setItem('tt_refresh_token', newRefreshToken);
    }
  }
}

export function clearAuthToken() {
  // Device-embedded session: account remains bound until app is uninstalled
  console.log('[Auth] Device-embedded session preserved');
}

export function getAuthToken() {
  return accessToken;
}

export function getCurrentUserId() {
  return currentUserId;
}

export function getServerUrl(): string {
  const isNative = typeof (window as any).Capacitor !== 'undefined' && 
    (typeof (window as any).Capacitor.isNativePlatform === 'function' ? (window as any).Capacitor.isNativePlatform() : (window as any).Capacitor.isNative);
  
  const saved = localStorage.getItem('tt_server_url');
  if (saved && saved.startsWith('http')) {
    // If previously saved URL had old disconnected IPs, discard and migrate to current Wi-Fi IP
    if (!saved.includes('192.168.1.24') && !saved.includes('192.168.10.3') && !saved.includes('192.168.10.2')) {
      return saved.replace(/\/+$/, '');
    }
  }

  if (isNative) {
    return 'http://192.168.10.5:4000';
  }

  if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `http://${window.location.hostname}:4000`;
  }

  return 'http://192.168.10.5:4000';
}

export function setServerUrl(url: string) {
  if (url && url.trim()) {
    localStorage.setItem('tt_server_url', url.trim().replace(/\/+$/, ''));
  } else {
    localStorage.removeItem('tt_server_url');
  }
}

export function resolveUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const base = getServerUrl();
  if (!base) return endpoint;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  headers.set('x-tt-client', 'native');
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const fullUrl = resolveUrl(endpoint);
  let response: Response;
  try {
    response = await fetch(fullUrl, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (netErr: any) {
    // Network offline / sleep disconnect: preserve token so idle doesn't force logout
    throw new Error(netErr?.message || 'Network unavailable. Please check server connection.');
  }

  if (response.status === 401) {
    // If unauthorized, attempt token refresh if not already on /refresh
    if (!endpoint.includes('/api/auth/refresh')) {
      const storedRefresh = localStorage.getItem('tt_refresh_token');
      try {
        const refreshRes = await fetch(resolveUrl('/api/auth/refresh'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-tt-client': 'native',
          },
          credentials: 'include',
          body: JSON.stringify({ refreshToken: storedRefresh }),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setAuthToken(data.accessToken, data.user?.id, data.refreshToken);
          headers.set('Authorization', `Bearer ${data.accessToken}`);
          const retry = await fetch(fullUrl, { ...options, headers, credentials: 'include' });
          if (retry.ok) return (await retry.json()) as T;
        } else {
          // Device-embedded session: preserve credentials, never force logout
          console.warn('[Session] Refresh rejected or pending, preserving device-embedded session');
        }
      } catch {
        // Network error during refresh: keep token and do not log out
      }
    }
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMsg = data.error?.message || data.message || `Request failed (${response.status})`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export function getDeviceId(): string {
  let id = localStorage.getItem('tt_device_id');
  if (!id) {
    id = 'dev-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('tt_device_id', id);
  }
  return id;
}

export const api = {
  // Auth
  async checkUsername(username: string) {
    return request<{ available: boolean; message: string }>(
      `/api/auth/check-username?username=${encodeURIComponent(username.trim().toLowerCase())}`
    );
  },

  async sendRegisterOtp(payload: { email: string; deviceId: string }) {
    return request<{ ok: boolean; devOtp?: string; message: string }>('/api/auth/register/send-otp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifyRegisterOtpStep(payload: { email: string; code: string }) {
    return request<{ ok: boolean; verified: boolean; message: string }>('/api/auth/register/verify-otp-step', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async completeRegistration(payload: {
    email: string;
    code: string;
    username: string;
    displayName: string;
    password: string;
    avatarUrl?: string;
    deviceId: string;
    deviceName?: string;
  }) {
    const res = await request<{ accessToken: string; user: User; refreshToken?: string; isCompanion: boolean; csrfToken?: string }>(
      '/api/auth/register/complete',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (res.accessToken) setAuthToken(res.accessToken, res.user?.id, res.refreshToken);
    return res;
  },

  async verifyRegisterOtp(payload: {
    email: string;
    code: string;
    displayName: string;
    username?: string;
    password: string;
    avatarUrl?: string;
    deviceId: string;
    deviceName?: string;
  }) {
    const res = await request<{ accessToken: string; user: User; refreshToken?: string; isCompanion: boolean; csrfToken?: string }>(
      '/api/auth/register/verify-otp',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (res.accessToken) setAuthToken(res.accessToken, res.user?.id, res.refreshToken);
    return res;
  },

  async login(payload: {
    identifier?: string;
    email?: string;
    password: string;
    deviceId: string;
    deviceName?: string;
    captchaToken?: string;
    isCompanion?: boolean;
  }) {
    return request<{
      ok: boolean;
      requireOtp: boolean;
      loginToken: string;
      devOtp?: string;
      email?: string;
      message: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        identifier: payload.identifier || payload.email,
      }),
    });
  },

  async verifyLoginOtp(payload: {
    loginToken: string;
    code: string;
    deviceId: string;
    deviceName?: string;
    isCompanion?: boolean;
  }) {
    const res = await request<{ accessToken: string; user: User; refreshToken?: string; isCompanion: boolean; csrfToken?: string }>(
      '/api/auth/login/verify-otp',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    if (res.accessToken) setAuthToken(res.accessToken, res.user?.id, res.refreshToken);
    return res;
  },

  // WhatsApp Web Companion browser linking
  async generatePairingLink() {
    return request<{ ok: boolean; linkToken: string; qrPayload: string; qrDataUrl?: string | null; expiresIn: number }>(
      '/api/auth/link/generate',
      { method: 'POST' }
    );
  },

  async pollPairing(linkToken: string) {
    const res = await request<{
      approved: boolean;
      accessToken?: string;
      user?: User;
      refreshToken?: string;
      isCompanion?: boolean;
    }>('/api/auth/link/poll', {
      method: 'POST',
      body: JSON.stringify({ linkToken }),
    });
    if (res.approved && res.accessToken) {
      setAuthToken(res.accessToken, res.user?.id);
    }
    return res;
  },

  async approvePairing(linkToken: string, deviceName?: string) {
    return request<{ ok: boolean; message: string }>('/api/auth/link/approve', {
      method: 'POST',
      body: JSON.stringify({ linkToken, deviceName }),
    });
  },

  async getLinkedDevices() {
    return request<{
      devices: Array<{
        id: string;
        deviceId: string;
        deviceName: string;
        ip: string;
        isPrimary: boolean;
        isCompanion: boolean;
        current: boolean;
        lastActiveAt: string;
        createdAt: string;
      }>;
    }>('/api/auth/linked-devices');
  },

  async unlinkDevice(id: string) {
    return request<{ ok: boolean; message?: string }>(`/api/auth/linked-devices/${id}`, {
      method: 'DELETE',
    });
  },

  async login2fa(mfaToken: string, code: string) {
    const res = await request<{ accessToken: string; user: User }>('/api/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    });
    if (res.accessToken) setAuthToken(res.accessToken, res.user?.id);
    return res;
  },

  async register(payload: { token: string; displayName: string; password: string }) {
    return request<{ ok: boolean; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifyEmail(token: string) {
    return request<{ ok: boolean; status: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  async forgotPassword(email: string) {
    return request<{ ok: boolean }>('/api/auth/forgot', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async resetPassword(token: string, password: string) {
    return request<{ ok: boolean }>('/api/auth/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  },

  async getMe() {
    return request<{ user: User }>('/api/auth/me');
  },

  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },

  async getSessions() {
    return request<{ sessions: Array<{ id: string; deviceName: string; ip: string; createdAt: string; lastActiveAt: string; current: boolean }> }>('/api/auth/sessions');
  },

  async revokeSession(id: string) {
    return request<{ ok: boolean }>(`/api/auth/sessions/${id}`, { method: 'DELETE' });
  },

  async setup2fa() {
    return request<{ secret: string; otpauthUrl: string; qrDataUrl: string }>('/api/auth/2fa/setup', { method: 'POST' });
  },

  async enable2fa(code: string) {
    return request<{ ok: boolean; recoveryCodes: string[] }>('/api/auth/2fa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  async disable2fa(password: string, code: string) {
    return request<{ ok: boolean }>('/api/auth/2fa/disable', {
      method: 'POST',
      body: JSON.stringify({ password, code }),
    });
  },

  // Chats
  async getChats() {
    return request<{ chats: Chat[] }>('/api/chats');
  },

  async getChat(id: string) {
    return request<{ chat: Chat }>(`/api/chats/${id}`);
  },

  async createDirectChat(userId: string) {
    return request<{ chat: Chat }>('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ type: 'DIRECT', userId }),
    });
  },

  async createGroupChat(name: string, memberIds: string[], description?: string) {
    return request<{ chat: Chat }>('/api/chats', {
      method: 'POST',
      body: JSON.stringify({ type: 'GROUP', name, memberIds, description }),
    });
  },

  async updateChat(chatId: string, patch: Partial<{ name: string; description: string; disappearingSeconds: number | null; isProtected: boolean }>) {
    return request<{ chat: Chat }>(`/api/chats/${chatId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async updateChatPrefs(chatId: string, prefs: { pinned?: boolean; archived?: boolean; muteForever?: boolean }) {
    return request<{ ok: boolean }>(`/api/chats/${chatId}/prefs`, {
      method: 'PUT',
      body: JSON.stringify(prefs),
    });
  },

  async addChatMembers(chatId: string, userIds: string[]) {
    return request<{ added: string[]; skipped: string[] }>(`/api/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  },

  async removeChatMember(chatId: string, userId: string) {
    return request<{ ok: boolean }>(`/api/chats/${chatId}/members/${userId}`, { method: 'DELETE' });
  },

  async setMemberRole(chatId: string, userId: string, role: 'ADMIN' | 'MEMBER') {
    return request<{ ok: boolean }>(`/api/chats/${chatId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  async deleteChat(chatId: string, scope: 'me' | 'all' = 'me') {
    return request<{ ok: boolean }>(`/api/chats/${chatId}?scope=${scope}`, { method: 'DELETE' });
  },

  // Messages
  async getMessages(chatId: string, before?: string, limit = 50) {
    const q = new URLSearchParams({ limit: String(limit) });
    if (before) q.set('before', before);
    return request<{ messages: Message[]; hasMore: boolean }>(`/api/chats/${chatId}/messages?${q}`);
  },

  async sendMessage(chatId: string, message: {
    type?: string;
    body?: string;
    attachmentIds?: string[];
    replyToId?: string;
    mentions?: string[];
    meta?: Record<string, unknown>;
    poll?: { question: string; options: string[]; multiple?: boolean };
  }) {
    return request<{ message: Message }>(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify(message),
    });
  },

  async editMessage(messageId: string, body: string) {
    return request<{ message: Message }>(`/api/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  },

  async deleteMessage(messageId: string, scope: 'me' | 'all' = 'me') {
    return request<{ ok: boolean }>(`/api/messages/${messageId}?scope=${scope}`, { method: 'DELETE' });
  },

  async setReaction(messageId: string, emoji: string | null) {
    if (emoji) {
      return request<{ reactions: Array<{ emoji: string; userIds: string[] }> }>(`/api/messages/${messageId}/reaction`, {
        method: 'PUT',
        body: JSON.stringify({ emoji }),
      });
    }
    return request<{ reactions: Array<{ emoji: string; userIds: string[] }> }>(`/api/messages/${messageId}/reaction`, {
      method: 'DELETE',
    });
  },

  async markRead(chatId: string) {
    return request<{ ok: boolean; count: number }>(`/api/chats/${chatId}/read`, { method: 'POST' });
  },

  async votePoll(messageId: string, optionIds: string[]) {
    return request<{ message: Message }>(`/api/messages/${messageId}/poll/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionIds }),
    });
  },

  async forwardMessage(messageId: string, chatIds: string[]) {
    return request<{ messages: Message[] }>(`/api/messages/${messageId}/forward`, {
      method: 'POST',
      body: JSON.stringify({ chatIds }),
    });
  },

  // Files
  async uploadFile(file: File | Blob, purpose: 'MESSAGE' | 'AVATAR' | 'STATUS' = 'MESSAGE') {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ file: Attachment }>(`/api/files?purpose=${purpose}`, {
      method: 'POST',
      body: formData,
    });
  },

  async getFileSignedUrl(fileId: string, download = false) {
    return request<{ url: string; expiresIn: number; name: string; mime: string; size: number }>(`/api/files/${fileId}/url?download=${download ? '1' : '0'}`);
  },

  // Status/Updates
  async getStatusUpdates() {
    return request<{ groups: StatusGroup[] }>('/api/status');
  },

  async createStatus(status: { kind: 'TEXT' | 'IMAGE' | 'VIDEO'; body?: string; background?: string; attachmentId?: string }) {
    return request<{ id: string }>('/api/status', {
      method: 'POST',
      body: JSON.stringify(status),
    });
  },

  async viewStatus(statusId: string) {
    return request<{ ok: boolean }>(`/api/status/${statusId}/view`, { method: 'POST' });
  },

  // Users & Search
  async getUsers() {
    return request<{ users: User[] }>('/api/users');
  },

  async search(query: string, scope = 'all') {
    return request<{
      users: User[];
      chats: Array<{ id: string; name: string; type: string }>;
      messages: Array<{ id: string; chatId: string; senderId: string; snippet: string; createdAt: string }>;
      docs: Array<{ id: string; name: string; size: number; chatId: string }>;
      media: Array<{ id: string; name: string; size: number; chatId: string }>;
    }>(`/api/search?q=${encodeURIComponent(query)}&scope=${scope}`);
  },

  async updateProfile(profile: Partial<{ displayName: string; about: string; avatarUrl: string | null; privacy: User['privacy'] }>) {
    return request<{ user: User }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(profile),
    });
  },

  // Privacy events (screen recording detection / blur notifications)
  async reportPrivacyEvent(type: 'screenshot' | 'screen_recording', chatId?: string) {
    return request<{ ok: boolean }>('/api/privacy-events', {
      method: 'POST',
      body: JSON.stringify({ type, chatId }),
    });
  },

  // Calls
  async getIceServers() {
    return request<{ ttl: number; iceServers: RTCIceServer[] }>('/api/calls/ice');
  },

  async getCallHistory() {
    return request<{ calls: CallHistoryItem[] }>('/api/calls/history');
  },

  async endCall(callId?: string) {
    return request<{ ok: boolean; status?: string }>('/api/calls/end', {
      method: 'POST',
      body: JSON.stringify({ callId }),
    });
  },

  // Admin Dashboard
  async getAdminOverview() {
    return request<{
      users: number;
      pending: number;
      invites: number;
      groups: number;
      sessions: number;
      openReports: number;
      suspiciousEvents7d: number;
    }>('/api/admin/overview');
  },

  async getAdminInvites() {
    return request<{ invites: Array<{ id: string; email: string; role: string; createdAt: string; expiresAt: string; createdBy: string; status: string }> }>('/api/admin/invites');
  },

  async createAdminInvite(email: string, role = 'MEMBER') {
    return request<{ invite: { id: string; email: string; role: string; expiresAt: string } }>('/api/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  },

  async revokeAdminInvite(id: string) {
    return request<{ ok: boolean }>(`/api/admin/invites/${id}`, { method: 'DELETE' });
  },

  async getAdminUsers() {
    return request<{ users: Array<User & { activeSessions: number; locked: boolean; createdAt: string }> }>('/api/admin/users');
  },

  async setAdminUserRole(id: string, role: string) {
    return request<{ ok: boolean }>(`/api/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  async forceLogoutUser(id: string) {
    return request<{ ok: boolean; revoked: number }>(`/api/admin/users/${id}/force-logout`, { method: 'POST' });
  },

  async deactivateUser(id: string) {
    return request<{ ok: boolean }>(`/api/admin/users/${id}/deactivate`, { method: 'POST' });
  },

  async reactivateUser(id: string) {
    return request<{ ok: boolean }>(`/api/admin/users/${id}/reactivate`, { method: 'POST' });
  },

  async getAdminSettings() {
    return request<{ settings: Record<string, unknown> }>('/api/admin/settings');
  },

  async updateAdminSettings(settings: Record<string, unknown>) {
    return request<{ settings: Record<string, unknown> }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    });
  },

  async getAdminAuditLogs(limit = 100) {
    return request<{ entries: Array<{ id: string; action: string; actorName?: string; targetType?: string; targetId?: string; ip: string; suspicious: boolean; createdAt: string; metadata: Record<string, unknown> }> }>(`/api/admin/audit?limit=${limit}`);
  },

  auth: {
    async sendRegisterOtp(email: string, deviceId: string) {
      try {
        const res = await request<{ ok: boolean; devOtp?: string; message: string }>('/api/auth/register/send-otp', {
          method: 'POST',
          body: JSON.stringify({ email, deviceId }),
        });
        return { ok: true, devOtp: res.devOtp, message: res.message };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Failed to send verification code' };
      }
    },

    async verifyRegisterOtp(payload: {
      email: string;
      code: string;
      displayName: string;
      password: string;
      deviceId: string;
      deviceName?: string;
    }) {
      try {
        const res = await request<{ accessToken: string; user: User; newDevice: boolean; isCompanion?: boolean }>('/api/auth/register/verify-otp', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.accessToken) setAuthToken(res.accessToken, res.user?.id);
        return { ok: true, data: { user: res.user } };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Registration failed' };
      }
    },

    async login(payload: { email: string; password: string; deviceId: string; deviceName?: string; isCompanion?: boolean }) {
      try {
        const res = await request<{ ok: boolean; requireOtp: boolean; loginToken: string; devOtp?: string; message: string }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return { ok: true, data: res };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Login failed' };
      }
    },

    async verifyLoginOtp(payload: { loginToken: string; code: string; deviceId: string; deviceName?: string; isCompanion?: boolean }) {
      try {
        const res = await request<{ accessToken: string; user: User; newDevice: boolean; isCompanion?: boolean }>('/api/auth/login/verify-otp', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (res.accessToken) setAuthToken(res.accessToken, res.user?.id);
        return { ok: true, data: { user: res.user } };
      } catch (err: any) {
        return { ok: false, error: err.message || 'Invalid verification code' };
      }
    },

    async generatePairingLink() {
      return request<{ ok: boolean; linkToken: string; qrPayload: string; expiresIn: number }>('/api/auth/link/generate', {
        method: 'POST',
      });
    },

    async pollPairing(linkToken: string) {
      const res = await request<{ approved: boolean; accessToken?: string; user?: User; isCompanion?: boolean }>('/api/auth/link/poll', {
        method: 'POST',
        body: JSON.stringify({ linkToken }),
      });
      if (res.approved && res.accessToken) {
        setAuthToken(res.accessToken, res.user?.id);
      }
      return res;
    },

    async approvePairing(linkToken: string, deviceName?: string) {
      return request<{ ok: boolean; message: string }>('/api/auth/link/approve', {
        method: 'POST',
        body: JSON.stringify({ linkToken, deviceName }),
      });
    },

    async getLinkedDevices() {
      return request<{ devices: Array<{ id: string; deviceId: string; deviceName: string; ip: string; isPrimary: boolean; isCompanion: boolean; current: boolean; lastActiveAt: string; createdAt: string }> }>('/api/auth/linked-devices');
    },

    async unlinkDevice(sessionId: string) {
      return request<{ ok: boolean; message: string }>(`/api/auth/linked-devices/${sessionId}`, {
        method: 'DELETE',
      });
    },

    async setupMfa() {
      try {
        const res = await api.setup2fa();
        return { ok: true, data: { secret: res.secret } };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
    async verifyMfa(code: string) {
      try {
        const res = await api.enable2fa(code);
        return { ok: true, data: { recoveryCodes: res.recoveryCodes } };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  },

  chats: {
    async createDirect(peerId: string) {
      try {
        const res = await api.createDirectChat(peerId);
        return { ok: true, data: res.chat };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
    async createGroup(payload: { name: string; description?: string; type: any; isProtected: boolean; memberIds: string[] }) {
      try {
        const res = await api.createGroupChat(
          payload.name,
          payload.memberIds,
          payload.description
        );
        return { ok: true, data: res.chat };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
  },

  users: {
    async search(query = '') {
      try {
        if (query) {
          const res = await api.search(query, 'users');
          return { ok: true, data: res.users };
        }
        const res = await api.getUsers();
        return { ok: true, data: res.users };
      } catch (err: any) {
        return { ok: false, error: err.message };
      }
    },
    async updateProfile(updates: { displayName?: string; about?: string; avatarUrl?: string | null }) {
      return api.updateProfile(updates);
    },
  },
};
