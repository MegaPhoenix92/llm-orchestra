/**
 * Anthropic Provider Tests
 * Tests for the Claude API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic.js';
import {
  createMockRequest,
  createMockMessages,
  createMockTools,
  collectStream,
} from '../utils/mocks.js';
import type { ProviderCredentials, Message } from '../../src/types/index.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockClient: any;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-anthropic-key',
    baseUrl: 'https://api.anthropic.com',
  };

  beforeEach(async () => {
    // Get the mocked Anthropic constructor
    const Anthropic = (await import('@anthropic-ai/sdk')).default;

    // Create mock client instance
    mockClient = {
      messages: {
        create: vi.fn(),
      },
    };

    // Make constructor return our mock
    vi.mocked(Anthropic).mockImplementation(() => mockClient as any);

    provider = new AnthropicProvider(mockCredentials);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should_setProviderName_when_initialized', () => {
      expect(provider.name).toBe('anthropic');
    });

    it('should_createAnthropicClient_when_constructed', async () => {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      expect(Anthropic).toHaveBeenCalledWith({
        apiKey: 'test-anthropic-key',
        baseURL: 'https://api.anthropic.com',
      });
    });
  });

  describe('complete', () => {
    it('should_returnCompletionResponse_when_apiSucceeds', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello from Claude!' }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 15,
          output_tokens: 25,
        },
      });

      const request = createMockRequest({ model: 'claude-3-sonnet' });
      const response = await provider.complete(request);

      expect(response.content).toBe('Hello from Claude!');
      expect(response.finishReason).toBe('stop');
      expect(response.meta.provider).toBe('anthropic');
      expect(response.meta.tokens.inputTokens).toBe(15);
      expect(response.meta.tokens.outputTokens).toBe(25);
    });

    it('should_extractSystemMessage_when_present', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      });

      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ];

      await provider.complete({ model: 'claude-3-sonnet', messages });

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.system).toBe('You are a helpful assistant.');
      expect(callArgs.messages).toEqual([
        { role: 'user', content: 'Hello!' },
      ]);
    });

    it('should_handleToolCalls_when_modelRequestsTools', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'Let me check the weather.' },
          {
            type: 'tool_use',
            id: 'tool_123',
            name: 'get_weather',
            input: { location: 'San Francisco' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 20, output_tokens: 30 },
      });

      const request = createMockRequest({
        model: 'claude-3-sonnet',
        tools: createMockTools(),
      });

      const response = await provider.complete(request);

      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].id).toBe('tool_123');
      expect(response.toolCalls![0].function.name).toBe('get_weather');
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should_resolveModelAliases_when_aliasProvided', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      });

      await provider.complete(createMockRequest({ model: 'claude-3-opus' }));

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-3-opus-20240229');
    });

    it('should_passOptionalParameters_when_provided', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      });

      await provider.complete(createMockRequest({
        model: 'claude-3-sonnet',
        temperature: 0.8,
        topP: 0.9,
        maxTokens: 2048,
        stop: ['STOP', 'END'],
      }));

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.8);
      expect(callArgs.top_p).toBe(0.9);
      expect(callArgs.max_tokens).toBe(2048);
      expect(callArgs.stop_sequences).toEqual(['STOP', 'END']);
    });

    it('should_handleToolResultMessages_when_present', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'The weather is sunny.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 30, output_tokens: 15 },
      });

      const messages: Message[] = [
        { role: 'user', content: 'What is the weather?' },
        { role: 'assistant', content: 'Let me check.' },
        { role: 'tool', content: '{"temperature": 72}', toolCallId: 'tool_123' },
      ];

      await provider.complete({ model: 'claude-3-sonnet', messages });

      const callArgs = mockClient.messages.create.mock.calls[0][0];
      expect(callArgs.messages[2]).toEqual({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool_123',
          content: '{"temperature": 72}',
        }],
      });
    });

    it('should_mapStopReasons_when_different', async () => {
      // Test 'max_tokens' stop reason
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Truncated...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 4096 },
      });

      const response = await provider.complete(createMockRequest({ model: 'claude-3-sonnet' }));
      expect(response.finishReason).toBe('length');
    });

    it('should_calculateCostCorrectly_when_completed', async () => {
      mockClient.messages.create.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1000, output_tokens: 500 },
      });

      const response = await provider.complete(createMockRequest({ model: 'claude-3-sonnet' }));

      // Sonnet pricing: inputPer1k=0.003, outputPer1k=0.015
      // Cost = (1000/1000)*0.003 + (500/1000)*0.015 = 0.003 + 0.0075 = 0.0105
      expect(response.meta.cost).toBe(0.0105);
    });
  });

  describe('stream', () => {
    it('should_yieldContentChunks_when_streaming', async () => {
      const streamEvents = [
        { type: 'message_start', message: { usage: { input_tokens: 10 } } },
        { type: 'content_block_delta', delta: { text: 'Hello' } },
        { type: 'content_block_delta', delta: { text: ' world' } },
        { type: 'message_delta', usage: { output_tokens: 5 }, delta: { stop_reason: 'end_turn' } },
      ];

      mockClient.messages.create.mockResolvedValueOnce(
        (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        })()
      );

      const request = createMockRequest({ model: 'claude-3-sonnet' });
      const chunks = await collectStream(provider.stream(request));

      expect(chunks.length).toBe(3);
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' world');
      expect(chunks[2].finishReason).toBe('stop');
    });

    it('should_includeMetadata_when_streamCompletes', async () => {
      const streamEvents = [
        { type: 'message_start', message: { usage: { input_tokens: 15 } } },
        { type: 'content_block_delta', delta: { text: 'Response' } },
        { type: 'message_delta', usage: { output_tokens: 20 }, delta: { stop_reason: 'end_turn' } },
      ];

      mockClient.messages.create.mockResolvedValueOnce(
        (async function* () {
          for (const event of streamEvents) {
            yield event;
          }
        })()
      );

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'claude-3-sonnet' })));

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.meta).toBeDefined();
      expect(lastChunk.meta?.tokens?.inputTokens).toBe(15);
      expect(lastChunk.meta?.tokens?.outputTokens).toBe(20);
    });
  });

  describe('listModels', () => {
    it('should_returnKnownModels_when_called', async () => {
      const models = await provider.listModels();

      expect(models).toContain('claude-3-opus-20240229');
      expect(models).toContain('claude-3-sonnet-20240229');
      expect(models).toContain('claude-3-haiku-20240307');
      expect(models).toContain('claude-3-5-sonnet-20241022');
    });
  });

  describe('getModelCost', () => {
    it('should_returnCorrectPricing_when_opusModel', () => {
      const cost = provider.getModelCost('claude-3-opus');
      expect(cost.inputPer1k).toBe(0.015);
      expect(cost.outputPer1k).toBe(0.075);
    });

    it('should_returnCorrectPricing_when_sonnetModel', () => {
      const cost = provider.getModelCost('claude-3-sonnet');
      expect(cost.inputPer1k).toBe(0.003);
      expect(cost.outputPer1k).toBe(0.015);
    });

    it('should_returnCorrectPricing_when_haikuModel', () => {
      const cost = provider.getModelCost('claude-3-haiku');
      expect(cost.inputPer1k).toBe(0.00025);
      expect(cost.outputPer1k).toBe(0.00125);
    });

    it('should_returnDefaultPricing_when_unknownModel', () => {
      const cost = provider.getModelCost('unknown-model');
      expect(cost.inputPer1k).toBe(0.003);
      expect(cost.outputPer1k).toBe(0.015);
    });
  });
});
