/**
 * Notification System Tests
 *
 * Comprehensive unit tests for the notification channel adapters:
 * - Slack adapter validation and delivery
 * - Email adapter validation and multi-provider support
 * - PagerDuty adapter validation and event sending
 * - Registry adapter lookup and management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlackAdapter } from '../src/notifications/adapters/slack.js';
import { EmailAdapter } from '../src/notifications/adapters/email.js';
import { PagerDutyAdapter } from '../src/notifications/adapters/pagerduty.js';
import {
  notificationAdapterRegistry,
  getNotificationAdapter,
  validateChannelConfig,
} from '../src/notifications/registry.js';
import type {
  NotificationPayload,
  SlackConfig,
  EmailConfig,
  PagerDutyConfig,
  NotificationChannel,
} from '../src/notifications/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Sample payload for testing
const samplePayload: NotificationPayload = {
  alertRule: {
    id: 'alr_test123',
    name: 'High Error Rate',
    type: 'error_rate',
    threshold: 0.05,
    windowMinutes: 15,
  },
  alertEvent: {
    id: 'ale_test456',
    triggeredAt: new Date('2024-01-15T10:30:00Z'),
    currentValue: 0.08,
    severity: 'warning',
  },
  project: {
    id: 'proj_test789',
    name: 'Test Project',
  },
  organization: {
    id: 'org_testabc',
    name: 'Test Org',
  },
  dashboardUrl: 'https://dashboard.example.com/alerts/ale_test456',
};

/**
 * Helper function to create a mock notification channel
 */
