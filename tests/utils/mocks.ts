/**
 * Shared mock utilities for LLM Orchestra tests
 */

import { vi } from 'vitest';
import type {
  CompletionRequest,
  CompletionResponse,
  TokenUsage,
  ProviderName,
  Message,
  ToolCall,
} from '../../src/types/index.js';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock completion request
 */
export function createMockRequest(overrides?: Partial<CompletionRequest>): CompletionRequest {
  return {
    model: 'test-model',
    messages: [
      { role: 'user', content: 'Hello, world!' },
    ],
    maxTokens: 1024,
    temperature: 0.7,
    ...overrides,
  };
}

/**
 * Create a mock completion response
 */
export function createMockResponse(overrides?: {
  content?: string;
  provider?: ProviderName;
  model?: string;
  tokens?: Partial<TokenUsage>;
  cost?: number;
  latencyMs?: number;
  toolCalls?: ToolCall[];
}): CompletionResponse {
  const tokens: TokenUsage = {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    ...overrides?.tokens,
  };

  return {
    content: overrides?.content ?? 'Test response content',
    toolCalls: overrides?.toolCalls,
    finishReason: 'stop',
    meta: {
      latencyMs: overrides?.latencyMs ?? 150,
      tokens,
      cost: overrides?.cost ?? 0.001,
      traceId: `trace_test_${Date.now()}`,
      spanId: `span_test_${Date.now()}`,
      model: overrides?.model ?? 'test-model',
      provider: overrides?.provider ?? 'anthropic',
      cached: false,
      failoverAttempts: 0,
    },
  };
}

/**
 * Create mock messages
 */
export function createMockMessages(count = 2): Message[] {
  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];

  for (let i = 0; i < count; i++) {
    messages.push(
      { role: 'user', content: `User message ${i + 1}` },
      { role: 'assistant', content: `Assistant response ${i + 1}` }
    );
  }

  return messages;
}

/**
 * Create mock tool definitions
 */
export function createMockTools() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'get_weather',
        description: 'Get the current weather in a location',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'The city name' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
          required: ['location'],
        },
      },
    },
  ];
}

// ============================================================================
// Anthropic API Mocks
// ============================================================================

export function createMockAnthropicClient() {
  return {
    messages: {
      create: vi.fn().mockImplementation(async (params: any) => {
        if (params.stream) {
          return createMockAnthropicStream();
        }
        return {
          id: 'msg_test_123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Mock Anthropic response' }],
          model: params.model,
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 10,
            output_tokens: 20,
          },
        };
      }),
    },
    models: {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: 'claude-3-opus-20240229' },
          { id: 'claude-3-sonnet-20240229' },
        ],
      }),
    },
  };
}

async function* createMockAnthropicStream() {
  yield {
    type: 'message_start',
    message: {
      usage: { input_tokens: 10 },
    },
  };
  yield {
    type: 'content_block_delta',
    delta: { text: 'Mock ' },
  };
  yield {
    type: 'content_block_delta',
    delta: { text: 'streaming ' },
  };
  yield {
    type: 'content_block_delta',
    delta: { text: 'response' },
  };
  yield {
    type: 'message_delta',
    usage: { output_tokens: 15 },
    delta: { stop_reason: 'end_turn' },
  };
}

// ============================================================================
// OpenAI API Mocks
// ============================================================================

export function createMockOpenAIClient() {
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          if (params.stream) {
            return createMockOpenAIStream();
          }
          return {
            id: 'chatcmpl-test-123',
            object: 'chat.completion',
            created: Date.now(),
            model: params.model,
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Mock OpenAI response',
                  tool_calls: undefined,
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          };
        }),
      },
    },
    models: {
      list: vi.fn().mockResolvedValue({
        data: [
          { id: 'gpt-4' },
          { id: 'gpt-4-turbo' },
          { id: 'gpt-3.5-turbo' },
          { id: 'davinci' },
        ],
      }),
    },
  };
}

async function* createMockOpenAIStream() {
  yield {
    choices: [{ delta: { content: 'Mock ' }, finish_reason: null }],
  };
  yield {
    choices: [{ delta: { content: 'streaming ' }, finish_reason: null }],
  };
  yield {
    choices: [{ delta: { content: 'response' }, finish_reason: null }],
  };
  yield {
    choices: [{ delta: {}, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 15,
      completion_tokens: 20,
      total_tokens: 35,
    },
  };
}

// ============================================================================
// Google AI API Mocks
// ============================================================================

export function createMockGoogleClient() {
  const mockChat = {
    sendMessage: vi.fn().mockResolvedValue({
      response: {
        text: () => 'Mock Google response',
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 18,
          totalTokenCount: 30,
        },
        candidates: [{ finishReason: 'STOP' }],
      },
    }),
    sendMessageStream: vi.fn().mockResolvedValue({
      stream: createMockGoogleStream(),
      response: Promise.resolve({
        text: () => 'Mock Google streaming response',
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 18,
          totalTokenCount: 30,
        },
        candidates: [{ finishReason: 'STOP' }],
      }),
    }),
  };

  const mockModel = {
    startChat: vi.fn().mockReturnValue(mockChat),
  };

  return {
    getGenerativeModel: vi.fn().mockReturnValue(mockModel),
    _mockChat: mockChat,
    _mockModel: mockModel,
  };
}

async function* createMockGoogleStream() {
  yield { text: () => 'Mock ' };
  yield { text: () => 'streaming ' };
  yield { text: () => 'response' };
}

// ============================================================================
// Provider Adapter Mocks
// ============================================================================

export function createMockProviderAdapter(name: ProviderName = 'anthropic') {
  return {
    name,
    complete: vi.fn().mockResolvedValue(createMockResponse({ provider: name })),
    stream: vi.fn().mockImplementation(async function* () {
      yield { content: 'Mock ' };
      yield { content: 'stream ' };
      yield { content: 'response' };
      yield {
        finishReason: 'stop',
        meta: {
          latencyMs: 150,
          tokens: { inputTokens: 10, outputTokens: 15, totalTokens: 25 },
          cost: 0.001,
          model: 'test-model',
          provider: name,
        },
      };
    }),
    listModels: vi.fn().mockResolvedValue(['model-1', 'model-2']),
    isAvailable: vi.fn().mockResolvedValue(true),
    getModelCost: vi.fn().mockReturnValue({ inputPer1k: 0.01, outputPer1k: 0.03 }),
  };
}

// ============================================================================
// Error Factories
// ============================================================================

export function createMockRateLimitError(provider: ProviderName = 'anthropic') {
  const error = new Error(`Rate limit exceeded for ${provider}`);
  (error as any).code = 'RATE_LIMIT';
  (error as any).status = 429;
  return error;
}

export function createMockTimeoutError(timeoutMs = 30000) {
  const error = new Error(`Request timed out after ${timeoutMs}ms`);
  (error as any).code = 'TIMEOUT';
  return error;
}

export function createMockNetworkError() {
  const error = new Error('Network error');
  (error as any).code = 'NETWORK_ERROR';
  return error;
}

// ============================================================================
// Timer Utilities
// ============================================================================

export function advanceTimers(ms: number) {
  vi.advanceTimersByTime(ms);
}

export function useFakeTimers() {
  vi.useFakeTimers();
}

export function useRealTimers() {
  vi.useRealTimers();
}

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Collect all chunks from an async iterable
 */
export async function collectStream<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}
