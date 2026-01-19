/**
 * Dashboard Connector Types
 * Interfaces for connecting the dashboard to Orchestra instances
 */

import type { OrchestraStats } from 'llm-orchestra';

export interface ProviderHealth {
  name: string;
  available: boolean;
  lastChecked: number;
  avgLatencyMs?: number;
}

export interface TraceInfo {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  status: 'ok' | 'error' | 'pending';
  attributes: Record<string, unknown>;
  events: TraceEvent[];
  children: TraceInfo[];
}

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, unknown>;
}

export interface DashboardStats extends OrchestraStats {
  uptime: number;
  requestsPerMinute: number;
  activeProviders: string[];
}

export interface RecentRequest {
  timestamp: number;
  traceId: string;
  provider: string;
  model: string;
  tokens: { input: number; output: number };
  cost: number;
  latencyMs: number;
  status: 'ok' | 'error';
}

export interface DashboardConnector {
  getStats(): Promise<DashboardStats>;
  getTraces(options?: { limit?: number; offset?: number }): Promise<TraceInfo[]>;
  getTrace(traceId: string): Promise<TraceInfo | undefined>;
  getProviderHealth(): Promise<ProviderHealth[]>;
  getRecentRequests(limit?: number): Promise<RecentRequest[]>;
  subscribe(callback: (event: DashboardEvent) => void): () => void;
}

export type DashboardEvent =
  | { type: 'stats'; data: DashboardStats }
  | { type: 'request'; data: RecentRequest }
  | { type: 'trace'; data: TraceInfo }
  | { type: 'health'; data: ProviderHealth[] };
