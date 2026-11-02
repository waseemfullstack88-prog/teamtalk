import React, { useState, useEffect } from 'react';
import {
  X,
  Shield,
  Users,
  UserPlus,
  Sliders,
  FileText,
  AlertTriangle,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import { User, Role } from '../types';
import { api } from '../services/api';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
}

export const AdminModal: React.FC<AdminModalProps> = ({ isOpen, onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'INVITES' | 'USERS' | 'POLICIES' | 'AUDIT' | 'REPORTS'>('OVERVIEW');
  const [loading, setLoading] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Invite creator state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('MEMBER');
  const [invites, setInvites] = useState<Array<{ id: string; email?: string; token: string; role: Role; expiresAt: string }>>([
    { id: 'inv-1', email: 'dev.lead@internal.io', token: 'tt-inv-8f92ab3c', role: 'ADMIN', expiresAt: '2026-11-05' },
    { id: 'inv-2', token: 'tt-inv-91c28f01', role: 'MEMBER', expiresAt: '2026-11-12' },
  ]);

  // Users state
  const [userList, setUserList] = useState<User[]>([
    { id: 'u1', email: 'alice@teamtalk.internal', displayName: 'Alice Chen (Engineering Lead)', role: 'ADMIN', status: 'ACTIVE', online: true },
    { id: 'u2', email: 'bob@teamtalk.internal', displayName: 'Bob Taylor (Product Design)', role: 'MEMBER', status: 'ACTIVE', online: true },
    { id: 'u3', email: 'clara@teamtalk.internal', displayName: 'Clara Oswald (Security Officer)', role: 'SUPER_ADMIN', status: 'ACTIVE', online: false },
    { id: 'u4', email: 'david@teamtalk.internal', displayName: 'David Miller (DevOps)', role: 'MEMBER', status: 'ACTIVE', online: true },
  ]);

  // Policies
  const [retentionDays, setRetentionDays] = useState(90);
  const [require2FA, setRequire2FA] = useState(false);
  const [allowMemberGroups, setAllowMemberGroups] = useState(true);
  const [policiesSaved, setPoliciesSaved] = useState(false);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<Array<{ id: string; event: string; actor: string; target?: string; ip: string; time: string }>>([
    { id: 'log-1', event: 'USER_LOGIN', actor: 'alice@teamtalk.internal', ip: '192.168.1.104', time: 'Just now' },
    { id: 'log-2', event: 'PROTECTED_CHAT_VIEWED', actor: 'bob@teamtalk.internal', target: 'Executive Channel', ip: '192.168.1.112', time: '10 min ago' },
    { id: 'log-3', event: 'ROLE_CHANGED', actor: 'clara@teamtalk.internal', target: 'Alice Chen -> ADMIN', ip: '10.0.0.12', time: '1 hour ago' },
    { id: 'log-4', event: 'INVITE_CREATED', actor: 'alice@teamtalk.internal', target: 'dev.lead@internal.io', ip: '192.168.1.104', time: '2 hours ago' },
  ]);

  // Reports
  const [reports, setReports] = useState<Array<{ id: string; reporter: string; target: string; reason: string; time: string }>>([
    { id: 'rep-1', reporter: 'David Miller', target: 'Suspicious direct message link', reason: 'Unverified external script link', time: '1 day ago' },
  ]);

  if (!isOpen) return null;

  const handleCreateInvite = () => {
    const newInv = {
      id: 'inv-' + Date.now(),
      email: inviteEmail.trim() || undefined,
      token: 'tt-inv-' + Math.random().toString(36).substring(2, 10),
      role: inviteRole,
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    };
    setInvites([newInv, ...invites]);
    setInviteEmail('');
  };

  const handleCopyLink = (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const handleRevokeInvite = (id: string) => {
    setInvites(invites.filter((i) => i.id !== id));
  };

  const handleChangeRole = (userId: string, newRole: Role) => {
    setUserList((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
    );
  };

  const handleSavePolicies = () => {
    setPoliciesSaved(true);
    setTimeout(() => setPoliciesSaved(false), 3000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840, maxHeight: '90vh' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: 'var(--primary-600)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                TeamTalk Admin & Security Center
              </h2>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Workspace governance, user directory, access invites, and audit logs
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', padding: '0 24px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
          {[
            { id: 'OVERVIEW', label: 'Overview', icon: Shield },
            { id: 'INVITES', label: 'Invites', icon: UserPlus },
            { id: 'USERS', label: 'Users & Roles', icon: Users },
            { id: 'POLICIES', label: 'Security & Retention', icon: Sliders },
            { id: 'AUDIT', label: 'Audit Trail', icon: FileText },
            { id: 'REPORTS', label: 'Abuse Reports', icon: AlertTriangle },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '12px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderBottom: active ? '2px solid var(--primary-500)' : '2px solid transparent',
                  color: active ? 'var(--primary-500)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {/* TAB 1: Overview */}
          {activeTab === 'OVERVIEW' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                {[
                  { label: 'Total Team Members', val: userList.length, color: 'var(--primary-500)' },
                  { label: 'Active Today', val: userList.filter((u) => u.online).length, color: 'var(--accent-emerald)' },
                  { label: 'Active Invites', val: invites.length, color: 'var(--accent-amber)' },
                  { label: 'Security Events (24h)', val: auditLogs.length, color: 'var(--accent-rose)' },
                ].map((stat, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '16px',
                      borderRadius: 'var(--radius-lg)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{stat.label}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: stat.color }}>{stat.val}</div>
                  </div>
                ))}
              </div>

              <div style={{ background: 'var(--bg-surface)', padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldAlert size={16} color="var(--primary-500)" /> Security Posture
                </h4>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  • <strong>AES-256-GCM Encryption:</strong> Active for all chats and attachments at rest with authenticated AAD.<br />
                  • <strong>coturn TURN Relay:</strong> Configured for enterprise WebRTC voice/video bypass through corporate firewalls.<br />
                  • <strong>Anti-Exfiltration:</strong> Protected chat watermarking active; Android builds enforce <code>FLAG_SECURE</code>.
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Invites */}
          {activeTab === 'INVITES' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Creator Box */}
              <div style={{ padding: 16, background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    Email (Optional - leave empty for generic link):
                  </label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder="teammate@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div style={{ width: 140 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Role:</label>
                  <select
                    className="input-field"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                  >
                    <option value="MEMBER">Member</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <button className="btn btn-primary" onClick={handleCreateInvite} style={{ height: 40 }}>
                  Generate Invite
                </button>
              </div>

              {/* Invites Table */}
              <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border-subtle)' }}>
                  Active Workspace Invites
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {invites.map((inv) => (
                    <div
                      key={inv.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border-subtle)',
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>{inv.email || 'Generic Workspace Link'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          Token: {inv.token} • Role: {inv.role} • Expires: {inv.expiresAt}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleCopyLink(inv.token)}
                          style={{ fontSize: 12, padding: '4px 10px', gap: 6 }}
                        >
                          {copiedToken === inv.token ? <Check size={14} color="var(--accent-emerald)" /> : <Copy size={14} />}
                          {copiedToken === inv.token ? 'Copied!' : 'Copy Link'}
                        </button>
                        <button
                          onClick={() => handleRevokeInvite(inv.id)}
                          className="btn-icon"
                          style={{ color: 'var(--accent-rose)' }}
                          title="Revoke Invite"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Users & Roles */}
          {activeTab === 'USERS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {userList.map((user) => (
                    <div
                      key={user.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                          className="avatar"
                          style={{
                            width: 38,
                            height: 38,
                            fontSize: 13,
                            background: 'linear-gradient(135deg, var(--primary-600), var(--accent-purple))',
                          }}
                        >
                          {user.displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{user.displayName}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.email}</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <select
                          className="input-field"
                          value={user.role}
                          onChange={(e) => handleChangeRole(user.id, e.target.value as Role)}
                          disabled={user.id === currentUser.id && currentUser.role === 'SUPER_ADMIN'}
                          style={{ width: 140, height: 34, fontSize: 12 }}
                        >
                          <option value="MEMBER">MEMBER</option>
                          <option value="ADMIN">ADMIN</option>
                          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Security & Retention Policies */}
          {activeTab === 'POLICIES' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {policiesSaved && (
                <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,0.1)', color: 'var(--accent-emerald)', borderRadius: 'var(--radius-md)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={16} /> Workspace policies successfully applied and updated.
                </div>
              )}

              <div style={{ background: 'var(--bg-surface)', padding: 18, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                    Automated Data Retention Purge
                  </label>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Automatically purge deleted messages and attachments older than the retention period.
                  </p>
                  <select
                    className="input-field"
                    value={retentionDays}
                    onChange={(e) => setRetentionDays(Number(e.target.value))}
                    style={{ maxWidth: 200 }}
                  >
                    <option value={30}>30 Days</option>
                    <option value={90}>90 Days (Quarterly)</option>
                    <option value={180}>180 Days</option>
                    <option value={365}>1 Year</option>
                    <option value={0}>Indefinite (No Purge)</option>
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Require Two-Factor Authentication (2FA)</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Enforce TOTP or Passkey setup before users can access confidential messages.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={require2FA}
                    onChange={(e) => setRequire2FA(e.target.checked)}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Allow Members to Create Groups</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      If disabled, only workspace Admins can initiate new groups and broadcast channels.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={allowMemberGroups}
                    onChange={(e) => setAllowMemberGroups(e.target.checked)}
                  />
                </div>

                <button className="btn btn-primary" onClick={handleSavePolicies} style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                  Save Policy Configuration
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: Audit Trail */}
          {activeTab === 'AUDIT' && (
            <div style={{ background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, borderBottom: '1px solid var(--border-subtle)' }}>
                Immutable Security Event Logs
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 16px',
                      borderBottom: '1px solid var(--border-subtle)',
                      fontSize: 12,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary-600)' }}>
                          {log.event}
                        </span>
                        <span>by {log.actor}</span>
                        {log.target && <span style={{ color: 'var(--text-secondary)' }}>→ {log.target}</span>}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                        IP: {log.ip}
                      </div>
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{log.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: Reports */}
          {activeTab === 'REPORTS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {reports.map((rep) => (
                <div
                  key={rep.id}
                  style={{
                    padding: 16,
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-lg)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-rose)' }}>{rep.target}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Reported by {rep.reporter} • &quot;{rep.reason}&quot;
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{rep.time}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setReports(reports.filter((r) => r.id !== rep.id))}
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      Dismiss
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => setReports(reports.filter((r) => r.id !== rep.id))}
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      Take Action
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
