import React, { useState } from 'react';
import {
  X,
  Shield,
  Clock,
  Volume2,
  VolumeX,
  Pin,
  Archive,
  Users,
  Image,
  FileText,
  Link2,
  UserPlus,
  ShieldCheck,
  UserMinus,
  AlertTriangle,
  Ban,
  Check,
} from 'lucide-react';
import { Chat, User, Attachment } from '../types';

interface DetailsPanelProps {
  currentUser: User;
  chat: Chat;
  onClose: () => void;
  onUpdateChat?: (chatId: string, updates: Partial<Chat>) => void;
  onAddMember?: (chatId: string) => void;
  onRemoveMember?: (chatId: string, userId: string) => void;
  onLeaveChat?: (chatId: string) => void;
  onToggleMute?: (chatId: string) => void;
  onTogglePin?: (chatId: string) => void;
  onToggleArchive?: (chatId: string) => void;
  onReportChat?: (chatId: string, reason: string) => void;
  onBlockUser?: (userId: string) => void;
  attachments?: Attachment[];
}

export const DetailsPanel: React.FC<DetailsPanelProps> = ({
  currentUser,
  chat,
  onClose,
  onUpdateChat,
  onAddMember,
  onRemoveMember,
  onLeaveChat,
  onToggleMute,
  onTogglePin,
  onToggleArchive,
  onReportChat,
  onBlockUser,
  attachments = [],
}) => {
  const [activeTab, setActiveTab] = useState<'MEDIA' | 'DOCS' | 'MEMBERS'>('MEDIA');
  const [reportReason, setReportReason] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);

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
  const isAdminOrOwner = chat.myRole === 'OWNER' || chat.myRole === 'ADMIN';

  const mediaAttachments = attachments.filter((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'));
  const docAttachments = attachments.filter((a) => !a.mime.startsWith('image/') && !a.mime.startsWith('video/'));

  return (
    <aside className="details-panel">
      {/* Header */}
      <div className="panel-header">
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
          {chat.type === 'DIRECT' ? 'Contact Details' : 'Group Information'}
        </h3>
        <button className="btn-icon" onClick={onClose} title="Close details">
          <X size={18} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
        {/* Profile Card */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 20 }}>
          <div
            className="avatar"
            style={{
              width: 80,
              height: 80,
              fontSize: 26,
              marginBottom: 12,
              background:
                chat.type === 'CHANNEL'
                  ? 'linear-gradient(135deg, var(--accent-rose), var(--accent-amber))'
                  : chat.type === 'GROUP'
                  ? 'linear-gradient(135deg, var(--accent-purple), var(--primary-500))'
                  : 'linear-gradient(135deg, var(--primary-600), var(--accent-cyan))',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            {getChatDisplayName().slice(0, 2).toUpperCase()}
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            {getChatDisplayName()}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            {chat.type === 'DIRECT' ? peer?.about || 'Team Member' : chat.description || `${chat.members.length} members`}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--bg-surface-hover)',
                color: 'var(--text-secondary)',
              }}
            >
              {chat.type}
            </span>
            {chat.isProtected && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: 'var(--primary-600)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Shield size={12} /> Protected
              </span>
            )}
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginBottom: 20,
            padding: '12px',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <button
            onClick={() => onToggleMute && onToggleMute(chat.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              color: chat.muted ? 'var(--accent-rose)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {chat.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            {chat.muted ? 'Muted' : 'Mute'}
          </button>
          <button
            onClick={() => onTogglePin && onTogglePin(chat.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              color: chat.pinned ? 'var(--primary-500)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Pin size={18} />
            {chat.pinned ? 'Pinned' : 'Pin'}
          </button>
          <button
            onClick={() => onToggleArchive && onToggleArchive(chat.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              color: chat.archived ? 'var(--accent-amber)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <Archive size={18} />
            {chat.archived ? 'Archived' : 'Archive'}
          </button>
        </div>

        {/* Privacy & Security Card */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '14px 16px',
            marginBottom: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Shield size={16} color="var(--primary-500)" /> Security & Controls
          </div>

          {/* Protected Chat Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Protected Mode</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Watermark overlay, anti-export, blur on app switch
              </div>
            </div>
            <button
              onClick={() => onUpdateChat && onUpdateChat(chat.id, { isProtected: !chat.isProtected })}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: chat.isProtected ? 'var(--primary-500)' : 'var(--border-strong)',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 2,
                  left: chat.isProtected ? 22 : 2,
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>

          {/* Disappearing Messages */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} color="var(--text-muted)" />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Disappearing Messages</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {chat.disappearingSeconds
                    ? `${chat.disappearingSeconds / 3600} hours timer`
                    : 'Off'}
                </div>
              </div>
            </div>
            {isAdminOrOwner && (
              <select
                value={chat.disappearingSeconds || 0}
                onChange={(e) =>
                  onUpdateChat &&
                  onUpdateChat(chat.id, {
                    disappearingSeconds: Number(e.target.value) || null,
                  })
                }
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value={0}>Off</option>
                <option value={86400}>24 Hours</option>
                <option value={604800}>7 Days</option>
                <option value={7776000}>90 Days</option>
              </select>
            )}
          </div>

          {/* Transparent Encryption Disclosure */}
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(99, 102, 241, 0.06)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              fontSize: 11,
              lineHeight: 1.45,
              color: 'var(--text-secondary)',
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--primary-600)', marginBottom: 2 }}>
              Workspace Encryption Standard
            </div>
            Data is encrypted at rest using authenticated AES-256-GCM. Transport is secured via TLS 1.3. For compliance search and indexing, keys are securely managed by the workspace backend.
          </div>
        </div>

        {/* Media & Participants Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', marginBottom: 14 }}>
          <button
            onClick={() => setActiveTab('MEDIA')}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 13,
              fontWeight: 600,
              borderBottom: activeTab === 'MEDIA' ? '2px solid var(--primary-500)' : '2px solid transparent',
              color: activeTab === 'MEDIA' ? 'var(--primary-500)' : 'var(--text-secondary)',
            }}
          >
            Media ({mediaAttachments.length})
          </button>
          <button
            onClick={() => setActiveTab('DOCS')}
            style={{
              flex: 1,
              padding: '8px 0',
              fontSize: 13,
              fontWeight: 600,
              borderBottom: activeTab === 'DOCS' ? '2px solid var(--primary-500)' : '2px solid transparent',
              color: activeTab === 'DOCS' ? 'var(--primary-500)' : 'var(--text-secondary)',
            }}
          >
            Docs ({docAttachments.length})
          </button>
          {chat.type !== 'DIRECT' && (
            <button
              onClick={() => setActiveTab('MEMBERS')}
              style={{
                flex: 1,
                padding: '8px 0',
                fontSize: 13,
                fontWeight: 600,
                borderBottom: activeTab === 'MEMBERS' ? '2px solid var(--primary-500)' : '2px solid transparent',
                color: activeTab === 'MEMBERS' ? 'var(--primary-500)' : 'var(--text-secondary)',
              }}
            >
              Members ({chat.members.length})
            </button>
          )}
        </div>

        {/* Tab Content */}
        {activeTab === 'MEDIA' && (
          <div>
            {mediaAttachments.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No shared photos or videos
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {mediaAttachments.map((att) => (
                  <img
                    key={att.id}
                    src={att.url}
                    alt={att.name}
                    style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'DOCS' && (
          <div>
            {docAttachments.length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No shared documents
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {docAttachments.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  >
                    <FileText size={18} color="var(--primary-500)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {doc.name}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{(doc.size / 1024).toFixed(1)} KB</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'MEMBERS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isAdminOrOwner && (
              <button
                onClick={() => onAddMember && onAddMember(chat.id)}
                className="btn btn-secondary"
                style={{ width: '100%', fontSize: 13, gap: 6 }}
              >
                <UserPlus size={16} /> Add Member
              </button>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {chat.members.map((member) => (
                <div
                  key={member.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    className="avatar"
                    style={{
                      width: 34,
                      height: 34,
                      fontSize: 12,
                      background: 'linear-gradient(135deg, var(--primary-500), var(--accent-purple))',
                    }}
                  >
                    {member.displayName.slice(0, 2).toUpperCase()}
                    {member.online && (
                      <span
                        className="status-dot online"
                        style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8 }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {member.displayName}
                      </span>
                      {member.role === 'OWNER' && (
                        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: 'var(--accent-amber)', fontWeight: 700 }}>
                          OWNER
                        </span>
                      )}
                      {member.role === 'ADMIN' && (
                        <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'rgba(99, 102, 241, 0.15)', color: 'var(--primary-600)', fontWeight: 700 }}>
                          ADMIN
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {member.online ? 'Online' : 'Offline'}
                    </div>
                  </div>

                  {isAdminOrOwner && member.id !== currentUser.id && member.role !== 'OWNER' && (
                    <button
                      onClick={() => onRemoveMember && onRemoveMember(chat.id, member.id)}
                      className="btn-icon"
                      style={{ width: 28, height: 28, color: 'var(--accent-rose)' }}
                      title="Remove from group"
                    >
                      <UserMinus size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Danger Area */}
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chat.type === 'DIRECT' && peer && onBlockUser && (
            <button
              onClick={() => onBlockUser(peer.id)}
              className="btn btn-secondary"
              style={{ color: 'var(--accent-rose)', width: '100%', fontSize: 13, gap: 8 }}
            >
              <Ban size={15} /> Block {peer.displayName}
            </button>
          )}

          {chat.type !== 'DIRECT' && onLeaveChat && (
            <button
              onClick={() => onLeaveChat(chat.id)}
              className="btn btn-secondary"
              style={{ color: 'var(--accent-rose)', width: '100%', fontSize: 13, gap: 8 }}
            >
              <AlertTriangle size={15} /> Exit Group
            </button>
          )}

          <button
            onClick={() => setShowReportModal(true)}
            style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0', textDecoration: 'underline' }}
          >
            Report an issue with this conversation
          </button>
        </div>
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="modal-overlay" onClick={() => setShowReportModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700 }}>
              Report Conversation to Admin
            </div>
            <div style={{ padding: '16px 20px' }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Reason for report:
              </label>
              <textarea
                className="input-field"
                rows={3}
                placeholder="Explain the security violation, spam, or misconduct..."
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
              />
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setShowReportModal(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (onReportChat && reportReason.trim()) {
                    onReportChat(chat.id, reportReason.trim());
                  }
                  setShowReportModal(false);
                  setReportReason('');
                }}
                disabled={!reportReason.trim()}
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
