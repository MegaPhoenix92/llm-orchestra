/**
 * Base Provider Adapter
 * Abstract base class for all LLM provider adapters
 */

import type {
  ProviderAdapter,
  ProviderName,
  ProviderCredentials,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  TokenUsage,
} from '../types/index.js';

export abstract class BaseProvider implements ProviderAdapter {
  abstract name: ProviderName;
  protected credentials: ProviderCredentials;

  constructor(credentials: ProviderCredentials) {
    this.credentials = credentials;
  }

  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;

  abstract stream(request: CompletionRequest): CompletionStream;

  abstract listModels(): Promise<string[]>;

  abstract getModelCost(model: string): { inputPer1k: number; outputPer1k: number };

  async isAvailable(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calculate cost based on token usage and model pricing
   */
  protected calculateCost(model: string, usage: TokenUsage): number {
    const pricing = this.getModelCost(model);
    const inputCost = (usage.inputTokens / 1000) * pricing.inputPer1k;
    const outputCost = (usage.outputTokens / 1000) * pricing.outputPer1k;
    return Math.round((inputCost + outputCost) * 1000000) / 1000000; // 6 decimal precision
  }

  /**
   * Generate a unique span ID for tracing
   */
  protected generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
