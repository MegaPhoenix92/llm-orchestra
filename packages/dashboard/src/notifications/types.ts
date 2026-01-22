/**
 * Notification Channels - Type Definitions
 *
 * Defines interfaces for Slack, Email, and PagerDuty notification adapters.
 */

import type { NotificationChannel, NotificationDelivery } from '../db/schema.js';
import type { EncryptionConfig } from '../auth/encryption.js';

// ============================================================================
// Channel Configuration Types
// ============================================================================

/**
 * Slack channel configuration
 */
export interface SlackConfig {
  webhookUrl: string; // Encrypted - Slack incoming webhook URL
  channel?: string; // Override channel (e.g., "#alerts")
  username?: string; // Bot name (default: "LLM Orchestra")
  iconEmoji?: string; // Bot icon (default: ":robot_face:")
  useBlockKit?: boolean; // Enable rich Block Kit formatting (default: true)
}

/**
 * Email channel configuration
 */
export interface EmailConfig {
  provider: 'smtp' | 'sendgrid' | 'resend';
  // SMTP configuration
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string; // Encrypted
  smtpPassword?: string; // Encrypted
  smtpSecure?: boolean; // Use TLS
  // API-based providers
  apiKey?: string; // Encrypted - SendGrid or Resend API key
  // Common settings
  fromEmail: string;
  fromName?: string; // Display name (default: "LLM Orchestra")
  recipients: string[]; // List of email addresses
  replyTo?: string; // Reply-to address
  htmlTemplate?: string; // Custom HTML template (optional)
}

/**
 * PagerDuty channel configuration
 */
export interface PagerDutyConfig {
  routingKey: string; // Encrypted - Events API v2 routing/integration key
  dedupKeyPrefix?: string; // Custom dedup key prefix (default: "llm-orchestra")
  severityMapping?: {
    // Map alert types to PagerDuty severities
    cost_threshold?: PagerDutySeverity;
    error_rate?: PagerDutySeverity;
    latency?: PagerDutySeverity;
    default?: PagerDutySeverity;
  };
  autoResolve?: boolean; // Auto-resolve incidents when alert clears (default: true)
  customDetails?: Record<string, string>; // Additional details to include
}

export type PagerDutySeverity = 'critical' | 'error' | 'warning' | 'info';

/**
 * Union type for all channel configurations
 */
export type ChannelConfig = SlackConfig | EmailConfig | PagerDutyConfig;

/**
 * Channel type enumeration
 */
export type ChannelType = 'slack' | 'email' | 'pagerduty';

// ============================================================================
// Notification Payload Types
// ============================================================================

/**
 * Standard notification payload sent to all adapters
 */
export interface NotificationPayload {
  alertRule: {
    id: string;
    name: string;
    type: string; // 'cost_threshold' | 'error_rate' | etc.
    threshold: number;
    windowMinutes: number;
  };
  alertEvent: {
    id: string;
    triggeredAt: Date;
    currentValue: number;
    severity: 'critical' | 'warning' | 'info';
  };
  project: {
    id: string;
    name: string;
  };
  organization: {
    id: string;
    name: string;
  };
  dashboardUrl?: string; // Link to alert details
}

/**
 * Delivery result from an adapter
 */
export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  externalId?: string; // Provider-specific ID (Slack ts, PagerDuty dedup key)
  error?: string;
  retryable?: boolean; // Whether the error is retryable
}

// ============================================================================
// Adapter Interface
// ============================================================================

/**
 * Notification channel adapter interface
 * All adapters (Slack, Email, PagerDuty) must implement this interface.
 */
export interface NotificationChannelAdapter {
  /**
   * Type identifier for this adapter
   */
  readonly type: ChannelType;

  /**
   * Send a notification through this channel
   */
  send(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<DeliveryResult>;

  /**
   * Test the channel connection/configuration
   * Should send a test notification or validate credentials
   */
  testConnection(channel: NotificationChannel): Promise<DeliveryResult>;

  /**
   * Validate the channel configuration
   * Returns validation errors or empty array if valid
   */
  validateConfig(config: unknown): string[];
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Notification event types that channels can subscribe to
 */
export type NotificationEventType =
  | 'alert.triggered'
  | 'alert.resolved'
  | 'alert.escalated'
  | 'quota.warning'
  | 'quota.exceeded'
  | 'test';

/**
 * Default events all channels receive
 */
export const DEFAULT_NOTIFICATION_EVENTS: NotificationEventType[] = [
  'alert.triggered',
];

// ============================================================================
// Worker/Dispatcher Types
// ============================================================================

/**
 * Notification worker configuration
 */
export interface NotificationWorkerConfig {
  intervalMs?: number; // Poll interval (default: 5000)
  batchSize?: number; // Deliveries per batch (default: 25)
  maxAttempts?: number; // Max retry attempts (default: 5)
  baseBackoffMs?: number; // Initial retry delay (default: 15000)
  enabled?: boolean; // Enable/disable worker (default: true)
  encryption?: EncryptionConfig; // Encryption config for decrypting channel secrets
}

/**
 * Default worker configuration
 * Note: encryption is omitted as it depends on runtime configuration
 */
export const DEFAULT_WORKER_CONFIG: Omit<Required<NotificationWorkerConfig>, 'encryption'> = {
  intervalMs: 5000,
  batchSize: 25,
  maxAttempts: 5,
  baseBackoffMs: 15000,
  enabled: true,
};

// ============================================================================
// Re-exports from schema for convenience
// ============================================================================

export type { NotificationChannel, NotificationDelivery };
