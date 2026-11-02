import React, { useState, useEffect } from 'react';
import {
  Phone,
  Video,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  PhoneOff,
  Search,
  X,
  UserPlus,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
} from 'lucide-react';
import { User, CallHistoryItem, ActiveCallState } from '../types';
import { api } from '../services/api';

interface CallsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  activeCall: ActiveCallState | null;
  onStartCall: (kind: 'AUDIO' | 'VIDEO', targetUser: { id: string; displayName: string }) => void;
  onReturnToActiveCall: () => void;
  onEndActiveCall: () => void;
  onOpenNewChat: () => void;
  slideDirection?: 'left' | 'right';
  isTab?: boolean;
}

export const CallsModal: React.FC<CallsModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  activeCall,
  onStartCall,
  onReturnToActiveCall,
  onEndActiveCall,
  onOpenNewChat,
  slideDirection = 'right',
  isTab = false,
}) => {
  if (!isTab && !isOpen) return null;
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const res = await api.getCallHistory();
      if (res?.calls) {
        setCalls(res.calls);
      }
    } catch (err) {
      console.warn('[Calls] Failed to load call history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatCallDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      const now = new Date();
      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (isToday) return `Today, ${timeStr}`;

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        d.getDate() === yesterday.getDate() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getFullYear() === yesterday.getFullYear();

      if (isYesterday) return `Yesterday, ${timeStr}`;
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
    } catch {
      return 'Recent';
    }
  };

  const formatDuration = (sec: number) => {
    if (!sec || sec <= 0) return '';
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    if (mins > 0) return `(${mins}m ${secs}s)`;
    return `(${secs}s)`;
  };

  const filteredCalls = calls.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const name = c.peer?.displayName || c.peerName || 'Team Member';
    return name.toLowerCase().includes(q);
  });

  const content = (
    <div
      className={isTab ? "tab-page-wrapper" : "modal-content"}
      onClick={(e) => e.stopPropagation()}
      style={isTab ? {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-app)',
        boxSizing: 'border-box',
      } : {
        maxWidth: 480,
        height: '85vh',
        maxHeight: 650,
        background: '#111b21',
        color: '#e9edef',
        borderRadius: 16,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Header */}
      <div
        className={isTab ? "panel-header" : undefined}
        style={isTab ? {
          paddingLeft: 16,
          paddingRight: 16,
        } : {
          padding: '14px 18px',
          background: '#202c33',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>Calls</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className="btn-icon"
            onClick={onOpenNewChat}
            title="Start New Call"
            style={{
              background: 'rgba(0, 168, 132, 0.15)',
              color: '#00a884',
              width: 36,
              height: 36,
              borderRadius: '50%',
            }}
          >
            <UserPlus size={18} />
          </button>
          {!isTab && (
            <button
              className="btn-icon"
              onClick={onClose}
              title="Close"
              style={{ width: 36, height: 36, color: '#8696a0' }}
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

        {/* Search Bar */}
        <div style={{ padding: '10px 16px', background: '#111b21' }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} color="#8696a0" style={{ position: 'absolute', left: 12, top: 10 }} />
            <input
              type="text"
              placeholder="Search call logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                height: 36,
                paddingLeft: 36,
                paddingRight: 12,
                background: '#202c33',
                border: 'none',
                borderRadius: 8,
                color: '#e9edef',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Ongoing Active Call Alert Banner */}
        {activeCall && (
          <div
            style={{
              margin: '8px 16px',
              padding: '10px 14px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.25))',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div
              onClick={onReturnToActiveCall}
              style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 10px #10b981',
                  animation: 'pulseGlow 1.5s infinite',
                }}
              />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981' }}>
                  {activeCall.status === 'RINGING' ? 'Call Ringing...' : 'Call In Progress'}
                </div>
                <div style={{ fontSize: 11, color: '#8696a0' }}>
                  With {activeCall.peer?.displayName || 'Team Member'} • Tap to open
                </div>
              </div>
            </div>

            <button
              onClick={onEndActiveCall}
              style={{
                background: '#ef4444',
                color: '#ffffff',
                border: 'none',
                padding: '6px 12px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <PhoneOff size={14} />
              End
            </button>
          </div>
        )}

        {/* Call Logs List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', paddingBottom: isTab ? 'calc(80px + var(--safe-bottom, 0px))' : 16 }}>
          <div style={{ padding: '6px 18px', fontSize: 12, fontWeight: 700, color: '#8696a0' }}>
            RECENT CALLS
          </div>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#8696a0', fontSize: 13 }}>
              Loading call history...
            </div>
          ) : filteredCalls.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '50px 20px', color: '#8696a0' }}>
              <Phone size={36} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: '#e9edef', marginBottom: 6 }}>
                No recent calls
              </div>
              <div style={{ fontSize: 12, maxWidth: 280, margin: '0 auto', lineHeight: 1.5 }}>
                Tap the call icon or open a chat to start an instant voice or video call with your teammates.
              </div>
              <button
                onClick={onOpenNewChat}
                style={{
                  marginTop: 18,
                  padding: '8px 18px',
                  borderRadius: 20,
                  background: '#00a884',
                  color: '#ffffff',
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Start a Call
              </button>
            </div>
          ) : (
            filteredCalls.map((call) => {
              const peerName = call.peer?.displayName || call.peerName || 'Team Member';
              const isMissed = call.missed;
              const isOutgoing = call.direction === 'outgoing';

              return (
                <div
                  key={call.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 18px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  className="call-log-row"
                >
                  {/* Left: Avatar + Details */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #374151, #1f2937)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 15,
                        fontWeight: 700,
                        color: '#ffffff',
                        flexShrink: 0,
                      }}
                    >
                      {peerName.slice(0, 2).toUpperCase()}
                    </div>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: isMissed ? '#f15c6d' : '#e9edef',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {peerName}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 12,
                          color: '#8696a0',
                          marginTop: 2,
                        }}
                      >
                        {/* Call direction arrow */}
                        {isOutgoing ? (
                          <ArrowUpRight size={14} color="#00a884" />
                        ) : isMissed ? (
                          <ArrowDownLeft size={14} color="#f15c6d" />
                        ) : (
                          <ArrowDownLeft size={14} color="#00a884" />
                        )}

                        <span>
                          {isMissed ? 'Missed' : isOutgoing ? 'Outgoing' : 'Incoming'} •{' '}
                          {formatCallDate(call.createdAt)} {formatDuration(call.durationSec)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Quick Call Back Buttons */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() =>
                        onStartCall('AUDIO', {
                          id: call.peer?.id || call.peerId || '',
                          displayName: peerName,
                        })
                      }
                      title="Audio Call"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#00a884',
                        cursor: 'pointer',
                        padding: 8,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Phone size={19} />
                    </button>

                    <button
                      onClick={() =>
                        onStartCall('VIDEO', {
                          id: call.peer?.id || call.peerId || '',
                          displayName: peerName,
                        })
                      }
                      title="Video Call"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#00a884',
                        cursor: 'pointer',
                        padding: 8,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Video size={19} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );

  if (isTab) {
    return content;
  }

  return (
    <div
      className={`modal-overlay ${slideDirection === 'left' ? 'slide-left' : 'slide-right'}`}
      onClick={onClose}
      style={{ zIndex: 65 }}
    >
      {content}
    </div>
  );
};

