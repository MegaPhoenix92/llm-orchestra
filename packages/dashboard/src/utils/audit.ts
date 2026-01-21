/**
 * Audit logging utilities.
 */

import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import type { Database } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export type AuditActorType = 'user' | 'api_key' | 'system';
export type AuditStatus = 'success' | 'denied' | 'error';

export interface AuditLogInput {
  orgId?: string | null;
  projectId?: string | null;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  status?: AuditStatus;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function getRequestMetadata(c: Context): { ip?: string; userAgent?: string } {
  const forwardedFor = c.req.header('x-forwarded-for');
  const ip =
    forwardedFor?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    c.req.header('cf-connecting-ip') ||
    undefined;

  return {
    ip,
    userAgent: c.req.header('user-agent') || undefined,
  };
}

export async function writeAuditLog(db: Database, input: AuditLogInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: `aud_${nanoid(21)}`,
      orgId: input.orgId ?? null,
      projectId: input.projectId ?? null,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      status: input.status ?? 'success',
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}