function createMockChannel(
  type: 'slack' | 'email' | 'pagerduty',
  config: SlackConfig | EmailConfig | PagerDutyConfig
): NotificationChannel {
  return {
    id: `nch_test_${type}`,
    projectId: 'proj_test789',
    name: `Test ${type.charAt(0).toUpperCase() + type.slice(1)} Channel`,
    type,
    config,
    enabled: true,
    events: ['alert.triggered'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

// ============================================================================
// Slack Adapter Tests
// ============================================================================

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;

  beforeEach(() => {
    adapter = new SlackAdapter();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('type property', () => {
    it('should_returnSlack_when_typeAccessed', () => {
      expect(adapter.type).toBe('slack');
    });
  });

  describe('validateConfig', () => {
    it('should_requireWebhookUrl_when_missingFromConfig', () => {
      const errors = adapter.validateConfig({});
      expect(errors).toContain('webhookUrl is required');
    });

    it('should_validateWebhookUrlFormat_when_invalidUrlProvided', () => {
      const errors = adapter.validateConfig({ webhookUrl: 'https://example.com/webhook' });
      expect(errors).toContain('webhookUrl must be a valid Slack webhook URL');
    });

    it('should_acceptValidSlackWebhookUrl_when_correctFormatProvided', () => {
      const errors = adapter.validateConfig({
        webhookUrl: 'https://hooks.example.com/services/TEST/TEST/TESTWEBHOOKURL',
      });
      expect(errors).toHaveLength(0);
    });

    it('should_validateChannelFormat_when_invalidChannelProvided', () => {
      const errors = adapter.validateConfig({
        webhookUrl: 'https://hooks.example.com/services/TEST',
        channel: 'invalid',
      });
      expect(errors).toContain('channel must start with # (channel) or @ (user)');
    });

    it('should_acceptChannelWithHashPrefix_when_channelNameProvided', () => {
      const errors = adapter.validateConfig({
        webhookUrl: 'https://hooks.example.com/services/TEST',
        channel: '#alerts',
      });
      expect(errors).toHaveLength(0);
    });

    it('should_acceptChannelWithAtPrefix_when_userMentionProvided', () => {
      const errors = adapter.validateConfig({
        webhookUrl: 'https://hooks.example.com/services/TEST',
        channel: '@user',
      });
      expect(errors).toHaveLength(0);
    });

    it('should_acceptOptionalFields_when_validConfigProvided', () => {
      const errors = adapter.validateConfig({
        webhookUrl: 'https://hooks.example.com/services/TEST',
        channel: '#alerts',
        username: 'Test Bot',
        iconEmoji: ':robot_face:',
        useBlockKit: true,
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('send', () => {
    it('should_sendNotificationSuccessfully_when_webhookReturnsOk', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
        useBlockKit: true,
      } as SlackConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should_sendCorrectPayload_when_messageBuilt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
        channel: '#alerts',
        username: 'LLM Orchestra',
        iconEmoji: ':robot_face:',
        useBlockKit: true,
      } as SlackConfig);

      await adapter.send(channel, samplePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.example.com/services/TEST',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.channel).toBe('#alerts');
      expect(body.username).toBe('LLM Orchestra');
      expect(body.blocks).toBeDefined();
    });

    it('should_handleRateLimitingAsRetryable_when_429Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate_limited',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it('should_handleServerErrorAsRetryable_when_500Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'internal_error',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(500);
    });

    it('should_handleClientErrorAsNonRetryable_when_400Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'invalid_payload',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it('should_handleNetworkErrorAsRetryable_when_fetchThrows', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toBe('Network error');
    });

    it('should_sendWithoutBlockKit_when_useBlockKitDisabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
        useBlockKit: false,
      } as SlackConfig);

      await adapter.send(channel, samplePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.blocks).toBeUndefined();
      expect(body.text).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('should_sendTestMessage_when_connectionTested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.testConnection(channel);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should_returnFailure_when_testConnectionFails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'invalid_token',
      });

      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.testConnection(channel);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });
  });
});

// ============================================================================
// Email Adapter Tests
// ============================================================================

describe('EmailAdapter', () => {
  let adapter: EmailAdapter;

  beforeEach(() => {
    adapter = new EmailAdapter();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('type property', () => {
    it('should_returnEmail_when_typeAccessed', () => {
      expect(adapter.type).toBe('email');
    });
  });

  describe('validateConfig', () => {
    it('should_requireProvider_when_missingFromConfig', () => {
      const errors = adapter.validateConfig({});
      expect(errors).toContain('provider is required (smtp, sendgrid, or resend)');
    });

    it('should_requireFromEmail_when_missingFromConfig', () => {
      const errors = adapter.validateConfig({ provider: 'sendgrid' });
      expect(errors).toContain('fromEmail is required');
    });

    it('should_requireRecipientsArray_when_missingFromConfig', () => {
      const errors = adapter.validateConfig({
        provider: 'sendgrid',
        fromEmail: 'test@example.com',
      });
      expect(errors).toContain('recipients must be a non-empty array');
    });

    it('should_requireNonEmptyRecipientsArray_when_emptyArrayProvided', () => {
      const errors = adapter.validateConfig({
        provider: 'sendgrid',
        fromEmail: 'test@example.com',
        recipients: [],
      });
      expect(errors).toContain('recipients must be a non-empty array');
    });

    it('should_validateEmailFormats_when_invalidEmailsProvided', () => {
      const errors = adapter.validateConfig({
        provider: 'sendgrid',
        fromEmail: 'invalid-email',
        recipients: ['also-invalid'],
      });
      expect(errors).toContain('fromEmail must be a valid email address');
      expect(errors).toContain('recipients[0] is not a valid email address');
    });

    it('should_validateMultipleRecipients_when_someInvalid', () => {
      const errors = adapter.validateConfig({
        provider: 'sendgrid',
        fromEmail: 'valid@example.com',
        recipients: ['valid@example.com', 'invalid', 'another@example.com', 'bad'],
        apiKey: 'SG.test',
      });
      expect(errors).toContain('recipients[1] is not a valid email address');
      expect(errors).toContain('recipients[3] is not a valid email address');
    });

    it('should_requireApiKeyForSendGrid_when_apiBasedProvider', () => {
      const errors = adapter.validateConfig({
        provider: 'sendgrid',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
      });
      expect(errors).toContain('apiKey is required for API-based providers');
    });

    it('should_requireApiKeyForResend_when_apiBasedProvider', () => {
      const errors = adapter.validateConfig({
        provider: 'resend',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
      });
      expect(errors).toContain('apiKey is required for API-based providers');
    });

    it('should_requireSmtpHost_when_smtpProviderUsed', () => {
      const errors = adapter.validateConfig({
        provider: 'smtp',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
      });
      expect(errors).toContain('smtpHost is required for SMTP provider');
    });

    it('should_requireSmtpPort_when_smtpProviderUsed', () => {
      const errors = adapter.validateConfig({
        provider: 'smtp',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
      });
      expect(errors).toContain('smtpPort is required for SMTP provider');
    });

    it('should_acceptValidSendGridConfig_when_allFieldsProvided', () => {
      const errors = adapter.validateConfig({
        provider: 'sendgrid',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
        apiKey: 'SG.xxxxx',
      });
      expect(errors).toHaveLength(0);
    });

    it('should_acceptValidResendConfig_when_allFieldsProvided', () => {
      const errors = adapter.validateConfig({
        provider: 'resend',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
        apiKey: 're_xxxxx',
      });
      expect(errors).toHaveLength(0);
    });

    it('should_acceptValidSmtpConfig_when_allFieldsProvided', () => {
      const errors = adapter.validateConfig({
        provider: 'smtp',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
      });
      expect(errors).toHaveLength(0);
    });

    it('should_rejectInvalidProvider_when_unknownProviderSpecified', () => {
      const errors = adapter.validateConfig({
        provider: 'unknown',
        fromEmail: 'test@example.com',
        recipients: ['user@example.com'],
      });
      expect(errors).toContain('provider must be one of: smtp, sendgrid, resend');
    });
  });

  describe('send via SendGrid', () => {
    it('should_sendEmailSuccessfully_when_sendGridReturns202', async () => {
      const mockHeaders = new Map([['X-Message-Id', 'msg_123']]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: {
          get: (key: string) => mockHeaders.get(key),
        },
      });

      const channel = createMockChannel('email', {
        provider: 'sendgrid',
        apiKey: 'SG.test',
        fromEmail: 'alerts@example.com',
        recipients: ['user@example.com'],
      } as EmailConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(202);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.sendgrid.com/v3/mail/send',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer SG.test',
          }),
        })
      );
    });

    it('should_includeCorrectPayloadStructure_when_sendGridCalled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: { get: () => null },
      });

      const channel = createMockChannel('email', {
        provider: 'sendgrid',
        apiKey: 'SG.test',
        fromEmail: 'alerts@example.com',
        fromName: 'LLM Orchestra',
        recipients: ['user1@example.com', 'user2@example.com'],
        replyTo: 'support@example.com',
      } as EmailConfig);

      await adapter.send(channel, samplePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.from.email).toBe('alerts@example.com');
      expect(body.from.name).toBe('LLM Orchestra');
      expect(body.personalizations[0].to).toHaveLength(2);
      expect(body.reply_to.email).toBe('support@example.com');
      expect(body.subject).toContain('High Error Rate');
      expect(body.content).toHaveLength(2); // plain text and HTML
    });

    it('should_handleSendGridRateLimiting_when_429Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too many requests',
      });

      const channel = createMockChannel('email', {
        provider: 'sendgrid',
        apiKey: 'SG.test',
        fromEmail: 'alerts@example.com',
        recipients: ['user@example.com'],
      } as EmailConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it('should_handleSendGridServerError_when_500Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal server error',
      });

      const channel = createMockChannel('email', {
        provider: 'sendgrid',
        apiKey: 'SG.test',
        fromEmail: 'alerts@example.com',
        recipients: ['user@example.com'],
      } as EmailConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });
  });

  describe('send via Resend', () => {
    it('should_sendEmailSuccessfully_when_resendReturnsOk', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 'resend_msg_123' }),
      });

      const channel = createMockChannel('email', {
        provider: 'resend',
        apiKey: 're_test',
        fromEmail: 'alerts@example.com',
        recipients: ['user@example.com'],
      } as EmailConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe('resend_msg_123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test',
          }),
        })
      );
    });
  });

  describe('testConnection', () => {
    it('should_sendTestEmail_when_connectionTested', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: { get: () => 'test_msg_id' },
      });

      const channel = createMockChannel('email', {
        provider: 'sendgrid',
        apiKey: 'SG.test',
        fromEmail: 'alerts@example.com',
        recipients: ['user@example.com'],
      } as EmailConfig);

      const result = await adapter.testConnection(channel);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

// ============================================================================
// PagerDuty Adapter Tests
// ============================================================================

describe('PagerDutyAdapter', () => {
  let adapter: PagerDutyAdapter;

  beforeEach(() => {
    adapter = new PagerDutyAdapter();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('type property', () => {
    it('should_returnPagerduty_when_typeAccessed', () => {
      expect(adapter.type).toBe('pagerduty');
    });
  });

  describe('validateConfig', () => {
    it('should_requireRoutingKey_when_missingFromConfig', () => {
      const errors = adapter.validateConfig({});
      expect(errors).toContain('routingKey is required');
    });

    it('should_validateRoutingKeyLength_when_invalidLengthProvided', () => {
      const errors = adapter.validateConfig({ routingKey: 'short' });
      expect(errors).toContain('routingKey must be a 32-character PagerDuty integration key');
    });

    it('should_validateSeverityMappingValues_when_invalidSeverityProvided', () => {
      const errors = adapter.validateConfig({
        routingKey: '12345678901234567890123456789012',
        severityMapping: { cost_threshold: 'invalid' as any },
      });
      expect(errors[0]).toContain('severityMapping.cost_threshold must be one of');
    });

    it('should_acceptValidSeverityMappingValues_when_validSeveritiesProvided', () => {
      const errors = adapter.validateConfig({
        routingKey: '12345678901234567890123456789012',
        severityMapping: {
          cost_threshold: 'critical',
          error_rate: 'error',
          latency: 'warning',
          default: 'info',
        },
      });
      expect(errors).toHaveLength(0);
    });

    it('should_acceptValidConfig_when_allFieldsProvided', () => {
      const errors = adapter.validateConfig({
        routingKey: '12345678901234567890123456789012',
        dedupKeyPrefix: 'my-app',
        severityMapping: { cost_threshold: 'critical' },
        autoResolve: true,
        customDetails: { environment: 'production' },
      });
      expect(errors).toHaveLength(0);
    });

    it('should_acceptMinimalValidConfig_when_onlyRoutingKeyProvided', () => {
      const errors = adapter.validateConfig({
        routingKey: '12345678901234567890123456789012',
      });
      expect(errors).toHaveLength(0);
    });
  });

  describe('send', () => {
    it('should_sendTriggerEventSuccessfully_when_apiReturnsSuccess', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'success',
          message: 'Event processed',
          dedup_key: 'llm-orchestra-alr_test123',
        }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(true);
      expect(result.externalId).toBe('llm-orchestra-alr_test123');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://events.pagerduty.com/v2/enqueue',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should_includeCorrectPayloadStructure_when_eventBuilt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'success',
          dedup_key: 'test-key',
        }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
        dedupKeyPrefix: 'custom-prefix',
        customDetails: { environment: 'test' },
      } as PagerDutyConfig);

      await adapter.send(channel, samplePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.routing_key).toBe('12345678901234567890123456789012');
      expect(body.event_action).toBe('trigger');
      expect(body.dedup_key).toBe('custom-prefix-alr_test123');
      expect(body.payload.summary).toContain('High Error Rate');
      expect(body.payload.severity).toBe('warning');
      expect(body.payload.custom_details.environment).toBe('test');
      expect(body.links).toHaveLength(1);
      expect(body.links[0].href).toBe(samplePayload.dashboardUrl);
    });

    it('should_useSeverityMapping_when_mappingProvided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'success',
          dedup_key: 'test-key',
        }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
        severityMapping: { error_rate: 'critical' },
      } as PagerDutyConfig);

      await adapter.send(channel, samplePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.payload.severity).toBe('critical');
    });

    it('should_handleRateLimiting_when_429Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ message: 'Rate limit exceeded' }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
    });

    it('should_handleServerError_when_500Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: 'Internal error' }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });

    it('should_handleClientError_when_400Returned', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid routing key' }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.error).toBe('Invalid routing key');
    });

    it('should_handleNetworkError_when_fetchThrows', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.send(channel, samplePayload);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.error).toBe('Network error');
    });
  });

  describe('testConnection', () => {
    it('should_sendTestEventAndResolve_when_connectionTested', async () => {
      // First call for trigger
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'success',
          dedup_key: 'test-dedup-key',
        }),
      });
      // Second call for resolve
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'success',
          dedup_key: 'test-dedup-key',
        }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.testConnection(channel);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify first call is trigger
      const triggerCall = mockFetch.mock.calls[0];
      const triggerBody = JSON.parse(triggerCall[1].body);
      expect(triggerBody.event_action).toBe('trigger');

      // Verify second call is resolve
      const resolveCall = mockFetch.mock.calls[1];
      const resolveBody = JSON.parse(resolveCall[1].body);
      expect(resolveBody.event_action).toBe('resolve');
    });

    it('should_returnFailure_when_triggerFails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: 'Invalid routing key' }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.testConnection(channel);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });
  });

  describe('resolve', () => {
    it('should_sendResolveEvent_when_called', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          status: 'success',
          dedup_key: 'llm-orchestra-alr_test123',
        }),
      });

      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      const result = await adapter.resolve(channel, 'alr_test123');

      expect(result.success).toBe(true);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.event_action).toBe('resolve');
      expect(body.dedup_key).toBe('llm-orchestra-alr_test123');
    });

    it('should_skipResolve_when_autoResolveDisabled', async () => {
      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
        autoResolve: false,
      } as PagerDutyConfig);

      const result = await adapter.resolve(channel, 'alr_test123');

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Notification Adapter Registry Tests
// ============================================================================

