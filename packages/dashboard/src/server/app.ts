/**
 * Dashboard Server
 * Hono-based web server for the LLM Orchestra dashboard
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { DashboardConnector } from '../connectors/types.js';
import { createApiRoutes } from './routes/api.js';
import { createSseRoutes } from './routes/sse.js';
import { createPageRoutes } from './routes/pages.js';

export interface DashboardServerOptions {
  port?: number;
  hostname?: string;
  open?: boolean;
}

export interface DashboardServer {
  app: Hono;
  start(): Promise<void>;
  stop(): Promise<void>;
  port: number;
}

export function createDashboardServer(
  connector: DashboardConnector,
  options: DashboardServerOptions = {}
): DashboardServer {
  const port = options.port ?? 3737;
  const hostname = options.hostname ?? 'localhost';
  const app = new Hono();
  let server: ReturnType<typeof serve> | null = null;

  // Middleware
  app.use('*', logger());
  app.use('/api/*', cors());

  // Mount routes
  app.route('/api', createApiRoutes(connector));
  app.route('/api', createSseRoutes(connector));
  app.route('/', createPageRoutes(connector));

  return {
    app,
    port,
    async start() {
      return new Promise((resolve) => {
        server = serve(
          {
            fetch: app.fetch,
            port,
            hostname,
          },
          (info) => {
            console.log(`\n🎭 LLM Orchestra Dashboard running at http://${hostname}:${info.port}\n`);
            
            if (options.open) {
              import('open').then((m) => m.default(`http://${hostname}:${info.port}`));
            }
            
            resolve();
          }
        );
      });
    },
    async stop() {
      if (server) {
        server.close();
        server = null;
      }
    },
  };
}

// Standalone server entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  // This is for testing without an Orchestra instance
  const MockConnector: DashboardConnector = {
    async getStats() {
      return {
        totalRequests: 0,
        totalTokens: { input: 0, output: 0 },
        totalCost: 0,
        byProvider: {},
        byModel: {},
        uptime: Date.now() - performance.now(),
        requestsPerMinute: 0,
        activeProviders: [],
      };
    },
    async getTraces() {
      return [];
    },
    async getTrace() {
      return undefined;
    },
    async getProviderHealth() {
      return [];
    },
    async getRecentRequests() {
      return [];
    },
    subscribe() {
      return () => {};
    },
  };

  const server = createDashboardServer(MockConnector, { open: true });
  server.start();
}
