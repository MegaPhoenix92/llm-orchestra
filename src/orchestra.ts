/**
 * LLM Orchestra - Main Entry Point
 * Unified orchestration and observability for multi-model AI applications
 */

import type {
  OrchestraConfig,
  CompletionRequest,
  CompletionResponse,
  CompletionMeta,
  CompletionStream,
  ProviderName,
  ProviderAdapter,
} from './types/index.js';
import { createProviders, getProviderForModel } from './providers/index.js';
import { Router } from './routing/router.js';
import { Tracer, createNoopTracer } from './tracing/tracer.js';

export interface OrchestraStats {
  totalRequests: number;
  totalTokens: { input: number; output: number };
  totalCost: number;
  byProvider: Record<ProviderName, {
    requests: number;
    tokens: { input: number; output: number };
    cost: number;
    avgLatencyMs: number;
  }>;
  byModel: Record<string, {
    requests: number;
    tokens: { input: number; output: number };
    cost: number;
  }>;
}

/**
 * Orchestra - Main class for LLM orchestration and observability
 */
export class Orchestra {
  private config: OrchestraConfig;
  private providers: Map<ProviderName, ProviderAdapter>;
  private router: Router;
  private tracer: Tracer;
  private stats: OrchestraStats;

  constructor(config: OrchestraConfig) {
    this.config = config;
    this.providers = createProviders(config.providers);
    this.router = new Router({
      providers: this.providers,
      retry: config.retry,
      defaultTimeout: config.defaultTimeout,
    });
    this.tracer = config.observability?.tracing?.enabled
      ? new Tracer(config.observability.tracing)
      : createNoopTracer();

    this.stats = this.initStats();
  }

  /**
   * Send a completion request with unified interface
   */
  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const traceId = this.tracer.generateTraceId();

