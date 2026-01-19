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

    it('should_useDefaultBaseUrl_when_notProvided', async () => {
      const p = new CohereProvider({ apiKey: 'test' });
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Hi',
          finish_reason: 'COMPLETE',
          token_count: { prompt_tokens: 1, response_tokens: 1, total_tokens: 2 },
        }),
      } as Response);

      await p.complete(createMockRequest({ model: 'command-r' }));
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('https://api.cohere.ai/v1');
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

    it('should_handleMaxTokensFinishReason_when_maxTokensReached', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Truncated...',
          finish_reason: 'MAX_TOKENS',
          token_count: { prompt_tokens: 5, response_tokens: 100, total_tokens: 105 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));
      expect(response.finishReason).toBe('length');
    });

    it('should_handleContentFilterFinishReason_when_contentFiltered', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: '',
          finish_reason: 'CONTENT_FILTER',
          token_count: { prompt_tokens: 5, response_tokens: 0, total_tokens: 5 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));
      expect(response.finishReason).toBe('content_filter');
    });

    it('should_throwError_when_apiFails', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      await expect(provider.complete(createMockRequest({ model: 'command-r' }))).rejects.toThrow(
        'Cohere API error: 401 Unauthorized'
      );
    });

    it('should_fallbackToMessage_when_textNotPresent', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: 'Response from message field',
          finish_reason: 'COMPLETE',
          token_count: { prompt_tokens: 5, response_tokens: 5, total_tokens: 10 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));
      expect(response.content).toBe('Response from message field');
    });

    it('should_handleAlternativeUsageFields_when_inputOutputTokensUsed', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Hi',
          finish_reason: 'COMPLETE',
          token_count: { input_tokens: 10, output_tokens: 5 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));
      expect(response.meta.tokens.inputTokens).toBe(10);
      expect(response.meta.tokens.outputTokens).toBe(5);
      expect(response.meta.tokens.totalTokens).toBe(15);
    });

    it('should_handleMetaBilledUnits_when_tokenCountMissing', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Hi',
          finish_reason: 'COMPLETE',
          meta: { billed_units: { input_tokens: 8, output_tokens: 4 } },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));
      expect(response.meta.tokens.inputTokens).toBe(8);
      expect(response.meta.tokens.outputTokens).toBe(4);
    });

    it('should_handleEmptyContent_when_noTextOrMessage', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          finish_reason: 'COMPLETE',
          token_count: { prompt_tokens: 5, response_tokens: 0, total_tokens: 5 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'command-r' }));
      expect(response.content).toBe('');
    });

    it('should_handleSingleUserMessage_when_noHistory', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Response',
          finish_reason: 'COMPLETE',
          token_count: { prompt_tokens: 5, response_tokens: 5, total_tokens: 10 },
        }),
      } as Response);

      await provider.complete({
        model: 'command-r',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const callArgs = (fetchSpy.mock.calls[0][1] as RequestInit) ?? {};
      const body = JSON.parse(callArgs.body as string);
      expect(body.message).toBe('Hello');
      expect(body.chat_history).toBeUndefined();
    });

    it('should_filterToolMessages_when_present', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: 'Response',
          finish_reason: 'COMPLETE',
          token_count: { prompt_tokens: 5, response_tokens: 5, total_tokens: 10 },
        }),
      } as Response);

      await provider.complete({
        model: 'command-r',
        messages: [
          { role: 'user', content: 'Call tool' },
          { role: 'tool', content: '{"result": "done"}', toolCallId: 'call_123' },
          { role: 'user', content: 'Thanks!' },
        ],
      });

      const callArgs = (fetchSpy.mock.calls[0][1] as RequestInit) ?? {};
      const body = JSON.parse(callArgs.body as string);
      expect(body.message).toBe('Thanks!');
      expect(body.chat_history).toEqual([{ role: 'USER', message: 'Call tool' }]);
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

    it('should_handleEmptyContent_when_noResponseContent', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          finish_reason: 'COMPLETE',
          token_count: { prompt_tokens: 3, response_tokens: 0, total_tokens: 3 },
        }),
      } as Response);

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'command-r' })));

      expect(chunks.length).toBe(1);
      expect(chunks[0].finishReason).toBe('stop');
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

    it('should_returnEmptyArray_when_noModels', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const models = await provider.listModels();
      expect(models).toEqual([]);
      expect(models.length).toBe(0);
    });

    it('should_throwError_when_listModelsFails', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      } as Response);

      await expect(provider.listModels()).rejects.toThrow('Cohere API error: 403 Forbidden');
    });

    it('should_useModelId_when_nameNotPresent', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ id: 'command-r' }, { name: 'command-r-plus' }],
        }),
      } as Response);

      const models = await provider.listModels();
      expect(models).toContain('command-r');
      expect(models).toContain('command-r-plus');
    });

    it('should_filterNullModels_when_noNameOrId', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: 'command-r' }, {}, { name: null }],
        }),
      } as Response);

      const models = await provider.listModels();
      expect(models).toEqual(['command-r']);
      expect(models.length).toBe(1);
    });
  });

  describe('getModelCost', () => {
    it('should_returnCost_when_knownModel', () => {
      const cost = provider.getModelCost('command-r');
      expect(cost.inputPer1k).toBe(0);
      expect(cost.outputPer1k).toBe(0);
    });

    it('should_returnCost_when_modelContainsKnownKey', () => {
      const cost = provider.getModelCost('command-r-plus-2024');
      expect(cost.inputPer1k).toBe(0);
      expect(cost.outputPer1k).toBe(0);
    });

    it('should_returnZeroCost_when_unknownModel', () => {
      const cost = provider.getModelCost('unknown-model');
      expect(cost.inputPer1k).toBe(0);
      expect(cost.outputPer1k).toBe(0);
    });
  });
});
