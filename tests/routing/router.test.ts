/**
 * Router Tests
 * Tests for the routing engine with failover and retry logic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router, RouterConfig } from '../../src/routing/router.js';
import {
  createMockRequest,
  createMockResponse,
  createMockProviderAdapter,
  createMockRateLimitError,
  createMockTimeoutError,
  createMockNetworkError,
  collectStream,
} from '../utils/mocks.js';
import type { ProviderAdapter, ProviderName } from '../../src/types/index.js';

// Mock the providers index to avoid circular dependencies
vi.mock('../../src/providers/index.js', () => ({
  getProviderForModel: vi.fn((model: string) => {
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gpt')) return 'openai';
    if (model.startsWith('gemini')) return 'google';
    return undefined;
  }),
}));

describe('Router', () => {
  let router: Router;
  let mockAnthropicAdapter: ReturnType<typeof createMockProviderAdapter>;
  let mockOpenAIAdapter: ReturnType<typeof createMockProviderAdapter>;
  let mockGoogleAdapter: ReturnType<typeof createMockProviderAdapter>;
  let providers: Map<ProviderName, ProviderAdapter>;

  beforeEach(() => {
    vi.useRealTimers();

    mockAnthropicAdapter = createMockProviderAdapter('anthropic');
    mockOpenAIAdapter = createMockProviderAdapter('openai');
    mockGoogleAdapter = createMockProviderAdapter('google');

    providers = new Map<ProviderName, ProviderAdapter>([
      ['anthropic', mockAnthropicAdapter as unknown as ProviderAdapter],
      ['openai', mockOpenAIAdapter as unknown as ProviderAdapter],
      ['google', mockGoogleAdapter as unknown as ProviderAdapter],
    ]);

    const config: RouterConfig = {
      providers,
      retry: {
        maxRetries: 2,
        initialDelayMs: 10, // Use small delays for faster tests
        maxDelayMs: 50,
        backoffMultiplier: 2,
      },
      defaultTimeout: 5000,
    };

    router = new Router(config);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should_useDefaultRetryConfig_when_notProvided', () => {
      const minimalRouter = new Router({ providers });
      const availableProviders = minimalRouter.getAvailableProviders();
      expect(availableProviders).toHaveLength(3);
    });

    it('should_useDefaultTimeout_when_notProvided', () => {
      const minimalRouter = new Router({ providers });
      expect(minimalRouter).toBeDefined();
    });
  });

  describe('route', () => {
    it('should_returnResponse_when_primaryProviderSucceeds', async () => {
      const request = createMockRequest({ model: 'claude-3-sonnet' });
      const result = await router.route(request);

      expect(result.response).toBeDefined();
      expect(result.response.meta.provider).toBe('anthropic');
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0].success).toBe(true);
    });

    it('should_tryFallbackProvider_when_primaryFails', async () => {
      // Reject all calls to Anthropic
      mockAnthropicAdapter.complete.mockRejectedValue(createMockNetworkError());
      mockOpenAIAdapter.complete.mockResolvedValue(createMockResponse({ provider: 'openai' }));

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      const result = await router.route(request);

      expect(result.response.meta.provider).toBe('openai');
      expect(result.attempts.length).toBeGreaterThan(1);
      expect(result.attempts[result.attempts.length - 1].success).toBe(true);
    });

    it('should_retryOnRetryableError_when_errorOccurs', async () => {
      mockAnthropicAdapter.complete
        .mockRejectedValueOnce(createMockRateLimitError('anthropic'))
        .mockResolvedValueOnce(createMockResponse({ provider: 'anthropic' }));

      const request = createMockRequest({ model: 'claude-3-sonnet' });
      const result = await router.route(request);

      expect(result.response.meta.provider).toBe('anthropic');
      // Should have 2 attempts: 1 failed + 1 success
      expect(result.attempts.length).toBe(2);
    });

    it('should_moveToNextModel_when_maxRetriesExceeded', async () => {
      mockAnthropicAdapter.complete.mockRejectedValue(createMockRateLimitError('anthropic'));
      mockOpenAIAdapter.complete.mockResolvedValueOnce(createMockResponse({ provider: 'openai' }));

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      const result = await router.route(request);

      expect(result.response.meta.provider).toBe('openai');
      // Initial + 2 retries = 3 attempts for Anthropic
      expect(result.attempts.filter(a => a.provider === 'anthropic').length).toBe(3);
    });

    it('should_throwAllProvidersFailedError_when_allFail', async () => {
      mockAnthropicAdapter.complete.mockRejectedValue(createMockNetworkError());
      mockOpenAIAdapter.complete.mockRejectedValue(createMockNetworkError());

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      await expect(router.route(request)).rejects.toMatchObject({
        name: 'AllProvidersFailedError',
        code: 'ALL_PROVIDERS_FAILED',
      });
    });

    it('should_skipMissingProvider_when_notConfigured', async () => {
      // Remove OpenAI provider
      providers.delete('openai');
      router = new Router({ providers, retry: { maxRetries: 0, initialDelayMs: 10, maxDelayMs: 50, backoffMultiplier: 2, retryableErrors: [] } });

      mockAnthropicAdapter.complete.mockRejectedValue(createMockNetworkError());
      mockGoogleAdapter.complete.mockResolvedValueOnce(createMockResponse({ provider: 'google' }));

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4', 'gemini-1.5-pro'], // gpt-4 provider missing
      });

      const result = await router.route(request);

      expect(result.response.meta.provider).toBe('google');
      // Should have recorded attempt with missing provider error
      const missingProviderAttempt = result.attempts.find(
        a => a.model === 'gpt-4' && !a.success
      );
      expect(missingProviderAttempt).toBeDefined();
    });

    it('should_updateFailoverAttempts_when_failoverOccurs', async () => {
      mockAnthropicAdapter.complete.mockRejectedValueOnce(createMockNetworkError());
      mockOpenAIAdapter.complete.mockResolvedValueOnce(createMockResponse({ provider: 'openai' }));

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      const result = await router.route(request);

      // failoverAttempts should reflect failed attempts before success
      expect(result.response.meta.failoverAttempts).toBeGreaterThan(0);
    });

    it('should_notRetry_when_errorNotRetryable', async () => {
      const nonRetryableError = new Error('Bad request');
      (nonRetryableError as any).code = 'BAD_REQUEST';
      (nonRetryableError as any).status = 400;

      mockAnthropicAdapter.complete.mockRejectedValueOnce(nonRetryableError);
      mockOpenAIAdapter.complete.mockResolvedValueOnce(createMockResponse({ provider: 'openai' }));

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      const result = await router.route(request);

      // Should have only 1 attempt for Anthropic (no retries)
      const anthropicAttempts = result.attempts.filter(a => a.provider === 'anthropic');
      expect(anthropicAttempts).toHaveLength(1);
    });
  });

  describe('routeStream', () => {
    it('should_yieldChunks_when_streamSucceeds', async () => {
      const request = createMockRequest({ model: 'claude-3-sonnet' });
      const chunks = await collectStream(router.routeStream(request));

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some(c => c.content)).toBe(true);
    });

    it('should_tryFallback_when_streamFails', async () => {
      mockAnthropicAdapter.stream.mockImplementation(async function* () {
        throw createMockNetworkError();
      });

      mockOpenAIAdapter.stream.mockImplementation(async function* () {
        yield { content: 'Fallback ' };
        yield { content: 'response' };
        yield { finishReason: 'stop', meta: { provider: 'openai' } };
      });

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      const chunks = await collectStream(router.routeStream(request));

      expect(chunks.length).toBeGreaterThan(0);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.meta?.provider).toBe('openai');
    });

    it('should_throwError_when_allStreamsFail', async () => {
      mockAnthropicAdapter.stream.mockImplementation(async function* () {
        throw createMockNetworkError();
      });

      mockOpenAIAdapter.stream.mockImplementation(async function* () {
        throw createMockNetworkError();
      });

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      await expect(collectStream(router.routeStream(request))).rejects.toMatchObject({
        name: 'AllProvidersFailedError',
      });
    });

    it('should_updateFailoverAttempts_when_streamingWithFailover', async () => {
      mockAnthropicAdapter.stream.mockImplementation(async function* () {
        throw createMockNetworkError();
      });

      mockOpenAIAdapter.stream.mockImplementation(async function* () {
        yield { content: 'Response' };
        yield {
          finishReason: 'stop',
          meta: {
            provider: 'openai',
            failoverAttempts: 0, // Will be updated by router
          },
        };
      });

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        fallback: ['gpt-4'],
      });

      const chunks = await collectStream(router.routeStream(request));

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.meta?.failoverAttempts).toBeGreaterThan(0);
    });
  });

  describe('getAvailableProviders', () => {
    it('should_returnAllConfiguredProviders_when_called', () => {
      const availableProviders = router.getAvailableProviders();

      expect(availableProviders).toContain('anthropic');
      expect(availableProviders).toContain('openai');
      expect(availableProviders).toContain('google');
      expect(availableProviders).toHaveLength(3);
    });
  });

  describe('isProviderAvailable', () => {
    it('should_returnTrue_when_providerAvailable', async () => {
      mockAnthropicAdapter.isAvailable.mockResolvedValueOnce(true);

      const available = await router.isProviderAvailable('anthropic');
      expect(available).toBe(true);
    });

    it('should_returnFalse_when_providerNotAvailable', async () => {
      mockAnthropicAdapter.isAvailable.mockResolvedValueOnce(false);

      const available = await router.isProviderAvailable('anthropic');
      expect(available).toBe(false);
    });

    it('should_returnFalse_when_providerNotConfigured', async () => {
      const available = await router.isProviderAvailable('mistral');
      expect(available).toBe(false);
    });
  });

  describe('retry configuration', () => {
    it('should_identifyRetryableErrors_when_checkingStatus', async () => {
      // Test with 503 status (retryable)
      const error503 = new Error('Service unavailable');
      (error503 as any).statusCode = 503;

      mockAnthropicAdapter.complete
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce(createMockResponse({ provider: 'anthropic' }));

      const request = createMockRequest({ model: 'claude-3-sonnet' });
      const result = await router.route(request);

      expect(result.attempts.length).toBe(2); // Initial + 1 retry
    });
  });
});
