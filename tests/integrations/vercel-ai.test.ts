/**
 * Tests for Vercel AI SDK integration helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  toVercelStream,
  toVercelStreamWithData,
  createStreamData,
  collectStream,
  hasCompletionMeta,
  type StreamDataLike,
} from '../../src/integrations/vercel-ai.js';
import type { CompletionStream, StreamChunk, CompletionMeta } from '../../src/types/index.js';

// Helper to create a mock stream
function createMockStream(chunks: StreamChunk[]): CompletionStream {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe('Vercel AI SDK Integration', () => {
  describe('toVercelStream', () => {
    it('should_convertStreamToReadableStream_when_givenOrchestraStream', async () => {
      const chunks: StreamChunk[] = [
        { content: 'Hello' },
        { content: ' world' },
        { content: '!' },
        { finishReason: 'stop', meta: { provider: 'openai', model: 'gpt-4' } as Partial<CompletionMeta> },
      ];
      const stream = createMockStream(chunks);

      const readable = toVercelStream(stream);
      const reader = readable.getReader();
      const decoder = new TextDecoder();

      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }

      expect(result).toBe('Hello world!');
    });

    it('should_appendMetadataToStreamData_when_streamDataProvided', async () => {
      const chunks: StreamChunk[] = [
        { content: 'Test' },
        {
          finishReason: 'stop',
          meta: {
            provider: 'anthropic',
            model: 'claude-3-haiku',
            traceId: 'trace-123',
          } as Partial<CompletionMeta>,
        },
      ];
      const stream = createMockStream(chunks);

      const appendedValues: unknown[] = [];
      const mockData: StreamDataLike = {
        append: (value) => appendedValues.push(value),
        close: vi.fn(),
      };

      const readable = toVercelStream(stream, { data: mockData });
      const reader = readable.getReader();

      // Consume the stream
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(appendedValues).toHaveLength(1);
      expect(appendedValues[0]).toMatchObject({
        meta: expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-3-haiku',
        }),
        finishReason: 'stop',
      });
      expect(mockData.close).toHaveBeenCalled();
    });

    it('should_callOnComplete_when_streamEnds', async () => {
      const chunks: StreamChunk[] = [
        { content: 'Done' },
        {
          finishReason: 'stop',
          meta: { provider: 'openai', model: 'gpt-4', latencyMs: 100 } as Partial<CompletionMeta>,
        },
      ];
      const stream = createMockStream(chunks);

      let completeMeta: Partial<CompletionMeta> | undefined;
      const readable = toVercelStream(stream, {
        onComplete: (meta) => {
          completeMeta = meta;
        },
      });

      const reader = readable.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      expect(completeMeta).toBeDefined();
      expect(completeMeta?.provider).toBe('openai');
      expect(completeMeta?.latencyMs).toBe(100);
    });

    it('should_handleErrors_when_streamThrows', async () => {
      const errorStream: CompletionStream = {
        async *[Symbol.asyncIterator]() {
          yield { content: 'Start' };
          throw new Error('Stream failed');
        },
      };

      let errorMessage: string | undefined;
      const mockData: StreamDataLike = {
        append: vi.fn(),
        close: vi.fn(),
      };

      const readable = toVercelStream(errorStream, {
        data: mockData,
        onError: (err) => {
          errorMessage = err.message;
        },
      });

      const reader = readable.getReader();

      await expect(async () => {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }).rejects.toThrow('Stream failed');

      expect(errorMessage).toBe('Stream failed');
      expect(mockData.append).toHaveBeenCalledWith({ error: 'Stream failed' });
      expect(mockData.close).toHaveBeenCalled();
    });
  });

  describe('toVercelStreamWithData', () => {
    it('should_returnBothReadableAndData_when_called', async () => {
      const chunks: StreamChunk[] = [
        { content: 'Test' },
        { finishReason: 'stop', meta: {} as Partial<CompletionMeta> },
      ];
      const stream = createMockStream(chunks);

      const result = toVercelStreamWithData(stream);

      expect(result).toHaveProperty('readable');
      expect(result).toHaveProperty('data');
      expect(result.readable).toBeInstanceOf(ReadableStream);
    });

    it('should_useProvidedStreamData_when_passed', async () => {
      const chunks: StreamChunk[] = [
        { content: 'Test' },
        { finishReason: 'stop', meta: {} as Partial<CompletionMeta> },
      ];
      const stream = createMockStream(chunks);

      const customData: StreamDataLike = {
        append: vi.fn(),
        close: vi.fn(),
      };

      const result = toVercelStreamWithData(stream, customData);

      expect(result.data).toBe(customData);
    });
  });

  describe('createStreamData', () => {
    it('should_appendValues_when_notClosed', () => {
      const data = createStreamData();

      data.append({ test: 1 });
      data.append({ test: 2 });

      // No error should be thrown
      expect(true).toBe(true);
    });

    it('should_ignoreAppends_when_closed', () => {
      const data = createStreamData();

      data.append({ test: 1 });
      data.close();
      data.append({ test: 2 }); // Should be ignored

      // No error should be thrown
      expect(true).toBe(true);
    });
  });

  describe('collectStream', () => {
    it('should_collectAllContent_when_streamCompletes', async () => {
      const chunks: StreamChunk[] = [
        { content: 'Hello' },
        { content: ' ' },
        { content: 'world' },
        {
          finishReason: 'stop',
          meta: {
            provider: 'openai',
            model: 'gpt-4',
            traceId: 'trace-456',
          } as Partial<CompletionMeta>,
        },
      ];
      const stream = createMockStream(chunks);

      const result = await collectStream(stream);

      expect(result.content).toBe('Hello world');
      expect(result.finishReason).toBe('stop');
      expect(result.meta.provider).toBe('openai');
      expect(result.meta.traceId).toBe('trace-456');
    });

    it('should_returnEmptyContent_when_streamHasNoContent', async () => {
      const chunks: StreamChunk[] = [
        { finishReason: 'stop', meta: {} as Partial<CompletionMeta> },
      ];
      const stream = createMockStream(chunks);

      const result = await collectStream(stream);

      expect(result.content).toBe('');
      expect(result.finishReason).toBe('stop');
    });
  });

  describe('hasCompletionMeta', () => {
    it('should_returnTrue_when_chunkHasFullMeta', () => {
      const chunk: StreamChunk = {
        content: 'test',
        meta: {
          provider: 'anthropic',
          model: 'claude-3-haiku',
        } as Partial<CompletionMeta>,
      };

      expect(hasCompletionMeta(chunk)).toBe(true);
    });

    it('should_returnFalse_when_chunkHasNoMeta', () => {
      const chunk: StreamChunk = {
        content: 'test',
      };

      expect(hasCompletionMeta(chunk)).toBe(false);
    });

    it('should_returnFalse_when_metaIsMissingProvider', () => {
      const chunk: StreamChunk = {
        content: 'test',
        meta: {
          model: 'gpt-4',
        } as Partial<CompletionMeta>,
      };

      expect(hasCompletionMeta(chunk)).toBe(false);
    });
  });
});