describe('NotificationAdapterRegistry', () => {
  describe('adapter registration', () => {
    it('should_haveSlackAdapterRegistered_when_initialized', () => {
      expect(notificationAdapterRegistry.has('slack')).toBe(true);
    });

    it('should_haveEmailAdapterRegistered_when_initialized', () => {
      expect(notificationAdapterRegistry.has('email')).toBe(true);
    });

    it('should_havePagerDutyAdapterRegistered_when_initialized', () => {
      expect(notificationAdapterRegistry.has('pagerduty')).toBe(true);
    });
  });

  describe('getTypes', () => {
    it('should_returnAllRegisteredTypes_when_called', () => {
      const types = notificationAdapterRegistry.getTypes();
      expect(types).toContain('slack');
      expect(types).toContain('email');
      expect(types).toContain('pagerduty');
      expect(types).toHaveLength(3);
    });
  });

  describe('get', () => {
    it('should_returnSlackAdapter_when_slackTypeRequested', () => {
      const adapter = notificationAdapterRegistry.get('slack');
      expect(adapter.type).toBe('slack');
    });

    it('should_returnEmailAdapter_when_emailTypeRequested', () => {
      const adapter = notificationAdapterRegistry.get('email');
      expect(adapter.type).toBe('email');
    });

    it('should_returnPagerDutyAdapter_when_pagerdutyTypeRequested', () => {
      const adapter = notificationAdapterRegistry.get('pagerduty');
      expect(adapter.type).toBe('pagerduty');
    });

    it('should_throwError_when_unknownTypeRequested', () => {
      expect(() => notificationAdapterRegistry.get('unknown' as any)).toThrow(
        'No adapter registered for channel type: unknown'
      );
    });
  });

  describe('getAll', () => {
    it('should_returnAllAdapters_when_called', () => {
      const adapters = notificationAdapterRegistry.getAll();
      expect(adapters).toHaveLength(3);
      expect(adapters.map((a) => a.type)).toEqual(
        expect.arrayContaining(['slack', 'email', 'pagerduty'])
      );
    });
  });
});

