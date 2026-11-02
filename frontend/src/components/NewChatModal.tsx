import React, { useState, useEffect } from 'react';
import { X, Search, Users, Shield, MessageSquare, Radio, Check } from 'lucide-react';
import { User, ChatType } from '../types';
import { api } from '../services/api';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChatCreated: (chatId: string) => void;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({ isOpen, onClose, onChatCreated }) => {
  const [tab, setTab] = useState<'DM' | 'GROUP' | 'CHANNEL'>('DM');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isProtected, setIsProtected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    loadUsers();
  }, [isOpen]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.users.search();
      if (res.ok && res.data) {
        setUsers(res.data);
      }
    } catch {
      // Fallback sample users for presentation
      setUsers([
        { id: 'u1', email: 'alice@teamtalk.internal', displayName: 'Alice Chen (Engineering Lead)', role: 'ADMIN', status: 'ACTIVE', online: true },
        { id: 'u2', email: 'bob@teamtalk.internal', displayName: 'Bob Taylor (Product Design)', role: 'MEMBER', status: 'ACTIVE', online: true },
        { id: 'u3', email: 'clara@teamtalk.internal', displayName: 'Clara Oswald (Security Officer)', role: 'SUPER_ADMIN', status: 'ACTIVE', online: false },
        { id: 'u4', email: 'david@teamtalk.internal', displayName: 'David Miller (DevOps)', role: 'MEMBER', status: 'ACTIVE', online: true },
        { id: 'u5', email: 'emma@teamtalk.internal', displayName: 'Emma Watson (Operations)', role: 'MEMBER', status: 'ACTIVE', online: false },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const q = (query || '').trim().toLowerCase().replace(/^@/, '');
  const filteredUsers = (users || []).filter((u) => {
    if (!u) return false;
    const username = (u.username || '').toLowerCase();
    const displayName = (u.displayName || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return username.includes(q) || displayName.includes(q) || email.includes(q);
  });

  const toggleUser = (userId: string) => {
    if (tab === 'DM') {
      handleCreateDM(userId);
      return;
    }
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleCreateDM = async (peerId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.chats.createDirect(peerId);
      if (res.ok && res.data) {
        onChatCreated(res.data.id);
        onClose();
      } else {
        setError(res.error || 'Failed to start conversation');
      }
    } catch {
      onChatCreated('demo-dm-' + peerId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateGroupOrChannel = async () => {
    if (!name.trim()) {
      setError('Please provide a name');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.chats.createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        type: tab as ChatType,
        isProtected,
        memberIds: selectedUserIds,
      });
      if (res.ok && res.data) {
        onChatCreated(res.data.id);
        onClose();
      } else {
        setError(res.error || 'Failed to create group');
      }
    } catch {
      onChatCreated('demo-group-' + Date.now());
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            {tab === 'DM' && <MessageSquare size={20} color="var(--primary-500)" />}
            {tab === 'GROUP' && <Users size={20} color="var(--primary-500)" />}
            {tab === 'CHANNEL' && <Radio size={20} color="var(--primary-500)" />}
            {tab === 'DM' ? 'New Direct Message' : tab === 'GROUP' ? 'Create Team Group' : 'New Broadcast Channel'}
          </h2>
          <button className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', padding: '12px 20px 0', gap: 8, background: 'var(--bg-surface)' }}>
          <button
            onClick={() => { setTab('DM'); setSelectedUserIds([]); }}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              borderBottom: tab === 'DM' ? '2px solid var(--primary-500)' : '2px solid transparent',
              color: tab === 'DM' ? 'var(--primary-500)' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Direct Message
          </button>
          <button
            onClick={() => setTab('GROUP')}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              borderBottom: tab === 'GROUP' ? '2px solid var(--primary-500)' : '2px solid transparent',
              color: tab === 'GROUP' ? 'var(--primary-500)' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Team Group
          </button>
          <button
            onClick={() => setTab('CHANNEL')}
            style={{
              flex: 1,
              padding: '10px 12px',
              borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
              borderBottom: tab === 'CHANNEL' ? '2px solid var(--primary-500)' : '2px solid transparent',
              color: tab === 'CHANNEL' ? 'var(--primary-500)' : 'var(--text-secondary)',
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Channel
          </button>
        </div>

        {error && (
          <div style={{ margin: '12px 20px 0', padding: '10px 14px', background: 'rgba(244,63,94,0.1)', color: 'var(--accent-rose)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Group / Channel metadata fields */}
        {tab !== 'DM' && (
          <div style={{ padding: '16px 20px 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                {tab === 'GROUP' ? 'Group Name' : 'Channel Name'} *
              </label>
              <input
                type="text"
                className="input-field"
                placeholder={tab === 'GROUP' ? 'e.g. Core Engineering' : 'e.g. All-Hands Announcements'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                Description (Optional)
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Topic, purpose, team goals..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={200}
              />
            </div>

            {/* Protected Chat toggle */}
            <div
              onClick={() => setIsProtected(!isProtected)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                background: isProtected ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-input)',
                border: isProtected ? '1px solid var(--primary-500)' : '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Shield size={18} color={isProtected ? 'var(--primary-500)' : 'var(--text-muted)'} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                  Protected Space (Watermarked & Anti-Capture)
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Restricts exports, enforces viewer watermarks, logs screenshot events.
                </div>
              </div>
              <input type="checkbox" checked={isProtected} onChange={() => {}} style={{ pointerEvents: 'none' }} />
            </div>
          </div>
        )}

        {/* Member selector / Search bar */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 12, top: 12 }} />
            <input
              type="text"
              className="input-field"
              placeholder={tab === 'DM' ? 'Search team member to message...' : 'Add team members...'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 38 }}
            />
          </div>
          {tab !== 'DM' && selectedUserIds.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {selectedUserIds.map((id) => {
                const u = users.find((item) => item.id === id);
                return (
                  <span
                    key={id}
                    onClick={() => toggleUser(id)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      background: 'var(--primary-100)',
                      color: 'var(--primary-700)',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {u?.displayName || id}
                    <X size={12} />
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* User list */}
        <div style={{ flex: 1, overflowY: 'auto', maxHeight: 260, padding: '8px 12px' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Loading team directory...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No team members found
            </div>
          ) : (
            filteredUsers.map((user) => {
              const selected = selectedUserIds.includes(user.id);
              return (
                <div
                  key={user.id}
                  onClick={() => toggleUser(user.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    background: selected ? 'var(--bg-surface-hover)' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface-hover)')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = selected ? 'var(--bg-surface-hover)' : 'transparent')
                  }
                >
                  <div
                    className="avatar"
                    style={{
                      background: 'linear-gradient(135deg, var(--primary-500), var(--accent-purple))',
                      width: 40,
                      height: 40,
                      fontSize: 14,
                      overflow: 'hidden',
                    }}
                  >
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      ((user.displayName || user.username || 'U').slice(0, 2).toUpperCase())
                    )}
                    {user.online && (
                      <span
                        className="status-dot online"
                        style={{ position: 'absolute', bottom: -2, right: -2 }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {user.displayName || user.username}
                      </span>
                      {user.role === 'SUPER_ADMIN' && (
                        <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(239, 68, 68, 0.15)', color: 'var(--accent-rose)', fontWeight: 700 }}>
                          SUPER ADMIN
                        </span>
                      )}
                      {user.role === 'ADMIN' && (
                        <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary-600)', fontWeight: 700 }}>
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ color: '#10b981', fontWeight: 600 }}>@{user.username || user.email?.split('@')[0] || 'member'}</span>
                      {user.about && <span style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {user.about}</span>}
                    </div>
                  </div>

                  {tab === 'DM' && (
                    <button
                      type="button"
                      style={{
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                        borderRadius: 8,
                        background: '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Chat
                    </button>
                  )}

                  {tab !== 'DM' && (
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        border: selected ? 'none' : '2px solid var(--border-strong)',
                        background: selected ? 'var(--primary-500)' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                      }}
                    >
                      {selected && <Check size={14} />}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer actions for Group / Channel */}
        {tab !== 'DM' && (
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-surface)',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {selectedUserIds.length} members selected
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateGroupOrChannel}
                disabled={submitting || !name.trim()}
              >
                {submitting ? 'Creating...' : tab === 'GROUP' ? 'Create Group' : 'Create Channel'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
