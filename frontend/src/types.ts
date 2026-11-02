export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MEMBER';
export type UserStatus = 'PENDING_VERIFICATION' | 'PENDING_APPROVAL' | 'ACTIVE' | 'DEACTIVATED';
export type Visibility = 'EVERYONE' | 'CHAT_PARTNERS' | 'NOBODY';
export type ChatType = 'DIRECT' | 'GROUP' | 'CHANNEL';
export type ChatMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type MessageType = 'TEXT' | 'STICKER' | 'GIF' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'VOICE' | 'FILE' | 'POLL' | 'SYSTEM';
export type CallKind = 'AUDIO' | 'VIDEO';
export type CallStatus = 'RINGING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'MISSED' | 'ENDED' | 'FAILED';

export interface User {
  id: string;
  email: string;
  username?: string | null;
  displayName: string;
  about?: string;
  avatarFileId?: string | null;
  avatarUrl?: string | null;
  role: Role;
  status: UserStatus;
  online?: boolean;
  lastSeenAt?: string | null;
  mfaEnabled?: boolean;
  passkeyCount?: number;
  privacy?: {
    profilePhoto: Visibility;
    lastSeen: Visibility;
    online: Visibility;
    status: Visibility;
    groups: Visibility;
    readReceipts: boolean;
  };
  autoDownload?: {
    wifi: boolean;
    mobile: boolean;
  };
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED';
  createdAt: string;
  url?: string;
}

export interface PollOption {
  id: string;
  text: string;
  votes: number;
  voted?: boolean;
}

export interface Poll {
  id: string;
  question: string;
  multiple: boolean;
  closed: boolean;
  options: PollOption[];
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  clientId?: string;
  type: MessageType;
  body: string | null;
  meta?: {
    stickerId?: string;
    gifUrl?: string;
    gifTitle?: string;
    duration?: number;
    peaks?: number[];
    mentions?: string[];
  };
  deletedForAll?: boolean;
  forwarded?: boolean;
  editedAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  pinned?: boolean;
  starred?: boolean;
  replyTo?: {
    id: string;
    senderId: string;
    type: MessageType;
    snippet: string;
  } | null;
  attachments?: Attachment[];
  reactions?: Reaction[];
  poll?: Poll | null;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
}

export interface ChatMember {
  id: string;
  displayName: string;
  about?: string;
  avatarFileId?: string | null;
  avatarUrl?: string | null;
  role: ChatMemberRole;
  online?: boolean;
  lastSeenAt?: string | null;
  joinedAt: string;
}

export interface Chat {
  id: string;
  type: ChatType;
  name?: string | null;
  description?: string;
  avatarFileId?: string | null;
  avatarUrl?: string | null;
  isProtected: boolean;
  disappearingSeconds?: number | null;
  membersCanInvite: boolean;
  archivedForAll: boolean;
  createdAt: string;
  updatedAt: string;
  myRole: ChatMemberRole;
  muted: boolean;
  mutedUntil?: string | null;
  pinned: boolean;
  archived: boolean;
  unread: number;
  members: ChatMember[];
  lastMessage?: Message | null;
  requestStatus?: 'PENDING' | 'ACCEPTED' | 'DECLINED';
  requestInitiatorId?: string;
}

export interface StatusItem {
  id: string;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO';
  body: string;
  background?: string;
  mediaUrl?: string;
  createdAt: string;
  expiresAt: string;
  fileId?: string | null;
  viewed: boolean;
  viewCount?: number;
}

export interface ScheduledMessage {
  id: string;
  chatId: string;
  body: string;
  type: MessageType;
  scheduledAt: string;
  createdAt: string;
}

export interface StatusGroup {
  user: {
    id: string;
    displayName: string;
    avatarFileId: string | null;
  };
  updates: StatusItem[];
  mine: boolean;
}

export interface CallHistoryItem {
  id: string;
  kind: CallKind;
  status: CallStatus;
  direction: 'incoming' | 'outgoing';
  peerId?: string | null;
  peerName?: string;
  peer?: {
    id: string;
    displayName: string;
    avatarUrl?: string | null;
    email?: string;
  } | null;
  createdAt: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  durationSec: number;
  missed: boolean;
}

export interface ActiveCallState {
  callId: string;
  kind: CallKind;
  status: CallStatus;
  isIncoming: boolean;
  peer: {
    id: string;
    displayName: string;
    avatarFileId?: string | null;
  };
  durationSec: number;
  micMuted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  screenSharing: boolean;
  quality: 'excellent' | 'good' | 'poor';
}
