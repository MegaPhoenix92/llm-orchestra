/**
 * API Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createApiRoutes } from '../src/server/routes/api.js';
import type { DashboardConnector, DashboardStats, TraceInfo, ProviderHealth, RecentRequest } from '../src/connectors/types.js';

// Mock connector
function createMockConnector(): DashboardConnector {
  const mockStats: DashboardStats = {
    totalRequests: 100,
    totalTokens: { input: 5000, output: 3000 },
    totalCost: 1.5,
    byProvider: {},
    byModel: {},
    uptime: 60000,
    requestsPerMinute: 10,
    activeProviders: ['anthropic', 'openai'],
  };

  const mockTraces: TraceInfo[] = [
    {
      id: 'trace-1',
      name: 'test-trace',
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      durationMs: 1000,
      status: 'ok',
      attributes: { model: 'claude-3-opus' },
      events: [],
      children: [],
    },
  ];

  const mockHealth: ProviderHealth[] = [
    { name: 'anthropic', available: true, lastChecked: Date.now(), avgLatencyMs: 500 },
    { name: 'openai', available: false, lastChecked: Date.now() },
  ];

  const mockRequests: RecentRequest[] = [
    {
      timestamp: Date.now(),
      traceId: 'trace-1',
      provider: 'anthropic',
      model: 'claude-3-opus',
      tokens: { input: 100, output: 50 },
      cost: 0.01,
      latencyMs: 500,
      status: 'ok',
    },
  ];

  return {
    getStats: vi.fn().mockResolvedValue(mockStats),
    getTraces: vi.fn().mockResolvedValue(mockTraces),
    getTrace: vi.fn().mockImplementation((id: string) => {
      return Promise.resolve(mockTraces.find((t) => t.id === id));
    }),
    getProviderHealth: vi.fn().mockResolvedValue(mockHealth),
    getRecentRequests: vi.fn().mockResolvedValue(mockRequests),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('API Routes', () => {
  let app: Hono;
  let connector: DashboardConnector;

  beforeEach(() => {
    connector = createMockConnector();
    app = new Hono();
    app.route('/api', createApiRoutes(connector));
  });

  describe('GET /api/stats', () => {
    it('should_returnStats_when_called', async () => {
      const res = await app.request('/api/stats');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.totalRequests).toBe(100);
      expect(data.totalCost).toBe(1.5);
      expect(data.activeProviders).toEqual(['anthropic', 'openai']);
    });

    it('should_callConnectorGetStats_when_requested', async () => {
      await app.request('/api/stats');
      expect(connector.getStats).toHaveBeenCalled();
    });
  });

  describe('GET /api/traces', () => {
    it('should_returnTraces_when_called', async () => {
      const res = await app.request('/api/traces');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.traces).toHaveLength(1);
      expect(data.traces[0].name).toBe('test-trace');
    });

    it('should_passLimitToConnector_when_provided', async () => {
      await app.request('/api/traces?limit=10');
      expect(connector.getTraces).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });

    it('should_passOffsetToConnector_when_provided', async () => {
      await app.request('/api/traces?offset=5');
      expect(connector.getTraces).toHaveBeenCalledWith({ limit: 50, offset: 5 });
    });
  });

  describe('GET /api/traces/:id', () => {
    it('should_returnTrace_when_found', async () => {
      const res = await app.request('/api/traces/trace-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe('trace-1');
      expect(data.name).toBe('test-trace');
    });

    it('should_return404_when_notFound', async () => {
      const res = await app.request('/api/traces/nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/health', () => {
    it('should_returnProviderHealth_when_called', async () => {
      const res = await app.request('/api/health');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.providers).toHaveLength(2);
      expect(data.providers[0].name).toBe('anthropic');
      expect(data.providers[0].available).toBe(true);
      expect(data.providers[1].available).toBe(false);
    });
  });

  describe('GET /api/requests', () => {
    it('should_returnRecentRequests_when_called', async () => {
      const res = await app.request('/api/requests');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.requests).toHaveLength(1);
      expect(data.requests[0].provider).toBe('anthropic');
    });

    it('should_passLimitToConnector_when_provided', async () => {
      await app.request('/api/requests?limit=5');
      expect(connector.getRecentRequests).toHaveBeenCalledWith(5);
    });
  });
});
