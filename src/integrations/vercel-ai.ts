/**
 * Vercel AI SDK integration helpers for LLM Orchestra.
 *
 * Provides utilities to convert Orchestra streams to Vercel AI SDK compatible formats.
 *
 * @example Basic streaming
 * ```ts
 * import { Orchestra } from 'llm-orchestra';
 * import { toVercelStream } from 'llm-orchestra/integrations/vercel-ai';
 * import { StreamingTextResponse } from 'ai';
 *
 * const orchestra = new Orchestra({ ... });
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   const stream = orchestra.stream({ model: 'gpt-4o-mini', messages });
 *   return new StreamingTextResponse(toVercelStream(stream));
 * }
 * ```
 *
 * @example With metadata via StreamData
 * ```ts
 * import { toVercelStreamWithData, createStreamData } from 'llm-orchestra/integrations/vercel-ai';
 * import { StreamingTextResponse } from 'ai';
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   const stream = orchestra.stream({ model: 'gpt-4o-mini', messages });
 *   const { readable, data } = toVercelStreamWithData(stream);
 *   return new StreamingTextResponse(readable, {}, data);
 * }
 * ```
 */

import type { CompletionStream, StreamChunk, CompletionMeta } from '../types/index.js';

/**
 * StreamData-like interface for metadata streaming.
 * Compatible with Vercel AI SDK's StreamData class.
 */
export interface StreamDataLike {
  append(value: unknown): void;
  close(): void;
}

/**
 * Options for stream conversion.
 */
export interface ToVercelStreamOptions {
  /**
   * Optional StreamData instance for metadata.
   * If provided, chunk metadata will be appended to it.
   */
  data?: StreamDataLike;

  /**
   * Called when the stream completes with final metadata.
   */
  onComplete?: (meta: Partial<CompletionMeta>) => void;

  /**
   * Called when an error occurs.
   */
  onError?: (error: Error) => void;
}

/**
 * Converts an Orchestra CompletionStream to a ReadableStream<Uint8Array>
 * suitable for use with Vercel AI SDK's StreamingTextResponse.
 *
 * @param stream - Orchestra completion stream from `orchestra.stream()`
 * @param options - Optional configuration for metadata handling
 * @returns A ReadableStream that can be passed to StreamingTextResponse
 */
export function toVercelStream(
  stream: CompletionStream,
  options: ToVercelStreamOptions = {}
): ReadableStream<Uint8Array> {
  const { data, onComplete, onError } = options;
  const encoder = new TextEncoder();
  let finalMeta: Partial<CompletionMeta> = {};

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          // Emit text content
          if (chunk.content) {
            controller.enqueue(encoder.encode(chunk.content));
          }

          // Track final metadata
          if (chunk.meta) {
            finalMeta = { ...finalMeta, ...chunk.meta };
          }

          // Append metadata to StreamData on completion
          if (chunk.finishReason && data) {
            data.append({
              meta: finalMeta,
              finishReason: chunk.finishReason,
            });
          }
        }

        // Close StreamData if provided
        if (data) {
          data.close();
        }

        // Call completion callback
        if (onComplete) {
          onComplete(finalMeta);
        }

        controller.close();
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Append error to StreamData
        if (data) {
          data.append({ error: err.message });
          data.close();
        }

        // Call error callback
        if (onError) {
          onError(err);
        }

        controller.error(err);
      }
    },
  });
}

/**
 * Result from toVercelStreamWithData containing both the stream and data object.
 */
export interface VercelStreamWithDataResult {
  /**
   * ReadableStream for use with StreamingTextResponse.
   */
  readable: ReadableStream<Uint8Array>;

  /**
   * StreamData-like object that receives metadata.
   * Pass this as the third argument to StreamingTextResponse.
   */
  data: StreamDataLike;
}

/**
 * Creates a simple StreamData-compatible object for environments
 * where the Vercel AI SDK is not available.
 *
 * Note: For production use with StreamingTextResponse, use
 * the actual StreamData class from the 'ai' package.
 */
export function createStreamData(): StreamDataLike {
  const values: unknown[] = [];
  let closed = false;

  return {
    append(value: unknown) {
      if (!closed) {
        values.push(value);
      }
    },
    close() {
      closed = true;
    },
  };
}

/**
 * Converts an Orchestra CompletionStream to a Vercel AI SDK compatible
 * stream with metadata support via StreamData.
 *
 * This is a convenience wrapper that creates a StreamData-like object
 * automatically. For use with the actual Vercel AI SDK StreamData class,
 * use `toVercelStream` directly with your own StreamData instance.
 *
 * @param stream - Orchestra completion stream from `orchestra.stream()`
 * @param streamData - Optional existing StreamData instance. If not provided, a simple one is created.
 * @returns Object containing the readable stream and data object
 *
 * @example
 * ```ts
 * import { StreamingTextResponse, StreamData } from 'ai';
 *
 * const stream = orchestra.stream({ model: 'gpt-4o-mini', messages });
 * const data = new StreamData();
 * const readable = toVercelStream(stream, { data });
 * return new StreamingTextResponse(readable, {}, data);
 * ```
 */
export function toVercelStreamWithData(
  stream: CompletionStream,
  streamData?: StreamDataLike
): VercelStreamWithDataResult {
  const data = streamData ?? createStreamData();
  const readable = toVercelStream(stream, { data });
  return { readable, data };
}

/**
 * Collects all chunks from an Orchestra stream and returns the complete response.
 * Useful for non-streaming scenarios or testing.
 *
 * @param stream - Orchestra completion stream
 * @returns Promise resolving to collected content and metadata
 */
export async function collectStream(stream: CompletionStream): Promise<{
  content: string;
  meta: Partial<CompletionMeta>;
  finishReason?: string;
}> {
  let content = '';
  let meta: Partial<CompletionMeta> = {};
  let finishReason: string | undefined;

  for await (const chunk of stream) {
    if (chunk.content) {
      content += chunk.content;
    }
    if (chunk.meta) {
      meta = { ...meta, ...chunk.meta };
    }
    if (chunk.finishReason) {
      finishReason = chunk.finishReason;
    }
  }

  return { content, meta, finishReason };
}

/**
 * Type guard to check if a chunk has completion metadata.
 */
export function hasCompletionMeta(
  chunk: StreamChunk
): chunk is StreamChunk & { meta: CompletionMeta } {
  return (
    chunk.meta !== undefined &&
    chunk.meta.provider !== undefined &&
    chunk.meta.model !== undefined
  );
}
