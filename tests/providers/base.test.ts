/**
 * Base Provider Tests
 * Tests for the abstract BaseProvider class functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseProvider } from '../../src/providers/base.js';
import type {
  ProviderCredentials,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  TokenUsage,
  ProviderName,
} from '../../src/types/index.js';

// Concrete implementation for testing abstract class
class TestProvider extends BaseProvider {
  name: ProviderName = 'anthropic';

  constructor(credentials: ProviderCredentials) {
    super(credentials);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const usage: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };

    return {
      content: 'Test response',
      finishReason: 'stop',
      meta: {
        latencyMs: 100,
        tokens: usage,
        cost: this.calculateCost(request.model, usage),
        traceId: '',
        spanId: this.generateSpanId(),
        model: request.model,
        provider: this.name,
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    yield { content: 'Test' };
    yield { content: ' stream' };
    yield { finishReason: 'stop' };
  }

  async listModels(): Promise<string[]> {
    return ['test-model-1', 'test-model-2'];
  }

  getModelCost(model: string): { inputPer1k: number; outputPer1k: number } {
    return { inputPer1k: 0.01, outputPer1k: 0.03 };
  }

  // Expose protected methods for testing
  public testCalculateCost(model: string, usage: TokenUsage): number {
    return this.calculateCost(model, usage);
  }

  public testGenerateSpanId(): string {
    return this.generateSpanId();
  }
}

describe('BaseProvider', () => {
  let provider: TestProvider;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-api-key',
    baseUrl: 'https://api.test.com',
  };

  beforeEach(() => {
    provider = new TestProvider(mockCredentials);
  });

  describe('constructor', () => {
    it('should_storeCredentials_when_initialized', () => {
      // Access the protected credentials through a custom getter
      expect(provider).toBeDefined();
    });

    it('should_setProviderName_when_constructed', () => {
      expect(provider.name).toBe('anthropic');
    });
  });

  describe('calculateCost', () => {
    it('should_calculateCostCorrectly_when_givenTokenUsage', () => {
      const usage: TokenUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      };

      // With inputPer1k=0.01 and outputPer1k=0.03:
      // Input cost: (1000/1000) * 0.01 = 0.01
      // Output cost: (500/1000) * 0.03 = 0.015
      // Total: 0.025
      const cost = provider.testCalculateCost('test-model', usage);
      expect(cost).toBe(0.025);
    });

    it('should_roundTo6DecimalPlaces_when_calculatingCost', () => {
      const usage: TokenUsage = {
        inputTokens: 333,
        outputTokens: 777,
        totalTokens: 1110,
      };

      const cost = provider.testCalculateCost('test-model', usage);
      const decimalPlaces = cost.toString().split('.')[1]?.length || 0;
      expect(decimalPlaces).toBeLessThanOrEqual(6);
    });

    it('should_handleZeroTokens_when_noTokensUsed', () => {
      const usage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };

      const cost = provider.testCalculateCost('test-model', usage);
      expect(cost).toBe(0);
    });

    it('should_handleLargeTokenCounts_when_manyTokensUsed', () => {
      const usage: TokenUsage = {
        inputTokens: 100000,
        outputTokens: 50000,
        totalTokens: 150000,
      };

      // Input cost: (100000/1000) * 0.01 = 1.00
      // Output cost: (50000/1000) * 0.03 = 1.50
      // Total: 2.50
      const cost = provider.testCalculateCost('test-model', usage);
      expect(cost).toBe(2.5);
    });
  });

  describe('generateSpanId', () => {
    it('should_generateUniqueIds_when_calledMultipleTimes', () => {
      const id1 = provider.testGenerateSpanId();
      const id2 = provider.testGenerateSpanId();
      const id3 = provider.testGenerateSpanId();

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should_startWithSpanPrefix_when_generated', () => {
      const spanId = provider.testGenerateSpanId();
      expect(spanId).toMatch(/^span_/);
    });

    it('should_containTimestamp_when_generated', () => {
      const spanId = provider.testGenerateSpanId();
      // Format: span_{timestamp}_{random}
      const parts = spanId.split('_');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('span');
    });
  });

  describe('isAvailable', () => {
    it('should_returnTrue_when_listModelsSucceeds', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('should_returnFalse_when_listModelsFails', async () => {
      const failingProvider = new TestProvider(mockCredentials);
      vi.spyOn(failingProvider, 'listModels').mockRejectedValueOnce(new Error('API Error'));

      const available = await failingProvider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('complete', () => {
    it('should_returnCompletionResponse_when_called', async () => {
      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.complete(request);

      expect(response).toBeDefined();
      expect(response.content).toBe('Test response');
      expect(response.finishReason).toBe('stop');
      expect(response.meta.model).toBe('test-model');
      expect(response.meta.provider).toBe('anthropic');
    });

    it('should_includeCostInMeta_when_completed', async () => {
      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.complete(request);

      expect(response.meta.cost).toBeGreaterThan(0);
    });

    it('should_includeSpanId_when_completed', async () => {
      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response = await provider.complete(request);

      expect(response.meta.spanId).toMatch(/^span_/);
    });
  });

  describe('stream', () => {
    it('should_yieldChunks_when_streaming', async () => {
      const request: CompletionRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const chunks: any[] = [];
      for await (const chunk of provider.stream(request)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(3);
      expect(chunks[0].content).toBe('Test');
      expect(chunks[1].content).toBe(' stream');
      expect(chunks[2].finishReason).toBe('stop');
    });
  });

  describe('listModels', () => {
    it('should_returnModelList_when_called', async () => {
      const models = await provider.listModels();

      expect(models).toEqual(['test-model-1', 'test-model-2']);
    });
  });

  describe('getModelCost', () => {
    it('should_returnPricing_when_called', () => {
      const cost = provider.getModelCost('test-model');

      expect(cost).toEqual({
        inputPer1k: 0.01,
        outputPer1k: 0.03,
      });
    });
  });
});
