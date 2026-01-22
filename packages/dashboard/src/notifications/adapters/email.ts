/**
 * Email Notification Adapter
 *
 * Sends alert notifications via SMTP, SendGrid, or Resend.
 * Supports custom HTML templates and provides fallback plain text.
 *
 * Note: SMTP functionality requires nodemailer to be installed as a peer dependency.
 * Install with: npm install nodemailer @types/nodemailer
 */

import type { NotificationChannel } from '../../db/schema.js';
import type {
  NotificationChannelAdapter,
  NotificationPayload,
  DeliveryResult,
  EmailConfig,
} from '../types.js';

/**
 * Default timeout for fetch requests (30 seconds)
 */
const FETCH_TIMEOUT_MS = 30000;

/**
 * Supported email provider types
 */
const EMAIL_PROVIDERS = ['smtp', 'sendgrid', 'resend'] as const;
type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/**
 * Nodemailer transporter interface for type safety without requiring the package
 */
interface NodemailerTransporter {
  sendMail(options: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<{ messageId: string }>;
}

/**
 * Nodemailer module interface
 */
interface NodemailerModule {
  createTransport(options: {
    host?: string;
    port?: number;
    secure?: boolean;
    auth?: { user: string; pass?: string };
  }): NodemailerTransporter;
}

/**
 * Helper to dynamically import nodemailer at runtime.
 * This avoids TypeScript compile-time dependency on nodemailer types.
 */
async function loadNodemailer(): Promise<NodemailerModule> {
  // Use a variable to prevent static analysis of the import path
  const moduleName = 'nodemailer';
  const module = await import(/* webpackIgnore: true */ moduleName);
  return module.default ?? module;
}

/**
 * Email adapter for sending alert notifications via SMTP, SendGrid, or Resend.
 *
 * @example
 * ```typescript
 * const adapter = new EmailAdapter();
 * const result = await adapter.send(channel, payload);
 * ```
 */
export class EmailAdapter implements NotificationChannelAdapter {
  readonly type = 'email' as const;

