/**
 * Cohere Provider Tests
 * Tests for the Cohere API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CohereProvider } from '../../src/providers/cohere.js';
import { createMockRequest, collectStream } from '../utils/mocks.js';
import type { ProviderCredentials } from '../../src/types/index.js';


describe('CohereProvider', () => {
  let provider: CohereProvider;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-cohere-key',
    baseUrl: 'https://api.cohere.ai/v1',
  };

  beforeEach(() => {
    provider = new CohereProvider(mockCredentials);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should_setProviderName_when_initialized', () => {
      expect(provider.name).toBe('cohere');
    });
  });

  describe('complete', () => {
    it('should_returnCompletionResponse_when_apiSucceeds', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Hello from Cohere!',
          finish_reason: 'COMPLETE',
          token_count: {
            prompt_tokens: 10,
            response_tokens: 5,
            total_tokens: 15,
          },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));

      expect(fetchSpy).toHaveBeenCalled();
      expect(response.content).toBe('Hello from Cohere!');
      expect(response.finishReason).toBe('stop');
      expect(response.meta.provider).toBe('cohere');
      expect(response.meta.tokens.inputTokens).toBe(10);
      expect(response.meta.tokens.outputTokens).toBe(5);
    });

    it('should_convertMessages_toChatHistory', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Response',
          finish_reason: 'COMPLETE',
          token_count: {
            prompt_tokens: 5,
            response_tokens: 5,
            total_tokens: 10,
          },
        }),
      } as Response);

      await provider.complete({
        model: 'command-r',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      const callArgs = (fetchSpy.mock.calls[0][1] as RequestInit) ?? {};
      const body = JSON.parse(callArgs.body as string);
      expect(body.preamble).toBe('You are helpful.');
      expect(body.message).toBe('How are you?');
      expect(body.chat_history).toEqual([
        { role: 'USER', message: 'Hello' },
        { role: 'CHATBOT', message: 'Hi there!' },
      ]);
    });
  });

  describe('stream', () => {
    it('should_returnSingleChunkStream_when_streaming', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Streaming response',
          finish_reason: 'COMPLETE',
          token_count: {
            prompt_tokens: 3,
            response_tokens: 4,
            total_tokens: 7,
          },
        }),
      } as Response);

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'command-r' })));

      expect(chunks[0].content).toBe('Streaming response');
      expect(chunks[chunks.length - 1].finishReason).toBe('stop');
      expect(chunks[chunks.length - 1].meta?.tokens?.totalTokens).toBe(7);
    });
  });

  describe('listModels', () => {
    it('should_returnModels_when_called', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'command-r' }, { name: 'command-r-plus' }],
        }),
      } as Response);

      const models = await provider.listModels();
      expect(models).toContain('command-r');
      expect(models).toContain('command-r-plus');
    });
  });
});
