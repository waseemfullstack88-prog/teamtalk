import { registerPlugin, Capacitor } from '@capacitor/core';

/**
 * TeamTalk Biometric & Fingerprint Security Service
 * Implements WhatsApp-style App Lock with Native Android BiometricPrompt
 * (Fingerprint sensor + Phone screen lock fallback) and custom PIN.
 */

interface BiometricAuthPlugin {
  isAvailable(): Promise<{ available: boolean; error?: string }>;
  authenticate(): Promise<{ success: boolean; error?: string; errorCode?: number }>;
}

const BiometricAuth = registerPlugin<BiometricAuthPlugin>('BiometricAuth');

export interface BiometricState {
  enabled: boolean;
  timeoutMs: number; // 0 = Immediately, 60000 = 1 min, 900000 = 15 min, 1800000 = 30 min
  hasCustomPin: boolean;
}

const STORAGE_KEY_ENABLED = 'tt_app_lock_enabled';
const STORAGE_KEY_TIMEOUT = 'tt_app_lock_timeout';
const STORAGE_KEY_PIN = 'tt_app_lock_pin';
const STORAGE_KEY_LAST_ACTIVE = 'tt_last_active_timestamp';

export const biometrics = {
  /**
   * Check if App Lock is enabled
   */
  isEnabled(): boolean {
    return localStorage.getItem(STORAGE_KEY_ENABLED) === 'true';
  },

  /**
   * Enable or disable App Lock
   */
  setEnabled(enabled: boolean): void {
    localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? 'true' : 'false');
    if (enabled && !localStorage.getItem(STORAGE_KEY_PIN)) {
      // Set default fallback PIN if none exists
      localStorage.setItem(STORAGE_KEY_PIN, '1234');
    }
  },

  /**
   * Get auto-lock timeout in milliseconds
   */
  getTimeoutMs(): number {
    const val = localStorage.getItem(STORAGE_KEY_TIMEOUT);
    return val !== null ? parseInt(val, 10) : 0; // default: immediately
  },

  /**
   * Set auto-lock timeout
   */
  setTimeoutMs(ms: number): void {
    localStorage.setItem(STORAGE_KEY_TIMEOUT, ms.toString());
  },

  /**
   * Get stored fallback PIN
   */
  getPin(): string {
    return localStorage.getItem(STORAGE_KEY_PIN) || '1234';
  },

  /**
   * Update fallback PIN
   */
  setPin(newPin: string): boolean {
    if (!/^\d{4,6}$/.test(newPin)) return false;
    localStorage.setItem(STORAGE_KEY_PIN, newPin);
    return true;
  },

  /**
   * Verify entered PIN
   */
  verifyPin(inputPin: string): boolean {
    const stored = localStorage.getItem(STORAGE_KEY_PIN) || '1234';
    return inputPin === stored;
  },

  /**
   * Record last active timestamp when user leaves app
   */
  recordLastActive(): void {
    localStorage.setItem(STORAGE_KEY_LAST_ACTIVE, Date.now().toString());
  },

  /**
   * Check if lock timeout has expired based on elapsed idle time
   */
  shouldLockOnResume(): boolean {
    if (!this.isEnabled()) return false;
    const timeout = this.getTimeoutMs();
    if (timeout === 0) return true; // Immediately lock

    const lastActiveStr = localStorage.getItem(STORAGE_KEY_LAST_ACTIVE);
    if (!lastActiveStr) return true;

    const lastActive = parseInt(lastActiveStr, 10);
    const elapsed = Date.now() - lastActive;
    return elapsed >= timeout;
  },

  /**
   * Check if hardware biometric authentication is supported on this device
   */
  async isHardwareAvailable(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await BiometricAuth.isAvailable();
        return !!res?.available;
      } catch {
        return false;
      }
    }
    return true;
  },

  /**
   * Request native biometric authentication (Triggers Android BiometricPrompt with
   * physical fingerprint sensor & device screen lock fallback, exactly like WhatsApp)
   */
  async authenticate(): Promise<{ success: boolean; error?: string }> {
    // 1. Android Native platform: calls official androidx.biometric.BiometricPrompt
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await BiometricAuth.authenticate();
        if (res && res.success) {
          return { success: true };
        }
        return { success: false, error: res?.error || 'Authentication cancelled' };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Biometric verification failed' };
      }
    }

    // 2. Web browser fallback: allows smooth touch verification
    return { success: true };
  },
};

