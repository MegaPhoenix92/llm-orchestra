/**
 * Notification Delivery Dispatcher
 *
 * Processes queued notification deliveries with retry logic.
 * Mirrors the webhook dispatcher pattern.
 */

import { nanoid } from 'nanoid';
import { eq, and, lte, sql, asc } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { notificationChannels, notificationDeliveries } from '../db/schema.js';
import type {
  NotificationChannel,
  NotificationPayload,
  NotificationWorkerConfig,
  ChannelType,
} from './types.js';
import { getNotificationAdapter } from './registry.js';
import {
  decryptIfNeeded,
  validateEncryptionConfig,
  type EncryptionConfig,
} from '../auth/encryption.js';

/**
 * Sensitive fields by channel type that must be decrypted before use
 */
const SENSITIVE_CHANNEL_FIELDS: Record<string, string[]> = {
  slack: ['webhookUrl'],
  email: ['apiKey', 'smtpPassword', 'smtpUser'],
  pagerduty: ['routingKey'],
};

/**
 * Decrypt sensitive fields in a notification channel config before use
 * @param type - The channel type (slack, email, pagerduty)
 * @param config - The config object with potentially encrypted values
 * @param encryption - The encryption configuration (optional)
 * @returns A new config object with sensitive fields decrypted
 */
function decryptChannelConfig(
  type: string,
  config: Record<string, unknown>,
  encryption?: EncryptionConfig
): Record<string, unknown> {
  if (!encryption || !validateEncryptionConfig(encryption)) {
    return config;
  }

  const sensitiveFields = SENSITIVE_CHANNEL_FIELDS[type] || [];
  const decrypted = { ...config };

  for (const field of sensitiveFields) {
    const value = decrypted[field];
    if (value && typeof value === 'string' && value.length > 0) {
      decrypted[field] = decryptIfNeeded(value, encryption);
    }
  }

  return decrypted;
}

// Default configuration values (encryption is optional, so not in Required type)
const DEFAULTS: Omit<Required<NotificationWorkerConfig>, 'encryption'> = {
  intervalMs: 5000,
  batchSize: 25,
  maxAttempts: 5,
  baseBackoffMs: 15000,
  enabled: true,
};

/**
 * Hydrate a notification payload from JSONB storage
 *
 * When NotificationPayload is stored in JSONB, Date objects are serialized
 * as ISO strings. This function converts them back to Date objects so that
 * adapters can call .toISOString() without runtime errors.
 */
function hydratePayload(payload: unknown): NotificationPayload {
  const p = payload as NotificationPayload;
  return {
    ...p,
    alertEvent: {
      ...p.alertEvent,
      triggeredAt:
        p.alertEvent.triggeredAt instanceof Date
          ? p.alertEvent.triggeredAt
          : new Date(p.alertEvent.triggeredAt as unknown as string),
    },
  };
}

// Worker state
let workerInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

/**
 * Normalize error message to a reasonable length
 */
