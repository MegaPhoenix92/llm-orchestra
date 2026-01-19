/**
 * API Routes
 * REST endpoints for dashboard data
 */

import { Hono } from 'hono';
import type { DashboardConnector } from '../../connectors/types.js';

export function createApiRoutes(connector: DashboardConnector): Hono {
  const api = new Hono();

  // GET /api/stats - Get current statistics
  api.get('/stats', async (c) => {
    const stats = await connector.getStats();
    return c.json(stats);
  });

  // GET /api/traces - List traces with pagination
  api.get('/traces', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const traces = await connector.getTraces({ limit, offset });
    return c.json({ traces, limit, offset });
  });

  // GET /api/traces/:id - Get single trace detail
  api.get('/traces/:id', async (c) => {
    const id = c.req.param('id');
    const trace = await connector.getTrace(id);
    if (!trace) {
      return c.json({ error: 'Trace not found' }, 404);
    }
    return c.json(trace);
  });

  // GET /api/health - Provider health status
  api.get('/health', async (c) => {
    const health = await connector.getProviderHealth();
    return c.json({ providers: health });
  });

  // GET /api/requests - Recent requests
  api.get('/requests', async (c) => {
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const requests = await connector.getRecentRequests(limit);
    return c.json({ requests });
  });

  return api;
}
