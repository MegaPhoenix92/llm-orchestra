/**
 * Azure OpenAI Provider Tests
 * Tests for the Azure OpenAI API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadableStream } from 'stream/web';
import { AzureOpenAIProvider } from '../../src/providers/azure-openai.js';
import { createMockRequest, collectStream } from '../utils/mocks.js';
import type { ProviderCredentials } from '../../src/types/index.js';


describe('AzureOpenAIProvider', () => {
  let provider: AzureOpenAIProvider;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-azure-key',
    baseUrl: 'https://example.openai.azure.com',
    apiVersion: '2024-02-15-preview',
  };

  beforeEach(() => {
    provider = new AzureOpenAIProvider(mockCredentials);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should_setProviderName_when_initialized', () => {
      expect(provider.name).toBe('azure-openai');
    });
  });

  describe('complete', () => {
    it('should_callAzureEndpoint_withDeploymentAndApiVersion', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Hello Azure!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'azure:gpt-4o' }));

      expect(fetchSpy).toHaveBeenCalled();
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/openai/deployments/gpt-4o/chat/completions');
      expect(url).toContain('api-version=2024-02-15-preview');
      expect(response.content).toBe('Hello Azure!');
      expect(response.meta.provider).toBe('azure-openai');
      expect(response.meta.tokens.totalTokens).toBe(12);
    });
  });

  describe('stream', () => {
    it('should_streamChunks_when_streaming', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n'
            )
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        body: stream,
      } as Response);

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'azure:gpt-4o' })));

      expect(chunks[0].content).toBe('Hello');
      expect(chunks[chunks.length - 1].finishReason).toBe('stop');
      expect(chunks[chunks.length - 1].meta?.tokens?.totalTokens).toBe(3);
    });
  });
});
