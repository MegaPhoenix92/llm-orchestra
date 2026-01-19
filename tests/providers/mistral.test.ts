/**
 * Mistral Provider Tests
 * Tests for the Mistral API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadableStream } from 'stream/web';
import { MistralProvider } from '../../src/providers/mistral.js';
import { createMockRequest, createMockTools, collectStream } from '../utils/mocks.js';
import type { ProviderCredentials, Message } from '../../src/types/index.js';


describe('MistralProvider', () => {
  let provider: MistralProvider;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-mistral-key',
    baseUrl: 'https://api.mistral.ai/v1',
  };

  beforeEach(() => {
    provider = new MistralProvider(mockCredentials);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should_setProviderName_when_initialized', () => {
      expect(provider.name).toBe('mistral');
    });

    it('should_useDefaultBaseUrl_when_notProvided', async () => {
      const p = new MistralProvider({ apiKey: 'test' });
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as Response);

      await p.complete(createMockRequest({ model: 'mistral-large' }));
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('https://api.mistral.ai/v1');
    });
  });

  describe('complete', () => {
    it('should_returnCompletionResponse_when_apiSucceeds', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Hello from Mistral!',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 18,
            total_tokens: 30,
          },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'mistral-large' }));

      expect(fetchSpy).toHaveBeenCalled();
      expect(response.content).toBe('Hello from Mistral!');
      expect(response.finishReason).toBe('stop');
      expect(response.meta.provider).toBe('mistral');
      expect(response.meta.tokens.inputTokens).toBe(12);
      expect(response.meta.tokens.outputTokens).toBe(18);
    });

    it('should_handleToolCalls_when_modelRequestsTools', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: '{"location":"SF"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({
        model: 'mistral-large',
        tools: createMockTools(),
      }));

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls?.[0].id).toBe('call_123');
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should_handleAllMessageTypes_when_convertingMessages', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Response',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        }),
      } as Response);

      const messages: Message[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'tool', content: '{"result": "done"}', toolCallId: 'call_456' },
      ];

      await provider.complete({ model: 'mistral-large', messages });

      const callArgs = (fetchSpy.mock.calls[0][1] as RequestInit) ?? {};
      const body = JSON.parse(callArgs.body as string);
      expect(body.messages).toHaveLength(4);
      expect(body.messages[3]).toEqual({
        role: 'tool',
        tool_call_id: 'call_456',
        content: '{"result": "done"}',
      });
    });

    it('should_handleLengthFinishReason_when_maxTokensReached', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Truncated...' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 5, completion_tokens: 100, total_tokens: 105 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'mistral-large' }));
      expect(response.finishReason).toBe('length');
    });

    it('should_handleContentFilterFinishReason_when_contentFiltered', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
          usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'mistral-large' }));
      expect(response.finishReason).toBe('content_filter');
    });

    it('should_throwError_when_apiFails', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      await expect(provider.complete(createMockRequest({ model: 'mistral-large' }))).rejects.toThrow(
        'Mistral API error: 401 Unauthorized'
      );
    });

    it('should_handleNullContent_when_messageContentIsNull', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'mistral-large' }));
      expect(response.content).toBe('');
    });

    it('should_handleMissingUsage_when_usageNotReturned', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'mistral-large' }));
      expect(response.meta.tokens.totalTokens).toBe(0);
    });
  });

  describe('stream', () => {
    it('should_streamContent_and_metadata', async () => {
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
              'data: {"choices":[{"delta":{"content":" world"}}]}\n\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\n'
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

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'mistral-large' })));

      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
      expect(chunks[chunks.length - 1].finishReason).toBe('stop');
      expect(chunks[chunks.length - 1].meta?.tokens?.totalTokens).toBe(5);
    });

    it('should_throwError_when_streamBodyMissing', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        body: null,
      } as Response);

      const stream = provider.stream(createMockRequest({ model: 'mistral-large' }));
      await expect(collectStream(stream)).rejects.toThrow('Mistral streaming response missing body.');
    });

    it('should_throwError_when_streamApiFails', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const stream = provider.stream(createMockRequest({ model: 'mistral-large' }));
      await expect(collectStream(stream)).rejects.toThrow('Mistral API error: 500 Internal Server Error');
    });

    it('should_streamToolCalls_when_present', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"loc\\""}}]}}]}\n\n'
            )
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":10,"total_tokens":15}}\n\n'
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

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'mistral-large', tools: createMockTools() })));
      const toolChunk = chunks.find(c => c.toolCalls);
      expect(toolChunk?.toolCalls?.[0].id).toBe('call_1');
    });
  });

  describe('listModels', () => {
    it('should_returnModels_when_called', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'mistral-large' }, { id: 'mistral-small' }],
        }),
      } as Response);

      const models = await provider.listModels();
      expect(models).toContain('mistral-large');
      expect(models).toContain('mistral-small');
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

      await expect(provider.listModels()).rejects.toThrow('Mistral API error: 403 Forbidden');
    });
  });

  describe('getModelCost', () => {
    it('should_returnCost_when_knownModel', () => {
      const cost = provider.getModelCost('mistral-large');
      expect(cost.inputPer1k).toBe(0);
      expect(cost.outputPer1k).toBe(0);
    });

    it('should_returnCost_when_modelContainsKnownKey', () => {
      const cost = provider.getModelCost('mistral-large-2024');
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
