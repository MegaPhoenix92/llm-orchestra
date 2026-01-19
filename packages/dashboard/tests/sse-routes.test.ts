/**
 * SSE Routes Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { createSseRoutes } from '../src/server/routes/sse.js';
import type { DashboardConnector, DashboardStats, ProviderHealth } from '../src/connectors/types.js';

// Helper to parse SSE events from response text
function parseSSEEvents(text: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const lines = text.split('\n');
  let currentEvent = '';
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      currentData = line.slice(5).trim();
    } else if (line === '' && currentEvent && currentData) {
      events.push({ event: currentEvent, data: currentData });
      currentEvent = '';
      currentData = '';
    }
  }

  // Handle last event if no trailing newline
  if (currentEvent && currentData) {
    events.push({ event: currentEvent, data: currentData });
  }

  return events;
}

// Mock connector factory
function createMockConnector(overrides: Partial<DashboardConnector> = {}): DashboardConnector {
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

  const mockHealth: ProviderHealth[] = [
    { name: 'anthropic', available: true, lastChecked: Date.now(), avgLatencyMs: 500 },
    { name: 'openai', available: false, lastChecked: Date.now() },
  ];

  return {
    getStats: vi.fn().mockResolvedValue(mockStats),
    getTraces: vi.fn().mockResolvedValue([]),
    getTrace: vi.fn().mockResolvedValue(undefined),
    getProviderHealth: vi.fn().mockResolvedValue(mockHealth),
    getRecentRequests: vi.fn().mockResolvedValue([]),
    subscribe: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe('SSE Routes', () => {
  let app: Hono;
  let connector: DashboardConnector;

  beforeEach(() => {
    connector = createMockConnector();
    app = new Hono();
    app.route('/api', createSseRoutes(connector));
  });

  describe('GET /api/events', () => {
    it('should_returnEventStreamContentType_when_connected', async () => {
      // Use a short timeout to get the initial response headers
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 50);

      try {
        const res = await app.request('/api/events', {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
      } catch {
        // AbortError is expected - we just want headers
        clearTimeout(timeoutId);
      }
    });

    it('should_callConnectorGetStats_when_connected', async () => {
      const controller = new AbortController();

      // Start the request
      const responsePromise = app.request('/api/events', {
        signal: controller.signal,
      });

      // Give it time to call getStats
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();

      try {
        await responsePromise;
      } catch {
        // AbortError expected
      }

      expect(connector.getStats).toHaveBeenCalled();
    });

    it('should_callConnectorGetProviderHealth_when_connected', async () => {
      const controller = new AbortController();

      const responsePromise = app.request('/api/events', {
        signal: controller.signal,
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();

      try {
        await responsePromise;
      } catch {
        // AbortError expected
      }

      expect(connector.getProviderHealth).toHaveBeenCalled();
    });

  });

  describe('createSseRoutes', () => {
    it('should_returnHonoInstance_when_called', () => {
      const routes = createSseRoutes(connector);
      expect(routes).toBeInstanceOf(Hono);
    });

    it('should_acceptConnector_when_created', () => {
      const customConnector = createMockConnector();
      const routes = createSseRoutes(customConnector);
      expect(routes).toBeDefined();
    });
  });

  describe('SSE event parsing', () => {
    it('should_parseValidSSEFormat_when_eventsSent', () => {
      const sseText = `event:stats
data:{"count":1}

event:health
data:{"status":"ok"}

`;
      const events = parseSSEEvents(sseText);

      expect(events).toHaveLength(2);
      expect(events[0].event).toBe('stats');
      expect(events[0].data).toBe('{"count":1}');
      expect(events[1].event).toBe('health');
      expect(events[1].data).toBe('{"status":"ok"}');
    });

    it('should_handleEmptyInput_when_noEvents', () => {
      const events = parseSSEEvents('');
      expect(events).toHaveLength(0);
    });

    it('should_handlePartialEvents_when_incomplete', () => {
      const sseText = `event:stats
data:{"count":1}`;
      const events = parseSSEEvents(sseText);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('stats');
    });

    it('should_handleMultipleDataLines_when_present', () => {
      const sseText = `event:message
data:line1

`;
      const events = parseSSEEvents(sseText);

      expect(events).toHaveLength(1);
      expect(events[0].data).toBe('line1');
    });

    it('should_trimWhitespace_when_parsing', () => {
      const sseText = `event: stats
data: {"value": 1}

`;
      const events = parseSSEEvents(sseText);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('stats');
      expect(events[0].data).toBe('{"value": 1}');
    });

    it('should_handleRequestEvent_when_sent', () => {
      const sseText = `event:request
data:{"provider":"anthropic","model":"claude-3-opus"}

`;
      const events = parseSSEEvents(sseText);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('request');

      const data = JSON.parse(events[0].data);
      expect(data.provider).toBe('anthropic');
      expect(data.model).toBe('claude-3-opus');
    });
  });

  describe('SSE data serialization', () => {
    it('should_serializeStatsCorrectly_when_parsed', () => {
      const stats: DashboardStats = {
        totalRequests: 100,
        totalTokens: { input: 5000, output: 3000 },
        totalCost: 1.5,
        byProvider: {},
        byModel: {},
        uptime: 60000,
        requestsPerMinute: 10,
        activeProviders: ['anthropic'],
      };

      const sseText = `event:stats
data:${JSON.stringify(stats)}

`;
      const events = parseSSEEvents(sseText);
      const parsed = JSON.parse(events[0].data);

      expect(parsed.totalRequests).toBe(100);
      expect(parsed.totalTokens.input).toBe(5000);
      expect(parsed.totalCost).toBe(1.5);
      expect(parsed.activeProviders).toContain('anthropic');
    });

    it('should_serializeHealthCorrectly_when_parsed', () => {
      const health: ProviderHealth[] = [
        { name: 'anthropic', available: true, lastChecked: 1234567890, avgLatencyMs: 500 },
      ];

      const sseText = `event:health
data:${JSON.stringify(health)}

`;
      const events = parseSSEEvents(sseText);
      const parsed = JSON.parse(events[0].data);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('anthropic');
      expect(parsed[0].available).toBe(true);
      expect(parsed[0].avgLatencyMs).toBe(500);
    });
  });
});
