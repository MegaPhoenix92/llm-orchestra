/**
 * LangChain integration for LLM Orchestra.
 *
 * Provides a BaseChatModel wrapper that enables Orchestra to be used
 * directly in LangChain Expression Language (LCEL) pipelines.
 *
 * @example Basic usage
 * ```ts
 * import { Orchestra } from 'llm-orchestra';
 * import { OrchestraChatModel } from 'llm-orchestra/integrations/langchain';
 * import { ChatPromptTemplate } from '@langchain/core/prompts';
 * import { StringOutputParser } from '@langchain/core/output_parsers';
 *
 * const orchestra = new Orchestra({ ... });
 * const model = new OrchestraChatModel({ orchestra, model: 'claude-3-haiku' });
 *
 * const chain = ChatPromptTemplate.fromMessages([
 *   ['system', 'You are a helpful assistant.'],
 *   ['human', '{question}'],
 * ]).pipe(model).pipe(new StringOutputParser());
 *
 * const result = await chain.invoke({ question: 'What is AI?' });
 * ```
 *
 * @example With failover
 * ```ts
 * const model = new OrchestraChatModel({
 *   orchestra,
 *   model: 'claude-3-opus',
 *   fallback: ['gpt-4-turbo', 'gemini-pro'],
 *   tags: ['production', 'chat'],
 * });
 * ```
 */

import type { Orchestra } from '../orchestra.js';
import type {
  Message,
  MessageRole,
  CompletionRequest,
  CompletionMeta,
  ToolDefinition,
} from '../types/index.js';

// LangChain core types - we define interfaces to avoid hard dependency
// Users must install @langchain/core themselves

/**
 * LangChain BaseMessage interface (simplified).
 */
export interface LangChainBaseMessage {
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  _getType(): string;
  name?: string;
  additional_kwargs?: Record<string, unknown>;
}

/**
 * LangChain AIMessage interface (simplified).
 */
export interface LangChainAIMessage extends LangChainBaseMessage {
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

/**
 * LangChain ChatGeneration interface.
 */
export interface LangChainChatGeneration {
  text: string;
  message: LangChainBaseMessage;
  generationInfo?: Record<string, unknown>;
}

/**
 * LangChain ChatResult interface.
 */
export interface LangChainChatResult {
  generations: LangChainChatGeneration[];
  llmOutput?: Record<string, unknown>;
}

/**
 * LangChain ChatGenerationChunk interface for streaming.
 */
export interface LangChainChatGenerationChunk {
  text: string;
  message: LangChainBaseMessage;
  generationInfo?: Record<string, unknown>;
}

/**
 * LangChain tool interface.
 */
export interface LangChainTool {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
}

/**
 * Configuration options for OrchestraChatModel.
 */
export interface OrchestraChatModelOptions {
  /**
   * Orchestra instance to use for completions.
   */
  orchestra: Orchestra;

  /**
   * Default model to use (e.g., 'claude-3-haiku', 'gpt-4o-mini').
   */
  model: string;

  /**
   * Fallback models for automatic failover.
   */
  fallback?: string[];

  /**
   * Tags for cost allocation and filtering.
   */
  tags?: string[];

  /**
   * Additional metadata to include with requests.
   */
  metadata?: Record<string, unknown>;

  /**
   * Temperature for generation (0-1).
   */
  temperature?: number;

  /**
   * Maximum tokens to generate.
   */
  maxTokens?: number;

  /**
   * Request timeout in milliseconds.
   */
  timeout?: number;

  /**
   * Whether to use caching.
   */
  cache?: boolean;
}

/**
 * Extracts string content from LangChain message content.
 */
function extractContent(
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
): string {
  if (typeof content === 'string') {
    return content;
  }

  // Handle array of content blocks (multimodal messages)
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
}

/**
 * Converts a LangChain message type to Orchestra message role.
 */
function toOrchestraRole(type: string): MessageRole {
  switch (type) {
    case 'system':
      return 'system';
    case 'ai':
    case 'assistant':
      return 'assistant';
    case 'tool':
      return 'tool';
    case 'human':
    case 'user':
    default:
      return 'user';
  }
}

/**
 * Converts LangChain messages to Orchestra messages.
 */
export function toOrchestraMessages(messages: LangChainBaseMessage[]): Message[] {
  return messages.map((message) => {
    const role = toOrchestraRole(message._getType());
    const content = extractContent(message.content);

    const orchestraMessage: Message = { role, content };

    if (message.name) {
      orchestraMessage.name = message.name;
    }

    // Handle tool call ID for tool messages
    if (role === 'tool' && message.additional_kwargs?.tool_call_id) {
      orchestraMessage.toolCallId = message.additional_kwargs.tool_call_id as string;
    }

    return orchestraMessage;
  });
}

/**
 * Converts LangChain tools to Orchestra tool definitions.
 */
export function toOrchestraTools(tools: LangChainTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.schema ?? { type: 'object', properties: {} },
    },
  }));
}

