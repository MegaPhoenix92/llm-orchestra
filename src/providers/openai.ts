/**
 * OpenAI Provider Adapter
 * Handles GPT models via the OpenAI API
 */

import OpenAI from 'openai';
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

// Pricing as of Jan 2026 (per 1K tokens)
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'gpt-4-turbo': { inputPer1k: 0.01, outputPer1k: 0.03 },
  'gpt-4-turbo-preview': { inputPer1k: 0.01, outputPer1k: 0.03 },
  'gpt-4': { inputPer1k: 0.03, outputPer1k: 0.06 },
  'gpt-4-32k': { inputPer1k: 0.06, outputPer1k: 0.12 },
  'gpt-3.5-turbo': { inputPer1k: 0.0005, outputPer1k: 0.0015 },
  'gpt-3.5-turbo-16k': { inputPer1k: 0.003, outputPer1k: 0.004 },
  'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
};

export class OpenAIProvider extends BaseProvider {
  name = 'openai' as const;
  private client: OpenAI;

  constructor(credentials: ProviderCredentials) {
    super(credentials);
    this.client = new OpenAI({
      apiKey: credentials.apiKey,
      baseURL: credentials.baseUrl,
      organization: credentials.organizationId,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const spanId = this.generateSpanId();

    const openaiRequest: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: request.model,
      messages: this.convertMessages(request.messages),
      ...(request.maxTokens && { max_tokens: request.maxTokens }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.topP !== undefined && { top_p: request.topP }),
      ...(request.stop && { stop: request.stop }),
      ...(request.tools && { tools: this.convertTools(request.tools) }),
      ...(request.toolChoice && { tool_choice: request.toolChoice }),
    };

    const response = await this.client.chat.completions.create(openaiRequest);
    const choice = response.choices[0];
    const latencyMs = Date.now() - startTime;

    const usage: TokenUsage = {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    };

    // Extract tool calls if present
    let toolCalls: ToolCall[] | undefined;
    if (choice.message.tool_calls) {
      toolCalls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    return {
      content: choice.message.content ?? '',
      toolCalls,
      finishReason: this.mapFinishReason(choice.finish_reason),
      meta: {
        latencyMs,
        tokens: usage,
        cost: this.calculateCost(request.model, usage),
        traceId: '', // Set by Orchestra
        spanId,
        model: request.model,
        provider: 'openai',
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    const startTime = Date.now();

    const openaiRequest: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
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
    };

    const stream = await this.client.chat.completions.create(openaiRequest);

    let usage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];

      if (choice?.delta?.content) {
        yield { content: choice.delta.content };
      }

      if (choice?.delta?.tool_calls) {
        const toolCalls: Partial<ToolCall>[] = choice.delta.tool_calls.map((toolCall) => ({
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

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }

      if (choice?.finish_reason) {
        yield {
          finishReason: this.mapFinishReason(choice.finish_reason),
          meta: {
            latencyMs: Date.now() - startTime,
            tokens: usage,
            cost: usage ? this.calculateCost(request.model, usage) : undefined,
            model: request.model,
            provider: 'openai',
          },
        };
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    return response.data
      .filter((m) => m.id.startsWith('gpt'))
      .map((m) => m.id);
  }

  getModelCost(model: string): { inputPer1k: number; outputPer1k: number } {
    // Find best matching pricing
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (model.includes(key) || key.includes(model)) {
        return pricing;
      }
    }
    return { inputPer1k: 0.01, outputPer1k: 0.03 }; // Default to GPT-4 pricing
  }

  private convertMessages(messages: Message[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === 'tool' && msg.toolCallId) {
        return {
          role: 'tool' as const,
          tool_call_id: msg.toolCallId,
          content: msg.content,
        };
      }
      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      };
    });
  }

  private convertTools(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
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
