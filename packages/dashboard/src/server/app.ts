/**
 * Main Hono app for the dashboard server
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import type { Orchestra } from 'llm-orchestra';
import { MemoryConnector } from '../connectors/memory.js';
import type { DashboardConfig, DashboardConnector } from '../connectors/types.js';
import { createApiRoutes } from './routes/api.js';
import { createSSERoutes } from './routes/sse.js';
import { createPageRoutes } from './routes/pages.js';

export interface DashboardServer {
  app: Hono;
  connector: DashboardConnector;
  start(): Promise<void>;
  stop(): void;
  getUrl(): string;
}

function normalizeConfig(config: Partial<DashboardConfig>): DashboardConfig {
  return {
    port: config.port ?? 3737,
    host: config.host ?? '0.0.0.0',
    open: config.open ?? false,
    traceBufferSize: config.traceBufferSize ?? 100,
    retentionMs: config.retentionMs ?? 3600000, // 1 hour
  };
}

export function createDashboardApp(connector: DashboardConnector): Hono {
  const app = new Hono();

  // Middleware
  app.use('*', logger());
  app.use('/api/*', cors());

  // Mount routes
  const api = createApiRoutes(connector);
  const sse = createSSERoutes(connector);
  const pages = createPageRoutes(connector);

  app.route('/api', api);
  app.route('/api', sse);
  app.route('/', pages);

  return app;
}

export function createDashboardServerWithConnector(
  connector: DashboardConnector,
  config: Partial<DashboardConfig> = {}
): DashboardServer {
  const fullConfig = normalizeConfig(config);
  const app = createDashboardApp(connector);
  let server: ReturnType<typeof serve> | null = null;

  return {
    app,
    connector,
    async start() {
      server = serve({
        fetch: app.fetch,
        port: fullConfig.port,
        hostname: fullConfig.host,
      });

      const url = `http://localhost:${fullConfig.port}`;
      console.log(`🎼 LLM Orchestra Dashboard running at ${url}`);

      if (fullConfig.open) {
        const open = await import('open');
        await open.default(url);
      }
    },
    stop() {
      if (server) {
        server.close();
        server = null;
      }
      connector.shutdown?.();
    },
    getUrl() {
      return `http://localhost:${fullConfig.port}`;
    },
  };
}

export function createDashboardServer(
  orchestra: Orchestra,
  config: Partial<DashboardConfig> = {}
): DashboardServer {
  const fullConfig = normalizeConfig(config);

  const connector = new MemoryConnector(orchestra, {
    traceBufferSize: fullConfig.traceBufferSize,
    retentionMs: fullConfig.retentionMs,
  });

  return createDashboardServerWithConnector(connector, fullConfig);
}

/**
 * Attach a dashboard to an Orchestra instance
 * This is the main entry point for embedding the dashboard
 */
export function attachDashboard(
  orchestra: Orchestra,
  config: Partial<DashboardConfig> = {}
): DashboardServer {
  const server = createDashboardServer(orchestra, config);
  server.start();
  return server;
}
