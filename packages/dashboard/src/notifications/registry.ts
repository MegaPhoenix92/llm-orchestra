/**
 * Notification Adapter Registry
 *
 * Manages notification channel adapters (Slack, Email, PagerDuty).
 * Provides adapter lookup by channel type.
 */

import type { NotificationChannelAdapter, ChannelType } from './types.js';
import { SlackAdapter } from './adapters/slack.js';
import { EmailAdapter } from './adapters/email.js';
import { PagerDutyAdapter } from './adapters/pagerduty.js';

/**
 * Singleton registry for notification adapters
 */
class NotificationAdapterRegistry {
  private adapters: Map<ChannelType, NotificationChannelAdapter> = new Map();

  constructor() {
    // Register built-in adapters
    this.register(new SlackAdapter());
    this.register(new EmailAdapter());
    this.register(new PagerDutyAdapter());
  }

  /**
   * Register an adapter for a channel type
   */
  register(adapter: NotificationChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /**
   * Get adapter for a channel type
   * @throws Error if adapter not found
   */
  get(type: ChannelType): NotificationChannelAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`No adapter registered for channel type: ${type}`);
    }
    return adapter;
  }

  /**
   * Check if an adapter is registered for a type
   */
  has(type: ChannelType): boolean {
    return this.adapters.has(type);
  }

  /**
   * Get all registered channel types
   */
  getTypes(): ChannelType[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get all registered adapters
   */
  getAll(): NotificationChannelAdapter[] {
    return Array.from(this.adapters.values());
  }
}

/**
 * Singleton instance
 */
export const notificationAdapterRegistry = new NotificationAdapterRegistry();

/**
 * Convenience function to get adapter by type
 */
export function getNotificationAdapter(type: ChannelType): NotificationChannelAdapter {
  return notificationAdapterRegistry.get(type);
}

/**
 * Convenience function to validate channel config
 */
export function validateChannelConfig(type: ChannelType, config: unknown): string[] {
  const adapter = notificationAdapterRegistry.get(type);
  return adapter.validateConfig(config);
}
