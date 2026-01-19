/**
 * Azure OpenAI Provider Tests
 * Tests for the Azure OpenAI API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadableStream } from 'stream/web';
import { AzureOpenAIProvider } from '../../src/providers/azure-openai.js';
import { createMockRequest, createMockTools, collectStream } from '../utils/mocks.js';
import type { ProviderCredentials, Message } from '../../src/types/index.js';


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

    it('should_throwError_when_baseUrlNotProvided', () => {
      expect(() => new AzureOpenAIProvider({ apiKey: 'test-key' })).toThrow(
        'Azure OpenAI requires baseUrl (resource endpoint).'
      );
    });

    it('should_useDefaultApiVersion_when_notProvided', () => {
      const p = new AzureOpenAIProvider({ apiKey: 'test', baseUrl: 'https://test.openai.azure.com' });
      expect(p.name).toBe('azure-openai');
    });

    it('should_stripTrailingSlash_when_baseUrlHasIt', async () => {
      const p = new AzureOpenAIProvider({
        apiKey: 'test',
        baseUrl: 'https://test.openai.azure.com/'
      });
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as Response);

      await p.complete(createMockRequest({ model: 'gpt-4' }));
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).not.toContain('//openai');
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

    it('should_normalizeAzureOpenAIPrefix_when_modelHasIt', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      } as Response);

      await provider.complete(createMockRequest({ model: 'azure-openai:gpt-4o' }));
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('/openai/deployments/gpt-4o/chat/completions');
    });

    it('should_handleToolCalls_when_modelRequestsTools', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_123',
                    type: 'function',
                    function: { name: 'get_weather', arguments: '{"location":"Seattle"}' },
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
        model: 'gpt-4o',
        tools: createMockTools(),
      }));

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls?.[0].id).toBe('call_123');
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should_handleLengthFinishReason_when_maxTokensReached', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Truncated...' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 5, completion_tokens: 100, total_tokens: 105 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'gpt-4o' }));
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

      const response = await provider.complete(createMockRequest({ model: 'gpt-4o' }));
      expect(response.finishReason).toBe('content_filter');
    });

    it('should_throwError_when_apiFails', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      } as Response);

      await expect(provider.complete(createMockRequest({ model: 'gpt-4o' }))).rejects.toThrow(
        'Azure OpenAI API error: 401 Unauthorized'
      );
    });

    it('should_convertToolMessages_when_present', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Done' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        }),
      } as Response);

      const messages: Message[] = [
        { role: 'user', content: 'Get weather' },
        { role: 'assistant', content: '' },
        { role: 'tool', content: '{"temp": 72}', toolCallId: 'call_123' },
      ];

      await provider.complete({ model: 'gpt-4o', messages });
      const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
      expect(body.messages[2]).toEqual({
        role: 'tool',
        tool_call_id: 'call_123',
        content: '{"temp": 72}',
      });
    });

    it('should_handleNullContent_when_messageContentIsNull', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'gpt-4o' }));
      expect(response.content).toBe('');
    });

    it('should_handleMissingUsage_when_usageNotReturned', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }],
        }),
      } as Response);

      const response = await provider.complete(createMockRequest({ model: 'gpt-4o' }));
      expect(response.meta.tokens.totalTokens).toBe(0);
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

    it('should_throwError_when_streamBodyMissing', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        body: null,
      } as Response);

      const stream = provider.stream(createMockRequest({ model: 'gpt-4o' }));
      await expect(collectStream(stream)).rejects.toThrow('Azure OpenAI streaming response missing body.');
    });

    it('should_throwError_when_streamApiFails', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const stream = provider.stream(createMockRequest({ model: 'gpt-4o' }));
      await expect(collectStream(stream)).rejects.toThrow('Azure OpenAI API error: 500 Internal Server Error');
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

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'gpt-4o', tools: createMockTools() })));
      const toolChunk = chunks.find(c => c.toolCalls);
      expect(toolChunk?.toolCalls?.[0].id).toBe('call_1');
    });
  });

  describe('listModels', () => {
    it('should_returnModels_when_called', async () => {
      vi.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'gpt-4o' }, { id: 'gpt-35-turbo' }],
        }),
      } as Response);

      const models = await provider.listModels();
      expect(models).toContain('gpt-4o');
      expect(models).toContain('gpt-35-turbo');
      expect(models.length).toBe(2);
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

      await expect(provider.listModels()).rejects.toThrow('Azure OpenAI API error: 403 Forbidden');
    });
  });

  describe('getModelCost', () => {
    it('should_returnZeroCost_when_called', () => {
      const cost = provider.getModelCost('gpt-4o');
      expect(cost.inputPer1k).toBe(0);
      expect(cost.outputPer1k).toBe(0);
    });
  });
});
