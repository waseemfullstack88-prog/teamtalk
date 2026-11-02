import type { Request } from 'express';
import { prisma } from './db.js';
import type { Prisma } from '@prisma/client';

export type AuditAction =
  | 'INVITE_CREATED' | 'INVITE_REVOKED' | 'INVITE_USED'
  | 'USER_REGISTERED' | 'EMAIL_VERIFIED' | 'USER_APPROVED' | 'USER_DEACTIVATED' | 'USER_REACTIVATED' | 'USER_REMOVED'
  | 'ROLE_CHANGED'
  | 'LOGIN_SUCCESS' | 'LOGIN_FAILED' | 'LOGIN_NEW_DEVICE' | 'LOGIN_LOCKED' | 'LOGIN_CAPTCHA_FAILED'
  | 'LOGOUT' | 'SESSION_REVOKED' | 'SESSIONS_FORCE_LOGOUT' | 'REFRESH_TOKEN_REUSE'
  | 'PASSWORD_RESET_REQUESTED' | 'PASSWORD_RESET_DONE' | 'PASSWORD_CHANGED'
  | 'MFA_ENABLED' | 'MFA_DISABLED' | 'MFA_FAILED' | 'PASSKEY_ADDED' | 'PASSKEY_REMOVED'
  | 'FILE_ACCESS' | 'FILE_UPLOADED' | 'FILE_REJECTED'
  | 'SETTINGS_CHANGED' | 'CHAT_PROTECTED_CHANGED' | 'CHAT_DELETED' | 'GROUP_MEMBER_CHANGED'
  | 'USER_BLOCKED' | 'USER_REPORTED' | 'REPORT_RESOLVED'
  | 'SCREENSHOT_DETECTED' | 'SCREEN_RECORDING_DETECTED' | 'PROTECTED_CHAT_DENIED'
  | 'USER_REGISTERED_OTP' | 'PRIMARY_DEVICE_DISPLACED' | 'COMPANION_BROWSER_LINKED' | 'LINKED_DEVICE_UNLINKED';

export interface AuditInput {
  action: AuditAction;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  suspicious?: boolean;
  metadata?: Record<string, unknown>;
  req?: Request;
}

export const clientIp = (req?: Request) => req?.ip ?? '';

/** Append-only audit trail. Never throws: auditing must not break the request path. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? null,
        targetType: input.targetType,
        targetId: input.targetId,
        suspicious: input.suspicious ?? false,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ip: clientIp(input.req),
        userAgent: (input.req?.get('user-agent') ?? '').slice(0, 300),
      },
    });
  } catch (e) {
    console.error('[audit] failed', e);
  }
}
