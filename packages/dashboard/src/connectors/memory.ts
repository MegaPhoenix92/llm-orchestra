/**
 * In-memory connector for Orchestra instance
 * Provides direct access to stats and traces without transport overhead
 */

import type { SpanData } from 'llm-orchestra';
import type { Orchestra, OrchestraStats } from 'llm-orchestra';
import type {
  DashboardConnector,
  DashboardStats,
  TraceListItem,
  TraceDetail,
  ProviderHealth,
  TraceQueryOptions,
  DashboardEvent,
} from './types.js';

export class RingBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private size = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    if (this.size === 0) return result;

    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buffer[idx];
      if (item !== undefined) {
        result.push(item);
      }
    }
    return result;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.size = 0;
  }

  getSize(): number {
    return this.size;
  }
}

export interface MemoryConnectorOptions {
  traceBufferSize?: number;
  retentionMs?: number;
}

export class MemoryConnector implements DashboardConnector {
  private orchestra: Orchestra;
  private traceBuffer: RingBuffer<SpanData>;
  private seenSpanIds = new Map<string, number>();
  private seenTraceIds = new Map<string, number>();
  private lastStats: OrchestraStats | null = null;
  private subscribers: Set<(event: DashboardEvent) => void> = new Set();
  private pollInterval?: ReturnType<typeof setInterval>;
  private retentionMs: number;

  constructor(orchestra: Orchestra, options: MemoryConnectorOptions = {}) {
    this.orchestra = orchestra;
    const bufferSize = options.traceBufferSize ?? 100;
    this.traceBuffer = new RingBuffer(bufferSize);
    this.retentionMs = options.retentionMs ?? 3600000; // 1 hour default

    // Start polling for new traces
    this.startPolling();
  }

  private startPolling(): void {
    this.pollInterval = setInterval(() => {
      try {
        this.syncTraces();
        this.checkStatsUpdate();
      } catch {
        // Log error but continue polling
      }
    }, 1000);
  }

  private syncTraces(): void {
    const spans = this.orchestra.getTraces();
    const now = Date.now();

    this.pruneSeenIds(now);

    // Only process unseen spans within retention
    for (const span of spans) {
      const spanId = span.context.spanId;

      // Skip if we've already seen this span
      if (this.seenSpanIds.has(spanId)) {
        continue;
      }

      // Skip spans older than retention period
      if (now - span.startTime > this.retentionMs) {
        continue;
      }

      // Add to buffer and mark as seen
      this.seenSpanIds.set(spanId, span.startTime);
      this.traceBuffer.push(span);

      const traceId = span.context.traceId;
      if (!this.seenTraceIds.has(traceId)) {
        this.seenTraceIds.set(traceId, span.startTime);
        const traceItem = this.buildTraceListItem(
          traceId,
          this.traceBuffer.getAll(),
          now
        );
        if (traceItem) {
          this.emit({
            type: 'new_trace',
            timestamp: now,
            data: traceItem,
          });
        }
      }
    }
  }