  /**
   * Send a notification email through the configured provider.
   *
   * @param channel - The notification channel configuration
   * @param payload - The notification payload containing alert details
   * @returns Delivery result indicating success or failure
   */
  async send(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<DeliveryResult> {
    const config = channel.config as EmailConfig;

    const subject = this.buildSubject(payload);
    const html = this.buildHtml(payload, config);
    const text = this.buildText(payload);

    return this.sendWithProvider(config, subject, html, text);
  }

  /**
   * Test the channel connection by sending a test notification.
   *
   * @param channel - The notification channel to test
   * @returns Delivery result indicating success or failure
   */
  async testConnection(channel: NotificationChannel): Promise<DeliveryResult> {
    const config = channel.config as EmailConfig;

    const subject = 'LLM Orchestra Test Notification';
    const html = this.buildTestHtml(channel.name);
    const text = `LLM Orchestra Test - Connection successful for channel: ${channel.name}`;

    return this.sendWithProvider(config, subject, html, text);
  }

  /**
   * Validate the email channel configuration.
   *
   * @param config - The configuration to validate
   * @returns Array of validation error messages (empty if valid)
   */
  validateConfig(config: unknown): string[] {
    const errors: string[] = [];
    const c = config as Partial<EmailConfig>;

    // Provider validation
    if (!c.provider) {
      errors.push('provider is required (smtp, sendgrid, or resend)');
    } else if (!this.isValidProvider(c.provider)) {
      errors.push('provider must be one of: smtp, sendgrid, resend');
    }

    // From email validation
    if (!c.fromEmail) {
      errors.push('fromEmail is required');
    } else if (!this.isValidEmail(c.fromEmail)) {
      errors.push('fromEmail must be a valid email address');
    }

    // Recipients validation
    if (!c.recipients || !Array.isArray(c.recipients) || c.recipients.length === 0) {
      errors.push('recipients must be a non-empty array');
    } else {
      c.recipients.forEach((email, index) => {
        if (!this.isValidEmail(email)) {
          errors.push(`recipients[${index}] is not a valid email address`);
        }
      });
    }

    // Provider-specific validation
    if (c.provider === 'smtp') {
      if (!c.smtpHost) {
        errors.push('smtpHost is required for SMTP provider');
      }
      if (!c.smtpPort) {
        errors.push('smtpPort is required for SMTP provider');
      }
    } else if (c.provider === 'sendgrid' || c.provider === 'resend') {
      if (!c.apiKey) {
        errors.push('apiKey is required for API-based providers');
      }
    }

    return errors;
  }

  /**
   * Route email sending to the appropriate provider.
   */
  private async sendWithProvider(
    config: EmailConfig,
    subject: string,
    html: string,
    text: string
  ): Promise<DeliveryResult> {
    switch (config.provider) {
      case 'smtp':
        return this.sendSmtp(config, subject, html, text);
      case 'sendgrid':
        return this.sendSendGrid(config, subject, html, text);
      case 'resend':
        return this.sendResend(config, subject, html, text);
      default:
        return {
          success: false,
          error: `Unknown provider: ${config.provider}`,
          retryable: false,
        };
    }
  }

  /**
   * Send email via SMTP using nodemailer.
   *
   * Uses dynamic import to avoid bundling nodemailer if not used.
   * Requires nodemailer to be installed: npm install nodemailer
   */
  private async sendSmtp(
    config: EmailConfig,
    subject: string,
    html: string,
    text: string
  ): Promise<DeliveryResult> {
    try {
      // Dynamic import to avoid bundling nodemailer if not used
      const nodemailer = await loadNodemailer();

      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort ?? 587,
        secure: config.smtpSecure ?? false,
        auth: config.smtpUser
          ? {
              user: config.smtpUser,
              pass: config.smtpPassword,
            }
          : undefined,
      });

      const result = await transporter.sendMail({
        from: config.fromName
          ? `"${config.fromName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${config.fromEmail}>`
          : config.fromEmail,
        to: config.recipients.join(', '),
        replyTo: config.replyTo,
        subject,
        html,
        text,
      });

      return {
        success: true,
        externalId: result.messageId,
      };
    } catch (error) {
      // Handle case where nodemailer is not installed
      if (
        error instanceof Error &&
        (error.message.includes('Cannot find module') ||
          error.message.includes('MODULE_NOT_FOUND'))
      ) {
        return {
          success: false,
          error:
            'SMTP provider requires nodemailer package. Install with: npm install nodemailer',
          retryable: false,
        };
      }

      const message = error instanceof Error ? error.message : 'SMTP send failed';
      return {
        success: false,
        error: message,
        retryable: this.isRetryableSmtpError(error),
      };
    }
  }

  /**
   * Send email via SendGrid API.
   *
   * @see https://docs.sendgrid.com/api-reference/mail-send/mail-send
   */
  private async sendSendGrid(
    config: EmailConfig,
    subject: string,
    html: string,
    text: string
  ): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [
            {
              to: config.recipients.map((email) => ({ email })),
            },
          ],
          from: {
            email: config.fromEmail,
            name: config.fromName ?? 'LLM Orchestra',
          },
          reply_to: config.replyTo ? { email: config.replyTo } : undefined,
          subject,
          content: [
            { type: 'text/plain', value: text },
            { type: 'text/html', value: html },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok || response.status === 202) {
        const messageId = response.headers.get('X-Message-Id');
        return {
          success: true,
          statusCode: response.status,
          externalId: messageId ?? undefined,
        };
      }

      const errorBody = await response.text();
      return {
        success: false,
        statusCode: response.status,
        error: errorBody || `HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timeout', retryable: true };
      }
      const message = error instanceof Error ? error.message : 'SendGrid send failed';
      return {
        success: false,
        error: message,
        retryable: true,
      };
    }
  }

  /**
   * Send email via Resend API.
   *
   * @see https://resend.com/docs/api-reference/emails/send-email
   */
  private async sendResend(
    config: EmailConfig,
    subject: string,
    html: string,
    text: string
  ): Promise<DeliveryResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.fromName
            ? `"${config.fromName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${config.fromEmail}>`
            : config.fromEmail,
          to: config.recipients,
          reply_to: config.replyTo,
          subject,
          html,
          text,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = (await response.json()) as { id: string };
        return {
          success: true,
          statusCode: response.status,
          externalId: data.id,
        };
      }

