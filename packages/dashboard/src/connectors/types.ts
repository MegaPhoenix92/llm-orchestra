/**
 * Shared types for dashboard connectors
 */

import type { SpanData } from 'llm-orchestra';

export interface DashboardStats {
  totalRequests: number;
  totalTokens: { input: number; output: number };
  totalCost: number;
  byProvider: Record<string, ProviderStats>;
  byModel: Record<string, ModelStats>;
}

export interface ProviderStats {
  requests: number;
  tokens: { input: number; output: number };
  cost: number;
  avgLatencyMs: number;
}

export interface ModelStats {
  requests: number;
  tokens: { input: number; output: number };
  cost: number;
}

export interface ProviderHealth {
  name: string;
  available: boolean;
  lastChecked: number;
  failoverCount: number;
  avgLatencyMs: number;
}

export interface TraceListItem {
  traceId: string;
  name: string;
  startTime: number;
  duration: number;
  status: 'ok' | 'error' | 'unset';
  provider?: string;
  model?: string;
  tokens?: { input: number; output: number };
  cost?: number;
  spanCount?: number;
}

export interface TraceDetail {
  traceId: string;
  spans: SpanData[];
  totalDuration: number;
  rootSpan: SpanData;
}

export interface DashboardConnector {
  getStats(): Promise<DashboardStats>;
  getTraces(options?: TraceQueryOptions): Promise<TraceListItem[]>;
  getTraceDetail(traceId: string): Promise<TraceDetail | null>;
  getProviderHealth(): Promise<ProviderHealth[]>;
  subscribe(callback: (event: DashboardEvent) => void): () => void;
  /**
   * Optional cleanup method called when the dashboard is stopped.
   * Implement this if your connector has resources that need cleanup
   * (e.g., polling intervals, open connections, file handles).
   */
  shutdown?: () => void;
}

export interface TraceQueryOptions {
  limit?: number;
  offset?: number;
  status?: 'ok' | 'error';
  provider?: string;
  model?: string;
  startTime?: number;
  endTime?: number;
}

export type DashboardEventType = 'stats_update' | 'new_trace' | 'health_change';

export interface DashboardEvent {
  type: DashboardEventType;
  timestamp: number;
  data: unknown;
}

export interface DashboardConfig {
  port: number;
  host?: string;
  open?: boolean;
  traceBufferSize?: number;
  retentionMs?: number;
}
