/**
 * Webhook dispatch helpers for alert events.
 */

import { createHmac } from 'crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Database } from '../db/index.js';
import { webhookDeliveries, webhooks } from '../db/schema.js';
import {
  decryptIfNeeded,
  isEncrypted,
  validateEncryptionConfig,
  type EncryptionConfig,
} from '../auth/encryption.js';
import type { AlertTrigger } from '../alerts/evaluator.js';

const ALERT_EVENT_TYPE = 'alert.triggered';
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 15_000;

export interface WebhookWorkerOptions {
  db: Database;
  encryption?: EncryptionConfig;
  intervalMs?: number;
  batchSize?: number;
  requestTimeoutMs?: number;
}

function buildAlertPayload(trigger: AlertTrigger): Record<string, unknown> {
  return {
    id: trigger.eventId,
    type: ALERT_EVENT_TYPE,
    createdAt: trigger.createdAt.toISOString(),
    data: {
      ruleId: trigger.ruleId,
      projectId: trigger.projectId,
      name: trigger.name,
      type: trigger.type,
      value: trigger.value,
      threshold: trigger.threshold,
      windowMinutes: trigger.windowMinutes,
      minRequests: trigger.minRequests,
      message: trigger.message,
      metadata: trigger.metadata,
    },
  };
}

function normalizeError(message: string): string {
  if (!message) return 'Unknown error';
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}

function getNextAttemptAt(now: Date, attempts: number): Date {
  const multiplier = Math.max(1, Math.pow(2, Math.max(0, attempts - 1)));
  const delay = BASE_BACKOFF_MS * multiplier;
  return new Date(now.getTime() + delay);
}

export async function enqueueAlertWebhookDeliveries(
  db: Database,
  triggers: AlertTrigger[],
  now: Date = new Date()
): Promise<number> {
  if (triggers.length === 0) {
    return 0;
  }

  const triggersByProject = new Map<string, AlertTrigger[]>();
  for (const trigger of triggers) {
    const list = triggersByProject.get(trigger.projectId) ?? [];
    list.push(trigger);
    triggersByProject.set(trigger.projectId, list);
  }

  const deliveries: Array<{
    id: string;
    webhookId: string;
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    status: 'pending';
    attempts: number;
    nextAttemptAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  for (const [projectId, projectTriggers] of triggersByProject.entries()) {
    const hookRows = await db
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.projectId, projectId), eq(webhooks.enabled, true)));

    const activeHooks = hookRows.filter((hook) =>
      (hook.events ?? []).includes(ALERT_EVENT_TYPE)
    );

    if (activeHooks.length === 0) {
      continue;
    }

    for (const trigger of projectTriggers) {
      const payload = buildAlertPayload(trigger);
      for (const hook of activeHooks) {
        deliveries.push({
          id: `whd_${nanoid(21)}`,
          webhookId: hook.id,
          eventId: trigger.eventId,
          eventType: ALERT_EVENT_TYPE,
          payload,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  if (deliveries.length === 0) {
    return 0;
  }

  await db.insert(webhookDeliveries).values(deliveries);
  return deliveries.length;
}

export async function processWebhookDeliveries(
  options: WebhookWorkerOptions
): Promise<number> {
  const { db } = options;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const now = new Date();
  const encryptionEnabled = validateEncryptionConfig(options.encryption);

  const dueDeliveries = await db
    .select({
      id: webhookDeliveries.id,
      webhookId: webhookDeliveries.webhookId,
      eventId: webhookDeliveries.eventId,
      eventType: webhookDeliveries.eventType,
      payload: webhookDeliveries.payload,
      attempts: webhookDeliveries.attempts,
      webhookUrl: webhooks.url,
      webhookSecret: webhooks.secret,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(
      and(
        eq(webhookDeliveries.status, 'pending'),
        lte(webhookDeliveries.nextAttemptAt, now),
        eq(webhooks.enabled, true)
      )
    )
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(batchSize);

  if (dueDeliveries.length === 0) {
    return 0;
  }

  await Promise.all(
    dueDeliveries.map(async (delivery) => {
      const attemptNumber = delivery.attempts + 1;
      const payloadBody = JSON.stringify(delivery.payload ?? {});
      let success = false;
      let responseCode: number | null = null;
      let errorMessage: string | null = null;

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'llm-orchestra-dashboard/alerts',
          'X-Orchestra-Event': delivery.eventType,
          'X-Orchestra-Delivery-Id': delivery.id,
        };

        if (delivery.eventId) {
          headers['X-Orchestra-Event-Id'] = delivery.eventId;
        }

        if (delivery.webhookSecret) {
          if (isEncrypted(delivery.webhookSecret) && !encryptionEnabled) {
            throw new Error('Encrypted webhook secret requires encryption config');
          }

          const secret =
            encryptionEnabled && options.encryption
              ? decryptIfNeeded(delivery.webhookSecret, options.encryption)
              : delivery.webhookSecret;
          const timestamp = Math.floor(now.getTime() / 1000).toString();
          const signaturePayload = `${timestamp}.${payloadBody}`;
          const signature = createHmac('sha256', secret)
            .update(signaturePayload)
            .digest('hex');

          headers['X-Orchestra-Timestamp'] = timestamp;
          headers['X-Orchestra-Signature'] = `sha256=${signature}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        let response: Response;
        try {
          response = await fetch(delivery.webhookUrl, {
            method: 'POST',
            headers,
            body: payloadBody,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        responseCode = response.status;
        success = response.ok;
        if (!response.ok) {
          errorMessage = response.statusText || `HTTP ${response.status}`;
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Webhook delivery failed';
      }

      const shouldFail = !success && attemptNumber >= MAX_ATTEMPTS;
      const updateData = {
        status: success ? 'success' : shouldFail ? 'failed' : 'pending',
        attempts: attemptNumber,
        lastAttemptAt: now,
        nextAttemptAt: success ? now : getNextAttemptAt(now, attemptNumber),
        responseCode,
        error: errorMessage ? normalizeError(errorMessage) : null,
        updatedAt: now,
      } as const;

      await db
        .update(webhookDeliveries)
        .set(updateData)
        .where(eq(webhookDeliveries.id, delivery.id));
    })
  );

  return dueDeliveries.length;
}

export function startWebhookWorker(options: WebhookWorkerOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let isProcessing = false;

  const interval = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await processWebhookDeliveries(options);
    } catch (error) {
      console.error('Webhook worker error:', error);
    } finally {
      isProcessing = false;
    }
  }, intervalMs);

  interval.unref?.();

  return () => {
    clearInterval(interval);
  };
}