      const errorBody = await response.text();
      return {
        success: false,
        statusCode: response.status,
        error: errorBody || `HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: 'Request timeout', retryable: true };
      }
      const message = error instanceof Error ? error.message : 'Resend send failed';
      return {
        success: false,
        error: message,
        retryable: true,
      };
    }
  }

  /**
   * Build email subject line with severity indicator.
   */
  private buildSubject(payload: NotificationPayload): string {
    const { alertRule, alertEvent, project } = payload;
    const severityIndicator = this.getSeverityIndicator(alertEvent.severity);
    return `${severityIndicator} [${alertEvent.severity.toUpperCase()}] ${alertRule.name} - ${project.name}`;
  }

  /**
   * Get severity indicator emoji for subject line.
   */
  private getSeverityIndicator(severity: string): string {
    switch (severity) {
      case 'critical':
        return '\u{1F534}'; // Red circle
      case 'warning':
        return '\u{1F7E1}'; // Yellow circle
      default:
        return '\u{1F535}'; // Blue circle
    }
  }

  /**
   * Build HTML email content with responsive design.
   */
  private buildHtml(payload: NotificationPayload, config: EmailConfig): string {
    // Use custom template if provided
    if (config.htmlTemplate) {
      return this.interpolateTemplate(config.htmlTemplate, payload);
    }

    const { alertRule, alertEvent, project, organization, dashboardUrl } = payload;
    const severityColor = this.getSeverityColor(alertEvent.severity);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Orchestra Alert</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: ${severityColor}; padding: 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">
                Alert: ${this.escapeHtml(alertRule.name)}
              </h1>
            </td>
          </tr>

          <!-- Severity Badge -->
          <tr>
            <td style="padding: 24px 24px 0;">
              <span style="display: inline-block; background-color: ${severityColor}; color: #ffffff; padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                ${this.escapeHtml(alertEvent.severity)}
              </span>
            </td>
          </tr>

          <!-- Alert Details -->
          <tr>
            <td style="padding: 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="padding: 8px 0;">
                    <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Current Value</div>
                    <div style="color: #111827; font-size: 18px; font-weight: 600;">${this.escapeHtml(this.formatValue(alertRule.type, alertEvent.currentValue))}</div>
                  </td>
                  <td width="50%" style="padding: 8px 0;">
                    <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Threshold</div>
                    <div style="color: #111827; font-size: 18px; font-weight: 600;">${this.escapeHtml(this.formatValue(alertRule.type, alertRule.threshold))}</div>
                  </td>
                </tr>
                <tr>
                  <td width="50%" style="padding: 8px 0;">
                    <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Alert Type</div>
                    <div style="color: #111827; font-size: 14px;">${this.escapeHtml(alertRule.type.replace(/_/g, ' '))}</div>
                  </td>
                  <td width="50%" style="padding: 8px 0;">
                    <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Time Window</div>
                    <div style="color: #111827; font-size: 14px;">${alertRule.windowMinutes} minutes</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 24px;">
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
            </td>
          </tr>

          <!-- Project Info -->
          <tr>
            <td style="padding: 24px;">
              <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Project</div>
              <div style="color: #111827; font-size: 14px; margin-bottom: 16px;">${this.escapeHtml(project.name)} (${this.escapeHtml(organization.name)})</div>

              <div style="color: #6b7280; font-size: 12px; margin-bottom: 4px;">Triggered At</div>
              <div style="color: #111827; font-size: 14px;">${alertEvent.triggeredAt.toISOString()}</div>
            </td>
          </tr>

          ${dashboardUrl ? this.buildDashboardLinkHtml(dashboardUrl) : ''}

          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 24px;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                This notification was sent by LLM Orchestra.
                Alert ID: ${this.escapeHtml(alertEvent.id)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Build the dashboard link section for the HTML template.
   */
  private buildDashboardLinkHtml(dashboardUrl: string): string {
    return `
          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 24px 24px;">
              <a href="${this.escapeHtml(dashboardUrl)}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 500;">
                View Alert Details
              </a>
            </td>
          </tr>`;
  }

  /**
   * Build HTML for test notification email.
   */
  private buildTestHtml(channelName: string): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Orchestra Test Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f3f4f6; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 32px; text-align: center;">
              <div style="font-size: 48px; margin-bottom: 16px;">\u2705</div>
              <h2 style="margin: 0 0 16px; color: #22c55e; font-size: 24px; font-weight: 600;">Connection Test Successful</h2>
              <p style="margin: 0 0 16px; color: #374151; font-size: 16px;">
                This email channel is now connected to LLM Orchestra and will receive alert notifications.
              </p>
              <p style="margin: 0; color: #6b7280; font-size: 14px;">
                <strong>Channel:</strong> ${this.escapeHtml(channelName)}
              </p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
              <p style="margin: 0; color: #6b7280; font-size: 12px;">
                This is a test message from LLM Orchestra.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Build plain text email content.
   */
  private buildText(payload: NotificationPayload): string {
    const { alertRule, alertEvent, project, organization, dashboardUrl } = payload;

    const lines = [
      'LLM ORCHESTRA ALERT',
      '==================',
      '',
      `Alert: ${alertRule.name}`,
      `Severity: ${alertEvent.severity.toUpperCase()}`,
      '',
      `Current Value: ${this.formatValue(alertRule.type, alertEvent.currentValue)}`,
      `Threshold: ${this.formatValue(alertRule.type, alertRule.threshold)}`,
      `Alert Type: ${alertRule.type.replace(/_/g, ' ')}`,
      `Time Window: ${alertRule.windowMinutes} minutes`,
      '',
      `Project: ${project.name}`,
      `Organization: ${organization.name}`,
      `Triggered: ${alertEvent.triggeredAt.toISOString()}`,
      '',
    ];

    if (dashboardUrl) {
      lines.push(`View Details: ${dashboardUrl}`, '');
    }

    lines.push('--', `Alert ID: ${alertEvent.id}`, 'Sent by LLM Orchestra');

    return lines.join('\n');
  }

  /**
   * Get color for severity level.
   */
  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      default:
        return '#3b82f6';
    }
  }

  /**
   * Format value based on alert type for display.
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

  /**
   * Interpolate custom template with payload values.
   *
   * Supports mustache-style placeholders: {{alertRule.name}}, {{project.name}}, etc.
   */
  private interpolateTemplate(template: string, payload: NotificationPayload): string {
    const replacements: Record<string, string> = {
      'alertRule.id': payload.alertRule.id,
      'alertRule.name': payload.alertRule.name,
      'alertRule.type': payload.alertRule.type,
      'alertRule.threshold': payload.alertRule.threshold.toString(),
      'alertRule.windowMinutes': payload.alertRule.windowMinutes.toString(),
      'alertEvent.id': payload.alertEvent.id,
      'alertEvent.severity': payload.alertEvent.severity,
      'alertEvent.currentValue': payload.alertEvent.currentValue.toString(),
      'alertEvent.triggeredAt': payload.alertEvent.triggeredAt.toISOString(),
      'project.id': payload.project.id,
      'project.name': payload.project.name,
      'organization.id': payload.organization.id,
      'organization.name': payload.organization.name,
      dashboardUrl: payload.dashboardUrl ?? '',
    };

    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }

    return result;
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  private escapeHtml(text: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEntities[char] ?? char);
  }

  /**
   * Validate email format using RFC 5322 compliant regex.
   */
  private isValidEmail(email: string): boolean {
    // More comprehensive email validation regex
    const emailRegex =
      /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailRegex.test(email);
  }

  /**
   * Check if provider is a valid email provider type.
   */
  private isValidProvider(provider: string): provider is EmailProvider {
    return EMAIL_PROVIDERS.includes(provider as EmailProvider);
  }

  /**
   * Check if SMTP error is retryable.
   *
   * Connection and network errors are retryable.
   * Authentication and validation errors are not retryable.
   */
  private isRetryableSmtpError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return true;
    }

    const message = error.message.toLowerCase();

    // Connection/network errors are retryable
    const retryablePatterns = ['etimedout', 'econnrefused', 'econnreset', 'temporary', 'timeout'];
    for (const pattern of retryablePatterns) {
      if (message.includes(pattern)) {
        return true;
      }
    }

    // Auth errors and invalid recipients are not retryable
    const nonRetryablePatterns = ['authentication', 'invalid', 'rejected', 'denied', 'forbidden'];
    for (const pattern of nonRetryablePatterns) {
      if (message.includes(pattern)) {
        return false;
      }
    }

    // Default to retryable for unknown errors
    return true;
  }
}
