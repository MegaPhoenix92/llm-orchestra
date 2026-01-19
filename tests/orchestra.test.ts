/**
 * Orchestra Tests
 * Tests for the main Orchestra class with cost tracking and statistics
 */

import { describe, it, expect, vi } from 'vitest';
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

    it('should_returnModels_when_providerConfigured', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {
          anthropic: { apiKey: 'test-key' },
        },
      };

      const orchestra = new Orchestra(config);

      // listModels calls the provider's listModels which returns available models
      const models = await orchestra.listModels('anthropic');
      expect(Array.isArray(models)).toBe(true);

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

    it('should_returnUndefined_when_modelProviderNotInConfig', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {
          openai: { apiKey: 'test-key' },
        },
      };

      const orchestra = new Orchestra(config);

      // claude-3-sonnet is anthropic, but anthropic is not configured
      const cost = orchestra.getModelCost('claude-3-sonnet');
      expect(cost).toBeUndefined();

      await orchestra.shutdown();
    });

    it('should_returnPricing_when_modelProviderConfigured', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {
          anthropic: { apiKey: 'test-key' },
        },
      };

      const orchestra = new Orchestra(config);

      const cost = orchestra.getModelCost('claude-3-sonnet-20240229');
      expect(cost).toBeDefined();
      expect(cost).toHaveProperty('inputPer1k');
      expect(cost).toHaveProperty('outputPer1k');

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

  describe('checkCostAlerts (private method)', () => {
    it('should_doNothing_when_costTrackingDisabled', async () => {
      const { Orchestra } = await import('../src/orchestra.js');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const config: OrchestraConfig = {
        providers: {},
        // No cost tracking config
      };

      const orchestra = new Orchestra(config);
      (orchestra as any).checkCostAlerts(100);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
      await orchestra.shutdown();
    });

    it('should_logWarning_when_alertThresholdExceeded', async () => {
      const { Orchestra } = await import('../src/orchestra.js');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config: OrchestraConfig = {
        providers: {},
        observability: {
          costTracking: {
            enabled: true,
            alertThreshold: 5,
          },
        },
      };

      const orchestra = new Orchestra(config);
      // Manually set totalCost to exceed threshold
      (orchestra as any).stats.totalCost = 10;

      (orchestra as any).checkCostAlerts(1);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cost alert')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('exceeds threshold')
      );

      warnSpy.mockRestore();
      await orchestra.shutdown();
    });

    it('should_logError_when_budgetLimitExceeded', async () => {
      const { Orchestra } = await import('../src/orchestra.js');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const config: OrchestraConfig = {
        providers: {},
        observability: {
          costTracking: {
            enabled: true,
            budgetLimit: 50,
          },
        },
      };

      const orchestra = new Orchestra(config);
      // Manually set totalCost to exceed budget
      (orchestra as any).stats.totalCost = 100;

      (orchestra as any).checkCostAlerts(1);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Budget exceeded')
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('exceeds limit')
      );

      errorSpy.mockRestore();
      await orchestra.shutdown();
    });

    it('should_logBothAlerts_when_bothThresholdsExceeded', async () => {
      const { Orchestra } = await import('../src/orchestra.js');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const config: OrchestraConfig = {
        providers: {},
        observability: {
          costTracking: {
            enabled: true,
            alertThreshold: 10,
            budgetLimit: 50,
          },
        },
      };

      const orchestra = new Orchestra(config);
      (orchestra as any).stats.totalCost = 100;

      (orchestra as any).checkCostAlerts(1);

      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
      errorSpy.mockRestore();
      await orchestra.shutdown();
    });
  });

  describe('mergeToolCalls (private method)', () => {
    it('should_mergeToolCallsWithIds_when_idsProvided', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const target: any[] = [];
      const byKey = new Map<string, any>();
      const counter = { value: 0 };

      // First chunk with ID and function name
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { id: 'call_123', type: 'function', function: { name: 'get_weather' } },
      ]);

      // Second chunk with same ID and arguments
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { id: 'call_123', function: { arguments: '{"city":"NYC"}' } },
      ]);

      expect(target).toHaveLength(1);
      expect(target[0].id).toBe('call_123');
      expect(target[0].function.name).toBe('get_weather');
      expect(target[0].function.arguments).toBe('{"city":"NYC"}');

      await orchestra.shutdown();
    });

    it('should_appendToLastToolCall_when_subsequentChunksOmitId', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const target: any[] = [];
      const byKey = new Map<string, any>();
      const counter = { value: 0 };

      // First chunk with ID (common in OpenAI streaming)
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { id: 'call_456', type: 'function', function: { name: 'search' } },
      ]);

      // Subsequent chunks WITHOUT ID (OpenAI behavior)
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { function: { arguments: '{"query":' } },
      ]);

      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { function: { arguments: '"hello world"}' } },
      ]);

      expect(target).toHaveLength(1);
      expect(target[0].id).toBe('call_456');
      expect(target[0].function.name).toBe('search');
      expect(target[0].function.arguments).toBe('{"query":"hello world"}');

      await orchestra.shutdown();
    });

    it('should_handleMultipleToolCalls_when_differentIdsProvided', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const target: any[] = [];
      const byKey = new Map<string, any>();
      const counter = { value: 0 };

      // First tool call
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { id: 'call_1', type: 'function', function: { name: 'func_a', arguments: '{}' } },
      ]);

      // Second tool call with different ID
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { id: 'call_2', type: 'function', function: { name: 'func_b', arguments: '{}' } },
      ]);

      expect(target).toHaveLength(2);
      expect(target[0].function.name).toBe('func_a');
      expect(target[1].function.name).toBe('func_b');

      await orchestra.shutdown();
    });

    it('should_createUnknownKey_when_noIdAndNoLastKey', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const target: any[] = [];
      const byKey = new Map<string, any>();
      const counter = { value: 0 };

      // Chunk without ID when there's no prior context
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        { function: { name: 'orphan_func', arguments: '{}' } },
      ]);

      expect(target).toHaveLength(1);
      expect(target[0].id).toBe('unknown_0');
      expect(target[0].function.name).toBe('orphan_func');

      await orchestra.shutdown();
    });

    it('should_skipEmptyPartials_when_noMeaningfulData', async () => {
      const { Orchestra } = await import('../src/orchestra.js');

      const config: OrchestraConfig = {
        providers: {},
      };

      const orchestra = new Orchestra(config);
      const target: any[] = [];
      const byKey = new Map<string, any>();
      const counter = { value: 0 };

      // Empty partial should be skipped
      (orchestra as any).mergeToolCalls(target, byKey, counter, [
        {},
        { function: {} },
      ]);

      expect(target).toHaveLength(0);

      await orchestra.shutdown();
    });
  });
});
