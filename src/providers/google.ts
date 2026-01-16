/**
 * Google Provider Adapter
 * Handles Gemini models via the Google Generative AI API
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { BaseProvider } from './base.js';
import type {
  ProviderCredentials,
  CompletionRequest,
  CompletionResponse,
  CompletionStream,
  Message,
  TokenUsage,
  ToolDefinition,
} from '../types/index.js';

// Pricing as of Jan 2024 (per 1K tokens)
const MODEL_PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  'gemini-pro': { inputPer1k: 0.00025, outputPer1k: 0.0005 },
  'gemini-pro-vision': { inputPer1k: 0.00025, outputPer1k: 0.0005 },
  'gemini-1.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'gemini-1.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  'gemini-2.0-flash': { inputPer1k: 0.0001, outputPer1k: 0.0004 },
};

const MODEL_ALIASES: Record<string, string> = {
  'gemini-pro': 'gemini-1.5-pro',
  'gemini-flash': 'gemini-1.5-flash',
};

export class GoogleProvider extends BaseProvider {
  name = 'google' as const;
  private client: GoogleGenerativeAI;

  constructor(credentials: ProviderCredentials) {
    super(credentials);
    this.client = new GoogleGenerativeAI(credentials.apiKey);
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();
    const spanId = this.generateSpanId();
    const resolvedModel = this.resolveModel(request.model);

    const model = this.client.getGenerativeModel({
      model: resolvedModel,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        topP: request.topP,
        stopSequences: request.stop,
      },
    });

    // Convert messages to Gemini format
    const { systemInstruction, contents } = this.convertMessages(request.messages);

    const chat = model.startChat({
      history: contents.slice(0, -1),
      ...(systemInstruction && { systemInstruction }),
    });

    const lastMessage = contents[contents.length - 1];
    const result = await chat.sendMessage(lastMessage.parts);
    const response = result.response;

    const latencyMs = Date.now() - startTime;

    // Estimate token usage (Gemini doesn't always return exact counts)
    const usage: TokenUsage = {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    };

    const content = response.text();

    return {
      content,
      finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
      meta: {
        latencyMs,
        tokens: usage,
        cost: this.calculateCost(resolvedModel, usage),
        traceId: '', // Set by Orchestra
        spanId,
        model: resolvedModel,
        provider: 'google',
        cached: false,
        failoverAttempts: 0,
      },
    };
  }

  async *stream(request: CompletionRequest): CompletionStream {
    const startTime = Date.now();
    const resolvedModel = this.resolveModel(request.model);

    const model = this.client.getGenerativeModel({
      model: resolvedModel,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        topP: request.topP,
        stopSequences: request.stop,
      },
    });

    const { systemInstruction, contents } = this.convertMessages(request.messages);

    const chat = model.startChat({
      history: contents.slice(0, -1),
      ...(systemInstruction && { systemInstruction }),
    });

    const lastMessage = contents[contents.length - 1];
    const result = await chat.sendMessageStream(lastMessage.parts);

    let totalContent = '';

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        totalContent += text;
        yield { content: text };
      }
    }

    // Final response with metadata
    const response = await result.response;
    const usage: TokenUsage = {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
    };

    yield {
      finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason),
      meta: {
        latencyMs: Date.now() - startTime,
        tokens: usage,
        cost: this.calculateCost(resolvedModel, usage),
        model: resolvedModel,
        provider: 'google',
      },
    };
  }

  async listModels(): Promise<string[]> {
    // Google doesn't have a public list models API, return known models
    return [
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-pro',
      'gemini-pro-vision',
    ];
  }

  getModelCost(model: string): { inputPer1k: number; outputPer1k: number } {
    const resolved = this.resolveModel(model);
    return MODEL_PRICING[resolved] ?? { inputPer1k: 0.00125, outputPer1k: 0.005 };
  }

  private resolveModel(model: string): string {
    return MODEL_ALIASES[model] ?? model;
  }

  private convertMessages(messages: Message[]): {
    systemInstruction: string | undefined;
    contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  } {
    let systemInstruction: string | undefined;
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = (systemInstruction ?? '') + msg.content;
      } else if (msg.role === 'user') {
        contents.push({ role: 'user', parts: [{ text: msg.content }] });
      } else if (msg.role === 'assistant') {
        contents.push({ role: 'model', parts: [{ text: msg.content }] });
      }
    }

    // Ensure we have at least one message
    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: '' }] });
    }

    return { systemInstruction, contents };
  }

  private mapFinishReason(
    reason: string | undefined
  ): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