function normalizeError(message: string): string {
  if (!message) return 'Unknown error';
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

/**
 * Enqueue notification deliveries for all enabled channels matching the event type
 */
export async function enqueueNotificationDeliveries(
  db: Database,
  projectId: string,
  eventType: string,
  eventId: string | null,
  payload: NotificationPayload
): Promise<string[]> {
  // Find all enabled channels for this project that subscribe to this event type
  const channels = await db
    .select()
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.projectId, projectId),
        eq(notificationChannels.enabled, true)
      )
    );

  // Filter channels by event type subscription
  const matchingChannels = channels.filter((channel) => {
    const events = (channel.events as string[]) || [];
    // If no events specified, default to receiving all events
    return events.length === 0 || events.includes(eventType);
  });

  if (matchingChannels.length === 0) {
    return [];
  }

  const now = new Date();
  const deliveryIds: string[] = [];

  for (const channel of matchingChannels) {
    const deliveryId = `nfd_${nanoid(21)}`;
    deliveryIds.push(deliveryId);

    await db.insert(notificationDeliveries).values({
      id: deliveryId,
      channelId: channel.id,
      eventId,
      eventType,
      payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  return deliveryIds;
}

/**
 * Process pending notification deliveries
 */
export async function processNotificationDeliveries(
  db: Database,
  options: NotificationWorkerConfig = {}
): Promise<{ processed: number; succeeded: number; failed: number }> {
  const config = { ...DEFAULTS, ...options };

  if (isProcessing) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  isProcessing = true;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const now = new Date();

    // Get pending deliveries that are ready to be processed
    const pendingDeliveries = await db
      .select({
        delivery: notificationDeliveries,
        channel: notificationChannels,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notificationChannels,
        eq(notificationDeliveries.channelId, notificationChannels.id)
      )
      .where(
        and(
          eq(notificationDeliveries.status, 'pending'),
          lte(notificationDeliveries.nextAttemptAt, now)
        )
      )
      .orderBy(asc(notificationDeliveries.nextAttemptAt))
      .limit(config.batchSize);

    for (const { delivery, channel } of pendingDeliveries) {
      processed++;

      const result = await processDelivery(db, delivery, channel, config);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    }
  } finally {
    isProcessing = false;
  }

  return { processed, succeeded, failed };
}

/**
 * Process a single delivery
 */
async function processDelivery(
  db: Database,
  delivery: typeof notificationDeliveries.$inferSelect,
  channel: NotificationChannel,
  config: NotificationWorkerConfig & Omit<Required<NotificationWorkerConfig>, 'encryption'>
): Promise<{ success: boolean }> {
  const now = new Date();
  const attempts = delivery.attempts + 1;

  try {
    // Get the appropriate adapter
    const adapter = getNotificationAdapter(channel.type as ChannelType);

    // Decrypt sensitive fields in channel config before passing to adapter
    const decryptedConfig = decryptChannelConfig(
      channel.type,
      channel.config as Record<string, unknown>,
      config.encryption
    );
    const channelWithDecryptedConfig = {
      ...channel,
      config: decryptedConfig,
    };

    // Hydrate the payload to convert JSONB-serialized dates back to Date objects
    const payload = hydratePayload(delivery.payload);
    const result = await adapter.send(channelWithDecryptedConfig, payload);

    if (result.success) {
      // Mark as succeeded
      await db
        .update(notificationDeliveries)
        .set({
          status: 'success',
          attempts,
          lastAttemptAt: now,
          responseCode: result.statusCode,
          externalId: result.externalId,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id));

      return { success: true };
    }

    // Handle failure
    const shouldRetry = result.retryable !== false && attempts < config.maxAttempts;

    if (shouldRetry) {
      // Calculate next attempt time with exponential backoff
      const backoffMs = config.baseBackoffMs * Math.pow(2, attempts - 1);
      const nextAttemptAt = new Date(now.getTime() + backoffMs);

      await db
        .update(notificationDeliveries)
        .set({
          attempts,
          lastAttemptAt: now,
          nextAttemptAt,
          responseCode: result.statusCode,
          error: result.error ? normalizeError(result.error) : null,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    } else {
      // Max attempts reached or non-retryable error
      await db
        .update(notificationDeliveries)
        .set({
          status: 'failed',
          attempts,
          lastAttemptAt: now,
          responseCode: result.statusCode,
          error: result.error ? normalizeError(result.error) : null,
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    }

    return { success: false };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const shouldRetry = attempts < config.maxAttempts;

    if (shouldRetry) {
      const backoffMs = config.baseBackoffMs * Math.pow(2, attempts - 1);
      const nextAttemptAt = new Date(now.getTime() + backoffMs);

      await db
        .update(notificationDeliveries)
        .set({
          attempts,
          lastAttemptAt: now,
          nextAttemptAt,
          error: normalizeError(errorMessage),
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    } else {
      await db
        .update(notificationDeliveries)
        .set({
          status: 'failed',
          attempts,
          lastAttemptAt: now,
          error: normalizeError(errorMessage),
          updatedAt: now,
        })
        .where(eq(notificationDeliveries.id, delivery.id));
    }

    return { success: false };
  }
}

/**
 * Start the notification delivery worker
 */
export function startNotificationWorker(
  db: Database,
  options: NotificationWorkerConfig = {}
): void {
  const config = { ...DEFAULTS, ...options };

  if (!config.enabled) {
    console.log('[Notifications] Worker disabled');
    return;
  }

  if (workerInterval) {
    console.log('[Notifications] Worker already running');
    return;
  }

  console.log(
    `[Notifications] Starting worker (interval: ${config.intervalMs}ms, batch: ${config.batchSize})`
  );

  workerInterval = setInterval(async () => {
    try {
      const result = await processNotificationDeliveries(db, config);
      if (result.processed > 0) {
        console.log(
          `[Notifications] Processed ${result.processed} deliveries: ` +
            `${result.succeeded} succeeded, ${result.failed} failed`
        );
      }
    } catch (error) {
      console.error('[Notifications] Worker error:', error);
    }
  }, config.intervalMs);

  // Allow the process to exit even if the interval is running
  workerInterval.unref?.();
}

/**
 * Stop the notification delivery worker
 */
export function stopNotificationWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('[Notifications] Worker stopped');
  }
}

/**
 * Check if the worker is running
 */
export function isNotificationWorkerRunning(): boolean {
  return workerInterval !== null;
}

/**
 * Get delivery statistics for a project
 */
export async function getDeliveryStats(
  db: Database,
  projectId: string,
  since?: Date
): Promise<{
  total: number;
  pending: number;
  success: number;
  failed: number;
}> {
  const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default 24h

  const stats = await db
    .select({
      status: notificationDeliveries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationChannels,
      eq(notificationDeliveries.channelId, notificationChannels.id)
    )
    .where(
      and(
        eq(notificationChannels.projectId, projectId),
        sql`${notificationDeliveries.createdAt} >= ${sinceDate}`
      )
    )
    .groupBy(notificationDeliveries.status);

  const result = {
    total: 0,
    pending: 0,
    success: 0,
    failed: 0,
  };

  for (const row of stats) {
    const count = row.count;
    result.total += count;
    if (row.status === 'pending') result.pending = count;
    if (row.status === 'success') result.success = count;
    if (row.status === 'failed') result.failed = count;
  }

  return result;
}
