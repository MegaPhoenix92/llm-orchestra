/**
 * Core type definitions for LLM Orchestra
 */

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'mistral';

export interface ProviderCredentials {
  apiKey: string;
  baseUrl?: string;
  organizationId?: string;
}

export interface ProvidersConfig {
  anthropic?: ProviderCredentials;
  openai?: ProviderCredentials;
  google?: ProviderCredentials;
  mistral?: ProviderCredentials;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AssistantMessage extends Message {
  role: 'assistant';
  toolCalls?: ToolCall[];
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CompletionRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  stream?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };

  // Orchestra-specific
  fallback?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  cache?: boolean;
  timeout?: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CompletionMeta {
  latencyMs: number;
  tokens: TokenUsage;
  cost: number;
  traceId: string;
  spanId: string;
  model: string;
  provider: ProviderName;
  cached: boolean;
  failoverAttempts: number;
}

export interface CompletionResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  meta: CompletionMeta;
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface StreamChunk {
  content?: string;
  toolCalls?: Partial<ToolCall>[];
  finishReason?: string;
  meta?: Partial<CompletionMeta>;
}

export type CompletionStream = AsyncIterable<StreamChunk>;

// ============================================================================
// Configuration Types
// ============================================================================

export interface TracingConfig {
  enabled: boolean;
  exportEndpoint?: string;
  sampleRate?: number;
  includePrompts?: boolean;
  includeResponses?: boolean;
}

export interface MetricsConfig {
  enabled: boolean;
  exportEndpoint?: string;
  collectInterval?: number;
}

export interface CostTrackingConfig {
  enabled: boolean;
  alertThreshold?: number;
  budgetLimit?: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttlSeconds?: number;
  maxSize?: number;
  similarityThreshold?: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface ObservabilityConfig {
  tracing?: TracingConfig;
  metrics?: MetricsConfig;
  costTracking?: CostTrackingConfig;
}

export interface OrchestraConfig {
  providers: ProvidersConfig;
  observability?: ObservabilityConfig;
  cache?: CacheConfig;
  retry?: RetryConfig;
  defaultModel?: string;
  defaultTimeout?: number;
}

// ============================================================================
// Provider Adapter Interface
// ============================================================================

export interface ProviderAdapter {
  name: ProviderName;

  complete(request: CompletionRequest): Promise<CompletionResponse>;

  stream(request: CompletionRequest): CompletionStream;

  listModels(): Promise<string[]>;

  isAvailable(): Promise<boolean>;

  getModelCost(model: string): { inputPer1k: number; outputPer1k: number };
}

// ============================================================================
// Error Types
// ============================================================================

export class OrchestraError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: ProviderName,
    public model?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'OrchestraError';
  }
}

export class RateLimitError extends OrchestraError {
  constructor(
    provider: ProviderName,
    public retryAfterMs?: number
  ) {
    super(`Rate limit exceeded for ${provider}`, 'RATE_LIMIT', provider);
    this.name = 'RateLimitError';
  }
}

export class ProviderError extends OrchestraError {
  constructor(
    message: string,
    provider: ProviderName,
    public statusCode?: number
  ) {
    super(message, 'PROVIDER_ERROR', provider);
    this.name = 'ProviderError';
  }
}

export class TimeoutError extends OrchestraError {
  constructor(provider: ProviderName, timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, 'TIMEOUT', provider);
    this.name = 'TimeoutError';
  }
}

export class AllProvidersFailedError extends OrchestraError {
  constructor(
    public attempts: Array<{ provider: ProviderName; model: string; error: Error }>
  ) {
    super(
      `All providers failed: ${attempts.map(a => `${a.provider}/${a.model}`).join(', ')}`,
      'ALL_PROVIDERS_FAILED'
    );
    this.name = 'AllProvidersFailedError';
  }
}
