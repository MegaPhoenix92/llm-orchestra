/**
 * Tests for LangChain integration.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  OrchestraChatModel,
  toOrchestraMessages,
  toOrchestraTools,
  type LangChainBaseMessage,
  type LangChainTool,
} from '../../src/integrations/langchain.js';
import type { CompletionResponse, CompletionStream, StreamChunk } from '../../src/types/index.js';

// Create a mock Orchestra factory
function createMockOrchestra() {
  return {
    complete: vi.fn(),
    stream: vi.fn(),
    shutdown: vi.fn(),
    getProviders: vi.fn().mockReturnValue(['anthropic']),
    isProviderAvailable: vi.fn().mockResolvedValue(true),
    getProviderForModel: vi.fn().mockReturnValue('anthropic'),
    listModels: vi.fn().mockResolvedValue(['claude-3-haiku']),
    getModelCost: vi.fn().mockReturnValue({ inputPer1k: 0.001, outputPer1k: 0.002 }),
    getStats: vi.fn().mockReturnValue({}),
    resetStats: vi.fn(),
    getTraces: vi.fn().mockReturnValue([]),
    flushTraces: vi.fn().mockResolvedValue(undefined),
  };
}

describe('LangChain Integration', () => {
  describe('toOrchestraMessages', () => {
    it('should_convertHumanMessage_when_givenUserMessage', () => {
      const messages: LangChainBaseMessage[] = [
        { content: 'Hello', _getType: () => 'human' },
      ];

      const result = toOrchestraMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('should_convertSystemMessage_when_givenSystemMessage', () => {
      const messages: LangChainBaseMessage[] = [
        { content: 'You are helpful', _getType: () => 'system' },
      ];

      const result = toOrchestraMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'system', content: 'You are helpful' });
    });

    it('should_convertAIMessage_when_givenAssistantMessage', () => {
      const messages: LangChainBaseMessage[] = [
        { content: 'I can help', _getType: () => 'ai' },
      ];

      const result = toOrchestraMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: 'assistant', content: 'I can help' });
    });

    it('should_convertToolMessage_when_givenToolMessage', () => {
      const messages: LangChainBaseMessage[] = [
        {
          content: '{"result": "success"}',
          _getType: () => 'tool',
          additional_kwargs: { tool_call_id: 'call-123' },
        },
      ];

      const result = toOrchestraMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: 'tool',
        content: '{"result": "success"}',
        toolCallId: 'call-123',
      });
    });

    it('should_handleMultipleMessages_when_givenConversation', () => {
      const messages: LangChainBaseMessage[] = [
        { content: 'Be helpful', _getType: () => 'system' },
        { content: 'Hi', _getType: () => 'human' },
        { content: 'Hello!', _getType: () => 'ai' },
        { content: 'Thanks', _getType: () => 'human' },
      ];

      const result = toOrchestraMessages(messages);

      expect(result).toHaveLength(4);
      expect(result[0].role).toBe('system');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');
      expect(result[3].role).toBe('user');
    });

    it('should_extractTextFromMultimodalContent_when_givenArrayContent', () => {
      const messages: LangChainBaseMessage[] = [
        {
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'image_url', image_url: 'http://example.com/img.png' },
            { type: 'text', text: 'world' },
          ],
          _getType: () => 'human',
        },
      ];

      const result = toOrchestraMessages(messages);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Hello world');
    });

    it('should_preserveMessageName_when_present', () => {
      const messages: LangChainBaseMessage[] = [
        { content: 'Hello', _getType: () => 'human', name: 'user_123' },
      ];

      const result = toOrchestraMessages(messages);

      expect(result[0].name).toBe('user_123');
    });
  });

  describe('toOrchestraTools', () => {
    it('should_convertTools_when_givenLangChainTools', () => {
      const tools: LangChainTool[] = [
        {
          name: 'get_weather',
          description: 'Get current weather',
          schema: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      ];

      const result = toOrchestraTools(tools);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
            },
            required: ['location'],
          },
        },
      });
    });

    it('should_useDefaultParameters_when_schemaNotProvided', () => {
      const tools: LangChainTool[] = [
        {
          name: 'simple_tool',
          description: 'A simple tool',
        },
      ];

      const result = toOrchestraTools(tools);

      expect(result[0].function.parameters).toEqual({
        type: 'object',
        properties: {},
      });
    });
  });

  describe('OrchestraChatModel', () => {
    it('should_returnOrchestraType_when_llmTypeCalled', () => {
      const mockOrchestra = createMockOrchestra();
      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
      });

      expect(model._llmType()).toBe('orchestra');
    });

    it('should_invokeOrchestra_when_generateCalled', async () => {
      const mockOrchestra = createMockOrchestra();
      const mockResponse: CompletionResponse = {
        content: 'Hello!',
        finishReason: 'stop',
        meta: {
          provider: 'anthropic',
          model: 'claude-3-haiku',
          traceId: 'trace-123',
          spanId: 'span-456',
          tokens: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          cost: 0.001,
          latencyMs: 100,
          cached: false,
          failoverAttempts: 0,
        },
      };

      mockOrchestra.complete.mockResolvedValue(mockResponse);

      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
        fallback: ['gpt-4o-mini'],
        tags: ['test'],
      });

      const messages: LangChainBaseMessage[] = [
        { content: 'Hi', _getType: () => 'human' },
      ];

      const result = await model._generate(messages);

      expect(mockOrchestra.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-haiku',
          messages: [{ role: 'user', content: 'Hi' }],
          fallback: ['gpt-4o-mini'],
          tags: ['test'],
        })
      );

      expect(result.generations).toHaveLength(1);
      expect(result.generations[0].text).toBe('Hello!');
      expect(result.llmOutput?.provider).toBe('anthropic');
    });

    it('should_invokeWithString_when_stringInputProvided', async () => {
      const mockOrchestra = createMockOrchestra();
      const mockResponse: CompletionResponse = {
        content: 'Response',
        finishReason: 'stop',
        meta: {
          provider: 'anthropic',
          model: 'claude-3-haiku',
          traceId: 'trace-123',
          spanId: 'span-456',
          tokens: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
          cost: 0.001,
          latencyMs: 50,
          cached: false,
          failoverAttempts: 0,
        },
      };

      mockOrchestra.complete.mockResolvedValue(mockResponse);

      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
      });

      const result = await model.invoke('Hello');

      expect(mockOrchestra.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello' }],
        })
      );

      expect(result.content).toBe('Response');
    });

    it('should_includeToolCalls_when_responseHasToolCalls', async () => {
      const mockOrchestra = createMockOrchestra();
      const mockResponse: CompletionResponse = {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call-123',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location": "NYC"}',
            },
          },
        ],
        meta: {
          provider: 'openai',
          model: 'gpt-4',
          traceId: 'trace-123',
          spanId: 'span-456',
          tokens: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          cost: 0.002,
          latencyMs: 150,
          cached: false,
          failoverAttempts: 0,
        },
      };

      mockOrchestra.complete.mockResolvedValue(mockResponse);

      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'gpt-4',
      });

      const result = await model._generate([
        { content: 'What is the weather?', _getType: () => 'human' },
      ]);

      expect(result.generations[0].message.tool_calls).toHaveLength(1);
      expect(result.generations[0].message.tool_calls![0]).toEqual({
        id: 'call-123',
        name: 'get_weather',
        args: { location: 'NYC' },
      });
    });

    it('should_streamResponse_when_streamCalled', async () => {
      const mockOrchestra = createMockOrchestra();
      const chunks: StreamChunk[] = [
        { content: 'Hello' },
        { content: ' ' },
        { content: 'world' },
        { finishReason: 'stop', meta: { traceId: 'trace-123' } },
      ];

      const mockStream: CompletionStream = {
        async *[Symbol.asyncIterator]() {
          for (const chunk of chunks) {
            yield chunk;
          }
        },
      };

      mockOrchestra.stream.mockReturnValue(mockStream);

      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
      });

      let result = '';
      for await (const chunk of model.stream('Hi')) {
        result += chunk;
      }

      expect(result).toBe('Hello world');
    });

    it('should_createBoundModel_when_bindCalled', async () => {
      const mockOrchestra = createMockOrchestra();
      const mockResponse: CompletionResponse = {
        content: 'Tool result',
        finishReason: 'stop',
        meta: {
          provider: 'anthropic',
          model: 'claude-3-haiku',
          traceId: 'trace-123',
          spanId: 'span-456',
          tokens: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
          cost: 0.001,
          latencyMs: 100,
          cached: false,
          failoverAttempts: 0,
        },
      };

      mockOrchestra.complete.mockResolvedValue(mockResponse);

      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
      });

      const boundModel = model.bind({
        tools: [{ name: 'test_tool', description: 'A test tool' }],
        stop: ['END'],
      });

      await boundModel.invoke([{ content: 'Use the tool', _getType: () => 'human' }]);

      expect(mockOrchestra.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'test_tool',
                description: 'A test tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
          stop: ['END'],
        })
      );
    });

    it('should_createNewModel_when_withConfigCalled', () => {
      const mockOrchestra = createMockOrchestra();
      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
        temperature: 0.5,
      });

      const newModel = model.withConfig({
        model: 'claude-3-opus',
        temperature: 0.8,
      });

      expect(newModel).toBeInstanceOf(OrchestraChatModel);
      expect(newModel).not.toBe(model);
    });

    it('should_enablePiping_when_pipeCalled', async () => {
      const mockOrchestra = createMockOrchestra();
      const mockResponse: CompletionResponse = {
        content: 'Piped response',
        finishReason: 'stop',
        meta: {
          provider: 'anthropic',
          model: 'claude-3-haiku',
          traceId: 'trace-123',
          spanId: 'span-456',
          tokens: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
          cost: 0.001,
          latencyMs: 80,
          cached: false,
          failoverAttempts: 0,
        },
      };

      mockOrchestra.complete.mockResolvedValue(mockResponse);

      const model = new OrchestraChatModel({
        orchestra: mockOrchestra as any,
        model: 'claude-3-haiku',
      });

      const parser = {
        invoke: async (message: { content: string }) => {
          return message.content.toUpperCase();
        },
      };

      const chain = model.pipe(parser);
      const result = await chain.invoke('Hello');

      expect(result).toBe('PIPED RESPONSE');
    });
  });
});
