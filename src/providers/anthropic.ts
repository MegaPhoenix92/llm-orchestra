/**
 * Anthropic Provider Adapter
 * Handles Claude models via the Anthropic API
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base.js';
import type {
  ProviderCredentials,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  StreamChunk,
  Message,
  TokenUsage,
  ToolDefinition,
} from '../types/index.js';

// Pricing as of Jan 2024 (per 1K tokens)
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'claude-3-opus-20240229': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-3-sonnet-20240229': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-haiku-20240307': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  'claude-3-5-sonnet-20241022': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-5-haiku-20241022': { inputPer1k: 0.001, outputPer1k: 0.005 },
  // Aliases
  'claude-3-opus': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-3-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3-haiku': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  'claude-3.5-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-3.5-haiku': { inputPer1k: 0.001, outputPer1k: 0.005 },
};

const MODEL_ALIASES: Record<string, string> = {
  'claude-3-opus': 'claude-3-opus-20240229',
  'claude-3-sonnet': 'claude-3-sonnet-20240229',
  'claude-3-haiku': 'claude-3-haiku-20240307',
  'claude-3.5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3.5-haiku': 'claude-3-5-haiku-20241022',
};

export class AnthropicProvider extends BaseProvider {
  name = 'anthropic' as const;
  private client: Anthropic;

  constructor(credentials: ProviderCredentials) {
    super(credentials);
    this.client = new Anthropic({
      apiKey: credentials.apiKey,
      baseURL: credentials.baseUrl,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const spanId = this.generateSpanId();
    const resolvedModel = this.resolveModel(request.model);

    // Extract system message and convert messages
    const { systemPrompt, messages } = this.convertMessages(request.messages);

    // Build Anthropic request
    const anthropicRequest: Anthropic.MessageCreateParams = {
      model: resolvedModel,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      ...(systemPrompt && { system: systemPrompt }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.topP !== undefined && { top_p: request.topP }),
      ...(request.stop && { stop_sequences: request.stop }),
      ...(request.tools && { tools: this.convertTools(request.tools) }),
    };

    const response = await this.client.messages.create(anthropicRequest);

    const latencyMs = Date.now() - startTime;
    const usage: TokenUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    // Extract content
    let content = '';
    const toolCalls: CompletionResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapStopReason(response.stop_reason),
      meta: {
        latencyMs,
        tokens: usage,
        cost: this.calculateCost(resolvedModel, usage),
        traceId: '', // Set by Orchestra
        spanId,
        model: resolvedModel,
        provider: 'anthropic',
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    const startTime = Date.now();
    const resolvedModel = this.resolveModel(request.model);
    const { systemPrompt, messages } = this.convertMessages(request.messages);

    const anthropicRequest: Anthropic.MessageCreateParams = {
      model: resolvedModel,
      max_tokens: request.maxTokens ?? 4096,
      messages,
      stream: true,
      ...(systemPrompt && { system: systemPrompt }),
      ...(request.temperature !== undefined && { temperature: request.temperature }),
      ...(request.topP !== undefined && { top_p: request.topP }),
      ...(request.stop && { stop_sequences: request.stop }),
      ...(request.tools && { tools: this.convertTools(request.tools) }),
    };

    const stream = await this.client.messages.create(anthropicRequest);

    let inputTokens = 0;
    let outputTokens = 0;
    const toolUses = new Map<number, { id: string; name: string; baseInputJson: string; deltaInputJson: string }>();

    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      if (event.type === 'message_start' && event.message.usage) {
        inputTokens = event.message.usage.input_tokens;
      } else if (event.type === 'content_block_start') {
        const contentBlock = event.content_block;
        if (contentBlock.type === 'tool_use') {
          toolUses.set(event.index, {
            id: contentBlock.id,
            name: contentBlock.name,
            baseInputJson: contentBlock.input ? JSON.stringify(contentBlock.input) : '',
            deltaInputJson: '',
          });
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if ('partial_json' in delta) {
          const toolUse = toolUses.get(event.index);
          if (toolUse) {
            toolUse.deltaInputJson += delta.partial_json;
          }
        }
        if ('text' in delta) {
          yield { content: delta.text };
        }
      } else if (event.type === 'content_block_stop') {
        const toolUse = toolUses.get(event.index);
        if (toolUse) {
          const argumentsJson = toolUse.deltaInputJson || toolUse.baseInputJson || '{}';
          yield {
            toolCalls: [{
              id: toolUse.id,
              type: 'function',
              function: {
                name: toolUse.name,
                arguments: argumentsJson,
              },
            }],
          };
          toolUses.delete(event.index);
        }
      } else if (event.type === 'message_delta') {
        if (event.usage) {
          outputTokens = event.usage.output_tokens;
        }
        if (event.delta.stop_reason) {
          const usage: TokenUsage = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
          yield {
            finishReason: this.mapStopReason(event.delta.stop_reason),
            meta: {
              latencyMs: Date.now() - startTime,
              tokens: usage,
              cost: this.calculateCost(resolvedModel, usage),
              model: resolvedModel,
              provider: 'anthropic',
            },
          };
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a list models endpoint, return known models
    return [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ];
  }

  getModelCost(model: string): { inputPer1k: number; outputPer1k: number } {
    const resolved = this.resolveModel(model);
    return MODEL_PRICING[resolved] ?? { inputPer1k: 0.003, outputPer1k: 0.015 };
  }

  private resolveModel(model: string): string {
    return MODEL_ALIASES[model] ?? model;
  }

  private convertMessages(
    messages: Message[]
  ): { systemPrompt: string | undefined; messages: Anthropic.MessageParam[] } {
    let systemPrompt: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = (systemPrompt ?? '') + msg.content;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        anthropicMessages.push({
          role: msg.role,
          content: msg.content,
        });
      } else if (msg.role === 'tool' && msg.toolCallId) {
        anthropicMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content,
            },
          ],
        });
      }
    }

    return { systemPrompt, messages: anthropicMessages };
  }

  private convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
    }));
  }

  private mapStopReason(
    reason: string | null
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}
