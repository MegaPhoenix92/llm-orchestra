/**
 * Cohere Provider Adapter
 * Handles Cohere chat models via the Cohere API
 */

import { BaseProvider } from './base.js';
import type {
  ProviderCredentials,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  Message,
  TokenUsage,
} from '../types/index.js';

const DEFAULT_BASE_URL = 'https://api.cohere.ai/v1';

interface CohereChatResponse {
  text?: string;
  message?: string;
  finish_reason?: string;
  token_count?: {
    prompt_tokens?: number;
    response_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
  meta?: {
    billed_units?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}

const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'command': { inputPer1k: 0, outputPer1k: 0 },
  'command-light': { inputPer1k: 0, outputPer1k: 0 },
  'command-r': { inputPer1k: 0, outputPer1k: 0 },
  'command-r-plus': { inputPer1k: 0, outputPer1k: 0 },
};

export class CohereProvider extends BaseProvider {
  name = 'cohere' as const;
  private baseUrl: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials);
    this.baseUrl = credentials.baseUrl ?? DEFAULT_BASE_URL;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const spanId = this.generateSpanId();

    const { message, chatHistory, systemPrompt } = this.convertMessages(request.messages);

    const response = await this.fetchJson<CohereChatResponse>('/chat', {
      model: request.model,
      message,
      ...(systemPrompt && { preamble: systemPrompt }),
      ...(chatHistory.length > 0 && { chat_history: chatHistory }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.topP !== undefined && { p: request.topP }),
      ...(request.maxTokens && { max_tokens: request.maxTokens }),
      ...(request.stop && { stop_sequences: request.stop }),
    });

    const content = response.text ?? response.message ?? '';
    const usage = this.extractUsage(response);

    return {
      content,
      finishReason: this.mapFinishReason(response.finish_reason),
      meta: {
        latencyMs: Date.now() - startTime,
        tokens: usage,
        cost: this.calculateCost(request.model, usage),
        traceId: '', // Set by Orchestra
        spanId,
        model: request.model,
        provider: 'cohere',
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    const response = await this.complete(request);

    if (response.content) {
      yield { content: response.content };
    }

    yield {
      finishReason: response.finishReason,
      meta: response.meta,
    };
  }

  async listModels(): Promise<string[]> {
    const response = await this.fetchJson<{ models?: Array<{ name?: string; id?: string }> }>(
      '/models',
      undefined,
      'GET'
    );
    const models = response.models ?? [];
    return models
      .map((model) => model.name ?? model.id)
      .filter((value): value is string => Boolean(value));
  }

  getModelCost(model: string): { inputPer1k: number; outputPer1k: number } {
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (model.includes(key) || key.includes(model)) {
        return pricing;
      }
    }
    return { inputPer1k: 0, outputPer1k: 0 };
  }

  private async fetchJson<T>(
    path: string,
    body?: Record<string, unknown>,
    method = 'POST'
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cohere API error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.credentials.apiKey}`,
    };
  }

  private convertMessages(messages: Message[]): {
    message: string;
    chatHistory: Array<{ role: 'USER' | 'CHATBOT'; message: string }>;
    systemPrompt?: string;
  } {
    const systemPrompt = messages.find((msg) => msg.role === 'system')?.content;
    const convo = messages.filter((msg) => msg.role !== 'system' && msg.role !== 'tool');
    const chatHistory: Array<{ role: 'USER' | 'CHATBOT'; message: string }> = [];

    let message = '';
    for (let i = 0; i < convo.length; i++) {
      const item = convo[i];
      const isLast = i === convo.length - 1;
      if (isLast && item.role === 'user') {
        message = item.content;
        continue;
      }
      if (item.role === 'assistant' || item.role === 'user') {
        chatHistory.push({
          role: item.role === 'assistant' ? 'CHATBOT' : 'USER',
          message: item.content,
        });
      }
    }

    if (!message) {
      message = convo[convo.length - 1]?.content ?? '';
    }

    return { message, chatHistory, systemPrompt };
  }

  private extractUsage(response: CohereChatResponse): TokenUsage {
    const promptTokens = response.token_count?.prompt_tokens ??
      response.token_count?.input_tokens ??
      response.meta?.billed_units?.input_tokens ??
      0;
    const completionTokens = response.token_count?.response_tokens ??
      response.token_count?.output_tokens ??
      response.meta?.billed_units?.output_tokens ??
      0;
    const totalTokens = response.token_count?.total_tokens ?? promptTokens + completionTokens;

    return {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      totalTokens,
    };
  }

  private mapFinishReason(
    reason?: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'COMPLETE':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'CONTENT_FILTER':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
