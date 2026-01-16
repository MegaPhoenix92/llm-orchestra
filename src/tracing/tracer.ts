/**
 * Distributed Tracing System
 * Provides OpenTelemetry-compatible tracing for LLM operations
 */

import type { TracingConfig, ProviderName, TokenUsage } from '../types/index.js';

export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  context: SpanContext;
  name: string;
  kind: 'client' | 'server' | 'internal';
  startTime: number;
  endTime?: number;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  links?: SpanContext[];
}

/**
 * Span represents a single operation within a trace
 */
export class Span {
  private data: SpanData;
  private children: Span[] = [];
  private tracer: Tracer;

  constructor(
    tracer: Tracer,
    name: string,
    parentContext?: SpanContext,
    attributes?: Record<string, unknown>,
    traceIdOverride?: string
  ) {
    this.tracer = tracer;
    this.data = {
      context: {
        // Prioritize explicit traceIdOverride to support concurrent scenarios
        traceId: traceIdOverride ?? parentContext?.traceId ?? this.generateId(),
        spanId: this.generateId(),
        parentSpanId: parentContext?.spanId,
      },
      name,
      kind: 'client',
      startTime: Date.now(),
      status: 'unset',
      attributes: attributes ?? {},
      events: [],
    };
  }

  /**
   * Get the span context for creating child spans
   */
  getContext(): SpanContext {
    return { ...this.data.context };
  }

  /**
   * Set an attribute on the span
   */
  setAttribute(key: string, value: unknown): this {
    this.data.attributes[key] = value;
    return this;
  }

  /**
   * Set multiple attributes
   */
  setAttributes(attributes: Record<string, unknown>): this {
    Object.assign(this.data.attributes, attributes);
    return this;
  }

  /**
   * Add an event to the span
   */
  addEvent(name: string, attributes?: Record<string, unknown>): this {
    this.data.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
    return this;
  }

  /**
   * Set the span status
   */
  setStatus(status: 'ok' | 'error', message?: string): this {
    this.data.status = status;
    if (message) {
      this.data.attributes['error.message'] = message;
    }
    return this;
  }

  /**
   * Record an exception
   */
  recordException(error: Error): this {
    this.setStatus('error', error.message);
    this.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack,
    });
    return this;
  }

  /**
   * Create a child span
   */
  startChild(name: string, attributes?: Record<string, unknown>): Span {
    const child = new Span(this.tracer, name, this.data.context, attributes);
    this.children.push(child);
    return child;
  }

  /**
   * End the span
   */
  end(): void {
    this.data.endTime = Date.now();
    if (this.data.status === 'unset') {
      this.data.status = 'ok';
    }
    this.tracer.recordSpan(this.data);
    this.tracer.endSpan(this);
  }

  /**
   * Get span duration in milliseconds
   */
  getDuration(): number {
    const endTime = this.data.endTime ?? Date.now();
    return endTime - this.data.startTime;
  }

  /**
   * Get the full span data
   */
  getData(): SpanData {
    return { ...this.data };
  }

  private generateId(): string {
    return `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Tracer manages span creation and export
 */
export class Tracer {
  private config: TracingConfig;
  private spans: SpanData[] = [];
  private spanStack: Span[] = [];
  private exportQueue: SpanData[] = [];
  private exportTimer?: ReturnType<typeof setInterval>;

  constructor(config: TracingConfig) {
    this.config = config;

    if (config.enabled && config.exportEndpoint) {
      // Start periodic export
      this.exportTimer = setInterval(() => this.flush(), 5000);
    }
  }

  /**
   * Start a new trace/span
   *
   * Note: When traceId is explicitly provided, currentSpan is bypassed to prevent
   * trace cross-linking in concurrent scenarios. Use parentContext explicitly if
   * you need to link to an existing span while overriding the trace ID.
   */
  startSpan(
    name: string,
    attributes?: Record<string, unknown>,
    options?: { parentContext?: SpanContext; traceId?: string }
  ): Span {
    // Bypass currentSpan when traceId is explicitly provided to prevent trace cross-linking
    const parentContext = options?.parentContext ??
      (options?.traceId ? undefined : this.currentSpan?.getContext());
    const span = new Span(this, name, parentContext, attributes, options?.traceId);
    this.spanStack.push(span);
    return span;
  }

  /**
   * Execute a function within a span
   */
  async trace<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes?: Record<string, unknown>,
    options?: { parentContext?: SpanContext; traceId?: string }
  ): Promise<T> {
    const span = this.startSpan(name, attributes, options);
    try {
      const result = await fn(span);
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Record LLM-specific attributes
   */
  recordLLMCall(
    span: Span,
    data: {
      provider: ProviderName;
      model: string;
      tokens?: TokenUsage;
      cost?: number;
      latencyMs?: number;
      cached?: boolean;
    }
  ): void {
    span.setAttributes({
      'llm.provider': data.provider,
      'llm.model': data.model,
      'llm.tokens.input': data.tokens?.inputTokens,
      'llm.tokens.output': data.tokens?.outputTokens,
      'llm.tokens.total': data.tokens?.totalTokens,
      'llm.cost': data.cost,
      'llm.latency_ms': data.latencyMs,
      'llm.cached': data.cached,
    });

    // Optionally record prompts/responses based on config
    if (this.config.includePrompts) {
      // Would be set by caller with actual prompt content
    }
  }

  /**
   * Record a completed span
   */
  recordSpan(data: SpanData): void {
    if (!this.shouldSample()) return;

    this.spans.push(data);
    this.exportQueue.push(data);

    // Auto-flush if queue is large
    if (this.exportQueue.length >= 100) {
      this.flush();
    }
  }

  endSpan(span: Span): void {
    const index = this.spanStack.lastIndexOf(span);
    if (index === -1) return;
    this.spanStack.splice(index, 1);
  }

  /**
   * Flush pending spans to export endpoint
   */
  async flush(): Promise<void> {
    if (!this.config.exportEndpoint || this.exportQueue.length === 0) return;

    const toExport = [...this.exportQueue];
    this.exportQueue = [];

    try {
      await fetch(this.config.exportEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spans: toExport }),
      });
    } catch (error) {
      // Re-queue on failure
      this.exportQueue.unshift(...toExport);
      console.error('Failed to export spans:', error);
    }
  }

  /**
   * Get all recorded spans
   */
  getSpans(): SpanData[] {
    return [...this.spans];
  }

  /**
   * Clear recorded spans
   */
  clearSpans(): void {
    this.spans = [];
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId(): string {
    return `trace_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Shutdown the tracer
   */
  async shutdown(): Promise<void> {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }
    await this.flush();
  }

  private shouldSample(): boolean {
    if (!this.config.enabled) return false;
    if (this.config.sampleRate === undefined) return true;
    return Math.random() < this.config.sampleRate;
  }

  private get currentSpan(): Span | undefined {
    return this.spanStack[this.spanStack.length - 1];
  }
}

/**
 * Create a no-op tracer for when tracing is disabled
 */
export function createNoopTracer(): Tracer {
  return new Tracer({ enabled: false });
}
