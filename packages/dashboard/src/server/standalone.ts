/**
 * Standalone server entrypoint with mock data
 */

import { fileURLToPath } from 'url';
import type { DashboardServer } from './app.js';
import { createDashboardServerWithConnector } from './app.js';
import { MockConnector } from '../connectors/mock.js';
import type { DashboardConfig } from '../connectors/types.js';

export interface StandaloneConfig extends Partial<DashboardConfig> {
  emitIntervalMs?: number;
  initialTraceCount?: number;
}

export function createStandaloneServer(
  config: StandaloneConfig = {}
): DashboardServer {
  const connector = new MockConnector({
    traceBufferSize: config.traceBufferSize,
    retentionMs: config.retentionMs,
    emitIntervalMs: config.emitIntervalMs,
    initialTraceCount: config.initialTraceCount,
  });

  return createDashboardServerWithConnector(connector, config);
}

function isMainModule(): boolean {
  const currentFile = fileURLToPath(import.meta.url);
  return process.argv[1] === currentFile;
}

if (isMainModule()) {
  const portFromEnv = process.env.DASHBOARD_PORT
    ? Number.parseInt(process.env.DASHBOARD_PORT, 10)
    : NaN;
  const port = Number.isNaN(portFromEnv) ? 3737 : portFromEnv;
  const host = process.env.DASHBOARD_HOST ?? '0.0.0.0';
  const open = process.env.DASHBOARD_OPEN === 'true';
  const emitIntervalRaw = process.env.DASHBOARD_MOCK_INTERVAL_MS
    ? Number.parseInt(process.env.DASHBOARD_MOCK_INTERVAL_MS, 10)
    : NaN;
  const emitIntervalMs = Number.isNaN(emitIntervalRaw) ? undefined : emitIntervalRaw;

  const server = createStandaloneServer({
    port,
    host,
    open,
    emitIntervalMs,
  });

  void server.start();

  const shutdown = () => {
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
