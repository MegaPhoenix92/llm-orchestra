/**
 * Routing Engine
 * Handles model selection, failover, and load balancing
 */

import type {
  ProviderAdapter,
  ProviderName,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  RetryConfig,
  RateLimitError,
  TimeoutError,
} from '../types/index.js';
import { AllProvidersFailedError } from '../types/index.js';
import { getProviderForModel } from '../providers/index.js';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR', '503', '529'],
};

export interface RouterConfig {
  providers: Map<ProviderName, ProviderAdapter>;
  retry?: Partial<RetryConfig>;
  defaultTimeout?: number;
}

export interface RouteResult {
  response: CompletionResponse;
  attempts: Array<{
    provider: ProviderName;
    model: string;
    success: boolean;
    error?: Error;
    latencyMs: number;
  }>;
}

/**
 * Router handles model selection and failover between providers
 */
export class Router {
  private providers: Map<ProviderName, ProviderAdapter>;
  private retryConfig: RetryConfig;
  private defaultTimeout: number;

  constructor(config: RouterConfig) {
    this.providers = config.providers;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
    this.defaultTimeout = config.defaultTimeout ?? 60000;
  }

  /**
   * Route a completion request with automatic failover
   */
  async route(request: CompletionRequest): Promise<RouteResult> {
    const models = this.buildModelChain(request);
    const attempts: RouteResult['attempts'] = [];

    for (const { model, provider } of models) {
      const adapter = this.providers.get(provider);
      if (!adapter) {
        attempts.push({
          provider,
          model,
          success: false,
          error: new Error(`Provider ${provider} not configured`),
          latencyMs: 0,
        });
        continue;
      }

      // Try with retries
      for (let retry = 0; retry <= this.retryConfig.maxRetries; retry++) {
        const startTime = Date.now();
        try {
          const response = await this.executeWithTimeout(
            adapter.complete({ ...request, model }),
            request.timeout ?? this.defaultTimeout
          );

          // Update meta with failover info
          response.meta.failoverAttempts = attempts.length;

          attempts.push({
            provider,
            model,
            success: true,
            latencyMs: Date.now() - startTime,
          });

          return { response, attempts };
        } catch (error) {
          const latencyMs = Date.now() - startTime;
          const isRetryable = this.isRetryable(error as Error);

          attempts.push({
            provider,
            model,
            success: false,
            error: error as Error,
            latencyMs,
          });

          if (!isRetryable || retry === this.retryConfig.maxRetries) {
            // Move to next model in chain
            break;
          }

          // Wait before retry with exponential backoff
          const delay = Math.min(
            this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, retry),
            this.retryConfig.maxDelayMs
          );
          await this.sleep(delay);
        }
      }
    }

    const failureAttempts = attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: attempt.error ?? new Error('Unknown error'),
      latencyMs: attempt.latencyMs,
      success: attempt.success,
    }));

    throw new AllProvidersFailedError(failureAttempts);
  }

  /**
   * Route a streaming request (failover only on initial connection)
   */
  async *routeStream(request: CompletionRequest): CompletionStream {
    const models = this.buildModelChain(request);
    const attempts: RouteResult['attempts'] = [];

    for (const { model, provider } of models) {
      const adapter = this.providers.get(provider);
      if (!adapter) continue;

      const startTime = Date.now();
      try {
        // For streaming, we can't retry mid-stream, so just yield the stream
        const stream = adapter.stream({ ...request, model });

        // Yield all chunks from the stream
        for await (const chunk of stream) {
          // Augment final chunk with failover info
          if (chunk.meta) {
            chunk.meta.failoverAttempts = attempts.length;
          }
          yield chunk;
        }

        // Success - stream completed
        return;
      } catch (error) {
        attempts.push({
          provider,
          model,
          success: false,
          error: error as Error,
          latencyMs: Date.now() - startTime,
        });
        // Try next provider
        continue;
      }
    }

    const failureAttempts = attempts.map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      error: attempt.error ?? new Error('Unknown error'),
      latencyMs: attempt.latencyMs,
      success: attempt.success,
    }));

    throw new AllProvidersFailedError(failureAttempts);
  }

  /**
   * Build the model chain for failover
   */
  private buildModelChain(
    request: CompletionRequest
  ): Array<{ model: string; provider: ProviderName }> {
    const chain: Array<{ model: string; provider: ProviderName }> = [];

    // Primary model
    const primaryProvider = getProviderForModel(request.model);
    if (primaryProvider) {
      chain.push({ model: request.model, provider: primaryProvider });
    }

    // Fallback models
    if (request.fallback) {
      for (const model of request.fallback) {
        const provider = getProviderForModel(model);
        if (provider) {
          chain.push({ model, provider });
        }
      }
    }

    return chain;
  }

  /**
   * Execute a promise with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject({
          name: 'TimeoutError',
          message: `Request timed out after ${timeoutMs}ms`,
          code: 'TIMEOUT',
        } as TimeoutError);
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Check if an error is retryable
   */
  private isRetryable(error: Error): boolean {
    const rawCode = (error as any).code;
    const rawStatus = (error as any).status ?? (error as any).statusCode;
    const errorCode = typeof rawCode === 'string' ? rawCode : rawCode !== undefined ? String(rawCode) : '';
    const errorStatus = rawStatus !== undefined ? String(rawStatus) : '';
    const message = typeof (error as any).message === 'string' ? (error as any).message : '';

    return this.retryConfig.retryableErrors.some(
      (code) =>
        errorCode.includes(code) ||
        errorStatus.includes(code) ||
        message.includes(code)
    );
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is available
   */
  async isProviderAvailable(provider: ProviderName): Promise<boolean> {
    const adapter = this.providers.get(provider);
    if (!adapter) return false;
    return adapter.isAvailable();
  }
}
