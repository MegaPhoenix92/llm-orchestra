/**
 * Alert evaluation helpers.
 */

import { nanoid } from 'nanoid';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { alertRules, alertEvents } from '../db/schema.js';

export type AlertRuleType = 'cost_threshold' | 'error_rate';

export interface AlertTrigger {
  eventId: string;
  ruleId: string;
  projectId: string;
  type: AlertRuleType;
  name: string;
  value: number;
  threshold: number;
  windowMinutes: number;
  minRequests?: number | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function getWindowStart(now: Date, windowMinutes: number): Date {
  return new Date(now.getTime() - windowMinutes * 60 * 1000);
}

function shouldThrottle(lastTriggeredAt: Date | null, cooldownMinutes: number, now: Date): boolean {
  if (!lastTriggeredAt) return false;
  const cooldownMs = cooldownMinutes * 60 * 1000;
  return now.getTime() - lastTriggeredAt.getTime() < cooldownMs;
}

interface TriggerParams {
  db: Database;
  rule: {
    id: string;
    name: string;
    type: string;
  };
  projectId: string;
  value: number;
  threshold: number;
  windowMinutes: number;
  minRequests: number;
  message: string;
  metadata: Record<string, unknown>;
  now: Date;
}

async function recordAlertTrigger(params: TriggerParams): Promise<AlertTrigger> {
  const { db, rule, projectId, value, threshold, windowMinutes, minRequests, message, metadata, now } =
    params;
  const eventId = `ale_${nanoid(21)}`;

  await db.insert(alertEvents).values({
    id: eventId,
    ruleId: rule.id,
    projectId,
    type: rule.type,
    status: 'triggered',
    value: String(value),
    threshold: String(threshold),
    message,
    metadata,
    createdAt: now,
  });

  await db
    .update(alertRules)
    .set({ lastTriggeredAt: now, updatedAt: now })
    .where(eq(alertRules.id, rule.id));

  return {
    eventId,
    ruleId: rule.id,
    projectId,
    type: rule.type as AlertRuleType,
    name: rule.name,
    value,
    threshold,
    windowMinutes,
    minRequests,
    message,
    metadata,
    createdAt: now,
  };
}

export async function evaluateAlertRulesForProject(
  db: Database,
  projectId: string,
  now: Date = new Date()
): Promise<AlertTrigger[]> {
  const rules = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.projectId, projectId), eq(alertRules.enabled, true)));

  if (rules.length === 0) {
    return [];
  }

  const triggers: AlertTrigger[] = [];

  for (const rule of rules) {
    const windowMinutes = rule.windowMinutes ?? 60;
    const threshold = Number(rule.threshold ?? 0);
    const minRequests = rule.minRequests ?? 1;
    const cooldownMinutes = rule.cooldownMinutes ?? 15;

    if (shouldThrottle(rule.lastTriggeredAt, cooldownMinutes, now)) {
      continue;
    }

    const windowStart = getWindowStart(now, windowMinutes);

    if (rule.type === 'cost_threshold') {
      const costResult = await db.execute(
        sql`SELECT COALESCE(SUM(total_cost::numeric), 0) as total
            FROM traces
            WHERE project_id = ${projectId}
              AND start_time >= ${windowStart}`
      );

      const totalCost = Number((costResult.rows[0] as { total: string }).total || 0);

      if (totalCost >= threshold) {
        const message = `Cost threshold exceeded: $${totalCost.toFixed(4)} >= $${threshold.toFixed(4)}`;
        const metadata = {
          windowMinutes,
          windowStart: windowStart.toISOString(),
          totalCost,
        };

        const trigger = await recordAlertTrigger({
          db,
          rule,
          projectId,
          value: totalCost,
          threshold,
          windowMinutes,
          minRequests,
          message,
          metadata,
          now,
        });
        triggers.push(trigger);
      }
    }

    if (rule.type === 'error_rate') {
      const counts = await db.execute(
        sql`SELECT COUNT(*)::int as total,
                  COUNT(*) FILTER (WHERE status = 'error')::int as errors
            FROM traces
            WHERE project_id = ${projectId}
              AND start_time >= ${windowStart}`
      );

      const total = Number((counts.rows[0] as { total: string }).total || 0);
      const errors = Number((counts.rows[0] as { errors: string }).errors || 0);

      if (total < minRequests) {
        continue;
      }

      const errorRate = total > 0 ? errors / total : 0;

      if (errorRate >= threshold) {
        const message = `Error rate threshold exceeded: ${(errorRate * 100).toFixed(2)}% >= ${(
          threshold * 100
        ).toFixed(2)}%`;
        const metadata = {
          windowMinutes,
          windowStart: windowStart.toISOString(),
          total,
          errors,
          errorRate,
        };

        const trigger = await recordAlertTrigger({
          db,
          rule,
          projectId,
          value: errorRate,
          threshold,
          windowMinutes,
          minRequests,
          message,
          metadata,
          now,
        });
        triggers.push(trigger);
      }
    }
  }

  return triggers;
}
