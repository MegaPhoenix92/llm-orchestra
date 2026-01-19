/**
 * LLM Orchestra Dashboard
 * Local observability dashboard for LLM Orchestra
 */

import type { Orchestra } from 'llm-orchestra';
import { MemoryConnector } from './connectors/memory.js';
import { createDashboardServer, type DashboardServer, type DashboardServerOptions } from './server/app.js';

export interface AttachDashboardOptions extends DashboardServerOptions {
  /** Maximum number of traces to keep */
  maxTraces?: number;
  /** Maximum number of recent requests to keep */
  maxRecentRequests?: number;
}

export interface AttachedDashboard {
  /** The underlying Hono app */
  app: DashboardServer['app'];
  /** Port the dashboard is running on */
  port: number;
  /** Stop the dashboard server */
  stop(): Promise<void>;
  /** Record a request (must be called manually for now) */
  recordRequest(request: {
    traceId: string;
    provider: string;
    model: string;
    tokens: { input: number; output: number };
    cost: number;
    latencyMs: number;
    status: 'ok' | 'error';
  }): void;
}

/**
 * Attach a dashboard to an Orchestra instance
 * 
 * @example
 * ```ts
 * import { Orchestra } from 'llm-orchestra';
 * import { attachDashboard } from '@llm-orchestra/dashboard';
 * 
 * const orchestra = new Orchestra({ providers: { ... } });
 * const dashboard = await attachDashboard(orchestra, { port: 3737, open: true });
 * 
 * // Dashboard is now available at http://localhost:3737
 * 
 * // Stop when done
 * await dashboard.stop();
 * ```
 */
export async function attachDashboard(
  orchestra: Orchestra,
  options: AttachDashboardOptions = {}
): Promise<AttachedDashboard> {
  const connector = new MemoryConnector(orchestra, {
    maxTraces: options.maxTraces,
    maxRecentRequests: options.maxRecentRequests,
  });

  const server = createDashboardServer(connector, options);
  await server.start();

  return {
    app: server.app,
    port: server.port,
    stop: () => server.stop(),
    recordRequest: (request) => {
      connector.recordRequest({
        timestamp: Date.now(),
        ...request,
      });
    },
  };
}

// Re-export types and utilities
export type { DashboardConnector, DashboardStats, TraceInfo, ProviderHealth, RecentRequest } from './connectors/types.js';
export { MemoryConnector } from './connectors/memory.js';
export { createDashboardServer } from './server/app.js';
export type { DashboardServerOptions, DashboardServer } from './server/app.js';
