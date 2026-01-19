/**
 * Memory Connector
 * Connects dashboard directly to an in-memory Orchestra instance
 */

import type { Orchestra, OrchestraStats, SpanData } from 'llm-orchestra';
import type {
  DashboardConnector,
  DashboardStats,
  DashboardEvent,
  TraceInfo,
  TraceEvent,
  ProviderHealth,
  RecentRequest,
} from './types.js';

export interface MemoryConnectorOptions {
  /** Maximum number of traces to keep in ring buffer */
  maxTraces?: number;
  /** Maximum number of recent requests to keep */
  maxRecentRequests?: number;
}

export class MemoryConnector implements DashboardConnector {
  private orchestra: Orchestra;
  private startTime: number;
  private recentRequests: RecentRequest[] = [];
  private subscribers: Set<(event: DashboardEvent) => void> = new Set();
  private requestCount = 0;
  private requestsLastMinute: number[] = [];
  private options: Required<MemoryConnectorOptions>;

  constructor(orchestra: Orchestra, options: MemoryConnectorOptions = {}) {
    this.orchestra = orchestra;
    this.startTime = Date.now();
    this.options = {
      maxTraces: options.maxTraces ?? 100,
      maxRecentRequests: options.maxRecentRequests ?? 50,
    };
  }

  async getStats(): Promise<DashboardStats> {
    const stats = this.orchestra.getStats();
    const now = Date.now();
    
    // Clean up old request timestamps (older than 1 minute)
    this.requestsLastMinute = this.requestsLastMinute.filter(
      (t) => now - t < 60000
    );

    return {
      ...stats,
      uptime: now - this.startTime,
      requestsPerMinute: this.requestsLastMinute.length,
      activeProviders: this.orchestra.getProviders(),
    };
  }

  async getTraces(options?: { limit?: number; offset?: number }): Promise<TraceInfo[]> {
    const spans = this.orchestra.getTraces();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Convert spans to TraceInfo format
    const traces: TraceInfo[] = spans
      .slice(offset, offset + limit)
      .map((span) => this.spanToTraceInfo(span));

    return traces;
  }

  async getTrace(traceId: string): Promise<TraceInfo | undefined> {
    const spans = this.orchestra.getTraces();
    const span = spans.find(
      (s) => s.context.traceId === traceId || s.context.spanId === traceId
    );
    return span ? this.spanToTraceInfo(span) : undefined;
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
        avgLatencyMs: providerStats?.avgLatencyMs,
      });
    }

    return health;
  }

  async getRecentRequests(limit = 20): Promise<RecentRequest[]> {
    return this.recentRequests.slice(-limit).reverse();
  }

  /**
   * Record a completed request for dashboard tracking
   */
  recordRequest(request: RecentRequest): void {
    this.recentRequests.push(request);
    this.requestsLastMinute.push(Date.now());
    this.requestCount++;

    // Trim to max size
    if (this.recentRequests.length > this.options.maxRecentRequests) {
      this.recentRequests = this.recentRequests.slice(
        -this.options.maxRecentRequests
      );
    }

    // Notify subscribers
    this.emit({ type: 'request', data: request });
  }

  subscribe(callback: (event: DashboardEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private emit(event: DashboardEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        console.error('Dashboard subscriber error:', error);
      }
    }
  }

  private spanToTraceInfo(span: SpanData): TraceInfo {
    const status = span.status === 'unset' ? 'pending' : span.status;
    return {
      id: span.context.spanId,
      name: span.name,
      startTime: span.startTime,
      endTime: span.endTime,
      durationMs: span.endTime ? span.endTime - span.startTime : undefined,
      status,
      attributes: span.attributes || {},
      events: span.events.map((e) => ({
        name: e.name,
        timestamp: e.timestamp,
        attributes: e.attributes || {},
      })),
      children: [],
    };
  }
}
