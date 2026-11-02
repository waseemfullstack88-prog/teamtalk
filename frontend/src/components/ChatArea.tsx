import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Phone,
  Video,
  Info,
  ArrowLeft,
  Shield,
  Paperclip,
  Smile,
  Send,
  MoreVertical,
  Check,
  CheckCheck,
  CornerDownRight,
  Pin,
  Trash2,
  Edit2,
  FileText,
  Download,
  BarChart2,
  X,
  Play,
  Pause,
  AlertCircle,
  Mic,
  Copy,
  Plus,
  Clock,
  Calendar,
  Maximize2,
  Film,
  CheckCircle2,
} from 'lucide-react';
import { Chat, Message, User, MessageType, Attachment, ScheduledMessage } from '../types';
import { ProtectedWatermark } from './ProtectedWatermark';
import { VoiceRecorder } from './VoiceRecorder';
import { EmojiPicker } from './EmojiPicker';
import { api, getServerUrl } from '../services/api';

interface ChatAreaProps {
  currentUser: User;
  chat: Chat | null;
  messages: Message[];
  typingUsers: string[];
  onSendMessage: (payload: {
    body?: string;
    type?: MessageType;
    replyToId?: string;
    attachments?: Attachment[];
    poll?: { question: string; options: string[]; multiple?: boolean };
  }) => void;
  onStartCall: (kind: 'AUDIO' | 'VIDEO') => void;
  onToggleDetails: () => void;
  onBackMobile: () => void;
  onVotePoll?: (pollId: string, optionId: string) => void;
  onAddReaction?: (messageId: string, emoji: string) => void;
  onDeleteMessage?: (messageId: string, forAll: boolean) => void;
  onPinMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newBody: string) => void;
  onTyping?: (isTyping: boolean) => void;
  scheduledMessages?: ScheduledMessage[];
  onScheduleMessage?: (payload: { body: string; scheduledAt: string; type?: MessageType }) => void;
  onCancelScheduledMessage?: (id: string) => void;
  onSendScheduledNow?: (id: string) => void;
  onAcceptChatRequest?: (chatId: string) => void;
  onDeclineChatRequest?: (chatId: string) => void;
  onBlockUser?: (userId: string) => void;
}

const COMMON_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '🙏'];

