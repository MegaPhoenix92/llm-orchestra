/**
 * Shared API utilities for CLI commands
 */

import type { DashboardStats, TraceListItem, TraceDetail, ProviderHealth } from '../../connectors/types.js';

export async function fetchStats(serverUrl: string): Promise<DashboardStats> {
  const response = await fetch(`${serverUrl}/api/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.statusText}`);
  }
  return response.json() as Promise<DashboardStats>;
}

export interface TracesResponse {
  traces: TraceListItem[];
  count: number;
}

export async function fetchTraces(
  serverUrl: string,
  options: { limit?: number; status?: string; provider?: string } = {}
): Promise<TracesResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.status) params.set('status', options.status);
  if (options.provider) params.set('provider', options.provider);

  const response = await fetch(`${serverUrl}/api/traces?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch traces: ${response.statusText}`);
  }
  return response.json() as Promise<TracesResponse>;
}

export async function fetchTraceDetail(
  serverUrl: string,
  traceId: string
): Promise<TraceDetail> {
  const response = await fetch(`${serverUrl}/api/traces/${traceId}`);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Trace not found: ${traceId}`);
    }
    throw new Error(`Failed to fetch trace: ${response.statusText}`);
  }
  return response.json() as Promise<TraceDetail>;
}

export interface HealthResponse {
  providers: ProviderHealth[];
  timestamp: number;
}

export async function fetchHealth(serverUrl: string): Promise<HealthResponse> {
  const response = await fetch(`${serverUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`Failed to fetch health: ${response.statusText}`);
  }
  return response.json() as Promise<HealthResponse>;
}
