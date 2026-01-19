/**
 * PostgreSQL Connector
 * Connects dashboard to PostgreSQL database for persistent storage
 */

import { eq, desc, and, gte, gt, sql, count, avg, sum, inArray } from 'drizzle-orm';
import type {
  DashboardConnector,
  DashboardStats,
  DashboardEvent,
  TraceInfo,
  TraceEvent,
  ProviderHealth,
  RecentRequest,
} from './types.js';
import {
  traces,
  spans,
  spanEvents,
  statsSnapshots,
  type Trace,
  type Span,
  type SpanEvent,
  type NewTrace,
  type NewSpan,
  type NewSpanEvent,
  type NewStatsSnapshot,
} from '../db/schema.js';
import type { Database } from '../db/index.js';

export interface PostgresConnectorOptions {
  /** Maximum number of traces to return in queries */
  maxTraces?: number;
}

type DrizzleDB = Database;

export class PostgresConnector implements DashboardConnector {
  private db: DrizzleDB;
  private projectId: string;
  private startTime: number;
  private subscribers: Set<(event: DashboardEvent) => void> = new Set();
  private options: Required<PostgresConnectorOptions>;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastTraceTime: Date | null = null;

  constructor(
    db: DrizzleDB,
    projectId: string,
    options: PostgresConnectorOptions = {}
  ) {
    this.db = db;
    this.projectId = projectId;
    this.startTime = Date.now();
    this.options = {
      maxTraces: options.maxTraces ?? 100,
    };
  }

  async getStats(): Promise<DashboardStats> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    // Get latest stats snapshot
    const [latestSnapshot] = await this.db
      .select()
      .from(statsSnapshots)
      .where(eq(statsSnapshots.projectId, this.projectId))
      .orderBy(desc(statsSnapshots.timestamp))
      .limit(1);

    // Count requests in last minute for RPM
    const [rpmResult] = await this.db
      .select({ count: count() })
      .from(traces)
      .where(
        and(
          eq(traces.projectId, this.projectId),
          gte(traces.startTime, oneMinuteAgo)
        )
      );

    // Get aggregated stats from traces
    const [aggregatedStats] = await this.db
      .select({
        totalRequests: count(),
        totalTokensInput: sum(traces.totalTokensIn),
        totalTokensOutput: sum(traces.totalTokensOut),
        totalCost: sum(traces.totalCost),
        avgLatencyMs: avg(traces.duration),
        errorCount: count(sql`CASE WHEN ${traces.status} = 'error' THEN 1 END`),
      })
      .from(traces)
      .where(eq(traces.projectId, this.projectId));

    // Get active providers
    const activeProviders = await this.db
      .selectDistinct({ provider: traces.provider })
      .from(traces)
      .where(
        and(
          eq(traces.projectId, this.projectId),
          gte(traces.startTime, oneHourAgo)
        )
      );

    const byProvider: Partial<Record<
      string,
      {
        requests: number;
        tokens: { input: number; output: number };
        cost: number;
        avgLatencyMs: number;
      }
    >> = {};

    // Get per-provider stats
    const providerStats = await this.db
      .select({
        provider: traces.provider,
        requests: count(),
        tokensIn: sum(traces.totalTokensIn),
        tokensOut: sum(traces.totalTokensOut),
        cost: sum(traces.totalCost),
        avgLatencyMs: avg(traces.duration),
      })
      .from(traces)
      .where(eq(traces.projectId, this.projectId))
      .groupBy(traces.provider);

    for (const stat of providerStats) {
      if (stat.provider) {
        byProvider[stat.provider] = {
          requests: Number(stat.requests) || 0,
          tokens: {
            input: Number(stat.tokensIn) || 0,
            output: Number(stat.tokensOut) || 0,
          },
          cost: Number(stat.cost) || 0,
          avgLatencyMs: Number(stat.avgLatencyMs) || 0,
        };
      }
    }

    // Get per-model stats
    const byModel: Record<
      string,
      {
        requests: number;
        tokens: { input: number; output: number };
        cost: number;
      }
    > = {};

