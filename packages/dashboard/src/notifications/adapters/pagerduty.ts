/**
 * PagerDuty Notification Adapter
 *
 * Sends alert notifications to PagerDuty using Events API v2.
 * Supports severity mapping, auto-resolve, and deduplication.
 */

import type { NotificationChannel } from '../../db/schema.js';
import type {
  NotificationChannelAdapter,
  NotificationPayload,
  DeliveryResult,
  PagerDutyConfig,
  PagerDutySeverity,
} from '../types.js';

/**
 * PagerDuty Events API v2 endpoint
 * @see https://developer.pagerduty.com/api-reference/
 */
const PAGERDUTY_EVENTS_API = 'https://events.pagerduty.com/v2/enqueue';

/**
 * Default timeout for fetch requests (30 seconds)
 */
const FETCH_TIMEOUT_MS = 30000;

/**
 * PagerDuty event types
 */
type PagerDutyEventAction = 'trigger' | 'acknowledge' | 'resolve';

/**
 * PagerDuty Events API v2 payload
 * @see https://developer.pagerduty.com/docs/events-api-v2/trigger-events/
 */
interface PagerDutyEvent {
  routing_key: string;
  event_action: PagerDutyEventAction;
  dedup_key: string;
  payload?: {
    summary: string;
    source: string;
    severity: PagerDutySeverity;
    timestamp?: string;
    component?: string;
    group?: string;
    class?: string;
    custom_details?: Record<string, unknown>;
  };
  links?: Array<{
    href: string;
    text: string;
  }>;
  images?: Array<{
    src: string;
    href?: string;
    alt?: string;
  }>;
  client?: string;
  client_url?: string;
}

/**
 * PagerDuty API response
 */
interface PagerDutyResponse {
  status: string;
  message: string;
  dedup_key: string;
}

export class PagerDutyAdapter implements NotificationChannelAdapter {
  readonly type = 'pagerduty' as const;

  async send(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<DeliveryResult> {
    const config = channel.config as PagerDutyConfig;

    try {
      const event = this.buildTriggerEvent(config, payload);
      return await this.sendEvent(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
        retryable: true,
      };
    }
  }

  /**
   * Resolve an existing PagerDuty incident
   * Called when an alert condition clears
   */
  async resolve(
    channel: NotificationChannel,
    alertRuleId: string
  ): Promise<DeliveryResult> {
    const config = channel.config as PagerDutyConfig;

    if (config.autoResolve === false) {
      return { success: true }; // Auto-resolve disabled
    }

    try {
      const event: PagerDutyEvent = {
        routing_key: config.routingKey,
        event_action: 'resolve',
        dedup_key: this.buildDedupKey(config, alertRuleId),
      };

      return await this.sendEvent(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
        retryable: true,
      };
    }
  }

  async testConnection(channel: NotificationChannel): Promise<DeliveryResult> {
    const config = channel.config as PagerDutyConfig;

    try {
      // Send a test trigger event that we immediately resolve
      const testDedupKey = `${config.dedupKeyPrefix || 'llm-orchestra'}-test-${Date.now()}`;

      const triggerEvent: PagerDutyEvent = {
        routing_key: config.routingKey,
        event_action: 'trigger',
        dedup_key: testDedupKey,
        payload: {
          summary: 'LLM Orchestra Connection Test - This is a test notification',
          source: 'LLM Orchestra',
          severity: 'info',
          timestamp: new Date().toISOString(),
          component: 'Notification Channel',
          class: 'test',
          custom_details: {
            channel_name: channel.name,
            test: true,
            message:
              'This notification was generated to test the PagerDuty integration. It will be automatically resolved.',
          },
        },
        client: 'LLM Orchestra',
      };

      const triggerResult = await this.sendEvent(triggerEvent);

      if (!triggerResult.success) {
        return triggerResult;
      }

      // Immediately resolve the test incident
      const resolveEvent: PagerDutyEvent = {
        routing_key: config.routingKey,
        event_action: 'resolve',
        dedup_key: testDedupKey,
      };

      await this.sendEvent(resolveEvent);

      return {
        success: true,
        externalId: triggerResult.externalId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
        retryable: false,
      };
    }
  }

  validateConfig(config: unknown): string[] {
    const errors: string[] = [];
    const c = config as Partial<PagerDutyConfig>;

    if (!c.routingKey) {
      errors.push('routingKey is required');
    } else if (c.routingKey.length !== 32) {
      // PagerDuty integration keys are always 32 characters
      // @see https://support.pagerduty.com/docs/services-and-integrations
      errors.push('routingKey must be a 32-character PagerDuty integration key');
    }

    if (c.severityMapping) {
      const validSeverities: PagerDutySeverity[] = ['critical', 'error', 'warning', 'info'];
      for (const [key, value] of Object.entries(c.severityMapping)) {
        if (value && !validSeverities.includes(value as PagerDutySeverity)) {
          errors.push(`severityMapping.${key} must be one of: ${validSeverities.join(', ')}`);
        }
      }
    }

    return errors;
  }

  /**
   * Send event to PagerDuty Events API v2
   */
  private async sendEvent(event: PagerDutyEvent): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(PAGERDUTY_EVENTS_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as PagerDutyResponse;
        return {
          success: true,
          statusCode: response.status,
          externalId: data.dedup_key,
        };
      }

      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = (await response.json()) as { message?: string; errors?: string[] };
        errorMessage = errorData.message || errorData.errors?.join(', ') || errorMessage;
      } catch {
        // Ignore JSON parse errors
      }

