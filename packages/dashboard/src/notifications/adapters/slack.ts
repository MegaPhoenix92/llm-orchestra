/**
 * Slack Notification Adapter
 *
 * Sends alert notifications to Slack using incoming webhooks with Block Kit formatting.
 */

import type { NotificationChannel } from '../../db/schema.js';
import type {
  NotificationChannelAdapter,
  NotificationPayload,
  DeliveryResult,
  SlackConfig,
} from '../types.js';

/**
 * Slack Block Kit element structure for context blocks
 */
interface SlackContextElement {
  type: string;
  text?: string; // For mrkdwn type, text is a direct string
}

/**
 * Slack Block Kit message structure
 */
interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  accessory?: {
    type: string;
    text?: { type: string; text: string };
    url?: string;
  };
  elements?: SlackContextElement[];
}

interface SlackMessage {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  text: string; // Fallback text for notifications
  blocks?: SlackBlock[]; // Rich Block Kit formatting
}

export class SlackAdapter implements NotificationChannelAdapter {
  readonly type = 'slack' as const;

  async send(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<DeliveryResult> {
    const config = channel.config as SlackConfig;

    try {
      const message = this.buildMessage(config, payload);
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      // Slack webhooks return 'ok' on success
      const responseText = await response.text();

      if (response.ok && responseText === 'ok') {
        return {
          success: true,
          statusCode: response.status,
          // Slack webhooks don't return a message timestamp
          // ts is only available via the Web API
        };
      }

      return {
        success: false,
        statusCode: response.status,
        error: responseText || `HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: message,
        retryable: true, // Network errors are retryable
      };
    }
  }

  async testConnection(channel: NotificationChannel): Promise<DeliveryResult> {
    const config = channel.config as SlackConfig;

    try {
      const testMessage: SlackMessage = {
        channel: config.channel,
        username: config.username || 'LLM Orchestra',
        icon_emoji: config.iconEmoji || ':robot_face:',
        text: 'LLM Orchestra notification channel test successful!',
        blocks:
          config.useBlockKit !== false
            ? [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: '*Connection Test Successful*\n\nThis Slack channel is now connected to LLM Orchestra and will receive alert notifications.',
                  },
                },
                {
                  type: 'context',
                  elements: [
                    {
                      type: 'mrkdwn',
                      text: `Channel: *${channel.name}* | Project: Connected`,
                    },
                  ],
                },
              ]
            : undefined,
      };

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testMessage),
      });

      const responseText = await response.text();

      if (response.ok && responseText === 'ok') {
        return { success: true, statusCode: response.status };
      }

      return {
        success: false,
        statusCode: response.status,
        error: responseText || `HTTP ${response.status}`,
        retryable: false,
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
    const c = config as Partial<SlackConfig>;

    if (!c.webhookUrl) {
      errors.push('webhookUrl is required');
    } else if (
      !c.webhookUrl.startsWith('https://hooks.slack.com/') &&
      !c.webhookUrl.startsWith('https://hooks.example.com/') // Allow test URLs
    ) {
      errors.push('webhookUrl must be a valid Slack webhook URL');
    }

    if (c.channel && !c.channel.startsWith('#') && !c.channel.startsWith('@')) {
      errors.push('channel must start with # (channel) or @ (user)');
    }

    return errors;
  }

  /**
   * Build a Slack message with Block Kit formatting
   */
  private buildMessage(config: SlackConfig, payload: NotificationPayload): SlackMessage {
    const { alertRule, alertEvent, project } = payload;

    // Severity emoji and color
    const severityInfo = this.getSeverityInfo(alertEvent.severity);

    // Fallback text for notifications
    const fallbackText = `${severityInfo.emoji} Alert: ${alertRule.name} triggered in ${project.name}`;

    const message: SlackMessage = {
      channel: config.channel,
      username: config.username || 'LLM Orchestra',
      icon_emoji: config.iconEmoji || ':robot_face:',
      text: fallbackText,
    };

    // Use Block Kit formatting unless disabled
    if (config.useBlockKit !== false) {
      message.blocks = this.buildBlocks(payload, severityInfo);
    }

    return message;
  }

  /**
   * Build Block Kit blocks for rich formatting
   */
  private buildBlocks(
    payload: NotificationPayload,
    severityInfo: { emoji: string; color: string }
  ): SlackBlock[] {
    const { alertRule, alertEvent, project, organization, dashboardUrl } = payload;

    const blocks: SlackBlock[] = [
      // Header
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityInfo.emoji} Alert: ${alertRule.name}`,
          emoji: true,
        },
      },
      // Alert details section
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${alertEvent.severity.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Current Value:*\n${this.formatValue(alertRule.type, alertEvent.currentValue)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Threshold:*\n${this.formatValue(alertRule.type, alertRule.threshold)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Window:*\n${alertRule.windowMinutes} minutes`,
          },
        ],
      },
      // Project info
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Project:* ${project.name}\n*Organization:* ${organization.name}`,
        },
      },
    ];

    // Add dashboard link if available
    if (dashboardUrl) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'View alert details in the dashboard:',
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'View Alert',
          },
          url: dashboardUrl,
        },
      });
    }

    // Timestamp context
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Triggered at ${alertEvent.triggeredAt.toISOString()} | Alert ID: ${alertEvent.id}`,
        },
      ],
    });

    return blocks;
  }

  /**
   * Get severity-specific emoji and color
   */
  private getSeverityInfo(severity: string): { emoji: string; color: string } {
    switch (severity) {
      case 'critical':
        return { emoji: '[CRITICAL]', color: '#FF0000' };
      case 'warning':
        return { emoji: '[WARNING]', color: '#FFCC00' };
      case 'info':
        return { emoji: '[INFO]', color: '#0066FF' };
      default:
        return { emoji: '[ALERT]', color: '#808080' };
    }
  }

  /**
   * Format value based on alert type
   */
  private formatValue(type: string, value: number): string {
    switch (type) {
      case 'cost_threshold':
        return `$${value.toFixed(2)}`;
      case 'error_rate':
        return `${(value * 100).toFixed(1)}%`;
      case 'latency':
        return `${value.toFixed(0)}ms`;
      default:
        return value.toString();
    }
  }
}
