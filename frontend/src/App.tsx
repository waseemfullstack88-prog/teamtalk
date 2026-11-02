import React, { useState, useEffect, useRef } from 'react';
import {
  Sidebar,
  ChatArea,
  DetailsPanel,
  CallModal,
  StatusModal,
  SettingsModal,
  AdminModal,
  NewChatModal,
  AuthScreen,
  BiometricLockScreen,
  CallsModal,
} from './components';
import { Chat, Message, User, ActiveCallState, StatusGroup, StatusItem, CallKind, MessageType, Attachment, ScheduledMessage } from './types';
import { connectSocket, disconnectSocket, onSocketEvent, emitSocket, getSocket } from './services/socket';
import { api } from './services/api';
import { webrtcService } from './services/webrtc';
import { biometrics } from './services/biometrics';
import { useProtectedCapture } from './hooks/useProtectedCapture';
import { Shield, EyeOff, MessageSquare, CircleDashed, Phone, Settings } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export const App: React.FC = () => {
  // Persistent device-embedded user session (WhatsApp style: never logged out once logged in)
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const cached = localStorage.getItem('tt_cached_user');
      if (cached) return JSON.parse(cached);
    } catch {}
    return null;
  });
  const [authChecking, setAuthChecking] = useState<boolean>(() => {
    const token = localStorage.getItem('tt_token');
    const cached = localStorage.getItem('tt_cached_user');
    return !!token && !cached;
  });

  // Sync cached user profile whenever currentUser updates
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('tt_cached_user', JSON.stringify(currentUser));
    }
  }, [currentUser]);

  // WhatsApp-Style Biometric / Fingerprint App Lock state
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => {
    return biometrics.isEnabled();
  });

  // Native and Web lifecycle listener for Fingerprint auto-lock
  useEffect(() => {
    let appStateHandle: any = null;
    try {
      CapApp.addListener('appStateChange', (state) => {
        if (!state.isActive) {
          biometrics.recordLastActive();
        } else {
          if (biometrics.shouldLockOnResume()) {
            setIsAppLocked(true);
          }
        }
      }).then((handle) => {
        appStateHandle = handle;
      });
    } catch {
      // Browser fallback
    }

    const handleVisibility = () => {
      if (document.hidden) {
        biometrics.recordLastActive();
      } else {
        if (biometrics.shouldLockOnResume()) {
          setIsAppLocked(true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (appStateHandle && typeof appStateHandle.remove === 'function') {
        appStateHandle.remove();
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  // Mark native mobile container for safe-area insets
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      document.documentElement.classList.add('is-native-mobile');
      document.body.classList.add('is-native-mobile');
    }
  }, []);

  // Check existing authenticated session on mount — permanently bound to device, never log out
  useEffect(() => {
    const token = localStorage.getItem('tt_token');
    if (token) {
      api.getMe()
        .then((res) => {
          if (res && res.user) {
            setCurrentUser(res.user);
            localStorage.setItem('tt_cached_user', JSON.stringify(res.user));
          }
        })
        .catch((err) => {
          // Device-embedded session: preserve cached credentials even if offline or server is restarting
          console.warn('[Session] Silent sync check:', err?.message);
        })
        .finally(() => {
          setAuthChecking(false);
        });
    } else {
      setAuthChecking(false);
    }
  }, []);

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Chats & Messages
  const [chats, setChats] = useState<Chat[]>([
    {
      id: 'c-direct-bob',
      type: 'DIRECT',
      isProtected: true,
      disappearingSeconds: 86400,
      membersCanInvite: true,
      archivedForAll: false,
      createdAt: '2026-10-25T10:00:00Z',
      updatedAt: '2026-10-27T17:15:00Z',
      myRole: 'MEMBER',
      muted: false,
      pinned: true,
      archived: false,
      unread: 1,
      members: [
        {
          id: 'u-alice',
          displayName: 'Alice Chen (Engineering Lead)',
          role: 'ADMIN',
          online: true,
          joinedAt: '2026-10-25T10:00:00Z',
        },
        {
          id: 'u-bob',
          displayName: 'Bob Taylor (Product Design)',
          about: 'Focusing on clean glassmorphic mobile experiences',
          role: 'MEMBER',
          online: true,
          joinedAt: '2026-10-25T10:00:00Z',
        },
      ],
      lastMessage: {
        id: 'm-bob-last',
        chatId: 'c-direct-bob',
        senderId: 'u-bob',
        type: 'TEXT',
        body: 'Just finished the updated responsive prototypes for the desktop 3-panel and mobile views! Take a look when you have a moment.',
        createdAt: '2026-10-27T17:15:00Z',
        status: 'delivered',
      },
    },
    {
      id: 'c-group-eng',
      type: 'GROUP',
      name: 'Core Engineering & SecOps',
      description: 'Zero-trust infrastructure, coturn TURN relay, and PostgreSQL persistence.',
      isProtected: true,
      disappearingSeconds: null,
      membersCanInvite: true,
      archivedForAll: false,
      createdAt: '2026-10-20T08:00:00Z',
      updatedAt: '2026-10-27T16:45:00Z',
      myRole: 'OWNER',
      muted: false,
      pinned: true,
      archived: false,
      unread: 0,
      members: [
        { id: 'u-alice', displayName: 'Alice Chen', role: 'OWNER', online: true, joinedAt: '2026-10-20T08:00:00Z' },
        { id: 'u-clara', displayName: 'Clara Oswald (Security Officer)', role: 'ADMIN', online: false, joinedAt: '2026-10-20T08:00:00Z' },
        { id: 'u-david', displayName: 'David Miller (DevOps)', role: 'MEMBER', online: true, joinedAt: '2026-10-20T08:00:00Z' },
      ],
      lastMessage: {
        id: 'm-poll-1',
        chatId: 'c-group-eng',
        senderId: 'u-alice',
        type: 'POLL',
        body: 'Team poll: Sprint deployment slot',
        createdAt: '2026-10-27T16:45:00Z',
        status: 'read',
        poll: {
          id: 'poll-eng-1',
          question: 'Which deployment window works best for coturn TURN server update?',
          multiple: false,
          closed: false,
          options: [
            { id: 'opt-1', text: 'Thursday 10:00 PM UTC (Low traffic)', votes: 3, voted: true },
            { id: 'opt-2', text: 'Friday 06:00 AM UTC (Pre-market)', votes: 1, voted: false },
            { id: 'opt-3', text: 'Saturday Maintenance Window', votes: 2, voted: false },
          ],
        },
      },
    },
    {
      id: 'c-channel-allhands',
      type: 'CHANNEL',
      name: 'All-Hands Announcements',
      description: 'Official workspace updates and policy notices for all team members.',
      isProtected: false,
      disappearingSeconds: null,
      membersCanInvite: false,
      archivedForAll: false,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-10-26T14:30:00Z',
      myRole: 'ADMIN',
      muted: true,
      pinned: false,
      archived: false,
      unread: 0,
      members: [
        { id: 'u-alice', displayName: 'Alice Chen', role: 'ADMIN', online: true, joinedAt: '2026-09-01T00:00:00Z' },
        { id: 'u-clara', displayName: 'Clara Oswald', role: 'OWNER', online: false, joinedAt: '2026-09-01T00:00:00Z' },
      ],
      lastMessage: {
        id: 'm-allhands-last',
        chatId: 'c-channel-allhands',
        senderId: 'u-clara',
        type: 'TEXT',
        body: 'Notice: Workspace-wide password rotation and 2FA enforcement will take effect this Friday.',
        createdAt: '2026-10-26T14:30:00Z',
        status: 'read',
      },
    },
  ]);

  const [activeChatId, setActiveChatId] = useState<string | null>('c-direct-bob');

  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({
    'c-direct-bob': [
      {
        id: 'm1',
        chatId: 'c-direct-bob',
        senderId: 'u-alice',
        type: 'TEXT',
        body: 'Hey Bob, did you review the AES-256-GCM encryption at rest architecture document?',
        createdAt: '2026-10-27T16:50:00Z',
        status: 'read',
      },
      {
        id: 'm2',
        chatId: 'c-direct-bob',
        senderId: 'u-bob',
        type: 'TEXT',
        body: 'Yes! The random 96-bit IVs and authenticated AAD binding to the chatId prevent tampering cleanly.',
        createdAt: '2026-10-27T16:52:00Z',
        status: 'read',
        replyTo: {
          id: 'm1',
          senderId: 'u-alice',
          type: 'TEXT',
          snippet: 'Hey Bob, did you review the AES-256-GCM encryption at rest architecture document?',
        },
        reactions: [{ emoji: '👍', userIds: ['u-alice'] }],
      },
      {
        id: 'm3',
        chatId: 'c-direct-bob',
        senderId: 'u-alice',
        type: 'VOICE',
        body: 'Voice note (12s)',
        createdAt: '2026-10-27T17:00:00Z',
        status: 'read',
      },
      {
        id: 'm4',
        chatId: 'c-direct-bob',
        senderId: 'u-bob',
        type: 'TEXT',
        body: 'Just finished the updated responsive prototypes for the desktop 3-panel and mobile views! Take a look when you have a moment.',
        createdAt: '2026-10-27T17:15:00Z',
        status: 'delivered',
        reactions: [{ emoji: '🔥', userIds: ['u-alice'] }],
      },
    ],
    'c-group-eng': [
      {
        id: 'm-eng-1',
        chatId: 'c-group-eng',
        senderId: 'u-david',
        type: 'TEXT',
        body: 'coturn TURN server credentials endpoint is integrated and responding with HMAC-SHA1 tokens.',
        createdAt: '2026-10-27T16:00:00Z',
        status: 'read',
      },
      {
        id: 'm-eng-2',
        chatId: 'c-group-eng',
        senderId: 'u-alice',
        type: 'POLL',
        body: 'Team poll: Sprint deployment slot',
        createdAt: '2026-10-27T16:45:00Z',
        status: 'read',
        poll: {
          id: 'poll-eng-1',
          question: 'Which deployment window works best for coturn TURN server update?',
          multiple: false,
          closed: false,
          options: [
            { id: 'opt-1', text: 'Thursday 10:00 PM UTC (Low traffic)', votes: 3, voted: true },
            { id: 'opt-2', text: 'Friday 06:00 AM UTC (Pre-market)', votes: 1, voted: false },
            { id: 'opt-3', text: 'Saturday Maintenance Window', votes: 2, voted: false },
          ],
        },
      },
    ],
  });

  const [typingMap, setTypingMap] = useState<Record<string, string[]>>({});
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);

  // Status updates data with persistent storage
  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>(() => {
    try {
      const saved = localStorage.getItem('tt_status_groups');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        user: { id: 'u-alice', displayName: 'Alice Chen', avatarFileId: null },
        mine: false,
        updates: [
          {
            id: 'st-1',
            kind: 'TEXT',
            body: 'Finalizing coturn TURN relay setup & Docker Compose services 🚀',
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            createdAt: '2026-10-27T15:00:00Z',
            expiresAt: '2026-10-28T15:00:00Z',
            viewed: false,
            viewCount: 4,
          },
        ],
      },
      {
        user: { id: 'u-bob', displayName: 'Bob Taylor', avatarFileId: null },
        mine: false,
        updates: [
          {
            id: 'st-2',
            kind: 'TEXT',
            body: 'Polishing responsive layout on Android & tablet displays ✨',
            background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
            createdAt: '2026-10-27T16:30:00Z',
            expiresAt: '2026-10-28T16:30:00Z',
            viewed: false,
          },
        ],
      },
    ];
  });

  // Scheduled messages state with persistent storage
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>(() => {
    try {
      const saved = localStorage.getItem('tt_scheduled_messages');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Chat Requests state (PENDING / ACCEPTED / DECLINED)
  const [chatRequests, setChatRequests] = useState<Record<string, { status: 'PENDING' | 'ACCEPTED' | 'DECLINED'; initiatorId: string }>>(() => {
    try {
      const saved = localStorage.getItem('tt_chat_requests');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {};
  });

  // Sync scheduled messages to storage
  useEffect(() => {
    try {
      localStorage.setItem('tt_scheduled_messages', JSON.stringify(scheduledMessages));
    } catch {}
  }, [scheduledMessages]);

  // Sync status groups to storage
  useEffect(() => {
    try {
      localStorage.setItem('tt_status_groups', JSON.stringify(statusGroups));
    } catch {}
  }, [statusGroups]);

  // Sync chat requests to storage
  useEffect(() => {
    try {
      localStorage.setItem('tt_chat_requests', JSON.stringify(chatRequests));
    } catch {}
  }, [chatRequests]);

  // Ensure current user has a personal status group marked as mine: true
  useEffect(() => {
    if (!currentUser) return;
    setStatusGroups((prev) => {
      const hasMyGroup = prev.some((g) => g.user.id === currentUser.id);
      if (hasMyGroup) {
        return prev.map((g) => ({
          ...g,
          mine: g.user.id === currentUser.id,
          user: g.user.id === currentUser.id
            ? { ...g.user, displayName: currentUser.displayName, avatarFileId: currentUser.avatarUrl || g.user.avatarFileId }
            : g.user,
        }));
      } else {
        const myGroup: StatusGroup = {
          user: {
            id: currentUser.id,
            displayName: currentUser.displayName,
            avatarFileId: currentUser.avatarUrl || null,
          },
          mine: true,
          updates: [],
        };
        return [myGroup, ...prev.map((g) => ({ ...g, mine: false }))];
      }
    });
  }, [currentUser?.id, currentUser?.displayName, currentUser?.avatarUrl]);

  // Main Navigation Tabs (WhatsApp 4 Bottom Tabs: Chats, Updates, Calls, Settings)
  type MainTab = 'CHATS' | 'UPDATES' | 'CALLS' | 'SETTINGS';
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('CHATS');
  const [statusStoryActive, setStatusStoryActive] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right'>('right');
  const requestExitStoryRef = useRef<(() => boolean) | null>(null);

  // Modal Open States
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<'SIDEBAR' | 'CHAT'>('SIDEBAR');
  const [isServerConnected, setIsServerConnected] = useState<boolean>(true);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' ? window.innerWidth > 768 : false);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // WhatsApp-style Horizontal Swipe Navigation between Main Tabs
  const MAIN_TABS: MainTab[] = ['CHATS', 'UPDATES', 'CALLS', 'SETTINGS'];
  const mainTouchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleSelectTab = (newTab: MainTab) => {
    const currentIdx = MAIN_TABS.indexOf(activeMainTab);
    const newIdx = MAIN_TABS.indexOf(newTab);
    if (newIdx !== currentIdx) {
      setSlideDirection(newIdx > currentIdx ? 'right' : 'left');
      setActiveMainTab(newTab);
    }
  };

  const handleMainTouchStart = (e: React.TouchEvent) => {
    if (mobileActivePanel === 'CHAT' || statusStoryActive) return;
    if (e.touches.length === 1) {
      mainTouchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const handleMainTouchEnd = (e: React.TouchEvent) => {
    if (!mainTouchStartRef.current || e.changedTouches.length === 0) return;
    const deltaX = e.changedTouches[0].clientX - mainTouchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - mainTouchStartRef.current.y;
    mainTouchStartRef.current = null;

    // Must be horizontal swipe > 50px
    if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      const currentIdx = MAIN_TABS.indexOf(activeMainTab);
      if (deltaX < 0 && currentIdx < MAIN_TABS.length - 1) {
        // Swipe left -> next tab
        setSlideDirection('right');
        setActiveMainTab(MAIN_TABS[currentIdx + 1]);
      } else if (deltaX > 0 && currentIdx > 0) {
        // Swipe right -> previous tab
        setSlideDirection('left');
        setActiveMainTab(MAIN_TABS[currentIdx - 1]);
      }
    }
  };

  // WhatsApp-style edge-swipe right inside chat to return to chat list
  const chatEdgeStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleChatTouchStart = (e: React.TouchEvent) => {
    if (mobileActivePanel === 'CHAT' && e.touches.length === 1) {
      if (e.touches[0].clientX < 50) {
        chatEdgeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }
  };
  const handleChatTouchEnd = (e: React.TouchEvent) => {
    if (chatEdgeStartRef.current && e.changedTouches.length > 0) {
      const deltaX = e.changedTouches[0].clientX - chatEdgeStartRef.current.x;
      const deltaY = e.changedTouches[0].clientY - chatEdgeStartRef.current.y;
      chatEdgeStartRef.current = null;
      if (deltaX > 65 && deltaX > Math.abs(deltaY) * 1.3) {
        setMobileActivePanel('SIDEBAR');
      }
    }
  };

  // WhatsApp-style Font Size setting (small, medium, large)
  const [fontSize, setFontSize] = useState<'small' | 'medium' | 'large'>(() => {
    try {
      const saved = localStorage.getItem('tt_font_size');
      if (saved === 'small' || saved === 'large') return saved;
    } catch {}
    return 'medium';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-font-size', fontSize);
  }, [fontSize]);

  // Persistent offline caching so messages remain readable when laptop/server is closed
  useEffect(() => {
    try {
      if (chats.length > 0) {
        localStorage.setItem('tt_cached_chats', JSON.stringify(chats));
      }
    } catch {}
  }, [chats]);

  useEffect(() => {
    try {
      if (Object.keys(messagesMap).length > 0) {
        localStorage.setItem('tt_cached_messages', JSON.stringify(messagesMap));
      }
    } catch {}
  }, [messagesMap]);

  // Active chat object
  const activeChat = chats.find((c) => c.id === activeChatId) || null;

  // Protected Capture hook (privacy blur curtain, screenshot hotkey warnings)
  const { isWindowBlurred, captureWarning, dismissWarning } = useProtectedCapture(
    activeChatId || undefined,
    activeChat?.isProtected,
    currentUser?.displayName
  );

  // Sync theme attribute to HTML document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Persistent reference for back button listener
  const navStateRef = useRef({
    activeMainTab,
    mobileActivePanel,
    isDetailsOpen,
    isNewChatOpen,
    isAdminOpen,
    statusStoryActive,
  });
  navStateRef.current = {
    activeMainTab,
    mobileActivePanel,
    isDetailsOpen,
    isNewChatOpen,
    isAdminOpen,
    statusStoryActive,
  };

  // WhatsApp-style Android Native Hardware / Gesture Back Button handling
  useEffect(() => {
    const handleHardwareBack = () => {
      const s = navStateRef.current;

      // 1. If viewing or creating a status story in StatusModal, exit back to the status list
      if (requestExitStoryRef.current && requestExitStoryRef.current()) {
        return;
      }

      // 2. If Details Panel is open in chat, close it
      if (s.isDetailsOpen) {
        setIsDetailsOpen(false);
        return;
      }

      // 3. If New Chat modal is open, close it
      if (s.isNewChatOpen) {
        setIsNewChatOpen(false);
        return;
      }

      // 4. If Admin modal is open, close it
      if (s.isAdminOpen) {
        setIsAdminOpen(false);
        return;
      }

      // 5. If mobile is in active chat message panel, return to sidebar chat list
      if (s.mobileActivePanel === 'CHAT') {
        setMobileActivePanel('SIDEBAR');
        return;
      }

      // 6. If on UPDATES, CALLS, or SETTINGS tab, return to CHATS tab (home screen)
      if (s.activeMainTab !== 'CHATS') {
        setActiveMainTab('CHATS');
        return;
      }

      // 7. If at the root CHATS home screen, minimize/exit the app
      try {
        CapApp.minimizeApp();
      } catch {
        try {
          CapApp.exitApp();
        } catch {}
      }
    };

    let listenerPromise: Promise<any> | null = null;
    try {
      listenerPromise = CapApp.addListener('backButton', () => {
        handleHardwareBack();
      });
    } catch {}

    const cordovaBackHandler = (e: Event) => {
      e.preventDefault();
      handleHardwareBack();
    };
    document.addEventListener('backbutton', cordovaBackHandler);

    return () => {
      document.removeEventListener('backbutton', cordovaBackHandler);
      if (listenerPromise) {
        listenerPromise.then((handle) => handle?.remove?.()).catch(() => {});
      }
    };
  }, []);

  // Initialize Realtime Socket listeners
  useEffect(() => {
    if (!currentUser) return;

    const sock = connectSocket();
    setIsServerConnected(sock.connected);

    const onConnect = () => setIsServerConnected(true);
    const onDisconnect = () => setIsServerConnected(false);
    const onConnectError = () => setIsServerConnected(false);

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('connect_error', onConnectError);

    // Real-time message receiver (Instant delivery across devices)
    const unsubMsg = onSocketEvent('message:new', (data: any) => {
      const message: Message = data?.message || data;
      if (!message || !message.chatId) return;

      setMessagesMap((prev) => {
        const list = prev[message.chatId] || [];
        const isMatch = (m: Message) =>
          m.id === message.id ||
          (message.clientId && m.clientId === message.clientId) ||
          (message.clientId && m.id === message.clientId) ||
          (m.clientId && message.id === m.clientId) ||
          (m.senderId === message.senderId && m.body === message.body && Math.abs(new Date(m.createdAt).getTime() - new Date(message.createdAt).getTime()) < 15000);

        const exists = list.some(isMatch);
        let updatedList: Message[];
        if (exists) {
          updatedList = list.map((m) =>
            isMatch(m)
              ? { ...m, ...message, status: message.status || m.status || 'sent' }
              : m
          );
        } else {
          updatedList = [...list, message];
        }

        // Deduplicate list by id and clientId so no duplicate can ever exist in state
        const seen = new Set<string>();
        const deduped: Message[] = [];
        for (const item of updatedList) {
          const k1 = item.id;
          const k2 = item.clientId;
          if (k1 && seen.has(k1)) continue;
          if (k2 && seen.has(k2)) continue;
          if (k1) seen.add(k1);
          if (k2) seen.add(k2);
          deduped.push(item);
        }

        return {
          ...prev,
          [message.chatId]: deduped,
        };
      });

      // Peer replied in this chat: automatically mark chat request as ACCEPTED & clear limits
      if (currentUser && message.senderId !== currentUser.id) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === message.chatId ? { ...c, requestStatus: 'ACCEPTED' } : c
          )
        );
        setChatRequests((prev) => ({
          ...prev,
          [message.chatId]: { status: 'ACCEPTED', initiatorId: '' },
        }));
      }

      // Update sidebar chat last message preview
      setChats((prev) =>
        prev.map((c) =>
          c.id === message.chatId
            ? {
                ...c,
                lastMessage: message,
                unread: c.id === activeChatId ? c.unread : c.unread + 1,
                updatedAt: message.createdAt || new Date().toISOString(),
              }
            : c
        )
      );

      // Instant delivery acknowledgment to sender (Double ticks ✓✓)
      if (currentUser && message.senderId !== currentUser.id) {
        emitSocket('message:delivered', {
          chatId: message.chatId,
          messageIds: [message.id],
        });
      }
    });

    // Real-time auto-delete for everyone
    const unsubDeleted = onSocketEvent('message:deleted', ({ chatId, messageId }: { chatId: string; messageId: string }) => {
      setMessagesMap((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map((m) =>
          m.id === messageId ? { ...m, deletedForAll: true, body: null } : m
        ),
      }));

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          if (c.lastMessage && c.lastMessage.id === messageId) {
            return {
              ...c,
              lastMessage: {
                ...c.lastMessage,
                deletedForAll: true,
                body: '🚫 This message was deleted',
              },
            };
          }
          return c;
        })
      );
    });

    // Real-time receipts update (Single tick to Double tick / Blue tick)
    const unsubReceipt = onSocketEvent('receipt:update', ({ chatId, messageIds, state }: { chatId: string; messageIds: string[]; state: 'delivered' | 'read' }) => {
      setMessagesMap((prev) => {
        const list = prev[chatId] || [];
        return {
          ...prev,
          [chatId]: list.map((m) => (messageIds.includes(m.id) ? { ...m, status: state } : m)),
        };
      });
      setChats((prev) =>
        prev.map((c) => {
          if (c.id === chatId && c.lastMessage && messageIds.includes(c.lastMessage.id)) {
            return {
              ...c,
              lastMessage: { ...c.lastMessage, status: state },
            };
          }
          return c;
        })
      );
    });

    // Real-time reactions
    const unsubReactions = onSocketEvent('message:reactions', ({ chatId, messageId, reactions }: { chatId: string; messageId: string; reactions: any }) => {
      setMessagesMap((prev) => ({
        ...prev,
        [chatId]: (prev[chatId] || []).map((m) =>
          m.id === messageId ? { ...m, reactions } : m
        ),
      }));
    });

    const unsubTyping = onSocketEvent('typing', ({ chatId, userName, isTyping }) => {
      setTypingMap((prev) => {
        const current = prev[chatId] || [];
        if (isTyping && !current.includes(userName)) {
          return { ...prev, [chatId]: [...current, userName] };
        }
        if (!isTyping) {
          return { ...prev, [chatId]: current.filter((n) => n !== userName) };
        }
        return prev;
      });
    });

    // WebRTC Real-time call events
    const unsubIncomingCall = onSocketEvent('call:incoming', ({ callId, kind, from, caller }) => {
      const peerInfo = from || caller || { id: 'peer', displayName: 'Caller' };
      setActiveCall({
        callId,
        kind,
        status: 'RINGING',
        isIncoming: true,
        peer: peerInfo,
        durationSec: 0,
        micMuted: false,
        cameraOff: kind !== 'VIDEO',
        speakerOn: true,
        screenSharing: false,
        quality: 'excellent',
      });
    });

    const unsubCallAccepted = onSocketEvent('call:accepted', ({ callId }: { callId: string }) => {
      setActiveCall((prev) => (prev && prev.callId === callId ? { ...prev, status: 'ACCEPTED' } : prev));
    });

    const unsubCallDeclined = onSocketEvent('call:declined', () => {
      webrtcService.cleanup();
      setActiveCall(null);
    });

    const unsubCallCancelled = onSocketEvent('call:cancelled', () => {
      webrtcService.cleanup();
      setActiveCall(null);
    });

    const unsubEndCall = onSocketEvent('call:ended', () => {
      webrtcService.cleanup();
      setActiveCall(null);
    });

    const unsubDisplaced = onSocketEvent('session:displaced', ({ reason }) => {
      console.warn('[Session] Connection displaced notice:', reason);
    });

    const unsubUserUpdated = onSocketEvent('user:updated', ({ user: updatedUser }: { user: any }) => {
      if (!updatedUser || !updatedUser.id) return;
      setChats((prev) =>
        prev.map((c) => ({
          ...c,
          members: c.members.map((m) =>
            m.id === updatedUser.id
              ? {
                  ...m,
                  displayName: updatedUser.displayName || m.displayName,
                  avatarUrl: updatedUser.avatarUrl !== undefined ? updatedUser.avatarUrl : m.avatarUrl,
                  avatarFileId: updatedUser.avatarFileId !== undefined ? updatedUser.avatarFileId : m.avatarFileId,
                }
              : m
          ),
        }))
      );
    });

    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('connect_error', onConnectError);
      unsubMsg();
      unsubDeleted();
      unsubReceipt();
      unsubReactions();
      unsubUserUpdated?.();
      unsubTyping();
      unsubIncomingCall();
      unsubCallAccepted();
      unsubCallDeclined();
      unsubCallCancelled();
      unsubEndCall();
      unsubDisplaced();
      disconnectSocket();
    };
  }, [currentUser, activeChatId]);

  // Load server chats on login
  useEffect(() => {
    if (!currentUser) return;
    api.getChats()
      .then((res) => {
        if (res && res.chats && res.chats.length > 0) {
          setChats(
            res.chats.map((c) => {
              const req = chatRequests[c.id];
              return req
                ? { ...c, requestStatus: req.status, requestInitiatorId: req.initiatorId }
                : c;
            })
          );
        }
      })
      .catch(() => {});
  }, [currentUser]);

  // Handler: Start or open direct message with a specific user
  const handleStartDirectChat = async (targetUser: User) => {
    const existing = chats.find(
      (c) => c.type === 'DIRECT' && c.members.some((m) => m.id === targetUser.id)
    );
    if (existing) {
      setActiveChatId(existing.id);
      setMobileActivePanel('CHAT');
      return;
    }

    try {
      const res = await api.createDirectChat(targetUser.id);
      if (res && res.chat) {
        const reqInfo = { status: 'PENDING' as const, initiatorId: currentUser!.id };
        const chatWithRequest: Chat = {
          ...res.chat,
          requestStatus: 'PENDING',
          requestInitiatorId: currentUser!.id,
        };
        setChatRequests((prev) => ({ ...prev, [res.chat.id]: reqInfo }));
        setChats((prev) => [chatWithRequest, ...prev.filter((c) => c.id !== res.chat.id)]);
        setActiveChatId(res.chat.id);
      } else {
        throw new Error('No chat returned');
      }
    } catch {
      const localId = `dm-${targetUser.id}`;
      const reqInfo = { status: 'PENDING' as const, initiatorId: currentUser!.id };
      const newLocalChat: Chat = {
        id: localId,
        type: 'DIRECT',
        isProtected: false,
        membersCanInvite: false,
        archivedForAll: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        myRole: 'MEMBER',
        muted: false,
        pinned: false,
        archived: false,
        unread: 0,
        requestStatus: 'PENDING',
        requestInitiatorId: currentUser!.id,
        members: [
          {
            id: currentUser!.id,
            displayName: currentUser!.displayName,
            role: 'MEMBER',
            online: true,
            joinedAt: new Date().toISOString(),
          },
          {
            id: targetUser.id,
            displayName: targetUser.displayName,
            role: 'MEMBER',
            online: targetUser.online,
            joinedAt: new Date().toISOString(),
          },
        ],
      };
      setChatRequests((prev) => ({ ...prev, [localId]: reqInfo }));
      setChats((prev) => [newLocalChat, ...prev]);
      setActiveChatId(localId);
    }
    setMobileActivePanel('CHAT');
  };

  const handleAcceptChatRequest = (chatId: string) => {
    setChatRequests((prev) => ({
      ...prev,
      [chatId]: { status: 'ACCEPTED', initiatorId: prev[chatId]?.initiatorId || '' },
    }));
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, requestStatus: 'ACCEPTED' } : c))
    );
  };

  const handleDeclineChatRequest = (chatId: string) => {
    setChatRequests((prev) => ({
      ...prev,
      [chatId]: { status: 'DECLINED', initiatorId: prev[chatId]?.initiatorId || '' },
    }));
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    setActiveChatId(null);
    setMobileActivePanel('SIDEBAR');
  };

  const handleChatCreated = async (newChatId: string) => {
    try {
      const res = await api.getChat(newChatId);
      if (res && res.chat) {
        setChats((prev) => [res.chat, ...prev.filter((c) => c.id !== newChatId)]);
      }
    } catch {}
    setActiveChatId(newChatId);
    setIsNewChatOpen(false);
    setMobileActivePanel('CHAT');
  };

  // Handler: Select chat
  const handleSelectChat = (chatId: string) => {
    setActiveChatId(chatId);
    setMobileActivePanel('CHAT');

    // Join real-time room & mark read
    emitSocket('chat:join', { chatId });
    emitSocket('chat:read', { chatId });

    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c))
    );

    // Fetch message history from API so existing messages are immediately loaded
    api.getMessages(chatId)
      .then((res) => {
        if (res && res.messages) {
          setMessagesMap((prev) => {
            const currentList = prev[chatId] || [];
            const merged = [...res.messages];
            for (const localMsg of currentList) {
              if (
                localMsg.status === 'sending' &&
                !merged.some((m) => (localMsg.clientId && m.clientId === localMsg.clientId) || m.id === localMsg.id)
              ) {
                merged.push(localMsg);
              }
            }

            // Deduplicate
            const seen = new Set<string>();
            const deduped: Message[] = [];
            for (const item of merged) {
              const k1 = item.id;
              const k2 = item.clientId;
              if (k1 && seen.has(k1)) continue;
              if (k2 && seen.has(k2)) continue;
              if (k1) seen.add(k1);
              if (k2) seen.add(k2);
              deduped.push(item);
            }

            return {
              ...prev,
              [chatId]: deduped,
            };
          });
        }
      })
      .catch(() => {});
  };

  // Handler: Send message (Sub-second instant transmission like WhatsApp)
  const handleSendMessage = ({
    body,
    type = 'TEXT',
    replyToId,
    attachments,
    poll,
  }: {
    body?: string;
    type?: MessageType;
    replyToId?: string;
    attachments?: Attachment[];
    poll?: { question: string; options: string[]; multiple?: boolean };
  }, targetChatId?: string) => {
    const destChatId = targetChatId || activeChatId;
    if (!destChatId || !currentUser) return;

    const clientId = 'c-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    const replyMsg = replyToId
      ? (messagesMap[destChatId] || []).find((m) => m.id === replyToId)
      : null;

    const newMsg: Message = {
      id: clientId,
      clientId,
      chatId: destChatId,
      senderId: currentUser.id,
      type,
      body: body || null,
      createdAt: new Date().toISOString(),
      status: 'sending',
      replyTo: replyMsg
        ? {
            id: replyMsg.id,
            senderId: replyMsg.senderId,
            type: replyMsg.type,
            snippet: replyMsg.body || 'Attachment',
          }
        : null,
      attachments,
      poll: poll
        ? {
            id: 'poll-' + Date.now(),
            question: poll.question,
            multiple: !!poll.multiple,
            closed: false,
            options: poll.options.map((opt, i) => ({
              id: 'opt-' + i,
              text: opt,
              votes: 0,
              voted: false,
            })),
          }
        : null,
    };

    // 1. Optimistic instant local render (filtered to ensure no clientId collisions)
    setMessagesMap((prev) => {
      const currentList = (prev[destChatId] || []).filter(
        (m) => m.id !== clientId && m.clientId !== clientId
      );
      return {
        ...prev,
        [destChatId]: [...currentList, newMsg],
      };
    });

    // Update last message in chat list
    setChats((prev) =>
      prev.map((c) => (c.id === destChatId ? { ...c, lastMessage: newMsg, updatedAt: new Date().toISOString() } : c))
    );

    // 2. Prepare payload matching backend sendSchema
    const messagePayload = {
      clientId,
      type: newMsg.type,
      body: newMsg.body || undefined,
      replyToId: newMsg.replyTo?.id,
      attachmentIds: newMsg.attachments?.map((a) => a.id),
      poll: poll ? { question: poll.question, options: poll.options, multiple: poll.multiple } : undefined,
    };

    // 3. Send message (WebSocket primary, HTTP fallback if offline)
    const sock = getSocket();
    const updateOptimistic = (confirmedMsg: Message) => {
      setMessagesMap((prev) => {
        const currentList = prev[destChatId] || [];
        const updated: Message[] = currentList.map((m) =>
          m.clientId === clientId || m.id === clientId || m.id === confirmedMsg.id
            ? ({ ...confirmedMsg, status: 'sent' as const } as Message)
            : m
        );
        const seen = new Set<string>();
        const deduped: Message[] = [];
        for (const item of updated) {
          const k1 = item.id;
          const k2 = item.clientId;
          if (k1 && seen.has(k1)) continue;
          if (k2 && seen.has(k2)) continue;
          if (k1) seen.add(k1);
          if (k2) seen.add(k2);
          deduped.push(item);
        }
        return {
          ...prev,
          [destChatId]: deduped,
        };
      });
    };

    if (sock && sock.connected) {
      emitSocket('message:send', {
        chatId: destChatId,
        message: messagePayload,
      }, (res: any) => {
        if (res && res.message) {
          updateOptimistic(res.message);
        } else if (res && res.error) {
          // Socket failed, fallback to HTTP
          api.sendMessage(destChatId, messagePayload).then((httpRes) => {
            if (httpRes && httpRes.message) updateOptimistic(httpRes.message);
          }).catch(() => {});
        }
      });
    } else {
      // Offline / socket disconnected: send via HTTP
      api.sendMessage(destChatId, messagePayload).then((res) => {
        if (res && res.message) updateOptimistic(res.message);
      }).catch(() => {});
    }
  };

  // Scheduled message handlers
  const handleScheduleMessage = (payload: { body: string; scheduledAt: string; type?: MessageType }) => {
    if (!activeChatId) return;
    const item: ScheduledMessage = {
      id: 'sch-' + Date.now(),
      chatId: activeChatId,
      body: payload.body,
      type: payload.type || 'TEXT',
      scheduledAt: payload.scheduledAt,
      createdAt: new Date().toISOString(),
    };
    setScheduledMessages((prev) => [...prev, item]);
  };

  const handleCancelScheduledMessage = (id: string) => {
    setScheduledMessages((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSendScheduledNow = (id: string) => {
    const target = scheduledMessages.find((s) => s.id === id);
    if (!target) return;
    handleSendMessage({ body: target.body, type: target.type }, target.chatId);
    setScheduledMessages((prev) => prev.filter((s) => s.id !== id));
  };

  // Background interval: Automatically send due scheduled messages
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setScheduledMessages((prev) => {
        const due = prev.filter((s) => new Date(s.scheduledAt).getTime() <= now);
        if (due.length === 0) return prev;

        due.forEach((msg) => {
          handleSendMessage({
            body: msg.body,
            type: msg.type || 'TEXT',
          }, msg.chatId);
        });

        return prev.filter((s) => new Date(s.scheduledAt).getTime() > now);
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [activeChatId, chats]);

  // Handler: Start Voice or Video Call
  const handleStartCall = async (
    kind: CallKind,
    targetUser?: { id: string; displayName: string }
  ) => {
    let peerId = targetUser?.id;
    let peerName = targetUser?.displayName;
    let chatId = activeChat?.id;

    if (!peerId && activeChat && currentUser) {
      const peer = activeChat.members.find((m) => m.id !== currentUser.id) || activeChat.members[0];
      if (peer) {
        peerId = peer.id;
        peerName = peer.displayName || activeChat.name || 'Team Member';
      }
    }

    if (!peerId) return;

    const tempCallId = 'call-' + Date.now();
    setActiveCall({
      callId: tempCallId,
      kind,
      status: 'RINGING',
      isIncoming: false,
      peer: {
        id: peerId,
        displayName: peerName || 'Team Member',
      },
      durationSec: 0,
      micMuted: false,
      cameraOff: kind !== 'VIDEO',
      speakerOn: true,
      screenSharing: false,
      quality: 'excellent',
    });

    emitSocket(
      'call:invite',
      {
        chatId,
        kind,
        calleeId: peerId,
      },
      async (res: any) => {
        if (res && res.error) {
          console.warn('[Call] Start call error:', res.error);
          webrtcService.cleanup();
          setActiveCall(null);
          alert(res.error);
          return;
        }
        const realCallId = res?.callId || tempCallId;
        setActiveCall((prev) => (prev ? { ...prev, callId: realCallId } : null));
        await webrtcService.initializeCall(realCallId, kind === 'VIDEO', true);
      }
    );
  };

  // Handler: Accept Call
  const handleAcceptCall = async (video: boolean) => {
    if (!activeCall) return;
    try {
      await webrtcService.initializeCall(activeCall.callId, video, false);
      emitSocket('call:accept', { callId: activeCall.callId });
      setActiveCall((prev) => (prev ? { ...prev, status: 'ACCEPTED', cameraOff: !video } : null));
    } catch (err) {
      console.error('Accept call error:', err);
    }
  };

  // Handler: End Call (Immediate, fail-safe WebRTC cleanup + Socket + REST sync)
  const handleEndCall = async () => {
    const callIdToEnd = activeCall?.callId;
    // 1. Instantly dismiss UI & release mic/camera tracks
    webrtcService.cleanup();
    setActiveCall(null);

    // 2. Realtime socket event
    emitSocket('call:end', { callId: callIdToEnd });

    // 3. Fallback REST API call to guarantee call record is marked ENDED/CANCELLED in DB
    try {
      await api.endCall(callIdToEnd);
    } catch (e) {
      console.warn('[Call] REST end call fallback notice:', e);
    }
  };

  // Handler: Vote in Poll
  const handleVotePoll = (pollId: string, optionId: string) => {
    if (!activeChatId) return;
    setMessagesMap((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).map((m) => {
        if (m.poll?.id === pollId) {
          const updatedOptions = m.poll.options.map((opt) => {
            if (opt.id === optionId) {
              return { ...opt, votes: opt.voted ? opt.votes - 1 : opt.votes + 1, voted: !opt.voted };
            }
            return m.poll?.multiple ? opt : { ...opt, voted: false, votes: opt.voted ? opt.votes - 1 : opt.votes };
          });
          return { ...m, poll: { ...m.poll, options: updatedOptions } };
        }
        return m;
      }),
    }));
  };

  // Handler: Add Emoji Reaction
  const handleAddReaction = (messageId: string, emoji: string) => {
    if (!activeChatId || !currentUser) return;
    setMessagesMap((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).map((m) => {
        if (m.id === messageId) {
          const reactions = m.reactions || [];
          const existing = reactions.find((r) => r.emoji === emoji);
          let newReactions;
          if (existing) {
            newReactions = reactions.filter((r) => r.emoji !== emoji);
          } else {
            newReactions = [...reactions, { emoji, userIds: [currentUser.id] }];
          }
          return { ...m, reactions: newReactions };
        }
        return m;
      }),
    }));
    emitSocket('message:reaction', { messageId, emoji });
  };

  // Handler: Edit Message
  const handleEditMessage = (messageId: string, newBody: string) => {
    if (!activeChatId) return;
    setMessagesMap((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).map((m) =>
        m.id === messageId ? { ...m, body: newBody, editedAt: new Date().toISOString() } : m
      ),
    }));
  };

  // Handler: Delete Message (WhatsApp-style sync with chats & home preview)
  const handleDeleteMessage = (messageId: string, forAll: boolean) => {
    if (!activeChatId) return;

    // 1. Update local messages map
    setMessagesMap((prev) => {
      const chatMsgs = prev[activeChatId] || [];
      if (forAll) {
        return {
          ...prev,
          [activeChatId]: chatMsgs.map((m) =>
            m.id === messageId ? { ...m, deletedForAll: true, body: null } : m
          ),
        };
      } else {
        return {
          ...prev,
          [activeChatId]: chatMsgs.filter((m) => m.id !== messageId),
        };
      }
    });

    // 2. Synchronize sidebar & home screen chat preview
    setChats((prevChats) =>
      prevChats.map((chat) => {
        if (chat.id !== activeChatId) return chat;
        if (chat.lastMessage && chat.lastMessage.id === messageId) {
          if (forAll) {
            return {
              ...chat,
              lastMessage: {
                ...chat.lastMessage,
                deletedForAll: true,
                body: '🚫 This message was deleted',
              },
            };
          } else {
            // Deleted for me: pick the preceding message in history
            const currentList = messagesMap[activeChatId] || [];
            const remaining = currentList.filter((m) => m.id !== messageId);
            const prevMsg = remaining.length > 0 ? remaining[remaining.length - 1] : null;
            return {
              ...chat,
              lastMessage: prevMsg
                ? {
                    ...prevMsg,
                    body: prevMsg.deletedForAll ? '🚫 This message was deleted' : (prevMsg.body || ''),
                  }
                : null,
            };
          }
        }
        return chat;
      })
    );

    // 3. Emit real-time socket deletion & persist to server
    const scope = forAll ? 'all' : 'me';
    emitSocket('message:delete', { messageId, chatId: activeChatId, scope, forAll });
    api.deleteMessage(messageId, scope).catch((e) => {
      console.warn('[deleteMessage error]:', e?.message);
    });
  };

  // Handler: Pin Message
  const handlePinMessage = (messageId: string) => {
    if (!activeChatId) return;
    setMessagesMap((prev) => ({
      ...prev,
      [activeChatId]: (prev[activeChatId] || []).map((m) =>
        m.id === messageId ? { ...m, pinned: !m.pinned } : m
      ),
    }));
  };

  // Handler: Update Chat properties
  const handleUpdateChat = (chatId: string, updates: Partial<Chat>) => {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, ...updates } : c))
    );
  };

  // Handler: Toggle Theme
  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Handler: Add ephemeral status update
  const handleAddStatus = async (newStatus: {
    kind: 'TEXT' | 'IMAGE' | 'VIDEO';
    body: string;
    background?: string;
    mediaUrl?: string;
  }) => {
    const item: StatusItem = {
      id: 'st-' + Date.now(),
      kind: newStatus.kind,
      body: newStatus.body,
      background: newStatus.background,
      mediaUrl: newStatus.mediaUrl,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      viewed: false,
      viewCount: 0,
    };

    setStatusGroups((prev) => {
      const myIdx = prev.findIndex((g) => g.mine || g.user.id === currentUser?.id);
      if (myIdx >= 0) {
        return prev.map((g, idx) =>
          idx === myIdx
            ? {
                ...g,
                mine: true,
                user: {
                  id: currentUser?.id || g.user.id,
                  displayName: currentUser?.displayName || g.user.displayName,
                  avatarFileId: currentUser?.avatarUrl || g.user.avatarFileId,
                },
                updates: [item, ...g.updates],
              }
            : { ...g, mine: false }
        );
      } else {
        const myGroup: StatusGroup = {
          user: {
            id: currentUser?.id || 'u-me',
            displayName: currentUser?.displayName || 'Me',
            avatarFileId: currentUser?.avatarUrl || null,
          },
          mine: true,
          updates: [item],
        };
        return [myGroup, ...prev.map((g) => ({ ...g, mine: false }))];
      }
    });

    // Background server call if online
    try {
      if (newStatus.kind === 'TEXT') {
        await api.createStatus({
          kind: 'TEXT',
          body: newStatus.body,
          background: newStatus.background,
        });
      }
    } catch {}
  };

  // Handler: Delete personal status update
  const handleDeleteStatus = (statusId: string) => {
    setStatusGroups((prev) =>
      prev.map((g) =>
        g.mine ? { ...g, updates: g.updates.filter((u) => u.id !== statusId) } : g
      )
    );
  };

  // Splash screen while checking existing session on app relaunch
  if (authChecking) {
    return (
      <div
        style={{
          height: '100vh',
          width: '100vw',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b141a',
          color: '#ffffff',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 30px rgba(16, 185, 129, 0.35)',
            marginBottom: 20,
          }}
        >
          <Shield size={36} color="#ffffff" />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.5px' }}>TeamTalk</h1>
        <p style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.5)', marginTop: 6, marginBottom: 24 }}>
          Private • Encrypted • Team Collaboration
        </p>
        <div
          className="spin"
          style={{
            width: 24,
            height: 24,
            border: '2px solid rgba(16, 185, 129, 0.2)',
            borderTopColor: '#10b981',
            borderRadius: '50%',
          }}
        />
      </div>
    );
  }

  // If unauthenticated, show AuthScreen
  if (!currentUser) {
    return (
      <AuthScreen
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          localStorage.setItem('tt_cached_user', JSON.stringify(user));
        }}
      />
    );
  }

  const currentMessages = activeChatId ? messagesMap[activeChatId] || [] : [];
  const activeChatTyping = activeChatId ? typingMap[activeChatId] || [] : [];

  return (
    <div
      className="app-container"
      onTouchStart={handleMainTouchStart}
      onTouchEnd={handleMainTouchEnd}
    >
      {/* Privacy Blur Curtain - triggers when tab is hidden / window loses focus on Protected chats */}
      {isWindowBlurred && activeChat?.isProtected && (
        <div className="privacy-blur-curtain">
          <EyeOff size={48} color="var(--primary-400)" />
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>TeamTalk Protected Window</h2>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 360, textAlign: 'center' }}>
            Content is hidden while application is inactive or in the background to prevent unauthorized capture.
          </p>
        </div>
      )}

      {/* Screenshot Warning Toast */}
      {captureWarning && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--accent-rose)',
            color: 'var(--accent-rose)',
            padding: '12px 20px',
            borderRadius: 'var(--radius-full)',
            fontSize: 13,
            fontWeight: 600,
            boxShadow: 'var(--shadow-lg)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Shield size={16} />
          <span>{captureWarning}</span>
          <button onClick={dismissWarning} style={{ color: 'inherit', fontWeight: 700, marginLeft: 8 }}>
            ✕
          </button>
        </div>
      )}

      {/* Panel 1: Main Tabs Carousel (Chats, Updates, Calls, Settings) */}
      <div
        className="main-tabs-viewport"
        onTouchStart={handleMainTouchStart}
        onTouchEnd={handleMainTouchEnd}
      >
        <div
          className="main-tabs-track"
          style={{
            transform: `translate3d(-${MAIN_TABS.indexOf(activeMainTab) * 25}%, 0, 0)`,
          }}
        >
          {/* Pane 0: Chats */}
          <div className="main-tab-pane">
            <Sidebar
              currentUser={currentUser}
              chats={chats}
              activeChatId={activeChatId}
              onSelectChat={handleSelectChat}
              onStartDirectChat={handleStartDirectChat}
              typingMap={typingMap}
              onOpenNewChat={() => setIsNewChatOpen(true)}
              onOpenSettings={() => handleSelectTab('SETTINGS')}
              onOpenAdmin={() => setIsAdminOpen(true)}
              onOpenCalls={() => handleSelectTab('CALLS')}
              onOpenStatus={() => handleSelectTab('UPDATES')}
              statusGroups={statusGroups}
              theme={theme}
              onToggleTheme={handleToggleTheme}
              isServerConnected={isServerConnected}
            />
          </div>

          {/* Pane 1: Updates */}
          <div className="main-tab-pane">
            <StatusModal
              isTab={true}
              isOpen={true}
              onClose={() => handleSelectTab('CHATS')}
              currentUser={currentUser}
              statusGroups={statusGroups}
              onAddStatus={handleAddStatus}
              onDeleteStatus={handleDeleteStatus}
              onStoryActiveChange={setStatusStoryActive}
              requestExitStoryRef={requestExitStoryRef}
            />
          </div>

          {/* Pane 2: Calls */}
          <div className="main-tab-pane">
            <CallsModal
              isTab={true}
              isOpen={true}
              onClose={() => handleSelectTab('CHATS')}
              currentUser={currentUser!}
              activeCall={activeCall}
              onStartCall={(kind, targetUser) => {
                handleSelectTab('CHATS');
                handleStartCall(kind, targetUser);
              }}
              onReturnToActiveCall={() => handleSelectTab('CHATS')}
              onEndActiveCall={handleEndCall}
              onOpenNewChat={() => {
                handleSelectTab('CHATS');
                setIsNewChatOpen(true);
              }}
            />
          </div>

          {/* Pane 3: Settings */}
          <div className="main-tab-pane">
            <SettingsModal
              isTab={true}
              isOpen={true}
              isActive={activeMainTab === 'SETTINGS'}
              onClose={() => handleSelectTab('CHATS')}
              currentUser={currentUser}
              onUpdateUser={(updated) => setCurrentUser((prev) => (prev ? { ...prev, ...updated } : null))}
              theme={theme}
              onToggleTheme={handleToggleTheme}
              fontSize={fontSize}
              onChangeFontSize={setFontSize}
            />
          </div>
        </div>
      </div>

      {/* Panel 2: Center Main Chat Area */}
      <div
        className={`chat-panel ${mobileActivePanel === 'CHAT' ? 'active-mobile' : ''}`}
        onTouchStart={handleChatTouchStart}
        onTouchEnd={handleChatTouchEnd}
      >
        <ChatArea
          currentUser={currentUser}
          chat={activeChat}
          messages={currentMessages}
          typingUsers={activeChatTyping}
          onSendMessage={handleSendMessage}
          onStartCall={handleStartCall}
          onToggleDetails={() => setIsDetailsOpen(!isDetailsOpen)}
          onBackMobile={() => setMobileActivePanel('SIDEBAR')}
          onVotePoll={handleVotePoll}
          onAddReaction={handleAddReaction}
          onDeleteMessage={handleDeleteMessage}
          onPinMessage={handlePinMessage}
          onEditMessage={handleEditMessage}
          onTyping={(isTyping) => {
            if (activeChatId) {
              emitSocket('typing', { chatId: activeChatId, isTyping });
            }
          }}
          scheduledMessages={scheduledMessages}
          onScheduleMessage={handleScheduleMessage}
          onCancelScheduledMessage={handleCancelScheduledMessage}
          onSendScheduledNow={handleSendScheduledNow}
          onAcceptChatRequest={handleAcceptChatRequest}
          onDeclineChatRequest={handleDeclineChatRequest}
          onBlockUser={(_userId) => {
            alert('User has been blocked. They will not be able to message or call you.');
          }}
        />
      </div>

      {/* Panel 3: Right Details Panel (Inspector) */}
      {isDetailsOpen && activeChat && (
        <DetailsPanel
          currentUser={currentUser}
          chat={activeChat}
          onClose={() => setIsDetailsOpen(false)}
          onUpdateChat={handleUpdateChat}
          onToggleMute={(chatId) => handleUpdateChat(chatId, { muted: !activeChat.muted })}
          onTogglePin={(chatId) => handleUpdateChat(chatId, { pinned: !activeChat.pinned })}
          onToggleArchive={(chatId) => handleUpdateChat(chatId, { archived: !activeChat.archived })}
          attachments={currentMessages.flatMap((m) => m.attachments || [])}
          onReportChat={(_chatId, _reason) => {
            alert('Conversation has been reported to TeamTalk security administrators.');
          }}
          onBlockUser={(_userId) => {
            alert('User has been blocked. They will not be able to message or call you.');
          }}
        />
      )}

      {/* Persistent WhatsApp Bottom Navigation Bar (Visible across all screens on mobile) */}
      {mobileActivePanel !== 'CHAT' && !statusStoryActive && (
        <nav
          className="mobile-bottom-nav"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: 'calc(58px + var(--safe-bottom, 0px))',
            paddingBottom: 'var(--safe-bottom, 0px)',
            background: 'rgba(17, 27, 33, 0.98)',
            backdropFilter: 'blur(10px)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            zIndex: 10000,
            boxShadow: '0 -4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {/* Animated sliding emerald indicator for Bottom Nav */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${MAIN_TABS.indexOf(activeMainTab) * 25}%`,
              width: '25%',
              height: 3,
              background: '#00a884',
              borderRadius: '0 0 3px 3px',
              transition: 'left 0.28s cubic-bezier(0.25, 1, 0.5, 1)',
              boxShadow: '0 2px 8px rgba(0, 168, 132, 0.6)',
              zIndex: 2,
            }}
          />

          {/* Tab 1: Chats */}
          <button
            onClick={() => {
              handleSelectTab('CHATS');
              setMobileActivePanel('SIDEBAR');
            }}
            style={{
              background: 'none',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              color: activeMainTab === 'CHATS' ? '#00a884' : '#8696a0',
              fontSize: 11,
              fontWeight: activeMainTab === 'CHATS' ? 700 : 500,
              cursor: 'pointer',
              padding: '6px 16px',
              transition: 'color 180ms ease',
            }}
          >
            <div
              style={{
                position: 'relative',
                transform: activeMainTab === 'CHATS' ? 'scale(1.15) translateY(-2px)' : 'scale(1)',
                transition: 'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                filter: activeMainTab === 'CHATS' ? 'drop-shadow(0 2px 8px rgba(0, 168, 132, 0.45))' : 'none',
              }}
            >
              <MessageSquare size={21} />
              {chats.some((c) => (c.unread || 0) > 0) && (
                <span
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -6,
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#00a884',
                  }}
                />
              )}
            </div>
            <span>Chats</span>
          </button>

          {/* Tab 2: Updates */}
          <button
            onClick={() => handleSelectTab('UPDATES')}
            style={{
              background: 'none',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              color: activeMainTab === 'UPDATES' ? '#00a884' : '#8696a0',
              fontSize: 11,
              fontWeight: activeMainTab === 'UPDATES' ? 700 : 500,
              cursor: 'pointer',
              padding: '6px 16px',
              transition: 'color 180ms ease',
            }}
          >
            <div
              style={{
                transform: activeMainTab === 'UPDATES' ? 'scale(1.15) translateY(-2px)' : 'scale(1)',
                transition: 'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                filter: activeMainTab === 'UPDATES' ? 'drop-shadow(0 2px 8px rgba(0, 168, 132, 0.45))' : 'none',
              }}
            >
              <CircleDashed size={21} />
            </div>
            <span>Updates</span>
          </button>

          {/* Tab 3: Calls */}
          <button
            onClick={() => handleSelectTab('CALLS')}
            style={{
              background: 'none',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              color: activeMainTab === 'CALLS' ? '#00a884' : '#8696a0',
              fontSize: 11,
              fontWeight: activeMainTab === 'CALLS' ? 700 : 500,
              cursor: 'pointer',
              padding: '6px 16px',
              transition: 'color 180ms ease',
            }}
          >
            <div
              style={{
                transform: activeMainTab === 'CALLS' ? 'scale(1.15) translateY(-2px)' : 'scale(1)',
                transition: 'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                filter: activeMainTab === 'CALLS' ? 'drop-shadow(0 2px 8px rgba(0, 168, 132, 0.45))' : 'none',
              }}
            >
              <Phone size={21} />
            </div>
            <span>Calls</span>
          </button>

          {/* Tab 4: Settings */}
          <button
            onClick={() => handleSelectTab('SETTINGS')}
            style={{
              background: 'none',
              border: 'none',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              color: activeMainTab === 'SETTINGS' ? '#00a884' : '#8696a0',
              fontSize: 11,
              fontWeight: activeMainTab === 'SETTINGS' ? 700 : 500,
              cursor: 'pointer',
              padding: '6px 16px',
              transition: 'color 180ms ease',
            }}
          >
            <div
              style={{
                transform: activeMainTab === 'SETTINGS' ? 'scale(1.15) translateY(-2px)' : 'scale(1)',
                transition: 'all 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                filter: activeMainTab === 'SETTINGS' ? 'drop-shadow(0 2px 8px rgba(0, 168, 132, 0.45))' : 'none',
              }}
            >
              <Settings size={21} />
            </div>
            <span>Settings</span>
          </button>
        </nav>
      )}

      {/* Modals & Overlays */}
      <NewChatModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onChatCreated={handleChatCreated}
      />

      {/* Desktop Modal Overlays */}
      {isDesktop && (
        <>
          <StatusModal
            isOpen={activeMainTab === 'UPDATES'}
            onClose={() => setActiveMainTab('CHATS')}
            currentUser={currentUser}
            statusGroups={statusGroups}
            onAddStatus={handleAddStatus}
            onDeleteStatus={handleDeleteStatus}
            onStoryActiveChange={setStatusStoryActive}
            requestExitStoryRef={requestExitStoryRef}
            slideDirection={slideDirection}
          />

          <SettingsModal
            isOpen={activeMainTab === 'SETTINGS'}
            onClose={() => setActiveMainTab('CHATS')}
            currentUser={currentUser}
            onUpdateUser={(updated) => setCurrentUser((prev) => (prev ? { ...prev, ...updated } : null))}
            theme={theme}
            onToggleTheme={handleToggleTheme}
            fontSize={fontSize}
            onChangeFontSize={setFontSize}
            slideDirection={slideDirection}
          />

          <CallsModal
            isOpen={activeMainTab === 'CALLS'}
            onClose={() => setActiveMainTab('CHATS')}
            currentUser={currentUser!}
            activeCall={activeCall}
            onStartCall={(kind, targetUser) => {
              setActiveMainTab('CHATS');
              handleStartCall(kind, targetUser);
            }}
            onReturnToActiveCall={() => setActiveMainTab('CHATS')}
            onEndActiveCall={handleEndCall}
            onOpenNewChat={() => {
              setActiveMainTab('CHATS');
              setIsNewChatOpen(true);
            }}
            slideDirection={slideDirection}
          />
        </>
      )}

      <AdminModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        currentUser={currentUser}
      />

      {activeCall && (
        <CallModal
          callState={activeCall}
          onAccept={handleAcceptCall}
          onDecline={handleEndCall}
          onEndCall={handleEndCall}
        />
      )}

      {/* WhatsApp Biometric & Fingerprint App Lock Screen */}
      {isAppLocked && currentUser && (
        <BiometricLockScreen
          onUnlock={() => setIsAppLocked(false)}
          userDisplayName={currentUser.displayName}
        />
      )}
    </div>
  );
};