/**
 * Creates a LangChain-compatible AIMessage from Orchestra response.
 */
function createAIMessage(content: string, meta?: Partial<CompletionMeta>): LangChainAIMessage {
  return {
    content,
    _getType: () => 'ai',
    additional_kwargs: meta
      ? {
          orchestra_meta: {
            traceId: meta.traceId,
            provider: meta.provider,
            model: meta.model,
            tokens: meta.tokens,
            cost: meta.cost,
            latencyMs: meta.latencyMs,
            cached: meta.cached,
          },
        }
      : {},
  };
}

/**
 * Creates a LangChain ChatGeneration from Orchestra response.
 */
function createChatGeneration(
  content: string,
  meta?: Partial<CompletionMeta>
): LangChainChatGeneration {
  return {
    text: content,
    message: createAIMessage(content, meta),
    generationInfo: meta
      ? {
          traceId: meta.traceId,
          provider: meta.provider,
          model: meta.model,
          tokens: meta.tokens,
          cost: meta.cost,
          latencyMs: meta.latencyMs,
          cached: meta.cached,
        }
      : undefined,
  };
}

/**
 * OrchestraChatModel - A LangChain-compatible chat model wrapper for Orchestra.
 *
 * This class can be used in LangChain Expression Language (LCEL) pipelines,
 * providing Orchestra's multi-model orchestration, failover, and observability
 * within LangChain workflows.
 *
 * Note: This is a standalone implementation that doesn't extend BaseChatModel
 * to avoid requiring @langchain/core as a dependency. It implements the
 * essential interface for use in LCEL pipelines.
 */
export class OrchestraChatModel {
  private orchestra: Orchestra;
  private model: string;
  private fallback?: string[];
  private tags?: string[];
  private metadata?: Record<string, unknown>;
  private temperature?: number;
  private maxTokens?: number;
  private timeout?: number;
  private cacheEnabled?: boolean;

  constructor(options: OrchestraChatModelOptions) {
    this.orchestra = options.orchestra;
    this.model = options.model;
    this.fallback = options.fallback;
    this.tags = options.tags;
    this.metadata = options.metadata;
    this.temperature = options.temperature;
    this.maxTokens = options.maxTokens;
    this.timeout = options.timeout;
    this.cacheEnabled = options.cache;
  }

  /**
   * Returns the model type identifier.
   */
  _llmType(): string {
    return 'orchestra';
  }

  /**
   * Invokes the model with the given messages.
   * Compatible with LangChain's Runnable interface.
   */
  async invoke(
    input: LangChainBaseMessage[] | string,
    _options?: Record<string, unknown>
  ): Promise<LangChainAIMessage> {
    const messages = typeof input === 'string'
      ? [{ content: input, _getType: () => 'human' } as LangChainBaseMessage]
      : input;

    const result = await this._generate(messages);
    return result.generations[0].message as LangChainAIMessage;
  }

