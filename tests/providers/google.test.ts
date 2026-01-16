/**
 * Google Provider Tests
 * Tests for the Gemini API adapter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleProvider } from '../../src/providers/google.js';
import {
  createMockRequest,
  collectStream,
} from '../utils/mocks.js';
import type { ProviderCredentials, Message } from '../../src/types/index.js';

// Mock the Google Generative AI SDK
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn(),
    })),
  };
});

describe('GoogleProvider', () => {
  let provider: GoogleProvider;
  let mockClient: any;
  let mockModel: any;
  let mockChat: any;
  const mockCredentials: ProviderCredentials = {
    apiKey: 'test-google-key',
  };

  beforeEach(async () => {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');

    mockChat = {
      sendMessage: vi.fn(),
      sendMessageStream: vi.fn(),
    };

    mockModel = {
      startChat: vi.fn().mockReturnValue(mockChat),
    };

    mockClient = {
      getGenerativeModel: vi.fn().mockReturnValue(mockModel),
    };

    vi.mocked(GoogleGenerativeAI).mockImplementation(() => mockClient as any);

    provider = new GoogleProvider(mockCredentials);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should_setProviderName_when_initialized', () => {
      expect(provider.name).toBe('google');
    });

    it('should_createGoogleClient_when_constructed', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      expect(GoogleGenerativeAI).toHaveBeenCalledWith('test-google-key');
    });
  });

  describe('complete', () => {
    it('should_returnCompletionResponse_when_apiSucceeds', async () => {
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Hello from Gemini!',
          usageMetadata: {
            promptTokenCount: 12,
            candidatesTokenCount: 18,
            totalTokenCount: 30,
          },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const request = createMockRequest({ model: 'gemini-1.5-pro' });
      const response = await provider.complete(request);

      expect(response.content).toBe('Hello from Gemini!');
      expect(response.finishReason).toBe('stop');
      expect(response.meta.provider).toBe('google');
      expect(response.meta.tokens.inputTokens).toBe(12);
      expect(response.meta.tokens.outputTokens).toBe(18);
    });

    it('should_extractSystemInstruction_when_present', async () => {
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Response',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
      ];

      await provider.complete({ model: 'gemini-1.5-pro', messages });

      const startChatArgs = mockModel.startChat.mock.calls[0][0];
      expect(startChatArgs.systemInstruction).toBe('You are a helpful assistant.');
    });

    it('should_convertMessagesToGeminiFormat_when_present', async () => {
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Response',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const messages: Message[] = [
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ];

      await provider.complete({ model: 'gemini-1.5-pro', messages });

      const startChatArgs = mockModel.startChat.mock.calls[0][0];
      // History should be all but the last message
      expect(startChatArgs.history).toEqual([
        { role: 'user', parts: [{ text: 'Hello!' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ]);

      // Last message should be sent separately
      expect(mockChat.sendMessage).toHaveBeenCalledWith([{ text: 'How are you?' }]);
    });

    it('should_resolveModelAliases_when_aliasProvided', async () => {
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Response',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      await provider.complete(createMockRequest({ model: 'gemini-pro' }));

      expect(mockClient.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-1.5-pro',
        })
      );
    });

    it('should_passGenerationConfig_when_provided', async () => {
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Response',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      await provider.complete(createMockRequest({
        model: 'gemini-1.5-pro',
        temperature: 0.8,
        topP: 0.9,
        maxTokens: 2048,
        stop: ['STOP', 'END'],
      }));

      expect(mockClient.getGenerativeModel).toHaveBeenCalledWith({
        model: 'gemini-1.5-pro',
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.8,
          topP: 0.9,
          stopSequences: ['STOP', 'END'],
        },
      });
    });

    it('should_mapFinishReasons_when_different', async () => {
      // Test MAX_TOKENS finish reason
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Truncated',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4096, totalTokenCount: 4106 },
          candidates: [{ finishReason: 'MAX_TOKENS' }],
        },
      });

      let response = await provider.complete(createMockRequest({ model: 'gemini-1.5-pro' }));
      expect(response.finishReason).toBe('length');

      // Test SAFETY finish reason
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => '',
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
          candidates: [{ finishReason: 'SAFETY' }],
        },
      });

      response = await provider.complete(createMockRequest({ model: 'gemini-1.5-pro' }));
      expect(response.finishReason).toBe('content_filter');
    });

    it('should_handleEmptyMessages_when_noUserMessages', async () => {
      mockChat.sendMessage.mockResolvedValueOnce({
        response: {
          text: () => 'Response',
          usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 10, totalTokenCount: 10 },
          candidates: [{ finishReason: 'STOP' }],
        },
      });

      const messages: Message[] = [
        { role: 'system', content: 'System only' },
      ];

      await provider.complete({ model: 'gemini-1.5-pro', messages });

      // Should add an empty user message
      expect(mockChat.sendMessage).toHaveBeenCalledWith([{ text: '' }]);
    });
  });

  describe('stream', () => {
    it('should_yieldContentChunks_when_streaming', async () => {
      const streamChunks = [
        { text: () => 'Hello' },
        { text: () => ' from' },
        { text: () => ' Gemini' },
      ];

      mockChat.sendMessageStream.mockResolvedValueOnce({
        stream: (async function* () {
          for (const chunk of streamChunks) {
            yield chunk;
          }
        })(),
        response: Promise.resolve({
          text: () => 'Hello from Gemini',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 15,
            totalTokenCount: 25,
          },
          candidates: [{ finishReason: 'STOP' }],
        }),
      });

      const request = createMockRequest({ model: 'gemini-1.5-pro' });
      const chunks = await collectStream(provider.stream(request));

      // Should have content chunks + final metadata chunk
      expect(chunks.length).toBe(4);
      expect(chunks[0].content).toBe('Hello');
      expect(chunks[1].content).toBe(' from');
      expect(chunks[2].content).toBe(' Gemini');
    });

    it('should_includeMetadata_when_streamCompletes', async () => {
      mockChat.sendMessageStream.mockResolvedValueOnce({
        stream: (async function* () {
          yield { text: () => 'Test' };
        })(),
        response: Promise.resolve({
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 20,
            totalTokenCount: 35,
          },
          candidates: [{ finishReason: 'STOP' }],
        }),
      });

      const chunks = await collectStream(provider.stream(createMockRequest({ model: 'gemini-1.5-pro' })));

      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.meta).toBeDefined();
      expect(lastChunk.meta?.tokens?.inputTokens).toBe(15);
      expect(lastChunk.meta?.tokens?.outputTokens).toBe(20);
      expect(lastChunk.finishReason).toBe('stop');
    });
  });

  describe('listModels', () => {
    it('should_returnKnownModels_when_called', async () => {
      const models = await provider.listModels();

      expect(models).toContain('gemini-1.5-pro');
      expect(models).toContain('gemini-1.5-flash');
      expect(models).toContain('gemini-2.0-flash');
      expect(models).toContain('gemini-pro');
    });
  });

  describe('getModelCost', () => {
    it('should_returnCorrectPricing_when_gemini15Pro', () => {
      const cost = provider.getModelCost('gemini-1.5-pro');
      expect(cost.inputPer1k).toBe(0.00125);
      expect(cost.outputPer1k).toBe(0.005);
    });

    it('should_returnCorrectPricing_when_gemini15Flash', () => {
      const cost = provider.getModelCost('gemini-1.5-flash');
      expect(cost.inputPer1k).toBe(0.000075);
      expect(cost.outputPer1k).toBe(0.0003);
    });

    it('should_returnCorrectPricing_when_gemini20Flash', () => {
      const cost = provider.getModelCost('gemini-2.0-flash');
      expect(cost.inputPer1k).toBe(0.0001);
      expect(cost.outputPer1k).toBe(0.0004);
    });

    it('should_returnCorrectPricing_when_geminiProAlias', () => {
      const cost = provider.getModelCost('gemini-pro');
      // Aliased to gemini-1.5-pro
      expect(cost.inputPer1k).toBe(0.00125);
      expect(cost.outputPer1k).toBe(0.005);
    });

    it('should_returnDefaultPricing_when_unknownModel', () => {
      const cost = provider.getModelCost('unknown-gemini-model');
      expect(cost.inputPer1k).toBe(0.00125);
      expect(cost.outputPer1k).toBe(0.005);
    });
  });

  describe('isAvailable', () => {
    it('should_returnTrue_when_listModelsSucceeds', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });

    it('should_returnFalse_when_listModelsFails', async () => {
      vi.spyOn(provider, 'listModels').mockRejectedValueOnce(new Error('API Error'));

      const available = await provider.isAvailable();
      expect(available).toBe(false);
    });
  });
});
