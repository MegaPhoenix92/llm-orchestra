from __future__ import annotations

from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Dict,
    List,
    Literal,
    Optional,
    TypedDict,
)

ProviderName = Literal["anthropic", "openai", "google", "mistral", "cohere", "azure-openai"]
MessageRole = Literal["system", "user", "assistant", "tool"]


class ProviderCredentials(TypedDict, total=False):
    apiKey: str
    baseUrl: str
    organizationId: str


class AzureOpenAICredentials(TypedDict, total=False):
    apiKey: str
    baseUrl: str
    apiVersion: str


class ProvidersConfig(TypedDict, total=False):
    anthropic: ProviderCredentials
    openai: ProviderCredentials
    google: ProviderCredentials
    mistral: ProviderCredentials
    cohere: ProviderCredentials
    azure_openai: AzureOpenAICredentials


class Message(TypedDict, total=False):
    role: MessageRole
    content: str
    name: str
    toolCallId: str


class ToolCallFunction(TypedDict, total=False):
    name: str
    arguments: str


class ToolCall(TypedDict, total=False):
    id: str
    type: Literal["function"]
    function: ToolCallFunction


class ToolDefinitionFunction(TypedDict, total=False):
    name: str
    description: str
    parameters: Dict[str, Any]


class ToolDefinition(TypedDict, total=False):
    type: Literal["function"]
    function: ToolDefinitionFunction


class CompletionRequest(TypedDict, total=False):
    model: str
    messages: List[Message]
    temperature: float
    maxTokens: int
    topP: float
    stop: List[str]
    stream: bool
    tools: List[ToolDefinition]
    toolChoice: Any
    fallback: List[str]
    tags: List[str]
    metadata: Dict[str, Any]
    cache: bool
    timeout: int


class CacheEmbeddingInput(TypedDict, total=False):
    text: str
    request: CompletionRequest


CacheEmbeddingFunction = Callable[[CacheEmbeddingInput], Awaitable[List[float]]]
CacheKeyFunction = Callable[[CompletionRequest], str]


class TokenUsage(TypedDict, total=False):
    inputTokens: int
    outputTokens: int
    totalTokens: int


class CompletionMeta(TypedDict, total=False):
    latencyMs: float
    tokens: TokenUsage
    cost: float
    traceId: str
    spanId: str
    model: str
    provider: ProviderName
    cached: bool
    failoverAttempts: int


class CompletionResponse(TypedDict, total=False):
    content: str
    toolCalls: List[ToolCall]
    finishReason: Literal["stop", "length", "tool_calls", "content_filter"]
    meta: CompletionMeta


class StreamChunk(TypedDict, total=False):
    content: str
    toolCalls: List[ToolCall]
    finishReason: str
    meta: CompletionMeta


CompletionStream = AsyncIterator[StreamChunk]


class OtelTracingConfig(TypedDict, total=False):
    enabled: bool
    endpoint: str
    headers: Dict[str, str]
    timeout: int
    batchSize: int
    flushInterval: int
    serviceName: str
    serviceVersion: str


TracingExportMode = Literal["legacy-only", "otel-only", "both"]


class TracingConfig(TypedDict, total=False):
    enabled: bool
    exportEndpoint: str
    sampleRate: float
    includePrompts: bool
    includeResponses: bool
    otel: OtelTracingConfig
    exportMode: TracingExportMode


class MetricsConfig(TypedDict, total=False):
    enabled: bool
    exportEndpoint: str
    collectInterval: int


class CostTrackingConfig(TypedDict, total=False):
    enabled: bool
    alertThreshold: float
    budgetLimit: float


class CacheConfig(TypedDict, total=False):
    enabled: bool
    ttlSeconds: int
    maxSize: int
    similarityThreshold: float
    embeddingFunction: CacheEmbeddingFunction
    keyFunction: CacheKeyFunction


class RetryConfig(TypedDict, total=False):
    maxRetries: int
    initialDelayMs: int
    maxDelayMs: int
    backoffMultiplier: float
    retryableErrors: List[str]


class ObservabilityConfig(TypedDict, total=False):
    tracing: TracingConfig
    metrics: MetricsConfig
    costTracking: CostTrackingConfig


class OrchestraConfig(TypedDict, total=False):
    providers: ProvidersConfig
    observability: ObservabilityConfig
    cache: CacheConfig
    retry: RetryConfig
    defaultModel: str
    defaultTimeout: int


class ProviderAttempt(TypedDict, total=False):
    provider: ProviderName
    model: str
    error: Exception
    latencyMs: float
    success: bool