      return {
        success: false,
        statusCode: response.status,
        error: errorMessage,
        // Rate limiting and server errors are retryable
        retryable: response.status === 429 || response.status >= 500,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timeout', retryable: true };
      }
      throw error;
    }
  }

  /**
   * Build PagerDuty trigger event from notification payload
   */
  private buildTriggerEvent(
    config: PagerDutyConfig,
    payload: NotificationPayload
  ): PagerDutyEvent {
    const { alertRule, alertEvent, project, organization, dashboardUrl } = payload;

    const severity = this.mapSeverity(config, alertRule.type, alertEvent.severity);
    const dedupKey = this.buildDedupKey(config, alertRule.id);

    const event: PagerDutyEvent = {
      routing_key: config.routingKey,
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[${alertEvent.severity.toUpperCase()}] ${alertRule.name} - ${project.name}`,
        source: `llm-orchestra:${project.id}`,
        severity,
        timestamp: alertEvent.triggeredAt.toISOString(),
        component: project.name,
        group: organization.name,
        class: alertRule.type,
        custom_details: {
          alert_rule_id: alertRule.id,
          alert_rule_name: alertRule.name,
          alert_type: alertRule.type,
          threshold: alertRule.threshold,
          current_value: alertEvent.currentValue,
          window_minutes: alertRule.windowMinutes,
          project_id: project.id,
          project_name: project.name,
          organization_id: organization.id,
          organization_name: organization.name,
          alert_event_id: alertEvent.id,
          ...config.customDetails,
        },
      },
      client: 'LLM Orchestra',
    };

    // Add dashboard link if available
    if (dashboardUrl) {
      event.links = [
        {
          href: dashboardUrl,
          text: 'View Alert in Dashboard',
        },
      ];
      event.client_url = dashboardUrl;
    }

    return event;
  }

  /**
   * Map alert severity to PagerDuty severity
   */
  private mapSeverity(
    config: PagerDutyConfig,
    alertType: string,
    alertSeverity: string
  ): PagerDutySeverity {
    // Check for type-specific mapping
    const mapping = config.severityMapping;
    if (mapping) {
      const typeKey = alertType as keyof typeof mapping;
      if (mapping[typeKey]) {
        return mapping[typeKey]!;
      }
      if (mapping.default) {
        return mapping.default;
      }
    }

    // Default mapping based on alert severity
    switch (alertSeverity) {
      case 'critical':
        return 'critical';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'error';
    }
  }

  /**
   * Build deduplication key for PagerDuty
   * Same alert rule will always use the same dedup key
   */
  private buildDedupKey(config: PagerDutyConfig, alertRuleId: string): string {
    const prefix = config.dedupKeyPrefix || 'llm-orchestra';
    return `${prefix}-${alertRuleId}`;
  }
}
