/**
 * Azure OpenAI Provider Adapter
 * Handles Azure OpenAI chat completions via REST
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

const DEFAULT_API_VERSION = '2024-02-15-preview';

interface AzureChatCompletion {
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

export class AzureOpenAIProvider extends BaseProvider {
  name = 'azure-openai' as const;
  private baseUrl: string;
  private apiVersion: string;

  constructor(credentials: ProviderCredentials) {
    super(credentials);
    if (!credentials.baseUrl) {
      throw new Error('Azure OpenAI requires baseUrl (resource endpoint).');
    }
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, '');
    this.apiVersion = credentials.apiVersion ?? DEFAULT_API_VERSION;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const spanId = this.generateSpanId();
    const deployment = this.normalizeDeployment(request.model);

    const response = await this.fetchJson<AzureChatCompletion>(deployment, {
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
        provider: 'azure-openai',
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    const startTime = Date.now();
    const deployment = this.normalizeDeployment(request.model);

    const response = await this.fetchStream(deployment, {
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
      throw new Error('Azure OpenAI streaming response missing body.');
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

        const parsed = JSON.parse(data) as AzureChatCompletion;
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
              provider: 'azure-openai',
            },
          };
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/openai/models?api-version=${this.apiVersion}`, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    return data.data?.map((model) => model.id) ?? [];
  }

  getModelCost(_model: string): { inputPer1k: number; outputPer1k: number } {
    return { inputPer1k: 0, outputPer1k: 0 };
  }

  private async fetchJson<T>(
    deployment: string,
    body: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(this.buildUrl(deployment), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetchStream(
    deployment: string,
    body: Record<string, unknown>
  ): Promise<Response> {
    const response = await fetch(this.buildUrl(deployment), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure OpenAI API error: ${response.status} ${errorText}`);
    }

    return response;
  }

  private buildUrl(deployment: string): string {
    return `${this.baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${this.apiVersion}`;
  }

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'api-key': this.credentials.apiKey,
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

  private normalizeDeployment(model: string): string {
    if (model.startsWith('azure-openai:')) {
      return model.slice('azure-openai:'.length);
    }
    if (model.startsWith('azure:')) {
      return model.slice('azure:'.length);
    }
    return model;
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
