/**
 * Orchestra Tests
 * Tests for the main Orchestra class with cost tracking and statistics
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockRequest,
  createMockResponse,
  collectStream,
} from './utils/mocks.js';
import type { OrchestraConfig, CompletionResponse, ProviderName } from '../src/types/index.js';

// We test the Orchestra class through its public interface
// by mocking the underlying providers and router

describe('Orchestra', () => {
  // Test the OrchestraStats interface structure
  describe('OrchestraStats structure', () => {
    it('should_defineCorrectStructure_when_imported', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const stats = orchestra.getStats();

      expect(stats).toHaveProperty('totalRequests');
      expect(stats).toHaveProperty('totalTokens');
      expect(stats).toHaveProperty('totalCost');
      expect(stats).toHaveProperty('byProvider');
      expect(stats).toHaveProperty('byModel');
      expect(stats.totalTokens).toHaveProperty('input');
      expect(stats.totalTokens).toHaveProperty('output');

      await orchestra.shutdown();
    });
  });

  describe('initialization', () => {
    it('should_createOrchestraInstance_when_validConfig', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {
          anthropic: { apiKey: 'test-key' },
        },
      };

      const orchestra = new Orchestra(config);
      expect(orchestra).toBeDefined();

      await orchestra.shutdown();
    });

    it('should_initializeWithZeroStats_when_created', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const stats = orchestra.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.totalTokens.input).toBe(0);
      expect(stats.totalTokens.output).toBe(0);
      expect(stats.totalCost).toBe(0);

      await orchestra.shutdown();
    });
  });

  describe('getProviders', () => {
    it('should_returnConfiguredProviders_when_called', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {
          anthropic: { apiKey: 'test-anthropic-key' },
          openai: { apiKey: 'test-openai-key' },
        },
      };

      const orchestra = new Orchestra(config);
      const providers = orchestra.getProviders();

      expect(providers).toContain('anthropic');
      expect(providers).toContain('openai');

      await orchestra.shutdown();
    });

    it('should_returnEmptyArray_when_noProviders', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const providers = orchestra.getProviders();

      expect(providers).toHaveLength(0);

      await orchestra.shutdown();
    });
  });

  describe('getProviderForModel', () => {
    it('should_returnAnthropic_when_claudeModel', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      expect(orchestra.getProviderForModel('claude-3-sonnet')).toBe('anthropic');
      expect(orchestra.getProviderForModel('claude-3-opus')).toBe('anthropic');

      await orchestra.shutdown();
    });

    it('should_returnOpenAI_when_gptModel', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      expect(orchestra.getProviderForModel('gpt-4')).toBe('openai');
      expect(orchestra.getProviderForModel('gpt-3.5-turbo')).toBe('openai');

      await orchestra.shutdown();
    });

    it('should_returnGoogle_when_geminiModel', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      expect(orchestra.getProviderForModel('gemini-1.5-pro')).toBe('google');
      expect(orchestra.getProviderForModel('gemini-1.5-flash')).toBe('google');

      await orchestra.shutdown();
    });

    it('should_returnUndefined_when_unknownModel', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      expect(orchestra.getProviderForModel('unknown-model')).toBeUndefined();

      await orchestra.shutdown();
    });
  });

  describe('getStats and resetStats', () => {
    it('should_returnCopyOfStats_when_called', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      const stats1 = orchestra.getStats();
      const stats2 = orchestra.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);

      await orchestra.shutdown();
    });

    it('should_resetStatsToZero_when_resetCalled', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      // Manually modify internal stats for testing
      (orchestra as any).stats.totalRequests = 10;
      (orchestra as any).stats.totalCost = 5.0;

      orchestra.resetStats();

      const stats = orchestra.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalCost).toBe(0);

      await orchestra.shutdown();
    });
  });

  describe('listModels', () => {
    it('should_returnEmptyArray_when_providerNotConfigured', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      const models = await orchestra.listModels('anthropic');
      expect(models).toEqual([]);

      await orchestra.shutdown();
    });
  });

  describe('getModelCost', () => {
    it('should_returnUndefined_when_providerNotConfigured', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      const cost = orchestra.getModelCost('unknown-model');
      expect(cost).toBeUndefined();

      await orchestra.shutdown();
    });
  });

  describe('getTraces', () => {
    it('should_returnEmptyArray_when_noTraces', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      const traces = orchestra.getTraces();
      expect(Array.isArray(traces)).toBe(true);

      await orchestra.shutdown();
    });
  });

  describe('flushTraces', () => {
    it('should_completeWithoutError_when_called', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      await expect(orchestra.flushTraces()).resolves.not.toThrow();

      await orchestra.shutdown();
    });
  });

  describe('shutdown', () => {
    it('should_completeWithoutError_when_called', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);

      await expect(orchestra.shutdown()).resolves.not.toThrow();
    });
  });

  describe('observability config', () => {
    it('should_acceptTracingConfig_when_provided', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
        observability: {
          tracing: {
            enabled: true,
            sampleRate: 0.5,
            includePrompts: false,
          },
        },
      };

      const orchestra = new Orchestra(config);
      expect(orchestra).toBeDefined();

      await orchestra.shutdown();
    });

    it('should_acceptCostTrackingConfig_when_provided', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
        observability: {
          costTracking: {
            enabled: true,
            alertThreshold: 10,
            budgetLimit: 100,
          },
        },
      };

      const orchestra = new Orchestra(config);
      expect(orchestra).toBeDefined();

      await orchestra.shutdown();
    });
  });

  describe('retry config', () => {
    it('should_acceptRetryConfig_when_provided', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
        retry: {
          maxRetries: 5,
          initialDelayMs: 500,
          maxDelayMs: 10000,
          backoffMultiplier: 1.5,
          retryableErrors: ['RATE_LIMIT', 'TIMEOUT'],
        },
      };

      const orchestra = new Orchestra(config);
      expect(orchestra).toBeDefined();

      await orchestra.shutdown();
    });
  });
});
