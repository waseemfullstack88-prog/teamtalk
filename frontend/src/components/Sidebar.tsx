import React, { useState, useEffect } from 'react';
import {
  MessageSquarePlus,
  Search,
  Pin,
  VolumeX,
  Shield,
  Phone,
  CircleDashed,
  Settings,
  ShieldAlert,
  Moon,
  Sun,
  Users,
  Radio,
  Check,
  CheckCheck,
  X,
} from 'lucide-react';
import { Chat, User, CallHistoryItem, StatusGroup } from '../types';
import { api, getServerUrl } from '../services/api';

interface SidebarProps {
  currentUser: User;
  chats: Chat[];
  activeChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onStartDirectChat?: (user: User) => void;
  typingMap: Record<string, string[]>;
  onOpenNewChat: () => void;
  onOpenSettings: () => void;
  onOpenAdmin: () => void;
  onOpenCalls: () => void;
  onOpenStatus: () => void;
  callHistory?: CallHistoryItem[];
  statusGroups?: StatusGroup[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isServerConnected?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentUser,
  chats,
  activeChatId,
  onSelectChat,
  onStartDirectChat,
  typingMap,
  onOpenNewChat,
  onOpenSettings,
  onOpenAdmin,
  onOpenCalls,
  onOpenStatus,
  theme,
  onToggleTheme,
  isServerConnected = true,
}) => {
  const [activeTab, setActiveTab] = useState<'ALL' | 'UNREAD' | 'GROUPS' | 'PROTECTED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .getUsers()
        .then((res) => {
          if (res && res.users) {
            setDirectoryUsers(res.users);
          }
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Format relative timestamp
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const isThisWeek = now.getTime() - date.getTime() < 7 * 86400000;
    if (isThisWeek) {
      return date.toLocaleDateString([], { weekday: 'short' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const getChatDisplayName = (chat: Chat): string => {
    if (chat.name) return chat.name;
    if (chat.type === 'DIRECT') {
      const peer = chat.members.find((m) => m.id !== currentUser.id) || chat.members[0];
      return peer ? peer.displayName : 'Direct Message';
    }
    return 'Unnamed Chat';
  };

  const getChatAvatarText = (chat: Chat): string => {
    const name = getChatDisplayName(chat);
    return name.slice(0, 2).toUpperCase();
  };

  const isPeerOnline = (chat: Chat): boolean => {
    if (chat.type !== 'DIRECT') return false;
    const peer = chat.members.find((m) => m.id !== currentUser.id);
    return !!peer?.online;
  };

  const filteredChats = chats
    .filter((chat) => {
      const name = getChatDisplayName(chat).toLowerCase();
      const query = searchQuery.toLowerCase();
      const matchesSearch = name.includes(query) || (chat.lastMessage?.body?.toLowerCase().includes(query) ?? false);
      if (!matchesSearch) return false;

      if (activeTab === 'UNREAD') return chat.unread > 0;
      if (activeTab === 'GROUPS') return chat.type === 'GROUP' || chat.type === 'CHANNEL';
      if (activeTab === 'PROTECTED') return chat.isProtected;
      return true;
    })
    .sort((a, b) => {
      // Pinned chats first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      // Then by latest activity
      const aTime = a.lastMessage?.createdAt || a.updatedAt;
      const bTime = b.lastMessage?.createdAt || b.updatedAt;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

  const cleanQ = (searchQuery || '').trim().toLowerCase().replace(/^@/, '');
  const matchingUsers = cleanQ
    ? directoryUsers.filter((u) => {
        if (!u || u.id === currentUser.id) return false;
        const username = (u.username || '').toLowerCase();
        const displayName = (u.displayName || '').toLowerCase();
        return username.includes(cleanQ) || displayName.includes(cleanQ);
      })
    : [];

  const handleUserClick = (targetUser: User) => {
    if (onStartDirectChat) {
      onStartDirectChat(targetUser);
    } else {
      const existing = chats.find(
        (c) => c.type === 'DIRECT' && c.members.some((m) => m.id === targetUser.id)
      );
      if (existing) {
        onSelectChat(existing.id);
      } else {
        onOpenNewChat();
      }
    }
    setSearchQuery('');
  };

  const totalUnread = chats.reduce((sum, c) => sum + (c.unread || 0), 0);

  return (
    <aside className="sidebar-panel">
      {/* Top Header */}
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            className="avatar"
            onClick={onOpenSettings}
            style={{
              width: 38,
              height: 38,
              background: 'linear-gradient(135deg, var(--primary-600), var(--accent-cyan))',
              fontSize: 14,
              boxShadow: '0 2px 6px rgba(0, 168, 132, 0.3)',
              position: 'relative',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
            title={`${currentUser.displayName} — Tap to edit profile`}
          >
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.displayName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              currentUser.displayName.slice(0, 2).toUpperCase()
            )}
            <span
              className="status-dot online"
              style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, zIndex: 2 }}
            />
          </div>
          <div
            onClick={onOpenSettings}
            style={{ cursor: 'pointer', userSelect: 'none' }}
            title="View your profile & settings"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.3px', color: 'var(--text-primary)' }}>
                TeamTalk
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: '1px 5px',
                  borderRadius: 4,
                  fontWeight: 700,
                  background: 'rgba(0, 168, 132, 0.15)',
                  color: 'var(--primary-600)',
                }}
              >
                PRO
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentUser.displayName}
              </span>
            </div>
          </div>
        </div>

        {/* Action icons - Mobile shows only essential icons, secondary ones stay on bottom bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="btn-icon hide-on-mobile" onClick={onOpenStatus} title="Status Updates (24h)">
            <CircleDashed size={19} />
          </button>
          <button className="btn-icon hide-on-mobile" onClick={onOpenCalls} title="Call History">
            <Phone size={18} />
          </button>
          <button
            className="btn-icon hide-on-mobile"
            onClick={onOpenNewChat}
            title="New Chat or Group"
            style={{ color: 'var(--primary-500)' }}
          >
            <MessageSquarePlus size={20} />
          </button>
          {(currentUser.role === 'ADMIN' || currentUser.role === 'SUPER_ADMIN') && (
            <button
              className="btn-icon"
              onClick={onOpenAdmin}
              title="Admin Dashboard"
              style={{ color: 'var(--accent-purple)' }}
            >
              <ShieldAlert size={19} />
            </button>
          )}
          <button className="btn-icon hide-on-mobile" onClick={onOpenSettings} title="Settings & Security">
            <Settings size={18} />
          </button>
          <button className="btn-icon" onClick={onToggleTheme} title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </div>

      {/* Offline / Server Connecting Banner (WhatsApp style, below header, never obscuring UI) */}
      {!isServerConnected && (
        <div
          style={{
            background: 'rgba(234, 179, 8, 0.12)',
            borderBottom: '1px solid rgba(234, 179, 8, 0.25)',
            color: '#facc15',
            padding: '7px 16px',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            letterSpacing: '0.2px',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#facc15' }} />
          <span>Waiting for server connection...</span>
        </div>
      )}

      {/* Search Input */}
      <div style={{ padding: '10px 14px 6px' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: 11 }} />
          <input
            type="text"
            className="input-field"
            placeholder="Search chats, contacts, or messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ paddingLeft: 36, paddingRight: searchQuery ? 32 : 12, height: 38, fontSize: 13 }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{ position: 'absolute', right: 8, top: 9, color: 'var(--text-muted)' }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Quick Filter Chips */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '6px 14px 10px',
          overflowX: 'auto',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <button
          onClick={() => setActiveTab('ALL')}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            background: activeTab === 'ALL' ? 'var(--primary-500)' : 'var(--bg-surface-hover)',
            color: activeTab === 'ALL' ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          All
        </button>
        <button
          onClick={() => setActiveTab('UNREAD')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            background: activeTab === 'UNREAD' ? 'var(--primary-500)' : 'var(--bg-surface-hover)',
            color: activeTab === 'UNREAD' ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          Unread
          {totalUnread > 0 && (
            <span
              style={{
                background: activeTab === 'UNREAD' ? 'rgba(255,255,255,0.3)' : 'var(--primary-500)',
                color: '#fff',
                borderRadius: 'var(--radius-full)',
                padding: '0 5px',
                fontSize: 10,
              }}
            >
              {totalUnread}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('GROUPS')}
          style={{
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            background: activeTab === 'GROUPS' ? 'var(--primary-500)' : 'var(--bg-surface-hover)',
            color: activeTab === 'GROUPS' ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          Groups
        </button>
        <button
          onClick={() => setActiveTab('PROTECTED')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 600,
            background: activeTab === 'PROTECTED' ? 'var(--primary-500)' : 'var(--bg-surface-hover)',
            color: activeTab === 'PROTECTED' ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          <Shield size={12} />
          Protected
        </button>
      </div>

      {/* Chat List & Search Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
        {/* People / Contacts Search Results */}
        {cleanQ && matchingUsers.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
                color: '#10b981',
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Users size={13} />
              <span>People ({matchingUsers.length})</span>
            </div>
            {matchingUsers.map((user) => (
              <div
                key={user.id}
                onClick={() => handleUserClick(user)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  marginBottom: 4,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  transition: 'background var(--transition-fast)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div
                    className="avatar"
                    style={{
                      width: 38,
                      height: 38,
                      fontSize: 13,
                      background: 'linear-gradient(135deg, #10b981, #059669)',
                      flexShrink: 0,
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      user.displayName.slice(0, 2).toUpperCase()
                    )}
                    {user.online && (
                      <span
                        className="status-dot online"
                        style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9 }}
                      />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.displayName}
                    </div>
                    <div style={{ fontSize: 11, color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                      <span>@{user.username || user.displayName.toLowerCase().replace(/\s+/g, '')}</span>
                      {user.role === 'ADMIN' && (
                        <span style={{ fontSize: 9, padding: '1px 5px', background: 'rgba(99, 102, 241, 0.2)', color: 'var(--primary-400)', borderRadius: 3 }}>
                          ADMIN
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: '5px 12px', height: 'auto', flexShrink: 0 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUserClick(user);
                  }}
                >
                  Chat
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Conversations Section Header if both users and chats match */}
        {cleanQ && matchingUsers.length > 0 && filteredChats.length > 0 && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              color: 'var(--text-muted)',
              padding: '6px 8px',
            }}
          >
            Conversations ({filteredChats.length})
          </div>
        )}

        {filteredChats.length === 0 && (!cleanQ || matchingUsers.length === 0) ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {cleanQ ? 'No matching people or chats' : 'No conversations found'}
            </p>
            <p style={{ fontSize: 12, marginBottom: 16 }}>
              {cleanQ ? `No one found with username or chat matching "${cleanQ}".` : 'Start a secure conversation with your team.'}
            </p>
            <button className="btn btn-primary" onClick={onOpenNewChat} style={{ fontSize: 13, margin: '0 auto' }}>
              <MessageSquarePlus size={16} />
              New Conversation
            </button>
          </div>
        ) : (
          filteredChats.map((chat) => {
            const isSelected = chat.id === activeChatId;
            const chatName = getChatDisplayName(chat);
            const avatarText = getChatAvatarText(chat);
            const peer = chat.type === 'DIRECT' ? chat.members.find((m) => m.id !== currentUser.id) : null;
            const rawPeerAvatar = peer?.avatarUrl || (peer?.avatarFileId ? `/api/files/${peer.avatarFileId}/view` : '') || (chat as any).avatarUrl;
            const peerAvatarUrl = rawPeerAvatar ? (rawPeerAvatar.startsWith('http') || rawPeerAvatar.startsWith('data:') || rawPeerAvatar.startsWith('blob:') ? rawPeerAvatar : `${getServerUrl()}${rawPeerAvatar}`) : null;
            const online = isPeerOnline(chat);
            const typingUsers = typingMap[chat.id] || [];
            const isTyping = typingUsers.length > 0;
            const lastMsg = chat.lastMessage;
            const isSelfLast = lastMsg?.senderId === currentUser.id;

            return (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-lg)',
                  cursor: 'pointer',
                  position: 'relative',
                  marginBottom: 2,
                  background: isSelected ? 'var(--bg-surface-hover)' : 'transparent',
                  border: isSelected ? '1px solid var(--border-subtle)' : '1px solid transparent',
                  transition: 'background var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--bg-surface-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                {/* Left: Avatar */}
                <div
                  className="avatar"
                  style={{
                    background:
                      chat.type === 'CHANNEL'
                        ? 'linear-gradient(135deg, var(--accent-rose), var(--accent-amber))'
                        : chat.type === 'GROUP'
                        ? 'linear-gradient(135deg, var(--accent-purple), var(--primary-500))'
                        : 'linear-gradient(135deg, var(--primary-500), var(--accent-cyan))',
                  }}
                >
                  {chat.type === 'CHANNEL' ? (
                    <Radio size={20} color="#ffffff" />
                  ) : chat.type === 'GROUP' ? (
                    <Users size={20} color="#ffffff" />
                  ) : peerAvatarUrl ? (
                    <img
                      src={peerAvatarUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                    />
                  ) : (
                    avatarText
                  )}
                  {chat.type === 'DIRECT' && online && (
                    <span
                      className="status-dot online"
                      style={{ position: 'absolute', bottom: -1, right: -1 }}
                      title="Online"
                    />
                  )}
                </div>

                {/* Center: Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span
                        style={{
                          fontWeight: chat.unread > 0 ? 700 : 600,
                          fontSize: 14,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {chatName}
                      </span>
                      {chat.isProtected && (
                        <span title="Protected Chat (Anti-Screenshot/Export)">
                          <Shield size={13} color="var(--primary-500)" />
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: chat.unread > 0 ? 'var(--primary-500)' : 'var(--text-muted)',
                        fontWeight: chat.unread > 0 ? 700 : 500,
                        flexShrink: 0,
                      }}
                    >
                      {formatTime(lastMsg?.createdAt || chat.updatedAt)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: isTyping ? 'var(--accent-emerald)' : chat.unread > 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: chat.unread > 0 ? 600 : 400,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        minWidth: 0,
                      }}
                    >
                      {isTyping ? (
                        <span style={{ fontStyle: 'italic', fontWeight: 600, color: 'var(--accent-emerald)' }}>typing...</span>
                      ) : (
                        <>
                          {isSelfLast && !lastMsg?.deletedForAll && lastMsg?.body !== '🚫 This message was deleted' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {lastMsg?.status === 'read' ? (
                                <CheckCheck size={14} color="#53bdeb" />
                              ) : lastMsg?.status === 'delivered' ? (
                                <CheckCheck size={14} color="var(--text-muted)" />
                              ) : (
                                <Check size={14} color="var(--text-muted)" />
                              )}
                            </span>
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {lastMsg?.deletedForAll || lastMsg?.body === '🚫 This message was deleted' ? (
                              <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                                🚫 This message was deleted
                              </span>
                            ) : lastMsg?.type === 'POLL'
                              ? '📊 Poll: ' + (lastMsg.poll?.question || 'Poll')
                              : lastMsg?.type === 'VOICE'
                              ? '🎤 Voice note'
                              : lastMsg?.type === 'IMAGE'
                              ? '📷 Photo'
                              : lastMsg?.type === 'FILE'
                              ? '📎 Attachment'
                              : lastMsg?.body || 'No messages yet'}
                          </span>
                        </>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 6 }}>
                      {chat.muted && <span title="Muted"><VolumeX size={13} color="var(--text-muted)" /></span>}
                      {chat.pinned && <span title="Pinned"><Pin size={13} color="var(--text-muted)" /></span>}
                      {chat.unread > 0 && <span className="badge">{chat.unread > 99 ? '99+' : chat.unread}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Action Button (New Chat / User Directory) */}
      <button
        onClick={onOpenNewChat}
        className="fab-new-chat"
        title="Start New Chat"
        aria-label="Start New Chat"
        style={{
          position: 'fixed',
          bottom: 74,
          right: 20,
          width: 54,
          height: 54,
          borderRadius: 27,
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 6px 18px rgba(16, 185, 129, 0.45)',
          border: 'none',
          cursor: 'pointer',
          zIndex: 30,
        }}
      >
        <MessageSquarePlus size={24} />
      </button>
    </aside>
  );
};
