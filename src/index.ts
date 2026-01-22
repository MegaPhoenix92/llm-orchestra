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
  OtelTracingConfig,
  TracingExportMode,
  MetricsConfig,
  CostTrackingConfig,
  CacheConfig,
  CacheEmbeddingInput,
  CacheEmbeddingFunction,
  CacheKeyFunction,
  RetryConfig,
  ObservabilityConfig,

  // Error types
  OrchestraError,
  RateLimitError,
  ProviderError,
  TimeoutError,
  AllProvidersFailedError,
  ProviderAttempt,
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
export {
  Tracer,
  Span,
  createNoopTracer,
  OtlpHttpExporter,
  toOtelTraceId,
  toOtelSpanId,
  msToNanos,
  ATTRIBUTE_MAPPING,
  mapAttributesToOtel,
} from './tracing/index.js';
export type { SpanContext, SpanEvent, SpanData, OtelExporterConfig } from './tracing/index.js';

// Cache exports
export { SemanticCache } from './cache/index.js';

// Workflow exports
export { WorkflowEngine } from './workflows/index.js';
export type {
  WorkflowDefinition,
  WorkflowContext,
  WorkflowStep,
  WorkflowStepExecution,
  WorkflowStepResult,
  WorkflowRunResult,
  WorkflowEngineOptions,
} from './workflows/index.js';

// Memory exports
export { InMemoryMemoryBackend } from './memory/index.js';
export type { MemoryBackend, InMemoryMemoryConfig } from './memory/index.js';

// Integration exports
export * from './integrations/index.js';

/**
 * Create an Orchestra instance with minimal configuration
 */
export function createOrchestra(config: {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  enableTracing?: boolean;
  enableCostTracking?: boolean;
}): import('./orchestra.js').Orchestra {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
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
