import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Eye,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Image as ImageIcon,
  Send,
  Trash2,
  Camera,
  Edit3,
} from 'lucide-react';
import { StatusGroup, StatusItem, User } from '../types';

interface StatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  statusGroups: StatusGroup[];
  onAddStatus: (status: { kind: 'TEXT' | 'IMAGE' | 'VIDEO'; body: string; background?: string; mediaUrl?: string }) => void;
  onDeleteStatus?: (statusId: string) => void;
  onStoryActiveChange?: (active: boolean) => void;
  requestExitStoryRef?: React.MutableRefObject<(() => boolean) | null>;
  slideDirection?: 'left' | 'right';
  isTab?: boolean;
}

const GRADIENTS = [
  'linear-gradient(135deg, #6366f1, #a855f7)',
  'linear-gradient(135deg, #06b6d4, #3b82f6)',
  'linear-gradient(135deg, #10b981, #059669)',
  'linear-gradient(135deg, #f43f5e, #f97316)',
  'linear-gradient(135deg, #8b5cf6, #ec4899)',
  'linear-gradient(135deg, #0f172a, #334155)',
];

export const StatusModal: React.FC<StatusModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  statusGroups,
  onAddStatus,
  onDeleteStatus,
  onStoryActiveChange,
  requestExitStoryRef,
  slideDirection = 'right',
  isTab = false,
}) => {
  if (!isTab && !isOpen) return null;
  const [mode, setMode] = useState<'LIST' | 'VIEW' | 'CREATE'>('LIST');
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    onStoryActiveChange?.(mode === 'VIEW');
  }, [mode, onStoryActiveChange]);

  useEffect(() => {
    if (requestExitStoryRef) {
      requestExitStoryRef.current = () => {
        if (mode === 'VIEW' || mode === 'CREATE') {
          setMode('LIST');
          return true;
        }
        return false;
      };
    }
    return () => {
      if (requestExitStoryRef) requestExitStoryRef.current = null;
    };
  }, [mode, requestExitStoryRef]);

  // Status Creator State
  const [createKind, setCreateKind] = useState<'TEXT' | 'IMAGE'>('TEXT');
  const [textBody, setTextBody] = useState('');
  const [selectedGradient, setSelectedGradient] = useState(GRADIENTS[0]);
  const [imageFileUrl, setImageFileUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  const activeGroup = statusGroups[activeGroupIndex];
  const activeItem = activeGroup?.updates[activeItemIndex];

  // Story progress timer
  useEffect(() => {
    if (mode !== 'VIEW' || !activeItem || isPaused) return;

    setProgress(0);
    const interval = 50; // update every 50ms
    const totalDuration = 5000; // 5 seconds per story
    const step = (interval / totalDuration) * 100;

    progressTimerRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          handleNextSlide();
          return 0;
        }
        return prev + step;
      });
    }, interval);

    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [mode, activeGroupIndex, activeItemIndex, isPaused]);

  if (!isOpen) return null;

  const handleNextSlide = () => {
    if (!activeGroup) return;
    if (activeItemIndex < activeGroup.updates.length - 1) {
      setActiveItemIndex((prev) => prev + 1);
    } else if (activeGroupIndex < statusGroups.length - 1) {
      setActiveGroupIndex((prev) => prev + 1);
      setActiveItemIndex(0);
    } else {
      setMode('LIST');
    }
  };

  const handlePrevSlide = () => {
    if (activeItemIndex > 0) {
      setActiveItemIndex((prev) => prev - 1);
    } else if (activeGroupIndex > 0) {
      setActiveGroupIndex((prev) => prev - 1);
      setActiveItemIndex(statusGroups[activeGroupIndex - 1].updates.length - 1);
    }
  };

  const handleCreateSubmit = () => {
    if (createKind === 'TEXT' && !textBody.trim()) return;
    if (createKind === 'IMAGE' && !imageFileUrl) return;

    onAddStatus({
      kind: createKind,
      body: textBody.trim(),
      background: createKind === 'TEXT' ? selectedGradient : undefined,
      mediaUrl: createKind === 'IMAGE' ? (imageFileUrl || undefined) : undefined,
    });

    setMode('LIST');
    setTextBody('');
    setImageFileUrl(null);
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setImageFileUrl(reader.result as string);
        setCreateKind('IMAGE');
      };
      reader.readAsDataURL(file);
    }
  };

  if (isTab && mode === 'LIST') {
    return (
      <div
        className="tab-page-wrapper"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-app)',
          boxSizing: 'border-box',
        }}
      >
        {/* Header */}
        <div className="panel-header" style={{ paddingLeft: 16, paddingRight: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>
            Updates
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn-icon"
              onClick={() => { setCreateKind('IMAGE'); setMode('CREATE'); }}
              title="Add photo update"
              style={{
                background: 'rgba(0, 168, 132, 0.15)',
                color: '#00a884',
                width: 36,
                height: 36,
                borderRadius: '50%',
              }}
            >
              <Camera size={18} />
            </button>
            <button
              className="btn-icon"
              onClick={() => { setCreateKind('TEXT'); setMode('CREATE'); }}
              title="Add text update"
              style={{ width: 36, height: 36, color: 'var(--text-secondary)' }}
            >
              <Edit3 size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px calc(80px + var(--safe-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* My Status Card */}
          {(() => {
            const myGroup = statusGroups.find((g) => g.mine);
            return (
              <div
                onClick={() => {
                  if (myGroup && myGroup.updates.length > 0) {
                    const idx = statusGroups.findIndex((g) => g.mine);
                    setActiveGroupIndex(idx);
                    setActiveItemIndex(0);
                    setMode('VIEW');
                  } else {
                    setMode('CREATE');
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 14px',
                  borderRadius: 14,
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ position: 'relative' }}>
                  <div
                    className="avatar"
                    style={{
                      width: 48,
                      height: 48,
                      background: 'linear-gradient(135deg, var(--primary-500), var(--accent-cyan))',
                      fontSize: 16,
                      border: myGroup?.updates.length ? '2px solid var(--primary-500)' : 'none',
                      overflow: 'hidden',
                    }}
                  >
                    {currentUser.avatarUrl ? (
                      <img src={currentUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      currentUser.displayName.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMode('CREATE');
                    }}
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--primary-500)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '2px solid var(--bg-surface-elevated)',
                    }}
                    title="Add update"
                  >
                    <Plus size={13} />
                  </button>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>My Status</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {myGroup && myGroup.updates.length > 0
                      ? `${myGroup.updates.length} updates active`
                      : 'Tap to share what you are working on'}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Team Updates List */}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>
            Recent Team Updates
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {statusGroups.filter((g) => !g.mine).length === 0 ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No recent team updates yet
              </div>
            ) : (
              statusGroups
                .filter((g) => !g.mine)
                .map((group) => (
                  <div
                    key={group.user.id}
                    onClick={() => {
                      const realIdx = statusGroups.indexOf(group);
                      setActiveGroupIndex(realIdx);
                      setActiveItemIndex(0);
                      setMode('VIEW');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      className="avatar"
                      style={{
                        width: 44,
                        height: 44,
                        fontSize: 14,
                        background: 'linear-gradient(135deg, var(--accent-purple), var(--primary-500))',
                        border: '2px solid var(--primary-500)',
                        overflow: 'hidden',
                      }}
                    >
                      {group.user.avatarFileId ? (
                        <img src={group.user.avatarFileId} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        group.user.displayName.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {group.user.displayName}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {group.updates.length} {group.updates.length === 1 ? 'update' : 'updates'} •{' '}
                        {new Date(group.updates[group.updates.length - 1].createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`modal-overlay ${mode === 'VIEW' ? 'fullscreen-story-overlay' : slideDirection === 'left' ? 'slide-left' : 'slide-right'}`}
      onClick={onClose}
      style={mode === 'VIEW' ? { paddingBottom: 0, zIndex: 10002 } : undefined}
    >
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: mode === 'VIEW' ? 440 : 540,
          height: mode === 'VIEW' ? '85vh' : 'auto',
          maxHeight: '90vh',
          background: mode === 'VIEW' ? '#000000' : 'var(--bg-surface-elevated)',
        }}
      >
        {/* VIEW MODE: Story Viewer */}
        {mode === 'VIEW' && activeGroup && activeItem ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              userSelect: 'none',
            }}
            onMouseDown={() => setIsPaused(true)}
            onMouseUp={() => setIsPaused(false)}
            onTouchStart={() => setIsPaused(true)}
            onTouchEnd={() => setIsPaused(false)}
          >
            {/* Top Progress Segments */}
            <div
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                right: 12,
                display: 'flex',
                gap: 4,
                zIndex: 20,
              }}
            >
              {activeGroup.updates.map((_, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    height: 3,
                    background: 'rgba(255, 255, 255, 0.3)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      background: '#ffffff',
                      width:
                        idx < activeItemIndex
                          ? '100%'
                          : idx === activeItemIndex
                          ? `${progress}%`
                          : '0%',
                    }}
                  />
                </div>
              ))}
            </div>

            {/* Story Header */}
            <div
              style={{
                position: 'absolute',
                top: 24,
                left: 16,
                right: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: '#ffffff',
                zIndex: 20,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  className="avatar"
                  style={{
                    width: 36,
                    height: 36,
                    fontSize: 13,
                    background: 'linear-gradient(135deg, var(--primary-500), var(--accent-purple))',
                    overflow: 'hidden',
                  }}
                >
                  {activeGroup.user.avatarFileId ? (
                    <img src={activeGroup.user.avatarFileId} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    activeGroup.user.displayName.slice(0, 2).toUpperCase()
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {activeGroup.mine ? 'My Status' : activeGroup.user.displayName}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>
                    {new Date(activeItem.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {activeGroup.mine && onDeleteStatus && (
                  <button
                    onClick={() => onDeleteStatus(activeItem.id)}
                    className="btn-icon"
                    style={{ color: '#fff' }}
                    title="Delete status"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
                <button onClick={() => setMode('LIST')} className="btn-icon" style={{ color: '#fff' }}>
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Main Story Content */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: activeItem.background || '#0f172a',
                padding: 32,
                position: 'relative',
              }}
            >
              {activeItem.kind === 'TEXT' ? (
                <div
                  style={{
                    color: '#ffffff',
                    fontSize: 24,
                    fontWeight: 700,
                    textAlign: 'center',
                    lineHeight: 1.4,
                    wordBreak: 'break-word',
                  }}
                >
                  {activeItem.body}
                </div>
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={activeItem.mediaUrl || (activeItem.body?.startsWith('data:') ? activeItem.body : null) || imageFileUrl || 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=600&q=80'}
                    alt="Status media"
                    style={{ maxWidth: '100%', maxHeight: '70%', objectFit: 'contain', borderRadius: 8 }}
                  />
                  {activeItem.body && !activeItem.body.startsWith('data:') && (
                    <div style={{ color: '#ffffff', fontSize: 15, marginTop: 14, textAlign: 'center' }}>
                      {activeItem.body}
                    </div>
                  )}
                </div>
              )}

              {/* Click zones for Previous / Next slide */}
              <div
                onClick={handlePrevSlide}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 60,
                  bottom: 60,
                  width: '30%',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
              />
              <div
                onClick={handleNextSlide}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 60,
                  bottom: 60,
                  width: '70%',
                  cursor: 'pointer',
                  zIndex: 10,
                }}
              />
            </div>

            {/* Viewer Count / Footer */}
            {activeGroup.mine && (
              <div
                style={{
                  padding: '12px 16px',
                  background: 'rgba(0, 0, 0, 0.6)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  zIndex: 20,
                }}
              >
                <Eye size={16} /> Viewed by {activeItem.viewCount || 0} team members
              </div>
            )}
          </div>
        ) : mode === 'CREATE' ? (
          /* CREATE MODE: Status Creator */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} color="var(--primary-500)" /> Create Status Update
              </h3>
              <button className="btn-icon" onClick={() => setMode('LIST')}>
                <X size={16} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Type Switcher */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setCreateKind('TEXT')}
                  className={`btn ${createKind === 'TEXT' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, fontSize: 13 }}
                >
                  Text Status
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`btn ${createKind === 'IMAGE' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1, fontSize: 13, gap: 6 }}
                >
                  <ImageIcon size={15} /> Photo / Video
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                  accept="image/*,video/*"
                  style={{ display: 'none' }}
                />
              </div>

              {/* Preview Canvas */}
              <div
                style={{
                  height: 200,
                  borderRadius: 'var(--radius-lg)',
                  background: createKind === 'TEXT' ? selectedGradient : '#0f172a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {createKind === 'TEXT' ? (
                  <textarea
                    placeholder="Type a team status..."
                    value={textBody}
                    onChange={(e) => setTextBody(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#ffffff',
                      fontSize: 18,
                      fontWeight: 700,
                      textAlign: 'center',
                      resize: 'none',
                    }}
                    rows={4}
                    maxLength={140}
                  />
                ) : (
                  <img
                    src={imageFileUrl || ''}
                    alt="Preview"
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                )}
              </div>

              {/* Gradient selector for text status */}
              {createKind === 'TEXT' && (
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    Background Gradient:
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {GRADIENTS.map((grad, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedGradient(grad)}
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: '50%',
                          background: grad,
                          border: selectedGradient === grad ? '2px solid #fff' : '2px solid transparent',
                          boxShadow: selectedGradient === grad ? '0 0 0 2px var(--primary-500)' : 'none',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {createKind === 'IMAGE' && (
                <input
                  type="text"
                  className="input-field"
                  placeholder="Add a caption..."
                  value={textBody}
                  onChange={(e) => setTextBody(e.target.value)}
                />
              )}
            </div>

            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => setMode('LIST')}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateSubmit} disabled={!textBody.trim() && !imageFileUrl}>
                <Send size={15} /> Share Update (24h)
              </button>
            </div>
          </div>
        ) : (
          /* LIST MODE: Status Hub */
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Team Status Updates</h3>
              <button className="btn-icon" onClick={onClose}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* My Status Card */}
              {(() => {
                const myGroup = statusGroups.find((g) => g.mine);
                return (
                  <div
                    onClick={() => {
                      if (myGroup && myGroup.updates.length > 0) {
                        const idx = statusGroups.findIndex((g) => g.mine);
                        setActiveGroupIndex(idx);
                        setActiveItemIndex(0);
                        setMode('VIEW');
                      } else {
                        setMode('CREATE');
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-lg)',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ position: 'relative' }}>
                      <div
                        className="avatar"
                        style={{
                          width: 48,
                          height: 48,
                          background: 'linear-gradient(135deg, var(--primary-500), var(--accent-cyan))',
                          fontSize: 16,
                          border: myGroup?.updates.length ? '2px solid var(--primary-500)' : 'none',
                          overflow: 'hidden',
                        }}
                      >
                        {currentUser.avatarUrl ? (
                          <img src={currentUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          currentUser.displayName.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMode('CREATE');
                        }}
                        style={{
                          position: 'absolute',
                          bottom: -2,
                          right: -2,
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          background: 'var(--primary-500)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: '2px solid var(--bg-surface)',
                        }}
                        title="Add update"
                      >
                        <Plus size={13} />
                      </button>
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>My Status</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {myGroup && myGroup.updates.length > 0
                          ? `${myGroup.updates.length} updates active`
                          : 'Tap to share what you are working on'}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Team Updates List */}
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>
                Recent Team Updates
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
                {statusGroups.filter((g) => !g.mine).length === 0 ? (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    No recent team updates yet
                  </div>
                ) : (
                  statusGroups
                    .filter((g) => !g.mine)
                    .map((group, idx) => (
                      <div
                        key={group.user.id}
                        onClick={() => {
                          const realIdx = statusGroups.indexOf(group);
                          setActiveGroupIndex(realIdx);
                          setActiveItemIndex(0);
                          setMode('VIEW');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '8px 10px',
                          borderRadius: 'var(--radius-md)',
                          background: 'var(--bg-surface)',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          className="avatar"
                          style={{
                            width: 42,
                            height: 42,
                            fontSize: 14,
                            background: 'linear-gradient(135deg, var(--accent-purple), var(--primary-500))',
                            border: '2px solid var(--primary-500)',
                          }}
                        >
                          {group.user.displayName.slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {group.user.displayName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {group.updates.length} {group.updates.length === 1 ? 'update' : 'updates'} •{' '}
                            {new Date(group.updates[group.updates.length - 1].createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
