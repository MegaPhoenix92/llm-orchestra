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
  });
});