    const modelStats = await this.db
      .select({
        model: traces.model,
        requests: count(),
        tokensIn: sum(traces.totalTokensIn),
        tokensOut: sum(traces.totalTokensOut),
        cost: sum(traces.totalCost),
      })
      .from(traces)
      .where(eq(traces.projectId, this.projectId))
      .groupBy(traces.model);

    for (const stat of modelStats) {
      if (stat.model) {
        byModel[stat.model] = {
          requests: Number(stat.requests) || 0,
          tokens: {
            input: Number(stat.tokensIn) || 0,
            output: Number(stat.tokensOut) || 0,
          },
          cost: Number(stat.cost) || 0,
        };
      }
    }

    return {
      totalRequests: Number(aggregatedStats?.totalRequests) || 0,
      totalTokens: {
        input: Number(aggregatedStats?.totalTokensInput) || 0,
        output: Number(aggregatedStats?.totalTokensOutput) || 0,
      },
      totalCost: Number(aggregatedStats?.totalCost) || 0,
      byProvider,
      byModel,
      uptime: Date.now() - this.startTime,
      requestsPerMinute: Number(rpmResult?.count) || 0,
      activeProviders: activeProviders
        .map((p) => p.provider)
        .filter((p): p is string => p !== null),
    };
  }

  async getTraces(options?: {
    limit?: number;
    offset?: number;
  }): Promise<TraceInfo[]> {
    const limit = Math.min(
      options?.limit ?? 50,
      this.options.maxTraces
    );
    const offset = options?.offset ?? 0;

    const traceRows = await this.db
      .select()
      .from(traces)
      .where(eq(traces.projectId, this.projectId))
      .orderBy(desc(traces.startTime))
      .limit(limit)
      .offset(offset);

    const traceInfos: TraceInfo[] = [];

    for (const trace of traceRows) {
      traceInfos.push(await this.traceToTraceInfo(trace));
    }

    return traceInfos;
  }

  async getTrace(traceId: string): Promise<TraceInfo | undefined> {
    const [trace] = await this.db
      .select()
      .from(traces)
      .where(
        and(
          eq(traces.traceId, traceId),
          eq(traces.projectId, this.projectId)
        )
      )
      .limit(1);

    if (!trace) {
      return undefined;
    }

    return this.traceToTraceInfo(trace, true);
  }

  async getProviderHealth(): Promise<ProviderHealth[]> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Get provider stats for last 5 minutes
    const providerStats = await this.db
      .select({
        provider: traces.provider,
        totalRequests: count(),
        successCount: count(
          sql`CASE WHEN ${traces.status} = 'ok' THEN 1 END`
        ),
        avgLatencyMs: avg(traces.duration),
        lastSeen: sql<Date>`MAX(${traces.startTime})`,
      })
      .from(traces)
      .where(
        and(
          eq(traces.projectId, this.projectId),
          gte(traces.startTime, fiveMinutesAgo)
        )
      )
      .groupBy(traces.provider);

    const health: ProviderHealth[] = [];

    for (const stat of providerStats) {
      if (stat.provider) {
        const total = Number(stat.totalRequests) || 0;
        const success = Number(stat.successCount) || 0;
        const successRate = total > 0 ? success / total : 0;

        health.push({
          name: stat.provider,
          available: successRate >= 0.5, // Consider available if >50% success rate
          lastChecked: stat.lastSeen
            ? new Date(stat.lastSeen).getTime()
            : Date.now(),
          avgLatencyMs: Number(stat.avgLatencyMs) || undefined,
        });
      }
    }

    return health;
  }

  async getRecentRequests(limit = 20): Promise<RecentRequest[]> {
    const recentTraces = await this.db
      .select()
      .from(traces)
      .where(eq(traces.projectId, this.projectId))
      .orderBy(desc(traces.startTime))
      .limit(limit);

    return recentTraces.map((trace) => this.traceToRecentRequest(trace));
  }

  subscribe(callback: (event: DashboardEvent) => void): () => void {
    this.subscribers.add(callback);

    // Start polling if this is the first subscriber
    if (this.subscribers.size === 1) {
      this.startPolling();
    }

    return () => {
      this.subscribers.delete(callback);

      // Stop polling if no more subscribers
      if (this.subscribers.size === 0) {
        this.stopPolling();
      }
    };
  }

  // ============================================================================
  // Data Ingestion Methods
  // ============================================================================

  /**
   * Record a new trace
   */
  async recordTrace(trace: NewTrace): Promise<void> {
    await this.db.insert(traces).values({
      ...trace,
      projectId: this.projectId,
    });

    // Emit event to subscribers
    const traceInfo = await this.getTrace(trace.traceId);
    if (traceInfo) {
      this.emit({ type: 'trace', data: traceInfo });
    }
  }

  /**
   * Record a new span
   */
  async recordSpan(span: NewSpan): Promise<void> {
    await this.db.insert(spans).values(span);
  }

  /**
   * Record a span event
   */
  async recordSpanEvent(event: NewSpanEvent): Promise<void> {
    await this.db.insert(spanEvents).values(event);
  }

  /**
   * Update hourly stats snapshot
   */
  async updateStatsSnapshot(): Promise<void> {
    const now = new Date();
    // Round down to the hour
    const hourTimestamp = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      0,
      0,
      0
    );
    const oneHourAgo = new Date(hourTimestamp.getTime() - 3600000);

    // Aggregate stats for the past hour
    const [hourStats] = await this.db
      .select({
        totalRequests: count(),
        totalTokensIn: sum(traces.totalTokensIn),
        totalTokensOut: sum(traces.totalTokensOut),
        totalCost: sum(traces.totalCost),
        averageLatency: avg(traces.duration),
        errorCount: count(sql`CASE WHEN ${traces.status} = 'error' THEN 1 END`),
      })
      .from(traces)
      .where(
        and(
          eq(traces.projectId, this.projectId),
          gte(traces.startTime, oneHourAgo),
          sql`${traces.startTime} < ${hourTimestamp}`
        )
      );

    if (!hourStats || Number(hourStats.totalRequests) === 0) {
      return; // No data to snapshot
    }

    const snapshotId = `snap_${this.projectId}_${hourTimestamp.getTime()}`;

    const snapshot: NewStatsSnapshot = {
      id: snapshotId,
      projectId: this.projectId,
      timestamp: hourTimestamp,
      totalRequests: Number(hourStats.totalRequests) || 0,
      totalTokensIn: Number(hourStats.totalTokensIn) || 0,
      totalTokensOut: Number(hourStats.totalTokensOut) || 0,
      totalCost: String(Number(hourStats.totalCost) || 0),
      averageLatency: Number(hourStats.averageLatency) || 0,
      errorCount: Number(hourStats.errorCount) || 0,
    };

    // Upsert the snapshot
    await this.db
      .insert(statsSnapshots)
      .values(snapshot)
      .onConflictDoUpdate({
        target: [statsSnapshots.projectId, statsSnapshots.timestamp],
        set: {
          totalRequests: snapshot.totalRequests,
          totalTokensIn: snapshot.totalTokensIn,
          totalTokensOut: snapshot.totalTokensOut,
          totalCost: snapshot.totalCost,
          averageLatency: snapshot.averageLatency,
          errorCount: snapshot.errorCount,
        },
      });
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async traceToTraceInfo(
    trace: Trace,
    includeChildren = false
  ): Promise<TraceInfo> {
    let events: TraceEvent[] = [];
    let children: TraceInfo[] = [];

    if (includeChildren) {
      // Get all spans for this trace
      const traceSpans = await this.db
        .select()
        .from(spans)
        .where(eq(spans.traceId, trace.traceId))
        .orderBy(spans.startTime);

      // Get all events for these spans
      const spanIds = traceSpans.map((s) => s.spanId);
      if (spanIds.length > 0) {
        const allEvents = await this.db
          .select()
          .from(spanEvents)
          .where(inArray(spanEvents.spanId, spanIds));

        // Build span-to-events map
        const spanEventsMap = new Map<string, SpanEvent[]>();
        for (const event of allEvents) {
          const existing = spanEventsMap.get(event.spanId) || [];
          existing.push(event);
          spanEventsMap.set(event.spanId, existing);
        }

        // Build parent-to-children map
        const childrenMap = new Map<string | null, Span[]>();
        for (const span of traceSpans) {
          const existing = childrenMap.get(span.parentId) || [];
          existing.push(span);
          childrenMap.set(span.parentId, existing);
        }

        // Convert spans to TraceInfo recursively
        const spanToTraceInfo = (span: Span): TraceInfo => {
          const spanEvts = spanEventsMap.get(span.spanId) || [];
          const childSpans = childrenMap.get(span.spanId) || [];

          const status =
            span.status === 'ok'
              ? 'ok'
              : span.status === 'error'
                ? 'error'
                : 'pending';

          return {
            id: span.spanId,
            name: span.name,
            startTime: span.startTime.getTime(),
            endTime: span.endTime?.getTime(),
            durationMs: span.duration ?? undefined,
            status,
            attributes: (span.attributes as Record<string, unknown>) || {},
            events: spanEvts.map((e) => ({
              name: e.name,
              timestamp: e.timestamp.getTime(),
              attributes: (e.attributes as Record<string, unknown>) || {},
            })),
            children: childSpans.map(spanToTraceInfo),
          };
        };

        // Get root-level spans (those with parentId = null or directly under trace)
        const rootSpans = childrenMap.get(null) || [];
        children = rootSpans.map(spanToTraceInfo);

        // Collect trace-level events from root spans
        for (const span of rootSpans) {
          const spanEvts = spanEventsMap.get(span.spanId) || [];
          events.push(
            ...spanEvts.map((e) => ({
              name: e.name,
              timestamp: e.timestamp.getTime(),
              attributes: (e.attributes as Record<string, unknown>) || {},
            }))
          );
        }
      }
    }

    const status =
      trace.status === 'ok'
        ? 'ok'
        : trace.status === 'error'
          ? 'error'
          : 'pending';

    return {
      id: trace.traceId,
      name: trace.name || 'unnamed',
      startTime: trace.startTime.getTime(),
      endTime: trace.endTime?.getTime(),
      durationMs: trace.duration ?? undefined,
      status,
      attributes: (trace.attributes as Record<string, unknown>) || {},
      events,
      children,
    };
  }

  private traceToRecentRequest(trace: Trace): RecentRequest {
    return {
      timestamp: trace.startTime.getTime(),
      traceId: trace.traceId,
      provider: trace.provider || 'unknown',
      model: trace.model || 'unknown',
      tokens: {
        input: trace.totalTokensIn || 0,
        output: trace.totalTokensOut || 0,
      },
      cost: Number(trace.totalCost) || 0,
      latencyMs: trace.duration || 0,
      status: trace.status === 'error' ? 'error' : 'ok',
    };
  }

  private startPolling(): void {
    if (this.pollInterval) {
      return;
    }

    this.pollInterval = setInterval(async () => {
      try {
        await this.pollForUpdates();
      } catch (error) {
        console.error('PostgresConnector polling error:', error);
      }
    }, 2000);
  }

  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async pollForUpdates(): Promise<void> {
    // Check for new traces since last poll
    const whereClause = this.lastTraceTime
      ? and(
          eq(traces.projectId, this.projectId),
          gt(traces.startTime, this.lastTraceTime)
        )
      : eq(traces.projectId, this.projectId);

    const newTraces = await this.db
      .select()
      .from(traces)
      .where(whereClause)
      .orderBy(desc(traces.startTime))
      .limit(10);

    if (newTraces.length > 0) {
      // Update last trace time
      this.lastTraceTime = newTraces[0].startTime;

      // Emit trace events
      for (const trace of newTraces.reverse()) {
        const traceInfo = await this.traceToTraceInfo(trace);
        this.emit({ type: 'trace', data: traceInfo });

        // Also emit as recent request
        const request = this.traceToRecentRequest(trace);
        this.emit({ type: 'request', data: request });
      }

      // Emit updated stats
      const stats = await this.getStats();
      this.emit({ type: 'stats', data: stats });

      // Emit updated health
      const health = await this.getProviderHealth();
      this.emit({ type: 'health', data: health });
    }
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
}