  private checkStatsUpdate(): void {
    const stats = this.orchestra.getStats();
    if (
      !this.lastStats ||
      stats.totalRequests !== this.lastStats.totalRequests
    ) {
      this.lastStats = stats;
      this.emit({
        type: 'stats_update',
        timestamp: Date.now(),
        data: this.convertStats(stats),
      });
    }
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

  private pruneSeenIds(now: number): void {
    for (const [spanId, timestamp] of this.seenSpanIds) {
      if (now - timestamp > this.retentionMs) {
        this.seenSpanIds.delete(spanId);
      }
    }

    for (const [traceId, timestamp] of this.seenTraceIds) {
      if (now - timestamp > this.retentionMs) {
        this.seenTraceIds.delete(traceId);
      }
    }
  }

  async getStats(): Promise<DashboardStats> {
    return this.convertStats(this.orchestra.getStats());
  }

  private convertStats(stats: OrchestraStats): DashboardStats {
    return {
      totalRequests: stats.totalRequests,
      totalTokens: stats.totalTokens,
      totalCost: stats.totalCost,
      byProvider: stats.byProvider,
      byModel: stats.byModel,
    };
  }

  async getTraces(options: TraceQueryOptions = {}): Promise<TraceListItem[]> {
    const allSpans = this.traceBuffer.getAll();
    const now = Date.now();

    // Filter by retention
    let filtered = allSpans.filter((span) => {
      const age = now - span.startTime;
      return age < this.retentionMs;
    });

    // Group spans by traceId and aggregate into trace summaries
    const traceMap = new Map<string, SpanData[]>();
    for (const span of filtered) {
      const traceId = span.context.traceId;
      if (!traceMap.has(traceId)) {
        traceMap.set(traceId, []);
      }
      traceMap.get(traceId)!.push(span);
    }

    // Convert to TraceListItem array (one entry per trace, not per span)
    const traces: TraceListItem[] = [];
    for (const [traceId, spans] of traceMap) {
      const traceItem = this.buildTraceListItem(traceId, spans, now, options);
      if (traceItem) {
        traces.push(traceItem);
      }
    }

    // Sort by start time descending (newest first)
    traces.sort((a, b) => b.startTime - a.startTime);

    // Apply pagination
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    return traces.slice(offset, offset + limit);
  }

  private buildTraceListItem(
    traceId: string,
    spans: SpanData[],
    now: number,
    filters?: TraceQueryOptions
  ): TraceListItem | null {
    const traceSpans = spans.filter((span) => span.context.traceId === traceId);
    if (traceSpans.length === 0) return null;

    traceSpans.sort((a, b) => a.startTime - b.startTime);

    const spanIds = new Set(traceSpans.map((s) => s.context.spanId));
    const rootSpan = traceSpans.find(
      (s) => !s.context.parentSpanId || !spanIds.has(s.context.parentSpanId)
    ) ?? traceSpans[0];

    const startTime = Math.min(...traceSpans.map((s) => s.startTime));
    const endTime = Math.max(...traceSpans.map((s) => s.endTime ?? now));
    const duration = endTime - startTime;

    const providers = new Set<string>();
    const models = new Set<string>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let hasTokens = false;
    let hasCost = false;
    let hasOk = false;
    let hasError = false;

    for (const span of traceSpans) {
      if (span.status === 'error') hasError = true;
      if (span.status === 'ok') hasOk = true;

      const provider = span.attributes['llm.provider'];
      if (typeof provider === 'string') {
        providers.add(provider);
      }
      const model = span.attributes['llm.model'];
      if (typeof model === 'string') {
        models.add(model);
      }

      const input = span.attributes['llm.tokens.input'] as number | undefined;
      const output = span.attributes['llm.tokens.output'] as number | undefined;
      const cost = span.attributes['llm.cost'] as number | undefined;

      if (input !== undefined) {
        totalInputTokens += input;
        hasTokens = true;
      }
      if (output !== undefined) {
        totalOutputTokens += output;
        hasTokens = true;
      }
      if (cost !== undefined) {
        totalCost += cost;
        hasCost = true;
      }
    }

    const provider =
      providers.size === 1
        ? Array.from(providers)[0]
        : providers.size > 1
          ? 'multiple'
          : undefined;
    const model =
      models.size === 1
        ? Array.from(models)[0]
        : models.size > 1
          ? 'multiple'
          : undefined;

    const status = hasError ? 'error' : hasOk ? 'ok' : 'unset';

    if (filters?.status && status !== filters.status) {
      return null;
    }
    if (filters?.provider && !providers.has(filters.provider)) {
      return null;
    }
    if (filters?.model && !models.has(filters.model)) {
      return null;
    }
    if (filters?.startTime && startTime < filters.startTime) {
      return null;
    }
    if (filters?.endTime && startTime > filters.endTime) {
      return null;
    }

    return {
      traceId,
      name: rootSpan.name,
      startTime,
      duration,
      status,
      provider,
      model,
      tokens: hasTokens ? { input: totalInputTokens, output: totalOutputTokens } : undefined,
      cost: hasCost ? totalCost : undefined,
      spanCount: traceSpans.length,
    };
  }

  async getTraceDetail(traceId: string): Promise<TraceDetail | null> {
    const allSpans = this.traceBuffer.getAll();
    const traceSpans = allSpans.filter(
      (span) => span.context.traceId === traceId
    );

    if (traceSpans.length === 0) {
      return null;
    }

    // Sort spans by start time
    traceSpans.sort((a, b) => a.startTime - b.startTime);

    // Find root span (no parent in this trace) or use first span as fallback
    const spanIds = new Set(traceSpans.map((s) => s.context.spanId));
    const rootSpan = traceSpans.find(
      (s) => !s.context.parentSpanId || !spanIds.has(s.context.parentSpanId)
    ) ?? traceSpans[0]; // Fallback to first span if root rolled out

    const startTime = Math.min(...traceSpans.map((s) => s.startTime));
    const endTime = Math.max(
      ...traceSpans.map((s) => s.endTime ?? Date.now())
    );

    return {
      traceId,
      spans: traceSpans,
      totalDuration: endTime - startTime,
      rootSpan,
    };
  }

  async getProviderHealth(): Promise<ProviderHealth[]> {
    const providers = this.orchestra.getProviders();
    const stats = this.orchestra.getStats();
    const health: ProviderHealth[] = [];

    for (const provider of providers) {
      const available = await this.orchestra.isProviderAvailable(provider);
      const providerStats = stats.byProvider[provider];

      health.push({
        name: provider,
        available,
        lastChecked: Date.now(),
        failoverCount: 0, // Would need to track this in Orchestra
        avgLatencyMs: providerStats?.avgLatencyMs ?? 0,
      });
    }

    return health;
  }

  subscribe(callback: (event: DashboardEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  shutdown(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.subscribers.clear();
  }
}
