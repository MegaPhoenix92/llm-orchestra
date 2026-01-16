/**
 * OpenAI Provider Tests
 * Tests for the GPT API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import {
  createMockRequest,
  createMockTools,
  collectStream,
} from '../utils/mocks.js';
import type { ProviderCredentials, Message } from '../../src/types/index.js';

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
      models: {
        list: vi.fn(),
      },
    })),
  };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockClient: any;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-openai-key',
    baseUrl: 'https://api.openai.com/v1',
    organizationId: 'org-test',
  };

  beforeEach(async () => {
    const OpenAI = (await import('openai')).default;

    mockClient = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
      models: {
        list: vi.fn(),
      },
    };

    vi.mocked(OpenAI).mockImplementation(() => mockClient as any);

    provider = new OpenAIProvider(mockCredentials);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should_setProviderName_when_initialized', () => {
      expect(provider.name).toBe('openai');
    });

    it('should_createOpenAIClient_when_constructed', async () => {
      const OpenAI = (await import('openai')).default;
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-openai-key',
        baseURL: 'https://api.openai.com/v1',
        organization: 'org-test',
      });
    });
  });

  describe('complete', () => {
    it('should_returnCompletionResponse_when_apiSucceeds', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4-turbo',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello from GPT!',
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 20,
          completion_tokens: 30,
          total_tokens: 50,
        },
      });

      const request = createMockRequest({ model: 'gpt-4-turbo' });
      const response = await provider.complete(request);

      expect(response.content).toBe('Hello from GPT!');
      expect(response.finishReason).toBe('stop');
      expect(response.meta.provider).toBe('openai');
      expect(response.meta.tokens.inputTokens).toBe(20);
      expect(response.meta.tokens.outputTokens).toBe(30);
      expect(response.meta.tokens.totalTokens).toBe(50);
    });

    it('should_handleToolCalls_when_modelRequestsTools', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location":"San Francisco"}',
              },
            }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 25, completion_tokens: 20, total_tokens: 45 },
      });

      const request = createMockRequest({
        model: 'gpt-4-turbo',
        tools: createMockTools(),
      });

      const response = await provider.complete(request);

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].id).toBe('call_123');
      expect(response.toolCalls![0].function.name).toBe('get_weather');
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should_handleAllMessageTypes_when_convertingMessages', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: { role: 'assistant', content: 'Response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      const messages: Message[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'tool', content: '{"result": "done"}', toolCallId: 'call_456' },
      ];

      await provider.complete({ model: 'gpt-4', messages });

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.messages).toHaveLength(4);
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
      expect(callArgs.messages[3]).toEqual({
        role: 'tool',
        tool_call_id: 'call_456',
        content: '{"result": "done"}',
      });
    });

    it('should_passOptionalParameters_when_provided', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Response' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });

      await provider.complete(createMockRequest({
        model: 'gpt-4',
        temperature: 0.5,
        topP: 0.95,
        maxTokens: 1000,
        stop: ['STOP'],
        toolChoice: 'auto',
      }));

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.5);
      expect(callArgs.top_p).toBe(0.95);
      expect(callArgs.max_tokens).toBe(1000);
      expect(callArgs.stop).toEqual(['STOP']);
      expect(callArgs.tool_choice).toBe('auto');
    });

    it('should_mapFinishReasons_when_different', async () => {
      // Test 'length' finish reason
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: 'Truncated' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 10, completion_tokens: 4096, total_tokens: 4106 },
      });

      let response = await provider.complete(createMockRequest({ model: 'gpt-4' }));
      expect(response.finishReason).toBe('length');

      // Test 'content_filter' finish reason
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{ message: { content: '' }, finish_reason: 'content_filter' }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      response = await provider.complete(createMockRequest({ model: 'gpt-4' }));
      expect(response.finishReason).toBe('content_filter');
    });

    it('should_handleNullContent_when_usingTools', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce({
        choices: [{
          message: { role: 'assistant', content: null },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = await provider.complete(createMockRequest({ model: 'gpt-4' }));
      expect(response.content).toBe('');
    });
  });

  describe('stream', () => {
    it('should_yieldContentChunks_when_streaming', async () => {
      const streamChunks = [
        { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
        { choices: [{ delta: { content: ' world' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } },
      ];

      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of streamChunks) {
            yield chunk;
          }
        })()
      );

      const request = createMockRequest({ model: 'gpt-4' });
      const chunks = await collectStream(provider.stream(request));

      expect(chunks.length).toBe(3);
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
      expect(chunks[2].finishReason).toBe('stop');
    });

    it('should_includeUsageMetadata_when_streamCompletes', async () => {
      const streamChunks = [
        { choices: [{ delta: { content: 'Test' }, finish_reason: null }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 15, completion_tokens: 25, total_tokens: 40 },
        },
      ];

      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of streamChunks) {
            yield chunk;
          }
        })()
      );

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'gpt-4' })));

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.meta).toBeDefined();
      expect(lastChunk.meta?.tokens?.inputTokens).toBe(15);
      expect(lastChunk.meta?.tokens?.outputTokens).toBe(25);
    });

    it('should_includeStreamOptions_when_creating', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'Test' }, finish_reason: 'stop' }] };
        })()
      );

      await collectStream(provider.stream(createMockRequest({ model: 'gpt-4' })));

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.stream).toBe(true);
      expect(callArgs.stream_options).toEqual({ include_usage: true });
    });

    it('should_yieldToolCalls_when_streamingToolCalls', async () => {
      const streamChunks = [
        {
          choices: [{
            delta: {
              tool_calls: [{
                id: 'call_123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"San Francisco"}',
                },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        },
      ];

      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          for (const chunk of streamChunks) {
            yield chunk;
          }
        })()
      );

      const request = createMockRequest({
        model: 'gpt-4',
        tools: createMockTools(),
        toolChoice: 'auto',
      });
      const chunks = await collectStream(provider.stream(request));

      const toolCallChunk = chunks.find((chunk) => chunk.toolCalls?.length);
      expect(toolCallChunk?.toolCalls?.[0]?.id).toBe('call_123');
      expect(toolCallChunk?.toolCalls?.[0]?.function?.name).toBe('get_weather');
    });

    it('should_passToolingOptions_when_streaming', async () => {
      mockClient.chat.completions.create.mockResolvedValueOnce(
        (async function* () {
          yield { choices: [{ delta: { content: 'Test' }, finish_reason: 'stop' }] };
        })()
      );

      await collectStream(provider.stream(createMockRequest({
        model: 'gpt-4',
        tools: createMockTools(),
        toolChoice: 'auto',
      })));

      const callArgs = mockClient.chat.completions.create.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      expect(callArgs.tool_choice).toBe('auto');
    });
  });

  describe('listModels', () => {
    it('should_returnGPTModels_when_called', async () => {
      mockClient.models.list.mockResolvedValueOnce({
        data: [
          { id: 'gpt-4' },
          { id: 'gpt-4-turbo' },
          { id: 'gpt-3.5-turbo' },
          { id: 'davinci-002' }, // Should be filtered out
          { id: 'whisper-1' }, // Should be filtered out
        ],
      });

      const models = await provider.listModels();

      expect(models).toContain('gpt-4');
      expect(models).toContain('gpt-4-turbo');
      expect(models).toContain('gpt-3.5-turbo');
      expect(models).not.toContain('davinci-002');
      expect(models).not.toContain('whisper-1');
    });
  });

  describe('getModelCost', () => {
    it('should_returnCorrectPricing_when_gpt4Turbo', () => {
      const cost = provider.getModelCost('gpt-4-turbo');
      expect(cost.inputPer1k).toBe(0.01);
      expect(cost.outputPer1k).toBe(0.03);
    });

    it('should_returnPricing_when_gpt4TurboStyle', () => {
      // Test GPT-4 Turbo pricing
      const cost = provider.getModelCost('gpt-4-turbo-preview');
      expect(cost.inputPer1k).toBe(0.01);
      expect(cost.outputPer1k).toBe(0.03);
    });

    it('should_returnCorrectPricing_when_gpt35Turbo', () => {
      const cost = provider.getModelCost('gpt-3.5-turbo');
      expect(cost.inputPer1k).toBe(0.0005);
      expect(cost.outputPer1k).toBe(0.0015);
    });

    it('should_returnPricing_when_gpt4oStyle', () => {
      // Test that pricing lookup works for known models
      const cost = provider.getModelCost('gpt-4-turbo');
      expect(cost.inputPer1k).toBe(0.01);
      expect(cost.outputPer1k).toBe(0.03);
    });

    it('should_returnPricing_when_gpt35TurboStyle', () => {
      const cost = provider.getModelCost('gpt-3.5-turbo');
      expect(cost.inputPer1k).toBe(0.0005);
      expect(cost.outputPer1k).toBe(0.0015);
    });

    it('should_returnDefaultPricing_when_unknownModel', () => {
      const cost = provider.getModelCost('unknown-gpt-model');
      expect(cost.inputPer1k).toBe(0.01);
      expect(cost.outputPer1k).toBe(0.03);
    });
  });

  describe('isAvailable', () => {
    it('should_returnTrue_when_apiResponds', async () => {
      mockClient.models.list.mockResolvedValueOnce({ data: [{ id: 'gpt-4' }] });

      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('should_returnFalse_when_apiFails', async () => {
      mockClient.models.list.mockRejectedValueOnce(new Error('API Error'));

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });
});