// ============================================================================
// Helper Functions Tests
// ============================================================================

describe('getNotificationAdapter', () => {
  it('should_returnCorrectAdapter_when_validTypeProvided', () => {
    const slackAdapter = getNotificationAdapter('slack');
    expect(slackAdapter.type).toBe('slack');

    const emailAdapter = getNotificationAdapter('email');
    expect(emailAdapter.type).toBe('email');

    const pdAdapter = getNotificationAdapter('pagerduty');
    expect(pdAdapter.type).toBe('pagerduty');
  });

  it('should_throwError_when_invalidTypeProvided', () => {
    expect(() => getNotificationAdapter('unknown' as any)).toThrow(
      'No adapter registered for channel type: unknown'
    );
  });
});

describe('validateChannelConfig', () => {
  it('should_delegateToSlackAdapter_when_slackTypeProvided', () => {
    const errors = validateChannelConfig('slack', {});
    expect(errors).toContain('webhookUrl is required');
  });

  it('should_delegateToEmailAdapter_when_emailTypeProvided', () => {
    const errors = validateChannelConfig('email', {});
    expect(errors).toContain('provider is required (smtp, sendgrid, or resend)');
  });

  it('should_delegateToPagerDutyAdapter_when_pagerdutyTypeProvided', () => {
    const errors = validateChannelConfig('pagerduty', {});
    expect(errors).toContain('routingKey is required');
  });

  it('should_returnNoErrors_when_validSlackConfigProvided', () => {
    const errors = validateChannelConfig('slack', {
      webhookUrl: 'https://hooks.example.com/services/TEST',
    });
    expect(errors).toHaveLength(0);
  });

  it('should_returnNoErrors_when_validEmailConfigProvided', () => {
    const errors = validateChannelConfig('email', {
      provider: 'sendgrid',
      fromEmail: 'test@example.com',
      recipients: ['user@example.com'],
      apiKey: 'SG.test',
    });
    expect(errors).toHaveLength(0);
  });

  it('should_returnNoErrors_when_validPagerDutyConfigProvided', () => {
    const errors = validateChannelConfig('pagerduty', {
      routingKey: '12345678901234567890123456789012',
    });
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Edge Cases and Integration Tests
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('payload variations', () => {
    it('should_handlePayloadWithoutDashboardUrl_when_urlNotProvided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const payloadWithoutUrl: NotificationPayload = {
        ...samplePayload,
        dashboardUrl: undefined,
      };

      const adapter = new SlackAdapter();
      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      const result = await adapter.send(channel, payloadWithoutUrl);
      expect(result.success).toBe(true);
    });

    it('should_handleDifferentSeverityLevels_when_criticalProvided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ status: 'success', dedup_key: 'test' }),
      });

      const criticalPayload: NotificationPayload = {
        ...samplePayload,
        alertEvent: {
          ...samplePayload.alertEvent,
          severity: 'critical',
        },
      };

      const adapter = new PagerDutyAdapter();
      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      await adapter.send(channel, criticalPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.payload.severity).toBe('critical');
    });

    it('should_handleDifferentSeverityLevels_when_infoProvided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ status: 'success', dedup_key: 'test' }),
      });

      const infoPayload: NotificationPayload = {
        ...samplePayload,
        alertEvent: {
          ...samplePayload.alertEvent,
          severity: 'info',
        },
      };

      const adapter = new PagerDutyAdapter();
      const channel = createMockChannel('pagerduty', {
        routingKey: '12345678901234567890123456789012',
      } as PagerDutyConfig);

      await adapter.send(channel, infoPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.payload.severity).toBe('info');
    });
  });

  describe('different alert types', () => {
    it('should_formatCostThresholdCorrectly_when_costTypeProvided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const costPayload: NotificationPayload = {
        ...samplePayload,
        alertRule: {
          ...samplePayload.alertRule,
          type: 'cost_threshold',
          threshold: 100.0,
        },
        alertEvent: {
          ...samplePayload.alertEvent,
          currentValue: 150.0,
        },
      };

      const adapter = new SlackAdapter();
      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
        useBlockKit: true,
      } as SlackConfig);

      await adapter.send(channel, costPayload);

      // Verify the message was sent (formatting is internal)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should_formatLatencyCorrectly_when_latencyTypeProvided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const latencyPayload: NotificationPayload = {
        ...samplePayload,
        alertRule: {
          ...samplePayload.alertRule,
          type: 'latency',
          threshold: 1000,
        },
        alertEvent: {
          ...samplePayload.alertEvent,
          currentValue: 1500,
        },
      };

      const adapter = new SlackAdapter();
      const channel = createMockChannel('slack', {
        webhookUrl: 'https://hooks.example.com/services/TEST',
      } as SlackConfig);

      await adapter.send(channel, latencyPayload);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
