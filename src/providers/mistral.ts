/**
 * Mistral Provider Adapter
 * Handles Mistral models via the Mistral API (OpenAI-compatible)
 */

import { BaseProvider } from './base.js';
import type {
  ProviderCredentials,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  Message,
  TokenUsage,
  ToolDefinition,
  ToolCall,
} from '../types/index.js';

const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';

// Pricing varies by model; defaults are zero to avoid misleading costs.
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'mistral-large': { inputPer1k: 0, outputPer1k: 0 },
  'mistral-medium': { inputPer1k: 0, outputPer1k: 0 },
  'mistral-small': { inputPer1k: 0, outputPer1k: 0 },
  'mistral-large-latest': { inputPer1k: 0, outputPer1k: 0 },
  'mistral-small-latest': { inputPer1k: 0, outputPer1k: 0 },
};

interface MistralChatCompletion {
  choices: Array<{
    message?: { content?: string | null; tool_calls?: ToolCall[] };
    finish_reason?: string | null;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class MistralProvider extends BaseProvider {
  name = 'mistral' as const;
  private baseUrl: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials);
    this.baseUrl = credentials.baseUrl ?? DEFAULT_BASE_URL;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const spanId = this.generateSpanId();

    const response = await this.fetchJson<MistralChatCompletion>('/chat/completions', {
      model: request.model,
      messages: this.convertMessages(request.messages),
      ...(request.maxTokens && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.topP !== undefined && { top_p: request.topP }),
      ...(request.stop && { stop: request.stop }),
      ...(request.tools && { tools: this.convertTools(request.tools) }),
      ...(request.toolChoice && { tool_choice: request.toolChoice }),
    });

    const choice = response.choices?.[0];
    const content = choice?.message?.content ?? '';
    const toolCalls = choice?.message?.tool_calls ?? undefined;
    const usage: TokenUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    return {
      content,
      toolCalls,
      finishReason: this.mapFinishReason(choice?.finish_reason ?? null),
      meta: {
        latencyMs: Date.now() - startTime,
        tokens: usage,
        cost: this.calculateCost(request.model, usage),
        traceId: '', // Set by Orchestra
        spanId,
        model: request.model,
        provider: 'mistral',
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    const startTime = Date.now();

    const response = await this.fetchStream('/chat/completions', {
      model: request.model,
      messages: this.convertMessages(request.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(request.maxTokens && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.topP !== undefined && { top_p: request.topP }),
      ...(request.stop && { stop: request.stop }),
      ...(request.tools && { tools: this.convertTools(request.tools) }),
      ...(request.toolChoice && { tool_choice: request.toolChoice }),
    });

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Mistral streaming response missing body.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = this.splitSseEvents(buffer);
      buffer = rest;

      for (const event of events) {
        const data = event.trim();
        if (!data) continue;
        if (data === '[DONE]') return;

        const parsed = JSON.parse(data) as MistralChatCompletion;
        if (parsed.usage) {
          usage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
          };
        }

        const choice = parsed.choices?.[0];
        const delta = choice?.delta;

        if (delta?.content) {
          yield { content: delta.content };
        }

        if (delta?.tool_calls?.length) {
          const toolCalls: Partial<ToolCall>[] = delta.tool_calls.map((toolCall) => ({
            ...(toolCall.id && { id: toolCall.id }),
            type: 'function',
            ...(toolCall.function && {
              function: {
                name: toolCall.function.name ?? '',
                arguments: toolCall.function.arguments ?? '',
              },
            }),
          }));

          if (toolCalls.length > 0) {
            yield { toolCalls };
          }
        }

        if (choice?.finish_reason) {
          yield {
            finishReason: this.mapFinishReason(choice.finish_reason),
            meta: {
              latencyMs: Date.now() - startTime,
              tokens: usage,
              cost: usage ? this.calculateCost(request.model, usage) : undefined,
              model: request.model,
              provider: 'mistral',
            },
          };
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.fetchJson<{ data?: Array<{ id: string }> }>(
      '/models',
      undefined,
      'GET'
    );
    const data = response.data ?? [];
    return data.map((model) => model.id);
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
    body: Record<string, unknown> | undefined,
    method = 'POST'
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral API error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetchStream(
    path: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral API error: ${response.status} ${errorText}`);
    }

    return response;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.credentials.apiKey}`,
    };
  }

  private splitSseEvents(buffer: string): { events: string[]; rest: string } {
    const chunks = buffer.split('\n\n');
    const rest = chunks.pop() ?? '';
    const events: string[] = [];

    for (const chunk of chunks) {
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        if (line.startsWith('data:')) {
          events.push(line.slice(5).trim());
        }
      }
    }

    return { events, rest };
  }

  private convertMessages(messages: Message[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      if (msg.role === 'tool' && msg.toolCallId) {
        return {
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: msg.content,
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));
  }

  private mapFinishReason(
    reason: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