    return this.tracer.trace(
      'orchestra.complete',
      async (span) => {
        span.setAttributes({
          'orchestra.model': request.model,
          'orchestra.fallback': request.fallback?.join(','),
          'orchestra.tags': request.tags?.join(','),
        });

        const result = await this.router.route(request);
        const response = result.response;

        // Set trace ID
        response.meta.traceId = traceId;

        // Record to tracer
        this.tracer.recordLLMCall(span, {
          provider: response.meta.provider,
          model: response.meta.model,
          tokens: response.meta.tokens,
          cost: response.meta.cost,
          latencyMs: response.meta.latencyMs,
          cached: response.meta.cached,
        });

        // Update stats
        this.updateStats(response.meta);

        // Check cost alerts
        if (this.config.observability?.costTracking?.enabled) {
          this.checkCostAlerts(response.meta.cost);
        }

        return response;
      },
      { 'orchestra.trace_id': traceId },
      { traceId }
    );
  }

  /**
   * Send a streaming completion request
   */
  async *stream(request: CompletionRequest): CompletionStream {
    const traceId = this.tracer.generateTraceId();
    const span = this.tracer.startSpan(
      'orchestra.stream',
      {
        'orchestra.model': request.model,
        'orchestra.trace_id': traceId,
      },
      { traceId }
    );
    let finalMeta: Pick<
      CompletionMeta,
      'provider' | 'model' | 'tokens' | 'cost' | 'latencyMs'
    > | undefined;

    try {
      const stream = this.router.routeStream(request);

      for await (const chunk of stream) {
        // Augment final chunk with trace ID
        if (chunk.meta) {
          chunk.meta.traceId = traceId;

          if (chunk.meta.provider && chunk.meta.model) {
            this.tracer.recordLLMCall(span, {
              provider: chunk.meta.provider,
              model: chunk.meta.model,
              tokens: chunk.meta.tokens,
              cost: chunk.meta.cost,
              latencyMs: chunk.meta.latencyMs,
              cached: chunk.meta.cached,
            });
          }

          if (
            chunk.meta.provider &&
            chunk.meta.model &&
            chunk.meta.tokens &&
            chunk.meta.cost !== undefined &&
            chunk.meta.latencyMs !== undefined
          ) {
            finalMeta = {
              provider: chunk.meta.provider,
              model: chunk.meta.model,
              tokens: chunk.meta.tokens,
              cost: chunk.meta.cost,
              latencyMs: chunk.meta.latencyMs,
            };
          }
        }

        yield chunk;
      }

      if (finalMeta) {
        this.updateStats(finalMeta);
        if (this.config.observability?.costTracking?.enabled) {
          this.checkCostAlerts(finalMeta.cost);
        }
      }

      span.setStatus('ok');
    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Get available providers
   */
  getProviders(): ProviderName[] {
    return this.router.getAvailableProviders();
  }

  /**
   * Check if a provider is available
   */
  async isProviderAvailable(provider: ProviderName): Promise<boolean> {
    return this.router.isProviderAvailable(provider);
  }

  /**
   * Get provider for a model
   */
  getProviderForModel(model: string): ProviderName | undefined {
    return getProviderForModel(model);
  }

  /**
   * List available models for a provider
   */
  async listModels(provider: ProviderName): Promise<string[]> {
    const adapter = this.providers.get(provider);
    if (!adapter) return [];
    return adapter.listModels();
  }

  /**
   * Get model pricing
   */
  getModelCost(model: string): { inputPer1k: number; outputPer1k: number } | undefined {
    const provider = getProviderForModel(model);
    if (!provider) return undefined;

    const adapter = this.providers.get(provider);
    if (!adapter) return undefined;

    return adapter.getModelCost(model);
  }

  /**
   * Get usage statistics
   */
  getStats(): OrchestraStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = this.initStats();
  }

  /**
   * Get all recorded traces
   */
  getTraces() {
    return this.tracer.getSpans();
  }

  /**
   * Flush traces to export endpoint
   */
  async flushTraces(): Promise<void> {
    await this.tracer.flush();
  }

  /**
   * Shutdown the orchestra (cleanup resources)
   */
  async shutdown(): Promise<void> {
    await this.tracer.shutdown();
  }

  private initStats(): OrchestraStats {
    return {
      totalRequests: 0,
      totalTokens: { input: 0, output: 0 },
      totalCost: 0,
      byProvider: {} as OrchestraStats['byProvider'],
      byModel: {} as OrchestraStats['byModel'],
    };
  }

  private updateStats(
    meta: Pick<CompletionMeta, 'provider' | 'model' | 'tokens' | 'cost' | 'latencyMs'>
  ): void {
    const { provider, model, tokens, cost, latencyMs } = meta;

    // Global stats
    this.stats.totalRequests++;
    this.stats.totalTokens.input += tokens.inputTokens;
    this.stats.totalTokens.output += tokens.outputTokens;
    this.stats.totalCost += cost;

    // Provider stats
    if (!this.stats.byProvider[provider]) {
      this.stats.byProvider[provider] = {
        requests: 0,
        tokens: { input: 0, output: 0 },
        cost: 0,
        avgLatencyMs: 0,
      };
    }
    const providerStats = this.stats.byProvider[provider];
    const prevAvg = providerStats.avgLatencyMs;
    const prevCount = providerStats.requests;
    providerStats.requests++;
    providerStats.tokens.input += tokens.inputTokens;
    providerStats.tokens.output += tokens.outputTokens;
    providerStats.cost += cost;
    providerStats.avgLatencyMs = (prevAvg * prevCount + latencyMs) / providerStats.requests;

    // Model stats
    if (!this.stats.byModel[model]) {
      this.stats.byModel[model] = {
        requests: 0,
        tokens: { input: 0, output: 0 },
        cost: 0,
      };
    }
    const modelStats = this.stats.byModel[model];
    modelStats.requests++;
    modelStats.tokens.input += tokens.inputTokens;
    modelStats.tokens.output += tokens.outputTokens;
    modelStats.cost += cost;
  }

  private checkCostAlerts(_cost: number): void {
    const config = this.config.observability?.costTracking;
    if (!config) return;

    // Alert threshold check
    if (config.alertThreshold && this.stats.totalCost >= config.alertThreshold) {
      console.warn(
        `[Orchestra] Cost alert: Total cost $${this.stats.totalCost.toFixed(4)} ` +
        `exceeds threshold $${config.alertThreshold}`
      );
    }

    // Budget limit check
    if (config.budgetLimit && this.stats.totalCost >= config.budgetLimit) {
      console.error(
        `[Orchestra] Budget exceeded: Total cost $${this.stats.totalCost.toFixed(4)} ` +
        `exceeds limit $${config.budgetLimit}`
      );
    }
  }
}

export default Orchestra;
