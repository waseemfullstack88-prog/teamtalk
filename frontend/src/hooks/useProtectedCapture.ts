import { useState, useEffect } from 'react';
import { api } from '../services/api';

export function useProtectedCapture(activeChatId?: string, isProtectedChat?: boolean, userName?: string) {
  const [isWindowBlurred, setIsWindowBlurred] = useState(false);
  const [captureWarning, setCaptureWarning] = useState<string | null>(null);

  useEffect(() => {
    // 1. Keyboard shortcut detection for screenshot hotkeys (PrintScreen, Cmd+Shift+3/4)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'PrintScreen' ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === 'S'))
      ) {
        if (isProtectedChat) {
          setCaptureWarning('Screenshots are discouraged in Protected Chats. An audit event was logged.');
          api.reportPrivacyEvent('screenshot', activeChatId).catch(() => undefined);
          setTimeout(() => setCaptureWarning(null), 5000);
        }
      }
    };

    window.addEventListener('keyup', handleKeyDown);
    return () => {
      window.removeEventListener('keyup', handleKeyDown);
    };
  }, [activeChatId, isProtectedChat]);

  return {
    // Blur curtain permanently disabled to guarantee zero black-screen lockups on mobile
    isWindowBlurred: false,
    captureWarning,
    dismissWarning: () => setCaptureWarning(null),
    watermarkText: userName ? `${userName} • TeamTalk Private • ${new Date().toLocaleDateString()}` : 'TeamTalk Protected',
  };
}
