/**
 * LLM Orchestra
 * Unified Observability & Orchestration SDK for Multi-Model AI Applications
 *
 * @packageDocumentation
 */

// Main Orchestra class
export { Orchestra, default } from './orchestra.js';
export type { OrchestraStats } from './orchestra.js';

// Type exports
export type {
  // Provider types
  ProviderName,
  ProviderCredentials,
  ProvidersConfig,
  ProviderAdapter,

  // Message types
  Message,
  MessageRole,
  ToolCall,
  AssistantMessage,
  ToolDefinition,

  // Request/Response types
  CompletionRequest,
  CompletionResponse,
  CompletionMeta,
  TokenUsage,

  // Streaming types
  StreamChunk,
  CompletionStream,

  // Configuration types
  OrchestraConfig,
  TracingConfig,
  MetricsConfig,
  CostTrackingConfig,
  CacheConfig,
  RetryConfig,
  ObservabilityConfig,

  // Error types
  OrchestraError,
  RateLimitError,
  ProviderError,
  TimeoutError,
  AllProvidersFailedError,
} from './types/index.js';

// Provider exports
export {
  BaseProvider,
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  createProviders,
  getProviderForModel,
  getModelsForProvider,
} from './providers/index.js';

// Router exports
export { Router } from './routing/index.js';
export type { RouterConfig, RouteResult } from './routing/index.js';

// Tracing exports
export { Tracer, Span, createNoopTracer } from './tracing/index.js';
export type { SpanContext, SpanEvent, SpanData } from './tracing/index.js';

/**
 * Create an Orchestra instance with minimal configuration
 */
export function createOrchestra(config: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  enableTracing?: boolean;
  enableCostTracking?: boolean;
}): InstanceType<typeof Orchestra> {
  const { Orchestra: OrchestraClass } = require('./orchestra.js');

  return new OrchestraClass({
    providers: {
      ...(config.anthropicApiKey && {
        anthropic: { apiKey: config.anthropicApiKey },
      }),
      ...(config.openaiApiKey && {
        openai: { apiKey: config.openaiApiKey },
      }),
      ...(config.googleApiKey && {
        google: { apiKey: config.googleApiKey },
      }),
    },
    observability: {
      tracing: config.enableTracing ? { enabled: true } : undefined,
      costTracking: config.enableCostTracking ? { enabled: true } : undefined,
    },
  });
}
