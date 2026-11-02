import React, { useState, useEffect, useRef } from 'react';
import {
  Shield,
  Lock,
  Mail,
  User as UserIcon,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Smartphone,
  QrCode,
  Laptop,
  RefreshCw,
  Camera,
  AtSign,
  Wifi,
  Settings,
  ArrowLeft,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  MessageSquare,
} from 'lucide-react';
import { api, getDeviceId, getServerUrl, setServerUrl } from '../services/api';
import { disconnectSocket, connectSocket } from '../services/socket';
import { User } from '../types';
import { App as CapApp } from '@capacitor/app';

interface AuthScreenProps {
  onAuthSuccess: (user: User) => void;
}

const AVATAR_PRESETS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
];

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [tab, setTab] = useState<'WELCOME' | 'LOGIN' | 'REGISTER'>('WELCOME');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const deviceId = getDeviceId();
  const deviceName = typeof navigator !== 'undefined' ? `${navigator.platform || 'Device'}` : 'Primary Device';

  // Server URL config
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrlVal, setServerUrlVal] = useState(getServerUrl() || 'http://192.168.10.5:4000');
  const [currentActiveServer, setCurrentActiveServer] = useState(getServerUrl() || 'http://192.168.10.5:4000');

  // Sign in state
  const [loginStep, setLoginStep] = useState<'CREDENTIALS' | 'OTP'>('CREDENTIALS');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginToken, setLoginToken] = useState('');
  const [loginOtpCode, setLoginOtpCode] = useState('');
  const [loginDevOtp, setLoginDevOtp] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string | null>(null);

  // Registration wizard state
  const [registerStep, setRegisterStep] = useState<'EMAIL' | 'OTP' | 'PROFILE' | 'AVATAR'>('EMAIL');
  const [regEmail, setRegEmail] = useState('');
  const [regOtpCode, setRegOtpCode] = useState('');
  const [regDevOtp, setRegDevOtp] = useState<string | null>(null);
  const [regDisplayName, setRegDisplayName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState('');

  // Username live check
  const [usernameStatus, setUsernameStatus] = useState<{
    checking?: boolean;
    available?: boolean;
    message?: string;
  }>({});
  const usernameTimerRef = useRef<any>(null);

  // Android Native Hardware / Gesture Back Button handling
  useEffect(() => {
    const handleBack = () => {
      if (showServerModal) {
        setShowServerModal(false);
        return;
      }
      if (loginStep === 'OTP') {
        setLoginStep('CREDENTIALS');
        return;
      }
      if (registerStep === 'OTP') {
        setRegisterStep('EMAIL');
        return;
      }
      if (registerStep === 'PROFILE') {
        setRegisterStep('OTP');
        return;
      }
      if (registerStep === 'AVATAR') {
        setRegisterStep('PROFILE');
        return;
      }
      if (tab === 'LOGIN' || tab === 'REGISTER') {
        setTab('WELCOME');
        return;
      }
      try {
        CapApp.minimizeApp();
      } catch {}
    };

    let listenerPromise: Promise<any> | null = null;
    try {
      listenerPromise = CapApp.addListener('backButton', handleBack);
    } catch {}

    const cordovaBackHandler = (e: Event) => {
      e.preventDefault();
      handleBack();
    };
    document.addEventListener('backbutton', cordovaBackHandler);

    return () => {
      document.removeEventListener('backbutton', cordovaBackHandler);
      if (listenerPromise) {
        listenerPromise.then((handle) => handle?.remove?.()).catch(() => {});
      }
    };
  }, [tab, loginStep, registerStep, showServerModal]);

  const checkUsernameAvailability = (name: string) => {
    const clean = name.trim().toLowerCase();
    if (!clean || clean.length < 3) {
      setUsernameStatus({ checking: false });
      return;
    }
    setUsernameStatus({ checking: true });
    if (usernameTimerRef.current) clearTimeout(usernameTimerRef.current);
    usernameTimerRef.current = setTimeout(async () => {
      try {
        const res = await api.checkUsername(clean);
        setUsernameStatus({
          checking: false,
          available: res.available,
          message: res.message,
        });
      } catch {
        setUsernameStatus({ checking: false });
      }
    }, 350);
  };

  // Sign In Flow
  const handleInitiateLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginIdentifier.trim() || !loginPassword) {
      setError('Please enter your username/email and password.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.login({
        identifier: loginIdentifier.trim(),
        password: loginPassword,
        deviceId,
        deviceName,
        isCompanion: false,
      });

      if (res.requireOtp && res.loginToken) {
        setLoginToken(res.loginToken);
        setLoginDevOtp(res.devOtp || null);
        setTargetEmail(res.email || loginIdentifier.trim());
        setLoginOtpCode(''); // No auto-fill
        setLoginStep('OTP');
        setSuccessMsg(res.message || 'Verification code sent to your email.');
      } else {
        setError('Unexpected authentication response. Please try again.');
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid username/email or password');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLoginOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!loginOtpCode.trim() || loginOtpCode.trim().length < 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verifyLoginOtp({
        loginToken,
        code: loginOtpCode.trim(),
        deviceId,
        deviceName,
        isCompanion: false,
      });

      if (res.user) {
        onAuthSuccess(res.user);
      } else {
        setError('Failed to establish session.');
      }
    } catch (err: any) {
      setError(err?.message || 'Verification code incorrect or expired.');
    } finally {
      setLoading(false);
    }
  };

  // Registration Flow
  const handleSendRegisterOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!regEmail.trim()) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.sendRegisterOtp({
        email: regEmail.trim(),
        deviceId,
      });

      setRegDevOtp(res.devOtp || null);
      setRegOtpCode(''); // No auto-fill
      setRegisterStep('OTP');
      setSuccessMsg(res.message || 'Verification code sent to your email.');
    } catch (err: any) {
      setError(err?.message || 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpStep = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!regOtpCode.trim() || regOtpCode.trim().length < 6) {
      setError('Please enter the 6-digit verification code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verifyRegisterOtpStep({
        email: regEmail.trim(),
        code: regOtpCode.trim(),
      });

      if (res.verified) {
        setRegisterStep('PROFILE');
        setError(null);
        setSuccessMsg(null);
      } else {
        setError('Invalid verification code.');
      }
    } catch (err: any) {
      setError(err?.message || 'Verification code is invalid or expired.');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileStepSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    if (!regDisplayName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!regUsername.trim() || regUsername.trim().length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (usernameStatus.available === false) {
      setError('Username unavailable. Please choose another username.');
      return;
    }
    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (!/[A-Za-z]/.test(regPassword) || !/[0-9]/.test(regPassword)) {
      setError('Password must contain both letters and numbers.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setRegisterStep('AVATAR');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG, PNG, WebP).');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setError('Image must be under 15MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 512;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.88);
          setAvatarUrl(compressed);
          setError(null);
        } else {
          setAvatarUrl(rawDataUrl);
          setError(null);
        }
      };
      img.onerror = () => {
        setAvatarUrl(rawDataUrl);
        setError(null);
      };
      img.src = rawDataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleFinishRegistration = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await api.completeRegistration({
        email: regEmail.trim(),
        code: regOtpCode.trim(),
        displayName: regDisplayName.trim(),
        username: regUsername.trim().toLowerCase(),
        password: regPassword,
        avatarUrl: avatarUrl || undefined,
        deviceId,
        deviceName,
      });

      if (res.user) {
        onAuthSuccess(res.user);
      } else {
        setError('Registration could not be completed.');
      }
    } catch (err: any) {
      setError(err?.message || 'Registration failed. Check details or code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'linear-gradient(180deg, #0b141a 0%, #111b21 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'max(env(safe-area-inset-top, 0px), 38px) 12px max(env(safe-area-inset-bottom, 0px), 16px)',
        color: '#ffffff',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Top Bar with Server Config Button */}
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => setShowServerModal(true)}
          title="Server Settings"
          style={{
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 20,
            padding: '5px 10px',
            color: '#34d399',
            fontSize: 11,
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          <Wifi size={12} />
          <span>Server</span>
          <Settings size={11} style={{ opacity: 0.6 }} />
        </button>
      </div>

      {/* ================= VIEW 1: WELCOME SCREEN ================= */}
      {tab === 'WELCOME' ? (
        <div
          style={{
            width: '100%',
            maxWidth: 440,
            background: '#111b21',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 24,
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            padding: '32px 22px 28px',
          }}
        >
          {/* Hero Emblem & App Title */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div
              style={{
                width: 72,
                height: 72,
                margin: '0 auto 16px',
                borderRadius: 22,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 30px rgba(16, 185, 129, 0.38)',
              }}
            >
              <Shield size={38} color="#ffffff" />
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 20,
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                color: '#10b981',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.4px',
                marginBottom: 10,
              }}
            >
              <Sparkles size={13} />
              <span>PRIVATE TEAM COLLABORATION</span>
            </div>

            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.5px' }}>
              Welcome to TeamTalk
            </h1>
            <p style={{ fontSize: 13, color: '#8696a0', margin: '0 auto', maxWidth: 320, lineHeight: 1.5 }}>
              Zero-knowledge encrypted messaging, crystal-clear voice calls, and secure channels built for teams.
            </p>
          </div>

          {/* Key Feature Highlight Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                background: '#1a2730',
                borderRadius: 14,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'rgba(16, 185, 129, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#10b981',
                  flexShrink: 0,
                }}
              >
                <ShieldCheck size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e9edef' }}>Military-Grade Privacy</div>
                <div style={{ fontSize: 12, color: '#8696a0', marginTop: 2, lineHeight: 1.4 }}>
                  Zero metadata tracking, tamper-proof audit trails, and encrypted message storage.
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                background: '#1a2730',
                borderRadius: 14,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'rgba(6, 182, 212, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#06b6d4',
                  flexShrink: 0,
                }}
              >
                <MessageSquare size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e9edef' }}>Instant Messaging & Calling</div>
                <div style={{ fontSize: 12, color: '#8696a0', marginTop: 2, lineHeight: 1.4 }}>
                  Ultra-low latency text, voice & video calling, rich group chats, and 24h status updates.
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                background: '#1a2730',
                borderRadius: 14,
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'rgba(99, 102, 241, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#818cf8',
                  flexShrink: 0,
                }}
              >
                <Smartphone size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e9edef' }}>1-Account 1-Device Integrity</div>
                <div style={{ fontSize: 12, color: '#8696a0', marginTop: 2, lineHeight: 1.4 }}>
                  Secure email OTP authentication with automatic single-device session locking.
                </div>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              type="button"
              onClick={() => {
                setTab('REGISTER');
                setError(null);
                setSuccessMsg(null);
              }}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 14,
                border: 'none',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontSize: 14.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                boxShadow: '0 4px 18px rgba(16, 185, 129, 0.35)',
              }}
            >
              <span>Get Started • Create Account</span>
              <ArrowRight size={17} />
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('LOGIN');
                setError(null);
                setSuccessMsg(null);
              }}
              style={{
                width: '100%',
                padding: '13px 20px',
                borderRadius: 14,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'transparent',
                color: '#e9edef',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <span>I already have an account • Sign In</span>
            </button>
          </div>
        </div>
      ) : (
        /* Main Card (Sign In & Register) */
        <div
          style={{
            width: '100%',
            maxWidth: 420,
            background: '#111b21',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 20,
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Back to Welcome Button */}
          <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setTab('WELCOME');
                setError(null);
                setSuccessMsg(null);
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#8696a0',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
              }}
            >
              <ArrowLeft size={16} />
              <span>Back to Welcome</span>
            </button>
          </div>

          {/* Header Branding */}
          <div style={{ textAlign: 'center', padding: '16px 20px 14px' }}>
            <div
              style={{
                width: 50,
                height: 50,
                margin: '0 auto 10px',
                borderRadius: 14,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)',
              }}
            >
              <Shield size={26} color="#ffffff" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 3px', letterSpacing: '-0.4px' }}>
              {tab === 'LOGIN' ? 'Sign In to TeamTalk' : 'Create TeamTalk Account'}
            </h1>
            <p style={{ fontSize: 12.5, color: '#8696a0', margin: 0 }}>
              {tab === 'LOGIN' ? 'Enter your credentials to access secure team channels' : 'Step-by-step verified account creation'}
            </p>
          </div>

        {/* Tab Switcher (Sign In vs Create Account) */}
        <div style={{ padding: '0 20px 16px' }}>
            <div
              style={{
                display: 'flex',
                background: '#202c33',
                borderRadius: 12,
                padding: 3,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setTab('LOGIN');
                  setError(null);
                  setSuccessMsg(null);
                }}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: tab === 'LOGIN' ? '#10b981' : 'transparent',
                  color: tab === 'LOGIN' ? '#ffffff' : '#8696a0',
                  transition: 'all 0.2s ease',
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('REGISTER');
                  setError(null);
                  setSuccessMsg(null);
                }}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: tab === 'REGISTER' ? '#10b981' : 'transparent',
                  color: tab === 'REGISTER' ? '#ffffff' : '#8696a0',
                  transition: 'all 0.2s ease',
                }}
              >
                Create Account
              </button>
            </div>
          </div>

        {/* Feedback Messages */}
        {error && (
          <div
            style={{
              margin: '0 20px 14px',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <XCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div
            style={{
              margin: '0 20px 14px',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              fontSize: 12.5,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        <div style={{ padding: '0 20px 24px' }}>
          {/* ================= TAB 1: SIGN IN ================= */}
          {tab === 'LOGIN' && (
            <div>
              {loginStep === 'CREDENTIALS' ? (
                <form onSubmit={handleInitiateLogin}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0', display: 'block', marginBottom: 5 }}>
                      Username or Email
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="e.g. alex or alex@company.com"
                        value={loginIdentifier}
                        onChange={(e) => setLoginIdentifier(e.target.value)}
                        required
                        style={{
                          background: '#202c33',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          borderRadius: 10,
                          padding: '12px 14px',
                          width: '100%',
                          fontSize: 14,
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0', display: 'block', marginBottom: 5 }}>
                      Password
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showLoginPassword ? 'text' : 'password'}
                        className="input-field"
                        placeholder="Enter password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                        style={{
                          background: '#202c33',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          borderRadius: 10,
                          padding: '12px 42px 12px 14px',
                          width: '100%',
                          fontSize: 14,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPassword(!showLoginPassword)}
                        style={{
                          position: 'absolute',
                          right: 12,
                          top: 12,
                          background: 'none',
                          border: 'none',
                          color: '#8696a0',
                          cursor: 'pointer',
                        }}
                      >
                        {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '13px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      opacity: loading ? 0.7 : 1,
                    }}
                  >
                    {loading ? <RefreshCw size={16} className="spin" /> : 'Continue'}
                    {!loading && <ArrowRight size={16} />}
                  </button>
                </form>
              ) : (
                /* Step 2: Sign-in OTP */
                <form onSubmit={handleVerifyLoginOtp}>
                  <div style={{ textAlign: 'center', marginBottom: 18 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Verify Your Sign-In</div>
                    <div style={{ fontSize: 12.5, color: '#8696a0' }}>
                      Enter the 6-digit verification code sent to:
                      <br />
                      <strong style={{ color: '#ffffff' }}>{targetEmail}</strong>
                    </div>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <input
                      type="text"
                      maxLength={6}
                      className="input-field"
                      placeholder="0 0 0 0 0 0"
                      value={loginOtpCode}
                      onChange={(e) => setLoginOtpCode(e.target.value.replace(/\D/g, ''))}
                      autoFocus
                      required
                      style={{
                        background: '#202c33',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        borderRadius: 10,
                        padding: '12px',
                        fontSize: 22,
                        letterSpacing: '8px',
                        textAlign: 'center',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        width: '100%',
                      }}
                    />
                  </div>

                  {loginDevOtp && (
                    <div style={{ marginBottom: 16, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setLoginOtpCode(loginDevOtp)}
                        style={{
                          background: 'none',
                          border: 'none',
                          fontSize: 11,
                          color: '#8696a0',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        (Dev environment: Click to view code: {loginDevOtp})
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '13px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      marginBottom: 10,
                    }}
                  >
                    {loading ? <RefreshCw size={16} className="spin" /> : 'Confirm & Sign In'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setLoginStep('CREDENTIALS')}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#8696a0',
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    ← Back to credentials
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ================= TAB 2: CREATE ACCOUNT ================= */}
          {tab === 'REGISTER' && (
            <div>
              {/* Step 1: Email */}
              {registerStep === 'EMAIL' && (
                <form onSubmit={handleSendRegisterOtp}>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0', display: 'block', marginBottom: 5 }}>
                      Work or Personal Email
                    </label>
                    <input
                      type="email"
                      className="input-field"
                      placeholder="e.g. name@company.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      required
                      style={{
                        background: '#202c33',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        borderRadius: 10,
                        padding: '12px 14px',
                        width: '100%',
                        fontSize: 14,
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '13px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    {loading ? <RefreshCw size={16} className="spin" /> : 'Send Verification Code'}
                    {!loading && <ArrowRight size={16} />}
                  </button>
                </form>
              )}

              {/* Step 2: Verification Code */}
              {registerStep === 'OTP' && (
                <form onSubmit={handleVerifyOtpStep}>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Check your inbox</div>
                    <div style={{ fontSize: 12.5, color: '#8696a0' }}>
                      Enter the 6-digit code sent to <strong style={{ color: '#ffffff' }}>{regEmail}</strong>
                    </div>
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <input
                      type="text"
                      maxLength={6}
                      className="input-field"
                      placeholder="0 0 0 0 0 0"
                      value={regOtpCode}
                      onChange={(e) => setRegOtpCode(e.target.value.replace(/\D/g, ''))}
                      autoFocus
                      required
                      style={{
                        background: '#202c33',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: '#ffffff',
                        borderRadius: 10,
                        padding: '12px',
                        fontSize: 22,
                        letterSpacing: '8px',
                        textAlign: 'center',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        width: '100%',
                      }}
                    />
                  </div>

                  {regDevOtp && (
                    <div style={{ marginBottom: 16, textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => setRegOtpCode(regDevOtp)}
                        style={{
                          background: 'none',
                          border: 'none',
                          fontSize: 11,
                          color: '#8696a0',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                      >
                        (Dev environment: Click to view code: {regDevOtp})
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '13px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      marginBottom: 10,
                    }}
                  >
                    {loading ? <RefreshCw size={16} className="spin" /> : 'Confirm Code'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setRegisterStep('EMAIL')}
                    style={{
                      width: '100%',
                      padding: '10px',
                      background: 'none',
                      border: 'none',
                      color: '#8696a0',
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    ← Change email
                  </button>
                </form>
              )}

              {/* Step 3: Profile Details */}
              {registerStep === 'PROFILE' && (
                <form onSubmit={handleProfileStepSubmit}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0', display: 'block', marginBottom: 4 }}>
                      Full Name *
                    </label>
                    <input
                      type="text"
                      className="input-field"
                      placeholder="e.g. Muhammad Nawaz"
                      value={regDisplayName}
                      onChange={(e) => setRegDisplayName(e.target.value)}
                      required
                      style={{
                        background: '#202c33',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        borderRadius: 10,
                        padding: '10px 12px',
                        width: '100%',
                        fontSize: 14,
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0' }}>Username *</label>
                      {usernameStatus.checking ? (
                        <span style={{ fontSize: 11, color: '#8696a0' }}>Checking...</span>
                      ) : usernameStatus.available === true ? (
                        <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>✓ Available</span>
                      ) : usernameStatus.available === false ? (
                        <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600 }}>✕ Taken</span>
                      ) : null}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 12, top: 11, color: '#8696a0', fontSize: 14 }}>@</span>
                      <input
                        type="text"
                        className="input-field"
                        placeholder="unique_username"
                        value={regUsername}
                        onChange={(e) => {
                          const val = e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '');
                          setRegUsername(val);
                          checkUsernameAvailability(val);
                        }}
                        required
                        style={{
                          background: '#202c33',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          borderRadius: 10,
                          padding: '10px 12px 10px 30px',
                          width: '100%',
                          fontSize: 14,
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0', display: 'block', marginBottom: 4 }}>
                      Password (min 8 chars, letters & numbers) *
                    </label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showRegPassword ? 'text' : 'password'}
                        className="input-field"
                        placeholder="At least 8 characters"
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        required
                        style={{
                          background: '#202c33',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#ffffff',
                          borderRadius: 10,
                          padding: '10px 42px 10px 12px',
                          width: '100%',
                          fontSize: 14,
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPassword(!showRegPassword)}
                        style={{
                          position: 'absolute',
                          right: 12,
                          top: 10,
                          background: 'none',
                          border: 'none',
                          color: '#8696a0',
                          cursor: 'pointer',
                        }}
                      >
                        {showRegPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginBottom: 18 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#8696a0', display: 'block', marginBottom: 4 }}>
                      Confirm Password *
                    </label>
                    <input
                      type="password"
                      className="input-field"
                      placeholder="Repeat password"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      required
                      style={{
                        background: '#202c33',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#ffffff',
                        borderRadius: 10,
                        padding: '10px 12px',
                        width: '100%',
                        fontSize: 14,
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    style={{
                      width: '100%',
                      padding: '13px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    <span>Next: Profile Photo</span>
                    <ArrowRight size={16} />
                  </button>
                </form>
              )}

              {/* Step 4: Avatar Selection */}
              {registerStep === 'AVATAR' && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ marginBottom: 16 }}>
                    <div
                      style={{
                        width: 88,
                        height: 88,
                        borderRadius: '50%',
                        margin: '0 auto 12px',
                        overflow: 'hidden',
                        background: '#202c33',
                        border: '2px solid #10b981',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <UserIcon size={40} color="#8696a0" />
                      )}
                    </div>

                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 14px',
                        borderRadius: 20,
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: '#ffffff',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Camera size={14} />
                      <span>Upload Photo</span>
                      <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                  </div>

                  <div style={{ fontSize: 12, color: '#8696a0', marginBottom: 10 }}>Or pick a photo:</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 20 }}>
                    {AVATAR_PRESETS.map((preset, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setAvatarUrl(preset)}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          overflow: 'hidden',
                          border: avatarUrl === preset ? '2px solid #10b981' : '2px solid transparent',
                          padding: 0,
                          cursor: 'pointer',
                          background: 'none',
                        }}
                      >
                        <img src={preset} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleFinishRegistration}
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '13px',
                      borderRadius: 10,
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                  >
                    {loading ? <RefreshCw size={16} className="spin" /> : 'Complete Registration'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Server IP Configuration Modal */}
      {showServerModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 16,
              padding: 24,
              width: '100%',
              maxWidth: 400,
            }}
          >
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>Backend Server URL</h3>
            <p style={{ fontSize: 12, color: '#8696a0', margin: '0 0 14px' }}>
              Configure the IP where TeamTalk backend API is running:
            </p>

            <input
              type="text"
              className="input-field"
              value={serverUrlVal}
              onChange={(e) => setServerUrlVal(e.target.value)}
              placeholder="http://192.168.10.2:4000"
              style={{
                width: '100%',
                marginBottom: 12,
                background: '#0f172a',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: 8,
                padding: '10px',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />

            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setServerUrlVal('http://192.168.10.5:4000')}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Laptop Wi-Fi (192.168.10.5:4000)
              </button>
              <button
                type="button"
                onClick={() => setServerUrlVal('http://10.0.2.2:4000')}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#ffffff',
                  cursor: 'pointer',
                }}
              >
                Emulator (10.0.2.2:4000)
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowServerModal(false)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#8696a0',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setServerUrl(serverUrlVal);
                  disconnectSocket();
                  connectSocket();
                  setCurrentActiveServer(serverUrlVal);
                  setShowServerModal(false);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  background: '#10b981',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Save & Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
