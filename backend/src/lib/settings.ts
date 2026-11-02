import { z } from 'zod';
import { prisma } from './db.js';

export const settingsSchema = z.object({
  messageRetentionDays: z.number().int().min(1).max(3650).nullable().default(null),
  disappearing: z
    .object({
      defaultSeconds: z.number().int().min(60).nullable().default(null),
      // admin-controlled list of the time limits that users may pick
      allowedSeconds: z.array(z.number().int().min(60)).max(12).default([3600, 86400, 604800, 7776000]),
    })
    .prefault({}),
  protectedChat: z
    .object({
      allowed: z.boolean().default(true), // may admins turn Protected Chat on?
      forceDisappearingSeconds: z.number().int().min(60).default(86400),
      watermark: z.boolean().default(true),
    })
    .prefault({}),
  storage: z
    .object({
      maxFileMb: z.number().int().min(1).max(2048).default(100),
      allowedMime: z
        .array(z.string().min(3).max(100))
        .max(80)
        .default([
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/x-matroska', 'video/x-msvideo',
          'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/aac',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/zip', 'text/plain', 'text/csv',
        ]),
      workspaceQuotaGb: z.number().min(1).max(10000).default(50),
    })
    .prefault({}),
  deleteForEveryoneSeconds: z.number().int().min(60).max(60 * 60 * 24 * 7).default(7200),
  requireApproval: z.boolean().default(false),
  callsEnabled: z.boolean().default(true),
  screenShareEnabled: z.boolean().default(false),
  watermarkDefault: z.boolean().default(false),
  inviteExpiryHours: z.number().int().min(1).max(720).default(72),
});

export type WorkspaceSettings = z.infer<typeof settingsSchema>;
// Admin PATCH accepts a deep partial: validate the merged result instead of the patch.
export const settingsPatchSchema = z.record(z.string(), z.unknown());

export const defaultSettings = (): WorkspaceSettings => settingsSchema.parse({});

export async function getSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const parsed = settingsSchema.safeParse(ws?.settings ?? {});
  return parsed.success ? parsed.data : defaultSettings();
}

function merge(base: unknown, patch: unknown): unknown {
  if (patch && typeof patch === 'object' && !Array.isArray(patch) && base && typeof base === 'object' && !Array.isArray(base)) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = merge(out[k], v);
    return out;
  }
  return patch;
}

/** Deep-merge a patch and validate the whole result. Returns [before, after]. */
export async function updateSettings(workspaceId: string, patch: Record<string, unknown>) {
  const before = await getSettings(workspaceId);
  const result = settingsSchema.safeParse(merge(before, patch));
  if (!result.success) throw result.error;
  await prisma.workspace.update({ where: { id: workspaceId }, data: { settings: result.data } });
  return { before, after: result.data };
}
