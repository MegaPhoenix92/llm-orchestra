/**
 * Alert evaluation helpers.
 */

import { nanoid } from 'nanoid';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { alertRules, alertEvents, projects, organizations } from '../db/schema.js';
import { enqueueNotificationDeliveries } from '../notifications/dispatcher.js';
import type { NotificationPayload } from '../notifications/types.js';

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
    type: AlertRuleType;
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
    type: rule.type,
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

/**
 * Determine alert severity based on how much the threshold was exceeded
 */
function determineSeverity(
  value: number,
  threshold: number,
  type: AlertRuleType
): 'critical' | 'warning' | 'info' {
  const ratio = value / threshold;
  if (type === 'error_rate') {
    // For error rates, anything over 2x threshold is critical
    if (ratio >= 2) return 'critical';
    if (ratio >= 1.5) return 'warning';
    return 'info';
  }
  // For cost thresholds, anything over 1.5x is critical
  if (ratio >= 1.5) return 'critical';
  if (ratio >= 1.25) return 'warning';
  return 'info';
}

/**
 * Enqueue notification deliveries for an alert trigger.
 * Runs asynchronously to avoid blocking the alert evaluation.
 */
async function enqueueAlertNotifications(
  db: Database,
  trigger: AlertTrigger,
  rule: { id: string; name: string; type: AlertRuleType; threshold: string | null; windowMinutes: number | null }
): Promise<void> {
  // Note: Errors propagate to caller's .catch() handler - no inner try/catch needed
  // Fetch project and organization details
  const projectResult = await db
    .select({
      project: projects,
      organization: organizations,
    })
    .from(projects)
    .innerJoin(organizations, eq(projects.orgId, organizations.id))
    .where(eq(projects.id, trigger.projectId))
    .limit(1);

  if (projectResult.length === 0) {
    throw new Error(`Project not found for notification: ${trigger.projectId}`);
  }

  const { project, organization } = projectResult[0];
  const severity = determineSeverity(trigger.value, trigger.threshold, trigger.type);

  // Build the notification payload
  const payload: NotificationPayload = {
    alertRule: {
      id: rule.id,
      name: rule.name,
      type: rule.type,
      threshold: trigger.threshold,
      windowMinutes: trigger.windowMinutes,
    },
    alertEvent: {
      id: trigger.eventId,
      triggeredAt: trigger.createdAt,
      currentValue: trigger.value,
      severity,
    },
    project: {
      id: project.id,
      name: project.name,
    },
    organization: {
      id: organization.id,
      name: organization.name,
    },
    // Dashboard URL - use environment variable or default
    dashboardUrl: `${process.env.DASHBOARD_URL || 'http://localhost:3030'}/projects/${project.id}/alerts/${trigger.eventId}`,
  };

  // Enqueue notifications for all matching channels
  const deliveryIds = await enqueueNotificationDeliveries(
    db,
    trigger.projectId,
    'alert.triggered',
    trigger.eventId,
    payload
  );

  if (deliveryIds.length > 0) {
    console.log(
      `[Alerts] Enqueued ${deliveryIds.length} notification(s) for alert ${trigger.eventId}`
    );
  }
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

        // Enqueue notifications asynchronously (don't await to avoid blocking)
        enqueueAlertNotifications(db, trigger, rule).catch((error) => {
          console.error('[Alerts] Failed to enqueue notifications:', error);
        });
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

        // Enqueue notifications asynchronously (don't await to avoid blocking)
        enqueueAlertNotifications(db, trigger, rule).catch((error) => {
          console.error('[Alerts] Failed to enqueue notifications:', error);
        });
      }
    }
  }

  return triggers;
}
