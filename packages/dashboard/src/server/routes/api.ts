/**
 * REST API endpoints for the dashboard
 */

import { Hono } from 'hono';
import type { DashboardConnector, TraceQueryOptions } from '../../connectors/types.js';

export function createApiRoutes(connector: DashboardConnector): Hono {
  const api = new Hono();

  // GET /api/stats - Get usage statistics
  api.get('/stats', async (c) => {
    try {
      const stats = await connector.getStats();
      return c.json(stats);
    } catch (error) {
      return c.json({ error: 'Failed to fetch stats' }, 500);
    }
  });

  // GET /api/traces - List traces with optional filtering
  api.get('/traces', async (c) => {
    try {
      // Parse and validate numeric parameters
      const limitRaw = parseInt(c.req.query('limit') || '50', 10);
      const offsetRaw = parseInt(c.req.query('offset') || '0', 10);
      const startTimeRaw = c.req.query('startTime')
        ? parseInt(c.req.query('startTime')!, 10)
        : undefined;
      const endTimeRaw = c.req.query('endTime')
        ? parseInt(c.req.query('endTime')!, 10)
        : undefined;

      // Validate status parameter
      const rawStatus = c.req.query('status');
      const status = rawStatus === 'ok' || rawStatus === 'error' ? rawStatus : undefined;

      const options: TraceQueryOptions = {
        limit: Number.isNaN(limitRaw) ? 50 : Math.min(Math.max(limitRaw, 1), 100),
        offset: Number.isNaN(offsetRaw) ? 0 : Math.max(offsetRaw, 0),
        status,
        provider: c.req.query('provider'),
        model: c.req.query('model'),
        startTime: startTimeRaw !== undefined && !Number.isNaN(startTimeRaw)
          ? startTimeRaw
          : undefined,
        endTime: endTimeRaw !== undefined && !Number.isNaN(endTimeRaw)
          ? endTimeRaw
          : undefined,
      };

      const traces = await connector.getTraces(options);
      return c.json({ traces, count: traces.length });
    } catch (error) {
      return c.json({ error: 'Failed to fetch traces' }, 500);
    }
  });

  // GET /api/traces/:id - Get trace detail
  api.get('/traces/:id', async (c) => {
    try {
      const traceId = c.req.param('id');
      const detail = await connector.getTraceDetail(traceId);

      if (!detail) {
        return c.json({ error: 'Trace not found' }, 404);
      }

      return c.json(detail);
    } catch (error) {
      return c.json({ error: 'Failed to fetch trace detail' }, 500);
    }
  });

  // GET /api/health - Provider health status
  api.get('/health', async (c) => {
    try {
      const health = await connector.getProviderHealth();
      return c.json({ providers: health, timestamp: Date.now() });
    } catch (error) {
      return c.json({ error: 'Failed to fetch health' }, 500);
    }
  });

  return api;
}