  /**
   * Generates a response for the given messages.
   * This is the core generation method.
   */
  async _generate(
    messages: LangChainBaseMessage[],
    options?: {
      tools?: LangChainTool[];
      stop?: string[];
    }
  ): Promise<LangChainChatResult> {
    const orchestraMessages = toOrchestraMessages(messages);

    const request: CompletionRequest = {
      model: this.model,
      messages: orchestraMessages,
      fallback: this.fallback,
      tags: this.tags,
      metadata: this.metadata,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      timeout: this.timeout,
      cache: this.cacheEnabled,
    };

    if (options?.tools) {
      request.tools = toOrchestraTools(options.tools);
    }

    if (options?.stop) {
      request.stop = options.stop;
    }

    const response = await this.orchestra.complete(request);

    const generation = createChatGeneration(response.content, response.meta);

    // Add tool calls to the message if present
    if (response.toolCalls && response.toolCalls.length > 0) {
      (generation.message as LangChainAIMessage).tool_calls = response.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments),
      }));
    }

    return {
      generations: [generation],
      llmOutput: {
        traceId: response.meta.traceId,
        provider: response.meta.provider,
        model: response.meta.model,
        tokenUsage: {
          promptTokens: response.meta.tokens.inputTokens,
          completionTokens: response.meta.tokens.outputTokens,
          totalTokens: response.meta.tokens.totalTokens,
        },
        cost: response.meta.cost,
        latencyMs: response.meta.latencyMs,
        cached: response.meta.cached,
        failoverAttempts: response.meta.failoverAttempts,
      },
    };
  }

  /**
   * Streams response chunks for the given messages.
   * Returns an async generator compatible with LangChain streaming.
   */
  async *_streamResponseChunks(
    messages: LangChainBaseMessage[],
    options?: {
      tools?: LangChainTool[];
      stop?: string[];
    }
  ): AsyncGenerator<LangChainChatGenerationChunk> {
    const orchestraMessages = toOrchestraMessages(messages);

    const request: CompletionRequest = {
      model: this.model,
      messages: orchestraMessages,
      fallback: this.fallback,
      tags: this.tags,
      metadata: this.metadata,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      timeout: this.timeout,
      cache: this.cacheEnabled,
    };

    if (options?.tools) {
      request.tools = toOrchestraTools(options.tools);
    }

    if (options?.stop) {
      request.stop = options.stop;
    }

    const stream = this.orchestra.stream(request);

    for await (const chunk of stream) {
      if (chunk.content) {
        yield {
          text: chunk.content,
          message: createAIMessage(chunk.content, chunk.meta),
          generationInfo: chunk.meta
            ? {
                traceId: chunk.meta.traceId,
                finishReason: chunk.finishReason,
              }
            : undefined,
        };
      }
    }
  }

  /**
   * Streams the response, returning an async iterable of content strings.
   * Convenience method for simple streaming use cases.
   */
  async *stream(
    input: LangChainBaseMessage[] | string,
    _options?: Record<string, unknown>
  ): AsyncGenerator<string> {
    const messages = typeof input === 'string'
      ? [{ content: input, _getType: () => 'human' } as LangChainBaseMessage]
      : input;

    for await (const chunk of this._streamResponseChunks(messages)) {
      yield chunk.text;
    }
  }

  /**
   * Binds tools to this model, returning a new instance with tools configured.
   */
  bind(options: { tools?: LangChainTool[]; stop?: string[] }): BoundOrchestraChatModel {
    return new BoundOrchestraChatModel(this, options);
  }

  /**
   * Creates a copy of this model with updated options.
   */
  withConfig(options: Partial<OrchestraChatModelOptions>): OrchestraChatModel {
    return new OrchestraChatModel({
      orchestra: options.orchestra ?? this.orchestra,
      model: options.model ?? this.model,
      fallback: options.fallback ?? this.fallback,
      tags: options.tags ?? this.tags,
      metadata: options.metadata ?? this.metadata,
      temperature: options.temperature ?? this.temperature,
      maxTokens: options.maxTokens ?? this.maxTokens,
      timeout: options.timeout ?? this.timeout,
      cache: options.cache ?? this.cacheEnabled,
    });
  }

  /**
   * Pipe this model to another runnable.
   * Enables LCEL-style chaining: model.pipe(outputParser)
   */
  pipe<T>(
    next: { invoke: (input: LangChainAIMessage) => Promise<T> }
  ): { invoke: (input: LangChainBaseMessage[] | string) => Promise<T> } {
    return {
      invoke: async (input: LangChainBaseMessage[] | string) => {
        const result = await this.invoke(input);
        return next.invoke(result);
      },
    };
  }
}

/**
 * A model instance with bound tools/options.
 */
class BoundOrchestraChatModel {
  constructor(
    private model: OrchestraChatModel,
    private boundOptions: { tools?: LangChainTool[]; stop?: string[] }
  ) {}

  _llmType(): string {
    return this.model._llmType();
  }

  async invoke(
    input: LangChainBaseMessage[] | string,
    _options?: Record<string, unknown>
  ): Promise<LangChainAIMessage> {
    const messages = typeof input === 'string'
      ? [{ content: input, _getType: () => 'human' } as LangChainBaseMessage]
      : input;

    const result = await this.model._generate(messages, this.boundOptions);
    return result.generations[0].message as LangChainAIMessage;
  }

  async _generate(
    messages: LangChainBaseMessage[]
  ): Promise<LangChainChatResult> {
    return this.model._generate(messages, this.boundOptions);
  }

  async *stream(
    input: LangChainBaseMessage[] | string
  ): AsyncGenerator<string> {
    const messages = typeof input === 'string'
      ? [{ content: input, _getType: () => 'human' } as LangChainBaseMessage]
      : input;

    for await (const chunk of this.model._streamResponseChunks(messages, this.boundOptions)) {
      yield chunk.text;
    }
  }

  pipe<T>(
    next: { invoke: (input: LangChainAIMessage) => Promise<T> }
  ): { invoke: (input: LangChainBaseMessage[] | string) => Promise<T> } {
    return {
      invoke: async (input: LangChainBaseMessage[] | string) => {
        const result = await this.invoke(input);
        return next.invoke(result);
      },
    };
  }
}
