import React, { useState, useEffect } from 'react';
import { Fingerprint, Lock, Shield, KeyRound, Delete, AlertCircle, CheckCircle2 } from 'lucide-react';
import { biometrics } from '../services/biometrics';

interface BiometricLockScreenProps {
  onUnlock: () => void;
  userDisplayName?: string;
}

export const BiometricLockScreen: React.FC<BiometricLockScreenProps> = ({ onUnlock, userDisplayName }) => {
  const [mode, setMode] = useState<'BIOMETRIC' | 'PIN'>('BIOMETRIC');
  const [pin, setPin] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Automatically prompt for native biometrics / screen lock on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      handleBiometricAuth();
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  const handleBiometricAuth = async () => {
    if (isScanning || success) return;
    setErrorMsg(null);
    setIsScanning(true);

    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([30, 40, 30]);
      }
    } catch {}

    try {
      const res = await biometrics.authenticate();
      if (res && res.success) {
        setSuccess(true);
        try {
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate(50);
          }
        } catch {}
        setTimeout(() => {
          onUnlock();
        }, 300);
        return;
      } else if (res && res.error) {
        setErrorMsg(res.error);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Biometric verification failed.');
    } finally {
      setIsScanning(false);
    }
  };

  const handlePinDigit = (digit: string) => {
    setErrorMsg(null);
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);

      if (newPin.length === 4) {
        // Auto verify 4-digit PIN
        setTimeout(() => {
          if (biometrics.verifyPin(newPin)) {
            setSuccess(true);
            setTimeout(() => onUnlock(), 300);
          } else {
            setErrorMsg('Incorrect PIN. Please try again.');
            setPin('');
          }
        }, 150);
      }
    }
  };

  const handlePinBackspace = () => {
    setErrorMsg(null);
    setPin((prev) => prev.slice(0, -1));
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#0b141a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'calc(var(--safe-top, 40px) + 24px) 24px calc(var(--safe-bottom, 20px) + 32px)',
        userSelect: 'none',
        fontFamily: 'var(--font-sans)',
        color: '#e9edef',
        boxSizing: 'border-box',
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'rgba(0, 168, 132, 0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid rgba(0, 168, 132, 0.3)',
          }}
        >
          <Lock size={22} color="#00a884" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: '-0.3px', color: '#e9edef' }}>
          TeamTalk Locked
        </h2>
        <p style={{ fontSize: 13, color: '#8696a0', margin: 0, maxWidth: 280, lineHeight: 1.4 }}>
          {mode === 'BIOMETRIC'
            ? 'Touch the fingerprint sensor to access your private conversations.'
            : 'Enter your 4-digit security PIN to unlock.'}
        </p>
      </div>

      {/* Center: Fingerprint Scanner or PIN Keypad */}
      {mode === 'BIOMETRIC' ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          {/* Animated Interactive Fingerprint Sensor Ring */}
          <div
            onClick={handleBiometricAuth}
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: success
                ? 'rgba(0, 168, 132, 0.25)'
                : isScanning
                ? 'rgba(0, 168, 132, 0.18)'
                : 'rgba(32, 44, 51, 0.8)',
              border: `2px solid ${success ? '#00a884' : isScanning ? '#00a884' : 'rgba(0, 168, 132, 0.4)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
              boxShadow: success
                ? '0 0 30px rgba(0, 168, 132, 0.6)'
                : isScanning
                ? '0 0 25px rgba(0, 168, 132, 0.4)'
                : '0 4px 16px rgba(0, 0, 0, 0.3)',
              transition: 'all 200ms ease',
            }}
          >
            {/* Pulsing Ripple Effect */}
            {isScanning && (
              <div
                style={{
                  position: 'absolute',
                  inset: -8,
                  borderRadius: '50%',
                  border: '2px solid rgba(0, 168, 132, 0.3)',
                  animation: 'pulseGlow 1.5s infinite',
                }}
              />
            )}

            {success ? (
              <CheckCircle2 size={56} color="#00a884" />
            ) : (
              <Fingerprint size={60} color={isScanning ? '#00a884' : '#8696a0'} />
            )}
          </div>

          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 13, color: isScanning ? '#00a884' : '#8696a0', fontWeight: 600 }}>
              {success ? 'Unlocked!' : isScanning ? 'Scanning fingerprint...' : 'Tap sensor to verify'}
            </span>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                fontSize: 12,
                maxWidth: 290,
                textAlign: 'center',
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      ) : (
        /* PIN Keypad Mode */
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, width: '100%', maxWidth: 280 }}>
          {/* PIN Dots Display */}
          <div style={{ display: 'flex', gap: 16, margin: '10px 0' }}>
            {[0, 1, 2, 3].map((idx) => (
              <div
                key={idx}
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: idx < pin.length ? '#00a884' : 'transparent',
                  border: `2px solid ${idx < pin.length ? '#00a884' : '#8696a0'}`,
                  transition: 'all 150ms ease',
                  boxShadow: idx < pin.length ? '0 0 10px rgba(0, 168, 132, 0.5)' : 'none',
                }}
              />
            ))}
          </div>

          {/* Default PIN Display & 1-Tap Unlock */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(0, 168, 132, 0.12)',
              border: '1px solid rgba(0, 168, 132, 0.3)',
              borderRadius: 20,
              padding: '6px 14px',
              fontSize: 12,
              color: '#00a884',
            }}
          >
            <span>Default PIN: <strong>1234</strong></span>
            <button
              onClick={() => {
                setPin('1234');
                setTimeout(() => {
                  setSuccess(true);
                  setTimeout(() => onUnlock(), 250);
                }, 150);
              }}
              style={{
                background: '#00a884',
                color: '#ffffff',
                border: 'none',
                borderRadius: 10,
                padding: '3px 9px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Unlock Now
            </button>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                fontSize: 12,
              }}
            >
              <AlertCircle size={14} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Keypad Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 16,
              width: '100%',
            }}
          >
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                onClick={() => handlePinDigit(digit)}
                style={{
                  width: 68,
                  height: 68,
                  borderRadius: '50%',
                  background: '#202c33',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#e9edef',
                  fontSize: 24,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  margin: '0 auto',
                  transition: 'background 100ms ease',
                }}
              >
                {digit}
              </button>
            ))}

            <div />
            <button
              onClick={() => handlePinDigit('0')}
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: '#202c33',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                color: '#e9edef',
                fontSize: 24,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                margin: '0 auto',
              }}
            >
              0
            </button>
            <button
              onClick={handlePinBackspace}
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: 'transparent',
                border: 'none',
                color: '#8696a0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                margin: '0 auto',
              }}
              title="Delete digit"
            >
              <Delete size={22} />
            </button>
          </div>
        </div>
      )}

      {/* Bottom Switch Options */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%', maxWidth: 300 }}>
        {mode === 'BIOMETRIC' ? (
          <>
            <button
              onClick={handleBiometricAuth}
              style={{
                width: '100%',
                padding: '13px 20px',
                borderRadius: 24,
                background: '#00a884',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: 15,
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 168, 132, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Fingerprint size={18} />
              Unlock with Fingerprint
            </button>
            <button
              onClick={() => {
                setMode('PIN');
                setErrorMsg(null);
                setPin('');
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#8696a0',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <KeyRound size={15} />
              Use Passcode / PIN instead
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              setMode('BIOMETRIC');
              setErrorMsg(null);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#00a884',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Fingerprint size={18} />
            Use Fingerprint instead
          </button>
        )}
      </div>
    </div>
  );
};

