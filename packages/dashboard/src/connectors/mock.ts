/**
 * Mock connector for standalone dashboard mode
 * Generates sample stats and traces for local demo usage
 */

import type { SpanData } from 'llm-orchestra';
import type {
  DashboardConnector,
  DashboardStats,
  TraceListItem,
  TraceDetail,
  ProviderHealth,
  TraceQueryOptions,
  DashboardEvent,
} from './types.js';

export interface MockConnectorOptions {
  traceBufferSize?: number;
  retentionMs?: number;
  emitIntervalMs?: number;
  initialTraceCount?: number;
}

const PROVIDERS = ['anthropic', 'openai', 'google', 'mistral'] as const;
const MODELS: Record<string, string[]> = {
  anthropic: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
  openai: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  google: ['gemini-1.5-pro', 'gemini-1.5-flash'],
  mistral: ['mistral-large', 'mistral-medium', 'mistral-small'],
};

export class MockConnector implements DashboardConnector {
  private traceItems: TraceListItem[] = [];
  private traceDetails = new Map<string, TraceDetail>();
  private stats: DashboardStats = {
    totalRequests: 0,
    totalTokens: { input: 0, output: 0 },
    totalCost: 0,
    byProvider: {},
    byModel: {},
  };
  private subscribers: Set<(event: DashboardEvent) => void> = new Set();
  private retentionMs: number;
  private emitInterval: ReturnType<typeof setInterval> | null = null;
  private traceBufferSize: number;
  private providerAvailability = new Map<string, boolean>();
  private providerFailovers = new Map<string, number>();

  constructor(options: MockConnectorOptions = {}) {
    this.traceBufferSize = options.traceBufferSize ?? 100;
    this.retentionMs = options.retentionMs ?? 3600000;
    const emitIntervalMs = options.emitIntervalMs ?? 3000;
    const initialTraceCount = options.initialTraceCount ?? 5;

    for (const provider of PROVIDERS) {
      this.providerAvailability.set(provider, true);
      this.providerFailovers.set(provider, 0);
    }

    for (let i = 0; i < initialTraceCount; i++) {
      this.generateTrace();
    }

    this.emitInterval = setInterval(() => {
      this.generateTrace();
    }, emitIntervalMs);
  }

  async getStats(): Promise<DashboardStats> {
    return {
      totalRequests: this.stats.totalRequests,
      totalTokens: { ...this.stats.totalTokens },
      totalCost: this.stats.totalCost,
      byProvider: this.stats.byProvider,
      byModel: this.stats.byModel,
    };
  }

  async getTraces(options: TraceQueryOptions = {}): Promise<TraceListItem[]> {
    const now = Date.now();
    let filtered = this.traceItems.filter(
      (trace) => now - trace.startTime < this.retentionMs
    );

    if (options.status) {
      filtered = filtered.filter((trace) => trace.status === options.status);
    }
    if (options.provider) {
      filtered = filtered.filter((trace) => trace.provider === options.provider);
    }
    if (options.model) {
      filtered = filtered.filter((trace) => trace.model === options.model);
    }
    if (options.startTime) {
      filtered = filtered.filter((trace) => trace.startTime >= options.startTime!);
    }
    if (options.endTime) {
      filtered = filtered.filter((trace) => trace.startTime <= options.endTime!);
    }

    filtered.sort((a, b) => b.startTime - a.startTime);

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    return filtered.slice(offset, offset + limit);
  }

  async getTraceDetail(traceId: string): Promise<TraceDetail | null> {
    return this.traceDetails.get(traceId) ?? null;
  }

  async getProviderHealth(): Promise<ProviderHealth[]> {
    const now = Date.now();
    return PROVIDERS.map((provider) => ({
      name: provider,
      available: this.providerAvailability.get(provider) ?? true,
      lastChecked: now,
      failoverCount: this.providerFailovers.get(provider) ?? 0,
      avgLatencyMs: this.stats.byProvider[provider]?.avgLatencyMs ?? 0,
    }));
  }