export const ChatArea: React.FC<ChatAreaProps> = ({
  currentUser,
  chat,
  messages,
  typingUsers,
  onSendMessage,
  onStartCall,
  onToggleDetails,
  onBackMobile,
  onVotePoll,
  onAddReaction,
  onDeleteMessage,
  onPinMessage,
  onEditMessage,
  onTyping,
  scheduledMessages,
  onScheduleMessage,
  onCancelScheduledMessage,
  onSendScheduledNow,
  onAcceptChatRequest,
  onDeclineChatRequest,
  onBlockUser,
}) => {
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [reactingToMessageId, setReactingToMessageId] = useState<string | null>(null);
  const [deleteTargetMessage, setDeleteTargetMessage] = useState<Message | null>(null);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [fullscreenVideo, setFullscreenVideo] = useState<{ url: string; name: string; size?: number; duration?: number } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Scheduled message modal states
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showScheduledListModal, setShowScheduledListModal] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [scheduleText, setScheduleText] = useState('');

  // Bulletproof client deduplication so messages never render twice
  const displayMessages = useMemo<Message[]>(() => {
    const seen = new Set<string>();
    const list: Message[] = [];
    for (const m of messages) {
      if (!m) continue;
      const kId = m.id;
      const kClient = m.clientId;
      if (kId && seen.has(kId)) continue;
      if (kClient && seen.has(kClient)) continue;
      if (kId) seen.add(kId);
      if (kClient) seen.add(kClient);
      list.push(m);
    }
    return list;
  }, [messages]);

  const handleDownloadMedia = async (rawUrl: string, filename: string, id?: string) => {
    try {
      if (id) setDownloadingId(id);
      setDownloadNotice(`Downloading ${filename || 'video'}...`);

      const fullUrl = rawUrl.startsWith('http') || rawUrl.startsWith('blob:')
        ? (rawUrl.includes('?') ? `${rawUrl}&download=1` : `${rawUrl}?download=1`)
        : `${getServerUrl()}${rawUrl}${rawUrl.includes('?') ? '&' : '?'}download=1`;

      const res = await fetch(fullUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename || `video_${Date.now()}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 10000);

      setDownloadNotice(`✓ Saved ${filename || 'video'} to downloads`);
      setTimeout(() => setDownloadNotice(null), 3000);
    } catch (err) {
      console.error('[Download error]', err);
      const directUrl = rawUrl.startsWith('http')
        ? (rawUrl.includes('?') ? `${rawUrl}&download=1` : `${rawUrl}?download=1`)
        : `${getServerUrl()}${rawUrl}${rawUrl.includes('?') ? '&' : '?'}download=1`;
      window.open(directUrl, '_blank');
      setDownloadNotice(`Downloading via browser...`);
      setTimeout(() => setDownloadNotice(null), 3000);
    } finally {
      setDownloadingId(null);
    }
  };

  const toLocalIso = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleOpenSchedule = () => {
    setScheduleText(inputText);
    const defaultDate = new Date(Date.now() + 30 * 60000);
    setScheduleDateTime(toLocalIso(defaultDate));
    setShowScheduleModal(true);
  };

  const handleConfirmSchedule = () => {
    if (!scheduleText.trim() || !scheduleDateTime) return;
    if (onScheduleMessage) {
      onScheduleMessage({
        body: scheduleText.trim(),
        scheduledAt: new Date(scheduleDateTime).toISOString(),
        type: 'TEXT',
      });
    }
    setInputText('');
    setScheduleText('');
    setShowScheduleModal(false);
  };

  // WhatsApp Date Divider helper
  const formatDateDivider = (dateIso: string): string => {
    const date = new Date(dateIso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return 'Today';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  };

  // Poll Creator State
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollMultiple, setPollMultiple] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages, typingUsers]);

  if (!chat) {
    return (
      <div className="chat-area-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', padding: 24, textAlign: 'center' }}>
        <div style={{ maxWidth: 360 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'var(--primary-100)',
              color: 'var(--primary-600)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <Shield size={36} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>
            TeamTalk Secure Workspace
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Select a team conversation from the sidebar or start a new group to begin messaging with enterprise-grade security.
          </p>
        </div>
      </div>
    );
  }

  const getChatDisplayName = (): string => {
    if (chat.name) return chat.name;
    if (chat.type === 'DIRECT') {
      const peer = chat.members.find((m) => m.id !== currentUser.id) || chat.members[0];
      return peer ? peer.displayName : 'Direct Message';
    }
    return 'Team Group';
  };

  const getPeerUser = () => {
    if (chat.type !== 'DIRECT') return null;
    return chat.members.find((m) => m.id !== currentUser.id);
  };

  const peer = getPeerUser();
  const isDirectChat = chat.type === 'DIRECT';
  // If the peer has sent any message in this chat, the conversation is active/accepted!
  const hasPeerReplied = displayMessages.some((m: Message) => m.senderId && m.senderId !== currentUser.id && m.senderId !== 'system');
  const isRequestPending = chat.requestStatus === 'PENDING' && !hasPeerReplied;
  const isSender = isRequestPending && (chat.requestInitiatorId === currentUser.id);
  const isRecipient = isRequestPending && !isSender;

  const mySentCount = isRequestPending && isSender ? displayMessages.filter((m: Message) => m.senderId === currentUser.id).length : 0;
  const isLimitReached = isRequestPending && isSender && mySentCount >= 3;
  const chatScheduledMessages = (scheduledMessages || []).filter((s) => s.chatId === chat.id);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        onTyping(false);
      }, 2000);
    }
  };

  const handleSend = () => {
    setShowEmojiPicker(false);
    if (editingMessage && onEditMessage) {
      if (inputText.trim()) {
        onEditMessage(editingMessage.id, inputText.trim());
      }
      setEditingMessage(null);
      setInputText('');
      return;
    }

    if (!inputText.trim()) return;

    onSendMessage({
      body: inputText.trim(),
      type: 'TEXT',
      replyToId: replyingTo?.id,
    });

    setInputText('');
    setReplyingTo(null);
    if (onTyping) onTyping(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setShowEmojiPicker(false);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    for (const file of Array.from(files)) {
      const isImg = file.type.startsWith('image/');
      const isVid = file.type.startsWith('video/');
      const isAud = file.type.startsWith('audio/');

      let durationSec: number | undefined;
      if (isVid) {
        try {
          durationSec = await new Promise<number>((resolve) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.onloadedmetadata = () => {
              window.URL.revokeObjectURL(v.src);
              resolve(Math.round(v.duration || 0));
            };
            v.onerror = () => resolve(0);
            v.src = URL.createObjectURL(file);
          });
        } catch {}
      }

      try {
        const uploadRes = await api.uploadFile(file, 'MESSAGE');
        if (uploadRes && uploadRes.file) {
          const serverAtt: Attachment = {
            ...uploadRes.file,
            url: uploadRes.file.url || `/api/files/${uploadRes.file.id}/view`,
          };
          onSendMessage({
            body: file.name,
            type: isImg ? 'IMAGE' : isVid ? 'VIDEO' : isAud ? 'AUDIO' : 'FILE',
            replyToId: replyingTo?.id,
            attachments: [serverAtt],
            ...(durationSec ? { meta: { duration: durationSec } } : {}),
          });
        }
      } catch (err: any) {
        console.error('[Upload File Error]', err);
        alert(err?.message || 'Could not upload file. Please check server connection.');
      }
    }
    setIsUploading(false);

    if (fileInputRef.current) fileInputRef.current.value = '';
    setReplyingTo(null);
  };

  const handleSendPoll = () => {
    setShowEmojiPicker(false);
    if (!pollQuestion.trim()) return;
    const validOptions = pollOptions.filter((o) => o.trim().length > 0);
    if (validOptions.length < 2) return;

    onSendMessage({
      type: 'POLL',
      replyToId: replyingTo?.id,
      poll: {
        question: pollQuestion.trim(),
        options: validOptions,
        multiple: pollMultiple,
      },
    });

    setShowPollModal(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollMultiple(false);
  };

  const handleVoiceSend = async (blob: Blob, durationSec: number) => {
    const voiceFile = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
    try {
      const uploadRes = await api.uploadFile(voiceFile, 'MESSAGE');
      if (uploadRes && uploadRes.file) {
        const serverAtt: Attachment = {
          ...uploadRes.file,
          url: uploadRes.file.url || `/api/files/${uploadRes.file.id}/view`,
        };
        onSendMessage({
          body: `Voice note (${Math.round(durationSec)}s)`,
          type: 'VOICE',
          attachments: [serverAtt],
        });
      }
    } catch (err: any) {
      console.error('[Upload Voice Error]', err);
      alert(err?.message || 'Could not send voice note. Please check server connection.');
    }
    setIsVoiceRecording(false);
  };

  const pinnedMessages = displayMessages.filter((m) => m.pinned);

  return (
    <div className="chat-area-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* Protected chat watermark overlay */}
      {chat.isProtected && (
        <ProtectedWatermark userEmail={currentUser.email} userDisplayName={currentUser.displayName} />
      )}

      {/* Header Bar */}
      <div className="panel-header">
        <div
          onClick={onToggleDetails}
          style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flex: 1, minWidth: 0 }}
          title="Tap to view contact info & settings"
        >
          <button
            className="btn-icon mobile-back-btn"
            onClick={(e) => {
              e.stopPropagation();
              onBackMobile();
            }}
            title="Back"
          >
            <ArrowLeft size={19} />
          </button>

          <div
            className="avatar"
            style={{
              width: 40,
              height: 40,
              fontSize: 14,
              flexShrink: 0,
              position: 'relative',
              overflow: 'hidden',
              background:
                chat.type === 'CHANNEL'
                  ? 'linear-gradient(135deg, var(--accent-rose), var(--accent-amber))'
                  : chat.type === 'GROUP'
                  ? 'linear-gradient(135deg, var(--accent-purple), var(--primary-500))'
                  : 'linear-gradient(135deg, var(--primary-600), var(--accent-cyan))',
            }}
          >
            {(() => {
              const rawAvatar = peer?.avatarUrl || (peer?.avatarFileId ? `/api/files/${peer.avatarFileId}/view` : '') || (chat as any).avatarUrl;
              const avatarSrc = rawAvatar ? (rawAvatar.startsWith('http') || rawAvatar.startsWith('data:') || rawAvatar.startsWith('blob:') ? rawAvatar : `${getServerUrl()}${rawAvatar}`) : null;
              return avatarSrc ? (
                <img
                  src={avatarSrc}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                />
              ) : (
                getChatDisplayName().slice(0, 2).toUpperCase()
              );
            })()}
            {chat.type === 'DIRECT' && peer?.online && (
              <span
                className="status-dot online"
                style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9 }}
              />
            )}
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                {getChatDisplayName()}
              </span>
              {chat.isProtected && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-full)',
                    background: 'rgba(99, 102, 241, 0.15)',
                    color: 'var(--primary-600)',
                    fontWeight: 700,
                  }}
                  title="Protected Chat: Watermarked, restricted copy/export"
                >
                  <Shield size={11} />
                  PROTECTED
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {typingUsers.length > 0 ? (
                <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                  {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                </span>
              ) : chat.type === 'DIRECT' ? (
                peer?.online ? (
                  'Active now'
                ) : peer?.lastSeenAt ? (
                  `Last seen ${new Date(peer.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                ) : (
                  'Offline'
                )
              ) : (
                `${chat.members.length} team members`
              )}
            </div>
          </div>
        </div>

        {/* Action icons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn-icon" onClick={() => onStartCall('AUDIO')} title="Start Voice Call">
            <Phone size={19} />
          </button>
          <button className="btn-icon" onClick={() => onStartCall('VIDEO')} title="Start Video Call">
            <Video size={19} />
          </button>
          <button className="btn-icon" onClick={onToggleDetails} title="Chat Details & Media">
            <Info size={19} />
          </button>
        </div>
      </div>

      {/* WhatsApp / Instagram Style Chat Request Banner for Recipient */}
      {isRecipient && (
        <div
          style={{
            padding: '12px 18px',
            background: 'rgba(0, 168, 132, 0.1)',
            borderBottom: '1px solid rgba(0, 168, 132, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            zIndex: 15,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 240, flex: 1 }}>
            <AlertCircle size={20} color="#00a884" style={{ flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
              <span style={{ fontWeight: 700, color: '#00a884' }}>{peer?.displayName || 'User'}</span> sent you a chat request. Initial limit: 3 messages until accepted.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {onBlockUser && peer && (
              <button
                className="btn"
                onClick={() => onBlockUser(peer.id)}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontSize: 12,
                  padding: '5px 12px',
                }}
              >
                Block
              </button>
            )}
            {onDeclineChatRequest && (
              <button
                className="btn btn-secondary"
                onClick={() => onDeclineChatRequest(chat.id)}
                style={{ fontSize: 12, padding: '5px 12px' }}
              >
                Decline
              </button>
            )}
            {onAcceptChatRequest && (
              <button
                className="btn btn-primary"
                onClick={() => onAcceptChatRequest(chat.id)}
                style={{ fontSize: 12, padding: '5px 16px', background: '#00a884', borderColor: '#00a884' }}
              >
                Accept
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pinned Messages Banner */}
      {pinnedMessages.length > 0 && (
        <div
          style={{
            padding: '6px 16px',
            background: 'var(--bg-surface-elevated)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Pin size={14} color="var(--primary-500)" />
            <span style={{ fontWeight: 600, color: 'var(--primary-600)' }}>Pinned:</span>
            <span
              style={{
                color: 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {pinnedMessages[0].body || 'Attachment'}
            </span>
          </div>
          {onPinMessage && (
            <button
              onClick={() => onPinMessage(pinnedMessages[0].id)}
              style={{ color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}
            >
              Unpin
            </button>
          )}
        </div>
      )}

      {/* Message Feed */}
      <div
        onClick={() => setShowEmojiPicker(false)}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          position: 'relative',
        }}
      >
        {displayMessages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', maxWidth: 280 }}>
            <Shield size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>This conversation is private</p>
            <p style={{ fontSize: 12 }}>
              Messages are encrypted at rest with AES-256-GCM. Send a message to start communicating.
            </p>
          </div>
        ) : (
          displayMessages.map((msg, index) => {
            const isSelf = msg.senderId === currentUser.id;
            const isHovered = hoveredMessageId === msg.id || selectedMessageId === msg.id;
            const sender = chat.members.find((m) => m.id === msg.senderId);
            const prevMsg = index > 0 ? displayMessages[index - 1] : null;
            const showDateDivider = !prevMsg || new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

            return (
              <React.Fragment key={msg.id || index}>
                {/* Centered WhatsApp Date Divider Pill */}
                {showDateDivider && (
                  <div className="wa-date-divider">
                    <span className="wa-date-chip">{formatDateDivider(msg.createdAt)}</span>
                  </div>
                )}

                <div
                  onMouseEnter={() => setHoveredMessageId(msg.id)}
                  onMouseLeave={() => setHoveredMessageId(null)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isSelf ? 'flex-end' : 'flex-start',
                    position: 'relative',
                    marginBottom: 3,
                  }}
                >
                  {/* Floating Action Menu for Message (On hover or mobile tap) */}
                  {isHovered && !msg.deletedForAll && (
                    <div
                      style={{
                        position: 'absolute',
                        top: -16,
                        [isSelf ? 'right' : 'left']: 8,
                        background: 'var(--bg-surface-elevated)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-full)',
                        padding: '2px 6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        boxShadow: 'var(--shadow-md)',
                        zIndex: 25,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            if (onAddReaction) onAddReaction(msg.id, emoji);
                            setSelectedMessageId(null);
                          }}
                          style={{
                            fontSize: 18,
                            padding: '3px 5px',
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            borderRadius: '50%',
                            transition: 'transform 0.12s ease',
                          }}
                          className="reaction-emoji-btn"
                          title={`React with ${emoji}`}
                        >
                          {emoji}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          setReactingToMessageId(msg.id);
                          setSelectedMessageId(null);
                        }}
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: '#8696a0',
                          border: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                        title="More emojis"
                      >
                        <Plus size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setReplyingTo(msg);
                          setSelectedMessageId(null);
                        }}
                        className="btn-icon"
                        style={{ width: 24, height: 24 }}
                        title="Reply"
                      >
                        <CornerDownRight size={13} />
                      </button>
                      {msg.body && (
                        <button
                          onClick={() => {
                            navigator.clipboard?.writeText(msg.body || '');
                            setSelectedMessageId(null);
                          }}
                          className="btn-icon"
                          style={{ width: 24, height: 24 }}
                          title="Copy Text"
                        >
                          <Copy size={13} />
                        </button>
                      )}
                      {onPinMessage && (
                        <button
                          onClick={() => {
                            onPinMessage(msg.id);
                            setSelectedMessageId(null);
                          }}
                          className="btn-icon"
                          style={{ width: 24, height: 24 }}
                          title="Pin Message"
                        >
                          <Pin size={13} />
                        </button>
                      )}
                      {isSelf && onEditMessage && msg.type === 'TEXT' && (
                        <button
                          onClick={() => {
                            setEditingMessage(msg);
                            setInputText(msg.body || '');
                            setSelectedMessageId(null);
                          }}
                          className="btn-icon"
                          style={{ width: 24, height: 24 }}
                          title="Edit Message"
                        >
                          <Edit2 size={13} />
                        </button>
                      )}
                      {onDeleteMessage && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTargetMessage(msg);
                            setSelectedMessageId(null);
                          }}
                          className="btn-icon"
                          style={{ width: 24, height: 24, color: 'var(--accent-rose)' }}
                          title="Delete Message"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Message Bubble Container */}
                  <div
                    onClick={() => setSelectedMessageId(selectedMessageId === msg.id ? null : msg.id)}
                    className={`wa-bubble ${isSelf ? 'wa-bubble-self' : 'wa-bubble-peer'}`}
                    style={{
                      cursor: 'pointer',
                      opacity: msg.deletedForAll ? 0.75 : 1,
                    }}
                  >
                    {/* Sender Name in Group/Channel */}
                    {!isSelf && chat.type !== 'DIRECT' && (
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary-500)', marginBottom: 2 }}>
                        {sender?.displayName || 'Team Member'}
                      </div>
                    )}

                  {/* Reply Quote Banner */}
                  {msg.replyTo && (
                    <div
                      style={{
                        padding: '4px 8px',
                        background: isSelf ? 'rgba(255,255,255,0.15)' : 'var(--bg-surface-hover)',
                        borderLeft: `3px solid ${isSelf ? '#ffffff' : 'var(--primary-500)'}`,
                        borderRadius: 4,
                        marginBottom: 6,
                        fontSize: 11,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>Reply to message</div>
                      <div style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {msg.replyTo.snippet}
                      </div>
                    </div>
                  )}

                  {/* Message Body Content */}
                  {msg.deletedForAll ? (
                    <span style={{ fontStyle: 'italic', opacity: 0.7, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <AlertCircle size={14} /> This message was deleted
                    </span>
                  ) : msg.type === 'POLL' && msg.poll ? (
                    /* Poll Component */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220, padding: '4px 0' }}>
                      <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BarChart2 size={16} />
                        {msg.poll.question}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {msg.poll.options.map((opt) => {
                          const totalVotes = msg.poll?.options.reduce((s, o) => s + o.votes, 0) || 1;
                          const pct = Math.round((opt.votes / totalVotes) * 100);
                          return (
                            <div
                              key={opt.id}
                              onClick={() => onVotePoll && onVotePoll(msg.poll!.id, opt.id)}
                              style={{
                                padding: '6px 10px',
                                borderRadius: 'var(--radius-sm)',
                                background: isSelf ? 'rgba(255,255,255,0.15)' : 'var(--bg-surface-hover)',
                                border: opt.voted ? `1.5px solid ${isSelf ? '#fff' : 'var(--primary-500)'}` : '1px solid transparent',
                                cursor: 'pointer',
                                position: 'relative',
                                overflow: 'hidden',
                              }}
                            >
                              {/* Percentage bar */}
                              <div
                                style={{
                                  position: 'absolute',
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: `${pct}%`,
                                  background: isSelf ? 'rgba(255,255,255,0.2)' : 'rgba(99,102,241,0.15)',
                                  pointerEvents: 'none',
                                }}
                              />
                              <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative', zIndex: 2, fontSize: 13 }}>
                                <span style={{ fontWeight: opt.voted ? 700 : 500 }}>{opt.text}</span>
                                <span style={{ fontSize: 11, fontWeight: 700, opacity: 0.9 }}>{opt.votes} ({pct}%)</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : msg.type === 'VOICE' ? (
                    /* Voice Note Player */
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 200, padding: '4px 0' }}>
                      <button
                        onClick={() => {
                          const att = msg.attachments?.[0];
                          const rawUrl = att?.url;
                          if (!rawUrl) return;
                          const playUrl = rawUrl.startsWith('http') || rawUrl.startsWith('blob:') ? rawUrl : `${getServerUrl()}${rawUrl}`;
                          if (activeAudioId === msg.id && currentAudioRef.current) {
                            currentAudioRef.current.pause();
                            setActiveAudioId(null);
                            return;
                          }
                          if (currentAudioRef.current) {
                            currentAudioRef.current.pause();
                          }
                          const audio = new Audio(playUrl);
                          currentAudioRef.current = audio;
                          setActiveAudioId(msg.id);
                          audio.play().catch(() => setActiveAudioId(null));
                          audio.onended = () => setActiveAudioId(null);
                        }}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          background: isSelf ? '#ffffff' : 'var(--primary-500)',
                          color: isSelf ? 'var(--primary-600)' : '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        {activeAudioId === msg.id ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
                      </button>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 24 }}>
                          {[6, 12, 18, 22, 14, 8, 16, 24, 18, 10, 15, 20, 12, 8].map((h, i) => (
                            <div
                              key={i}
                              style={{
                                width: 3,
                                height: h,
                                borderRadius: 2,
                                background: isSelf ? 'rgba(255,255,255,0.7)' : 'var(--primary-400)',
                              }}
                            />
                          ))}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{msg.body || 'Voice note'}</div>
                      </div>
                    </div>
                  ) : (msg.type === 'VIDEO' || (msg.attachments && msg.attachments[0]?.mime?.startsWith('video/'))) && msg.attachments && msg.attachments.length > 0 ? (
                    (() => {
                      const videoAtt = msg.attachments[0];
                      const rawUrl = videoAtt.url || `/api/files/${videoAtt.id}/view`;
                      const fullUrl = rawUrl.startsWith('http') || rawUrl.startsWith('blob:') ? rawUrl : `${getServerUrl()}${rawUrl}`;
                      const videoName = videoAtt.name || 'Video attachment';
                      const videoSizeMb = videoAtt.size > 0 ? (videoAtt.size / (1024 * 1024)).toFixed(1) : null;
                      const videoDuration = (msg.meta as any)?.duration;

                      return (
                        /* WhatsApp-Style Video Message Bubble */
                        <div style={{ marginBottom: 4, width: '100%', maxWidth: 320, borderRadius: 12, overflow: 'hidden' }}>
                          <div
                            style={{
                              position: 'relative',
                              width: '100%',
                              minHeight: 180,
                              maxHeight: 280,
                              background: '#000000',
                              borderRadius: 12,
                              overflow: 'hidden',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {playingVideoId === msg.id ? (
                              /* Active Inline Video Player with range-stream support */
                              <video
                                src={fullUrl}
                                controls
                                autoPlay
                                playsInline
                                style={{ width: '100%', maxHeight: 280, objectFit: 'contain', background: '#000000' }}
                              />
                            ) : (
                              /* WhatsApp-Style Video Preview with Play Button Overlay */
                              <div
                                onClick={() => setPlayingVideoId(msg.id)}
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  position: 'relative',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <video
                                  src={`${fullUrl}#t=0.5`}
                                  preload="metadata"
                                  playsInline
                                  muted
                                  style={{
                                    width: '100%',
                                    minHeight: 180,
                                    maxHeight: 280,
                                    objectFit: 'cover',
                                    filter: 'brightness(0.85)',
                                    display: 'block',
                                  }}
                                />

                                {/* Central WhatsApp Play Button */}
                                <div
                                  style={{
                                    position: 'absolute',
                                    width: 54,
                                    height: 54,
                                    borderRadius: '50%',
                                    background: 'rgba(0, 0, 0, 0.65)',
                                    backdropFilter: 'blur(8px)',
                                    border: '2px solid rgba(255, 255, 255, 0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#ffffff',
                                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
                                  }}
                                >
                                  <Play size={24} style={{ marginLeft: 3 }} fill="#ffffff" />
                                </div>

                                {/* Top Right Quick Actions: Fullscreen & Download */}
                                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFullscreenVideo({
                                        url: fullUrl,
                                        name: videoName,
                                        size: videoAtt.size,
                                        duration: videoDuration,
                                      });
                                    }}
                                    title="Fullscreen Player"
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: '50%',
                                      background: 'rgba(0,0,0,0.65)',
                                      border: 'none',
                                      color: '#fff',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <Maximize2 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownloadMedia(rawUrl, videoName, msg.id);
                                    }}
                                    title="Download Video"
                                    style={{
                                      width: 32,
                                      height: 32,
                                      borderRadius: '50%',
                                      background: 'rgba(0,0,0,0.65)',
                                      border: 'none',
                                      color: '#fff',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    {downloadingId === msg.id ? (
                                      <div style={{ width: 14, height: 14, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                                    ) : (
                                      <Download size={14} />
                                    )}
                                  </button>
                                </div>

                                {/* Bottom Pill: Duration & Size */}
                                <div
                                  style={{
                                    position: 'absolute',
                                    bottom: 8,
                                    left: 8,
                                    background: 'rgba(0, 0, 0, 0.7)',
                                    backdropFilter: 'blur(4px)',
                                    color: '#ffffff',
                                    padding: '3px 8px',
                                    borderRadius: 12,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <Film size={12} />
                                  <span>
                                    {videoDuration
                                      ? `${Math.floor(videoDuration / 60)}:${String(videoDuration % 60).padStart(2, '0')}`
                                      : 'Video'}
                                  </span>
                                  {videoSizeMb && (
                                    <span style={{ opacity: 0.75 }}>• {videoSizeMb} MB</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Video Bar: Name & Direct Download Action */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              background: isSelf ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
                              borderBottomLeftRadius: 10,
                              borderBottomRightRadius: 10,
                              marginTop: 3,
                              fontSize: 12,
                            }}
                          >
                            <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                              {videoName}
                            </span>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {playingVideoId === msg.id && (
                                <button
                                  type="button"
                                  onClick={() => setPlayingVideoId(null)}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.2)',
                                    border: 'none',
                                    borderRadius: 6,
                                    color: isSelf ? '#fff' : 'inherit',
                                    padding: '3px 7px',
                                    fontSize: 11,
                                    cursor: 'pointer',
                                  }}
                                >
                                  Close
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleDownloadMedia(rawUrl, videoName, msg.id)}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'var(--primary-500, #10b981)',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: 6,
                                  padding: '3px 9px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                <Download size={12} />
                                <span>{downloadingId === msg.id ? 'Saving...' : 'Download'}</span>
                              </button>
                            </div>
                          </div>

                          {/* Optional Caption */}
                          {msg.body && msg.body !== videoName && (
                            <div style={{ fontSize: 13, marginTop: 4, padding: '0 4px' }}>{msg.body}</div>
                          )}
                        </div>
                      );
                    })()
                  ) : (msg.type === 'IMAGE' || (msg.attachments && msg.attachments[0]?.mime?.startsWith('image/'))) && msg.attachments && msg.attachments.length > 0 ? (
                    /* Image Attachment */
                    <div style={{ marginBottom: 4 }}>
                      <img
                        src={
                          msg.attachments[0].url
                            ? (msg.attachments[0].url.startsWith('http') || msg.attachments[0].url.startsWith('blob:')
                                ? msg.attachments[0].url
                                : `${getServerUrl()}${msg.attachments[0].url}`)
                            : 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80'
                        }
                        alt={msg.attachments[0].name}
                        style={{
                          maxWidth: '100%',
                          maxHeight: 280,
                          borderRadius: 'var(--radius-md)',
                          display: 'block',
                          objectFit: 'cover',
                        }}
                      />
                      {msg.body && msg.body !== msg.attachments[0].name && (
                        <div style={{ fontSize: 13, marginTop: 6 }}>{msg.body}</div>
                      )}
                    </div>
                  ) : msg.type === 'FILE' && msg.attachments && msg.attachments.length > 0 ? (
                    /* Document Attachment */
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 8px',
                        background: isSelf ? 'rgba(255,255,255,0.12)' : 'var(--bg-surface-hover)',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: 4,
                      }}
                    >
                      <FileText size={24} color={isSelf ? '#fff' : 'var(--primary-500)'} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {msg.attachments[0].name}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.8 }}>
                          {(msg.attachments[0].size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <a
                        href={
                          msg.attachments[0].url
                            ? (msg.attachments[0].url.startsWith('http') || msg.attachments[0].url.startsWith('blob:')
                                ? msg.attachments[0].url
                                : `${getServerUrl()}${msg.attachments[0].url}`)
                            : '#'
                        }
                        download={msg.attachments[0].name}
                        style={{ color: 'inherit' }}
                        title="Download"
                      >
                        <Download size={16} />
                      </a>
                    </div>
                  ) : (
                    /* Standard Text */
                    <div style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>
                      {msg.body}
                    </div>
                  )}

                  {/* Metadata Row: Edited, Expiry, Timestamp, Read status */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 4,
                      marginTop: 4,
                      fontSize: 10,
                      opacity: 0.8,
                    }}
                  >
                    {msg.editedAt && <span>(edited)</span>}
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isSelf && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 2 }}>
                        {msg.status === 'read' ? (
                          <CheckCheck size={14} color="#53bdeb" />
                        ) : msg.status === 'delivered' ? (
                          <CheckCheck size={14} color="rgba(233, 237, 239, 0.7)" />
                        ) : (
                          <Check size={14} color="rgba(233, 237, 239, 0.7)" />
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Reactions list pill */}
                {msg.reactions && msg.reactions.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 3,
                      marginTop: -4,
                      [isSelf ? 'marginRight' : 'marginLeft']: 8,
                      zIndex: 5,
                    }}
                  >
                    {msg.reactions.map((r) => (
                      <span
                        key={r.emoji}
                        onClick={() => onAddReaction && onAddReaction(msg.id, r.emoji)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                          background: 'var(--bg-surface-elevated)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-full)',
                          padding: '1px 6px',
                          fontSize: 11,
                          cursor: 'pointer',
                          boxShadow: 'var(--shadow-sm)',
                        }}
                      >
                        {r.emoji} <span style={{ fontWeight: 600 }}>{r.userIds.length}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Banner */}
      {replyingTo && (
        <div
          style={{
            padding: '8px 16px',
            background: 'var(--bg-surface-elevated)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 12 }}>
            <CornerDownRight size={14} color="var(--primary-500)" />
            <span style={{ fontWeight: 600, color: 'var(--primary-600)' }}>Replying:</span>
            <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {replyingTo.body || 'Attachment'}
            </span>
          </div>
          <button onClick={() => setReplyingTo(null)} className="btn-icon" style={{ width: 24, height: 24 }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Edit Mode Banner */}
      {editingMessage && (
        <div
          style={{
            padding: '8px 16px',
            background: 'rgba(99, 102, 241, 0.1)',
            borderTop: '1px solid var(--primary-500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--primary-600)' }}>
            <Edit2 size={14} />
            <span style={{ fontWeight: 600 }}>Editing Message (15-min window)</span>
          </div>
          <button
            onClick={() => {
              setEditingMessage(null);
              setInputText('');
            }}
            className="btn-icon"
            style={{ width: 24, height: 24 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Scheduled Messages Notice Bar */}
      {chatScheduledMessages.length > 0 && (
        <div
          style={{
            margin: '0 12px 6px',
            padding: '7px 14px',
            borderRadius: 10,
            background: 'rgba(0, 168, 132, 0.12)',
            border: '1px solid rgba(0, 168, 132, 0.28)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: '#00a884',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={15} />
            <span style={{ fontWeight: 600 }}>
              {chatScheduledMessages.length} scheduled message{chatScheduledMessages.length > 1 ? 's' : ''} pending
            </span>
          </div>
          <button
            onClick={() => setShowScheduledListModal(true)}
            style={{
              background: 'none',
              border: 'none',
              color: '#00a884',
              fontWeight: 700,
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            View
          </button>
        </div>
      )}

      {/* 3-Message Request Pending Count Pill */}
      {isSender && !isLimitReached && (
        <div
          style={{
            margin: '0 12px 6px',
            padding: '7px 12px',
            borderRadius: 8,
            background: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            fontSize: 12,
            color: '#eab308',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertCircle size={15} />
          <span>
            Chat request pending: You can send <strong>{3 - mySentCount}</strong> more message{3 - mySentCount === 1 ? '' : 's'} until {peer?.displayName || 'user'} accepts.
          </span>
        </div>
      )}

      {/* When 3-message limit reached */}
      {isLimitReached ? (
        <div
          style={{
            margin: '8px 12px 14px',
            padding: '16px 20px',
            borderRadius: 12,
            background: 'var(--bg-surface-elevated, #202c33)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{ color: '#eab308', fontWeight: 700, fontSize: 14 }}>
            ⏳ Chat Request Limit Reached (3/3)
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 420 }}>
            You have sent 3 messages to {peer?.displayName || 'this user'}. You cannot send more messages until they accept your chat request.
          </div>
        </div>
      ) : isVoiceRecording ? (
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <VoiceRecorder onSendVoice={handleVoiceSend} onCancel={() => setIsVoiceRecording(false)} />
        </div>
      ) : (
        /* WhatsApp-Style Capsule Composer Bar */
        <div
          style={{
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            padding: '6px 8px calc(6px + var(--safe-bottom))',
            background: 'var(--bg-chat)',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 6,
            position: 'relative',
          }}
        >
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            multiple
          />

          {/* WhatsApp Attachment Menu Popover */}
          {showAttachMenu && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                right: 56,
                zIndex: 60,
                background: 'var(--bg-surface-elevated, #202c33)',
                borderRadius: 16,
                padding: '10px 14px',
                display: 'flex',
                gap: 16,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setShowAttachMenu(false);
                  fileInputRef.current?.click();
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  color: '#e9edef',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#bf59cf', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <Paperclip size={20} />
                </div>
                <span>Media</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowAttachMenu(false);
                  setShowPollModal(true);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  color: '#e9edef',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#007bfc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <BarChart2 size={20} />
                </div>
                <span>Poll</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowAttachMenu(false);
                  handleOpenSchedule();
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  color: '#e9edef',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#00a884', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <Clock size={20} />
                </div>
                <span>Schedule</span>
              </button>
            </div>
          )}

          {/* WhatsApp Capsule Container */}
          <div
            style={{
              flex: '1 1 0%',
              minWidth: 0,
              display: 'flex',
              alignItems: 'flex-end',
              background: 'var(--bg-surface-elevated)',
              borderRadius: 24,
              padding: '2px 8px 2px 6px',
              border: '1px solid var(--border-subtle)',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
              position: 'relative',
              minHeight: 46,
              boxSizing: 'border-box',
            }}
          >
            {/* Emoji Toggle */}
            <button
              className="btn-icon"
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker);
                setShowAttachMenu(false);
              }}
              title="Emoji"
              style={{
                width: 32,
                height: 36,
                marginBottom: 5,
                color: showEmojiPicker ? 'var(--primary-500)' : 'var(--text-secondary)',
                flexShrink: 0,
                padding: 0,
              }}
            >
              <Smile size={20} />
            </button>

            {/* Input Text Area */}
            <textarea
              placeholder={
                chat.type === 'CHANNEL' && chat.myRole === 'MEMBER'
                  ? 'Only admins can post here'
                  : 'Message'
              }
              value={inputText}
              onChange={handleInputChange}
              onFocus={() => {
                setShowEmojiPicker(false);
                setShowAttachMenu(false);
              }}
              onKeyDown={handleKeyDown}
              disabled={chat.type === 'CHANNEL' && chat.myRole === 'MEMBER'}
              rows={1}
              style={{
                flex: '1 1 0%',
                minWidth: 0,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                color: 'var(--text-primary)',
                padding: '11px 6px 11px',
                fontSize: 15,
                lineHeight: 1.35,
                resize: 'none',
                maxHeight: 120,
                minHeight: 22,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />

            {/* Attachments Trigger Button */}
            <button
              className="btn-icon"
              onClick={() => {
                setShowAttachMenu(!showAttachMenu);
                setShowEmojiPicker(false);
              }}
              title="Attach media, poll, or schedule"
              style={{ width: 32, height: 36, marginBottom: 5, color: showAttachMenu ? '#00a884' : 'var(--text-secondary)', flexShrink: 0, padding: 0 }}
            >
              <Paperclip size={20} />
            </button>

            {/* Full-featured Categorized WhatsApp Emoji Picker */}
            {showEmojiPicker && (
              <EmojiPicker
                onSelectEmoji={(emoji) => {
                  setInputText((prev) => prev + emoji);
                }}
                onBackspace={() => {
                  setInputText((prev) => Array.from(prev).slice(0, -1).join(''));
                }}
                onClose={() => setShowEmojiPicker(false)}
              />
            )}

            {/* Emoji Reaction Drawer when '+' is clicked on a message */}
            {reactingToMessageId && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 70,
                  background: 'rgba(0, 0, 0, 0.45)',
                  backdropFilter: 'blur(3px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 16,
                }}
                onClick={() => setReactingToMessageId(null)}
              >
                <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 390 }}>
                  <EmojiPicker
                    inline
                    onSelectEmoji={(emoji) => {
                      if (onAddReaction && reactingToMessageId) {
                        onAddReaction(reactingToMessageId, emoji);
                      }
                      setReactingToMessageId(null);
                    }}
                    onClose={() => setReactingToMessageId(null)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Floating WhatsApp Action Button (Send / Mic) - Always pinned and fully visible */}
          {inputText.trim() || editingMessage ? (
            <button
              onClick={handleSend}
              style={{
                width: 44,
                height: 44,
                minWidth: 44,
                borderRadius: '50%',
                background: '#00a884',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 2px 6px rgba(0, 168, 132, 0.4)',
                border: 'none',
                cursor: 'pointer',
                marginBottom: 1,
              }}
              title="Send Message"
            >
              <Send size={19} style={{ marginLeft: 2 }} />
            </button>
          ) : (
            <button
              onClick={() => setIsVoiceRecording(true)}
              style={{
                width: 44,
                height: 44,
                minWidth: 44,
                borderRadius: '50%',
                background: '#00a884',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 2px 6px rgba(0, 168, 132, 0.4)',
                border: 'none',
                cursor: 'pointer',
                marginBottom: 1,
              }}
              title="Record Voice Note"
            >
              <Mic size={19} />
            </button>
          )}
        </div>
      )}

      {/* WhatsApp-Style Delete Confirmation Dialog */}
      {deleteTargetMessage && (
        <div
          className="modal-overlay"
          onClick={() => setDeleteTargetMessage(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-surface-elevated, #202c33)',
              borderRadius: 16,
              padding: '24px 22px 18px',
              width: '100%',
              maxWidth: 340,
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              Delete message?
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {deleteTargetMessage.senderId === currentUser.id && (
                <button
                  onClick={() => {
                    if (onDeleteMessage) onDeleteMessage(deleteTargetMessage.id, true);
                    setDeleteTargetMessage(null);
                    setSelectedMessageId(null);
                  }}
                  style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    fontWeight: 700,
                    fontSize: 14,
                    textAlign: 'center',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    cursor: 'pointer',
                  }}
                >
                  Delete for everyone
                </button>
              )}
              <button
                onClick={() => {
                  if (onDeleteMessage) onDeleteMessage(deleteTargetMessage.id, false);
                  setDeleteTargetMessage(null);
                  setSelectedMessageId(null);
                }}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'var(--bg-surface-hover, #111b21)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: 14,
                  textAlign: 'center',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                Delete for me
              </button>
              <button
                onClick={() => setDeleteTargetMessage(null)}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  color: 'var(--text-secondary, #8696a0)',
                  fontWeight: 500,
                  fontSize: 14,
                  textAlign: 'center',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Poll Creation Modal */}
      {showPollModal && (
        <div className="modal-overlay" onClick={() => setShowPollModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChart2 size={18} color="var(--primary-500)" /> Create Poll
              </h3>
              <button className="btn-icon" onClick={() => setShowPollModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Question</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ask a question..."
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Options</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pollOptions.map((opt, idx) => (
                    <input
                      key={idx}
                      type="text"
                      className="input-field"
                      placeholder={`Option ${idx + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const newOpts = [...pollOptions];
                        newOpts[idx] = e.target.value;
                        setPollOptions(newOpts);
                      }}
                    />
                  ))}
                  {pollOptions.length < 5 && (
                    <button
                      onClick={() => setPollOptions([...pollOptions, ''])}
                      style={{ fontSize: 12, color: 'var(--primary-500)', fontWeight: 600, textAlign: 'left', padding: '4px 0' }}
                    >
                      + Add Option
                    </button>
                  )}
                </div>
              </div>

              <div
                onClick={() => setPollMultiple(!pollMultiple)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 4 }}
              >
                <input type="checkbox" checked={pollMultiple} onChange={() => {}} style={{ pointerEvents: 'none' }} />
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Allow multiple answers</span>
              </div>
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowPollModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSendPoll} disabled={!pollQuestion.trim()}>
                Create Poll
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Message Modal */}
      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={18} color="#00a884" /> Schedule Message
              </h3>
              <button className="btn-icon" onClick={() => setShowScheduleModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Message</label>
                <textarea
                  className="input-field"
                  placeholder="Type your message to schedule..."
                  value={scheduleText}
                  onChange={(e) => setScheduleText(e.target.value)}
                  rows={3}
                  style={{ width: '100%', resize: 'none' }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Quick Select</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { label: '+15 mins', offset: 15 },
                    { label: '+30 mins', offset: 30 },
                    { label: '+1 hour', offset: 60 },
                    { label: '+3 hours', offset: 180 },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setScheduleDateTime(toLocalIso(new Date(Date.now() + chip.offset * 60000)))}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 16,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-surface-elevated)',
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const tom = new Date();
                      tom.setDate(tom.getDate() + 1);
                      tom.setHours(9, 0, 0, 0);
                      setScheduleDateTime(toLocalIso(tom));
                    }}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 16,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-surface-elevated)',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Tomorrow 9:00 AM
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Delivery Date & Time
                </label>
                <input
                  type="datetime-local"
                  className="input-field"
                  value={scheduleDateTime}
                  min={toLocalIso(new Date())}
                  onChange={(e) => setScheduleDateTime(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowScheduleModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleConfirmSchedule}
                disabled={!scheduleText.trim() || !scheduleDateTime}
                style={{ background: '#00a884', borderColor: '#00a884' }}
              >
                Schedule Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scheduled Messages List Modal */}
      {showScheduledListModal && (
        <div className="modal-overlay" onClick={() => setShowScheduledListModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Clock size={18} color="#00a884" /> Scheduled Messages ({chatScheduledMessages.length})
              </h3>
              <button className="btn-icon" onClick={() => setShowScheduledListModal(false)}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflowY: 'auto' }}>
              {chatScheduledMessages.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  No scheduled messages for this chat
                </div>
              ) : (
                chatScheduledMessages.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 14, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {item.body}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} color="#00a884" />
                        Will send: {new Date(item.scheduledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {onSendScheduledNow && (
                          <button
                            onClick={() => {
                              onSendScheduledNow(item.id);
                              if (chatScheduledMessages.length <= 1) setShowScheduledListModal(false);
                            }}
                            className="btn"
                            style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(0, 168, 132, 0.15)', color: '#00a884' }}
                          >
                            Send Now
                          </button>
                        )}
                        {onCancelScheduledMessage && (
                          <button
                            onClick={() => {
                              onCancelScheduledMessage(item.id);
                              if (chatScheduledMessages.length <= 1) setShowScheduledListModal(false);
                            }}
                            className="btn"
                            style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setShowScheduledListModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* WhatsApp Fullscreen Lightbox Video Player Modal */}
      {fullscreenVideo && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: '#000000',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent)',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              color: '#ffffff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                type="button"
                onClick={() => setFullscreenVideo(null)}
                style={{
                  background: 'rgba(255,255,255,0.15)',
                  border: 'none',
                  borderRadius: '50%',
                  color: '#ffffff',
                  cursor: 'pointer',
                  width: 38,
                  height: 38,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ArrowLeft size={22} />
              </button>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fullscreenVideo.name}
                </div>
                {fullscreenVideo.size ? (
                  <div style={{ fontSize: 11, opacity: 0.75 }}>
                    {(fullscreenVideo.size / (1024 * 1024)).toFixed(1)} MB
                  </div>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleDownloadMedia(fullscreenVideo.url, fullscreenVideo.name)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'var(--primary-500, #10b981)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 20,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.4)',
              }}
            >
              <Download size={15} />
              <span>Save Video</span>
            </button>
          </div>

          {/* Video Center Viewport */}
          <div
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#000000',
              padding: '60px 0 20px',
            }}
          >
            <video
              src={fullscreenVideo.url}
              controls
              autoPlay
              playsInline
              style={{
                width: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
              }}
            />
          </div>
        </div>,
        document.body
      )}

      {/* Floating Download Toast */}
      {downloadNotice && (
        <div
          style={{
            position: 'fixed',
            bottom: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            background: 'rgba(15, 23, 42, 0.94)',
            backdropFilter: 'blur(8px)',
            color: '#ffffff',
            padding: '8px 16px',
            borderRadius: 24,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            pointerEvents: 'none',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <CheckCircle2 size={16} color="#10b981" />
          <span>{downloadNotice}</span>
        </div>
      )}
    </div>
  );
};
