/**
 * Pages Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createPageRoutes } from '../src/server/routes/pages.js';
import type {
  DashboardConnector,
  DashboardStats,
  TraceInfo,
  ProviderHealth,
  RecentRequest,
} from '../src/connectors/types.js';

// Mock connector factory
function createMockConnector(overrides: Partial<DashboardConnector> = {}): DashboardConnector {
  const mockStats: DashboardStats = {
    totalRequests: 100,
    totalTokens: { input: 5000, output: 3000 },
    totalCost: 1.5,
    byProvider: {
      anthropic: {
        requests: 60,
        tokens: { input: 3000, output: 1800 },
        cost: 1.0,
        avgLatencyMs: 500,
      },
      openai: {
        requests: 40,
        tokens: { input: 2000, output: 1200 },
        cost: 0.5,
        avgLatencyMs: 400,
      },
    },
    byModel: {
      'claude-3-opus': {
        requests: 60,
        tokens: { input: 3000, output: 1800 },
        cost: 1.0,
      },
      'gpt-4': {
        requests: 40,
        tokens: { input: 2000, output: 1200 },
        cost: 0.5,
      },
    },
    uptime: 3600000, // 1 hour
    requestsPerMinute: 10,
    activeProviders: ['anthropic', 'openai'],
  };

  const mockTraces: TraceInfo[] = [
    {
      id: 'trace-001',
      name: 'test-trace',
      startTime: Date.now() - 1000,
      endTime: Date.now(),
      durationMs: 1000,
      status: 'ok',
      attributes: { model: 'claude-3-opus', provider: 'anthropic' },
      events: [
        { name: 'request_start', timestamp: Date.now() - 1000, attributes: {} },
        { name: 'request_end', timestamp: Date.now(), attributes: {} },
      ],
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
      traceId: 'trace-001',
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
    ...overrides,
  };
}

describe('Pages Routes', () => {
  let app: Hono;
  let connector: DashboardConnector;

  beforeEach(() => {
    connector = createMockConnector();
    app = new Hono();
    app.route('/', createPageRoutes(connector));
  });

  describe('GET / (Overview)', () => {
    it('should_return200_when_requested', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
    });

    it('should_returnHtmlContentType_when_requested', async () => {
      const res = await app.request('/');
      expect(res.headers.get('content-type')).toContain('text/html');
    });

    it('should_includeStatsInPage_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('100'); // totalRequests
      expect(html).toContain('$1.5000'); // totalCost
      expect(html).toContain('8,000'); // total tokens (5000 + 3000)
    });

    it('should_includeHealthStatus_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('anthropic');
      expect(html).toContain('OK');
    });

    it('should_includeRecentRequests_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('claude-3-opus');
      expect(html).toContain('$0.0100');
      expect(html).toContain('500ms');
    });

    it('should_callConnectorMethods_when_rendered', async () => {
      await app.request('/');

      expect(connector.getStats).toHaveBeenCalled();
      expect(connector.getProviderHealth).toHaveBeenCalled();
      expect(connector.getRecentRequests).toHaveBeenCalledWith(10);
    });

    it('should_showNoRequestsMessage_when_empty', async () => {
      connector = createMockConnector({
        getRecentRequests: vi.fn().mockResolvedValue([]),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('No requests yet');
    });
  });

  describe('GET /traces', () => {
    it('should_return200_when_requested', async () => {
      const res = await app.request('/traces');
      expect(res.status).toBe(200);
    });

    it('should_includeTraceList_when_rendered', async () => {
      const res = await app.request('/traces');
      const html = await res.text();

      expect(html).toContain('trace-001');
      expect(html).toContain('test-trace');
      expect(html).toContain('1000ms');
    });

    it('should_callGetTracesWithLimit_when_rendered', async () => {
      await app.request('/traces');
      // Fetches more traces (100) to allow for client-side filtering
      expect(connector.getTraces).toHaveBeenCalledWith({ limit: 100 });
    });

    it('should_showNoTracesMessage_when_empty', async () => {
      connector = createMockConnector({
        getTraces: vi.fn().mockResolvedValue([]),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/traces');
      const html = await res.text();

      expect(html).toContain('No traces found');
    });

    it('should_includeTraceStatus_when_rendered', async () => {
      const res = await app.request('/traces');
      const html = await res.text();

      expect(html).toContain('status-ok');
    });
  });

  describe('GET /traces/:id', () => {
    it('should_return200_when_traceFound', async () => {
      const res = await app.request('/traces/trace-001');
      expect(res.status).toBe(200);
    });

    it('should_return404_when_traceNotFound', async () => {
      const res = await app.request('/traces/nonexistent');
      expect(res.status).toBe(404);
    });

    it('should_includeTraceDetails_when_found', async () => {
      const res = await app.request('/traces/trace-001');
      const html = await res.text();

      expect(html).toContain('trace-001');
      expect(html).toContain('test-trace');
      expect(html).toContain('1000ms');
    });

    it('should_includeAttributes_when_present', async () => {
      const res = await app.request('/traces/trace-001');
      const html = await res.text();

      expect(html).toContain('claude-3-opus');
      expect(html).toContain('anthropic');
    });

    it('should_includeEvents_when_present', async () => {
      const res = await app.request('/traces/trace-001');
      const html = await res.text();

      expect(html).toContain('request_start');
      expect(html).toContain('request_end');
    });

    it('should_showNotFoundMessage_when_missing', async () => {
      const res = await app.request('/traces/nonexistent');
      const html = await res.text();

      expect(html).toContain('Trace Not Found');
    });

    it('should_includeBackLink_when_rendered', async () => {
      const res = await app.request('/traces/trace-001');
      const html = await res.text();

      expect(html).toContain('href="/traces"');
      expect(html).toContain('Back to Traces');
    });
  });

  describe('GET /costs', () => {
    it('should_return200_when_requested', async () => {
      const res = await app.request('/costs');
      expect(res.status).toBe(200);
    });

    it('should_includeTotalCost_when_rendered', async () => {
      const res = await app.request('/costs');
      const html = await res.text();

      expect(html).toContain('$1.5000');
    });

    it('should_includeTokenBreakdown_when_rendered', async () => {
      const res = await app.request('/costs');
      const html = await res.text();

      expect(html).toContain('5,000'); // input tokens
      expect(html).toContain('3,000'); // output tokens
    });

    it('should_includeProviderBreakdown_when_rendered', async () => {
      const res = await app.request('/costs');
      const html = await res.text();

      expect(html).toContain('anthropic');
      expect(html).toContain('openai');
      expect(html).toContain('$1.0000');
      expect(html).toContain('$0.5000');
    });

    it('should_includeModelBreakdown_when_rendered', async () => {
      const res = await app.request('/costs');
      const html = await res.text();

      expect(html).toContain('claude-3-opus');
      expect(html).toContain('gpt-4');
    });

    it('should_showNoDataMessage_when_emptyProviders', async () => {
      connector = createMockConnector({
        getStats: vi.fn().mockResolvedValue({
          totalRequests: 0,
          totalTokens: { input: 0, output: 0 },
          totalCost: 0,
          byProvider: {},
          byModel: {},
          uptime: 0,
          requestsPerMinute: 0,
          activeProviders: [],
        }),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/costs');
      const html = await res.text();

      expect(html).toContain('No data yet');
    });
  });

  describe('GET /health', () => {
    it('should_return200_when_requested', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
    });

    it('should_includeProviderStatus_when_rendered', async () => {
      const res = await app.request('/health');
      const html = await res.text();

      expect(html).toContain('anthropic');
      expect(html).toContain('openai');
      expect(html).toContain('Available');
      expect(html).toContain('Unavailable');
    });

    it('should_includeLatency_when_available', async () => {
      const res = await app.request('/health');
      const html = await res.text();

      expect(html).toContain('500ms');
    });

    it('should_showNoProvidersMessage_when_empty', async () => {
      connector = createMockConnector({
        getProviderHealth: vi.fn().mockResolvedValue([]),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/health');
      const html = await res.text();

      expect(html).toContain('No providers configured');
    });

    it('should_includeRequestCounts_when_available', async () => {
      const res = await app.request('/health');
      const html = await res.text();

      expect(html).toContain('60'); // anthropic requests
      expect(html).toContain('40'); // openai requests
    });
  });

  describe('createPageRoutes', () => {
    it('should_returnHonoInstance_when_called', () => {
      const routes = createPageRoutes(connector);
      expect(routes).toBeInstanceOf(Hono);
    });

    it('should_acceptConnector_when_created', () => {
      const customConnector = createMockConnector();
      const routes = createPageRoutes(customConnector);
      expect(routes).toBeDefined();
    });
  });

  describe('Layout and Navigation', () => {
    it('should_includeNavigation_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('href="/"');
      expect(html).toContain('href="/traces"');
      expect(html).toContain('href="/costs"');
      expect(html).toContain('href="/health"');
    });

    it('should_includeTitle_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('<title>');
      expect(html).toContain('LLM Orchestra Dashboard');
    });

    it('should_includePicoCSS_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('pico');
    });

    it('should_includeChartJS_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('chart.js');
    });

    it('should_includeSSEScript_when_rendered', async () => {
      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('EventSource');
      expect(html).toContain('/api/events');
    });
  });

  describe('Uptime Formatting', () => {
    it('should_formatSeconds_when_uptimeLessThanMinute', async () => {
      connector = createMockConnector({
        getStats: vi.fn().mockResolvedValue({
          totalRequests: 0,
          totalTokens: { input: 0, output: 0 },
          totalCost: 0,
          byProvider: {},
          byModel: {},
          uptime: 45000, // 45 seconds
          requestsPerMinute: 0,
          activeProviders: [],
        }),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('45s');
    });

    it('should_formatMinutes_when_uptimeLessThanHour', async () => {
      connector = createMockConnector({
        getStats: vi.fn().mockResolvedValue({
          totalRequests: 0,
          totalTokens: { input: 0, output: 0 },
          totalCost: 0,
          byProvider: {},
          byModel: {},
          uptime: 300000, // 5 minutes
          requestsPerMinute: 0,
          activeProviders: [],
        }),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('5m');
    });

    it('should_formatHours_when_uptimeLessThanDay', async () => {
      connector = createMockConnector({
        getStats: vi.fn().mockResolvedValue({
          totalRequests: 0,
          totalTokens: { input: 0, output: 0 },
          totalCost: 0,
          byProvider: {},
          byModel: {},
          uptime: 7200000, // 2 hours
          requestsPerMinute: 0,
          activeProviders: [],
        }),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('2h');
    });

    it('should_formatDays_when_uptimeMoreThanDay', async () => {
      connector = createMockConnector({
        getStats: vi.fn().mockResolvedValue({
          totalRequests: 0,
          totalTokens: { input: 0, output: 0 },
          totalCost: 0,
          byProvider: {},
          byModel: {},
          uptime: 90000000, // > 1 day
          requestsPerMinute: 0,
          activeProviders: [],
        }),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/');
      const html = await res.text();

      expect(html).toContain('d');
    });
  });

  describe('XSS Protection', () => {
    it('should_escapeProviderNames_when_rendered', async () => {
      connector = createMockConnector({
        getProviderHealth: vi.fn().mockResolvedValue([
          { name: '<script>alert("xss")</script>', available: true, lastChecked: Date.now() },
        ]),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/health');
      const html = await res.text();

      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should_escapeTraceNames_when_rendered', async () => {
      connector = createMockConnector({
        getTraces: vi.fn().mockResolvedValue([
          {
            id: 'trace-xss',
            name: '<img src=x onerror=alert(1)>',
            startTime: Date.now(),
            status: 'ok',
            attributes: {},
            events: [],
            children: [],
          },
        ]),
      });
      app = new Hono();
      app.route('/', createPageRoutes(connector));

      const res = await app.request('/traces');
      const html = await res.text();

      expect(html).not.toContain('<img src=x onerror=alert(1)>');
      expect(html).toContain('&lt;img');
    });
  });
});