  subscribe(callback: (event: DashboardEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  shutdown(): void {
    if (this.emitInterval) {
      clearInterval(this.emitInterval);
      this.emitInterval = null;
    }
    this.subscribers.clear();
  }

  private generateTrace(): void {
    const provider = pick(PROVIDERS);
    const model = pick(MODELS[provider]);
    const status = Math.random() < 0.08 ? 'error' : 'ok';

    const inputTokens = randomInt(40, 600);
    const outputTokens = randomInt(20, 500);
    const duration = randomInt(120, 2200);
    const startTime = Date.now() - randomInt(0, 1200);

    const cost =
      inputTokens * 0.000003 +
      outputTokens * 0.000006;

    const traceId = createId('trace');
    const rootSpanId = createId('span');
    const childSpanId = createId('span');

    const rootSpan: SpanData = {
      context: { traceId, spanId: rootSpanId },
      name: 'orchestra.complete',
      kind: 'client',
      startTime,
      endTime: startTime + duration,
      status,
      attributes: {},
      events: status === 'error'
        ? [
            {
              name: 'exception',
              timestamp: startTime + duration,
              attributes: { 'exception.message': 'Mock provider error' },
            },
          ]
        : [],
    };

    const llmSpan: SpanData = {
      context: {
        traceId,
        spanId: childSpanId,
        parentSpanId: rootSpanId,
      },
      name: 'llm.call',
      kind: 'client',
      startTime: startTime + randomInt(10, 80),
      endTime: startTime + duration - randomInt(10, 80),
      status,
      attributes: {
        'llm.provider': provider,
        'llm.model': model,
        'llm.tokens.input': inputTokens,
        'llm.tokens.output': outputTokens,
        'llm.tokens.total': inputTokens + outputTokens,
        'llm.cost': cost,
        'llm.latency_ms': duration,
      },
      events: [],
    };

    const spans = [rootSpan, llmSpan].sort((a, b) => a.startTime - b.startTime);
    const detail: TraceDetail = {
      traceId,
      spans,
      totalDuration: duration,
      rootSpan,
    };

    const listItem: TraceListItem = {
      traceId,
      name: rootSpan.name,
      startTime,
      duration,
      status,
      provider,
      model,
      tokens: { input: inputTokens, output: outputTokens },
      cost,
      spanCount: spans.length,
    };

    this.traceItems.unshift(listItem);
    if (this.traceItems.length > this.traceBufferSize) {
      const removed = this.traceItems.pop();
      if (removed) {
        this.traceDetails.delete(removed.traceId);
      }
    }
    this.traceDetails.set(traceId, detail);

    this.updateStats(listItem, duration);

    this.emit({
      type: 'new_trace',
      timestamp: Date.now(),
      data: listItem,
    });
    this.emit({
      type: 'stats_update',
      timestamp: Date.now(),
      data: this.stats,
    });
  }

  private updateStats(trace: TraceListItem, latencyMs: number): void {
    const tokens = trace.tokens ?? { input: 0, output: 0 };
    const cost = trace.cost ?? 0;

    this.stats.totalRequests += 1;
    this.stats.totalTokens.input += tokens.input;
    this.stats.totalTokens.output += tokens.output;
    this.stats.totalCost += cost;

    if (!this.stats.byProvider[trace.provider ?? 'unknown']) {
      this.stats.byProvider[trace.provider ?? 'unknown'] = {
        requests: 0,
        tokens: { input: 0, output: 0 },
        cost: 0,
        avgLatencyMs: 0,
      };
    }

    const providerStats = this.stats.byProvider[trace.provider ?? 'unknown'];
    const prevCount = providerStats.requests;
    providerStats.requests += 1;
    providerStats.tokens.input += tokens.input;
    providerStats.tokens.output += tokens.output;
    providerStats.cost += cost;
    providerStats.avgLatencyMs =
      (providerStats.avgLatencyMs * prevCount + latencyMs) /
      providerStats.requests;

    if (!this.stats.byModel[trace.model ?? 'unknown']) {
      this.stats.byModel[trace.model ?? 'unknown'] = {
        requests: 0,
        tokens: { input: 0, output: 0 },
        cost: 0,
      };
    }

    const modelStats = this.stats.byModel[trace.model ?? 'unknown'];
    modelStats.requests += 1;
    modelStats.tokens.input += tokens.input;
    modelStats.tokens.output += tokens.output;
    modelStats.cost += cost;
  }

  private emit(event: DashboardEvent): void {
    for (const callback of this.subscribers) {
      try {
        callback(event);
      } catch {
        // Ignore subscriber errors
      }
    }
  }
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
