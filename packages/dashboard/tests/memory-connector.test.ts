/**
 * MemoryConnector Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryConnector } from '../src/connectors/memory.js';
import type { Orchestra } from 'llm-orchestra';

// Mock Orchestra instance
function createMockOrchestra(overrides: Partial<Orchestra> = {}): Orchestra {
  return {
    getStats: vi.fn().mockReturnValue({
      totalRequests: 100,
      totalTokens: { input: 5000, output: 3000 },
      totalCost: 1.5,
      byProvider: {
        anthropic: {
          requests: 60,
          tokens: { input: 3000, output: 2000 },
          cost: 1.0,
          avgLatencyMs: 500,
        },
      },
      byModel: {
        'claude-3-opus': {
          requests: 60,
          tokens: { input: 3000, output: 2000 },
          cost: 1.0,
        },
      },
    }),
    getTraces: vi.fn().mockReturnValue([
      {
        context: { traceId: 'trace-1', spanId: 'span-1' },
        name: 'test-trace',
        startTime: Date.now() - 1000,
        endTime: Date.now(),
        status: 'ok',
        kind: 'client',
        attributes: { model: 'claude-3-opus' },
        events: [],
      },
      {
        context: { traceId: 'trace-2', spanId: 'span-2' },
        name: 'another-trace',
        startTime: Date.now() - 2000,
        endTime: Date.now() - 1000,
        status: 'error',
        kind: 'client',
        attributes: {},
        events: [{ name: 'error', timestamp: Date.now(), attributes: {} }],
      },
    ]),
    getProviders: vi.fn().mockReturnValue(['anthropic', 'openai']),
    isProviderAvailable: vi.fn().mockImplementation((name: string) => {
      return Promise.resolve(name === 'anthropic');
    }),
    ...overrides,
  } as unknown as Orchestra;
}

describe('MemoryConnector', () => {
  let connector: MemoryConnector;
  let mockOrchestra: Orchestra;

  beforeEach(() => {
    mockOrchestra = createMockOrchestra();
    connector = new MemoryConnector(mockOrchestra);
  });

  describe('getStats', () => {
    it('should_returnDashboardStats_when_called', async () => {
      const stats = await connector.getStats();

      expect(stats.totalRequests).toBe(100);
      expect(stats.totalTokens.input).toBe(5000);
      expect(stats.totalTokens.output).toBe(3000);
      expect(stats.totalCost).toBe(1.5);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);
      expect(stats.requestsPerMinute).toBe(0);
      expect(stats.activeProviders).toEqual(['anthropic', 'openai']);
    });

    it('should_trackRequestsPerMinute_when_requestsRecorded', async () => {
      // Record some requests
      connector.recordRequest({
        traceId: 'test-1',
        provider: 'anthropic',
        model: 'claude-3-opus',
        tokens: { input: 100, output: 50 },
        cost: 0.01,
        latencyMs: 500,
        status: 'ok',
      });

      const stats = await connector.getStats();
      expect(stats.requestsPerMinute).toBe(1);
    });
  });

  describe('getTraces', () => {
    it('should_returnTraceInfoList_when_called', async () => {
      const traces = await connector.getTraces();

      expect(traces).toHaveLength(2);
      expect(traces[0].id).toBe('span-1');
      expect(traces[0].name).toBe('test-trace');
      expect(traces[0].status).toBe('ok');
      expect(traces[1].id).toBe('span-2');
      expect(traces[1].status).toBe('error');
    });

    it('should_respectLimitOption_when_provided', async () => {
      const traces = await connector.getTraces({ limit: 1 });
      expect(traces).toHaveLength(1);
    });

    it('should_respectOffsetOption_when_provided', async () => {
      const traces = await connector.getTraces({ offset: 1 });
      expect(traces).toHaveLength(1);
      expect(traces[0].name).toBe('another-trace');
    });
  });

  describe('getTrace', () => {
    it('should_returnTraceInfo_when_traceExists', async () => {
      const trace = await connector.getTrace('trace-1');

      expect(trace).toBeDefined();
      expect(trace?.name).toBe('test-trace');
    });

    it('should_returnUndefined_when_traceNotFound', async () => {
      const trace = await connector.getTrace('nonexistent');
      expect(trace).toBeUndefined();
    });

    it('should_findBySpanId_when_traceIdNotMatched', async () => {
      const trace = await connector.getTrace('span-2');
      expect(trace).toBeDefined();
      expect(trace?.name).toBe('another-trace');
    });
  });

  describe('getProviderHealth', () => {
    it('should_returnHealthForAllProviders_when_called', async () => {
      const health = await connector.getProviderHealth();

      expect(health).toHaveLength(2);
      expect(health[0].name).toBe('anthropic');
      expect(health[0].available).toBe(true);
      expect(health[1].name).toBe('openai');
      expect(health[1].available).toBe(false);
    });

    it('should_includeLatencyFromStats_when_available', async () => {
      const health = await connector.getProviderHealth();

      const anthropic = health.find((h) => h.name === 'anthropic');
      expect(anthropic?.avgLatencyMs).toBe(500);
    });
  });

  describe('getRecentRequests', () => {
    it('should_returnEmptyArray_when_noRequestsRecorded', async () => {
      const requests = await connector.getRecentRequests();
      expect(requests).toEqual([]);
    });

    it('should_returnRequests_when_recorded', async () => {
      connector.recordRequest({
        traceId: 'test-1',
        provider: 'anthropic',
        model: 'claude-3-opus',
        tokens: { input: 100, output: 50 },
        cost: 0.01,
        latencyMs: 500,
        status: 'ok',
      });

      const requests = await connector.getRecentRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].provider).toBe('anthropic');
    });

    it('should_returnInReverseOrder_when_multipleRequests', async () => {
      connector.recordRequest({
        traceId: 'test-1',
        provider: 'anthropic',
        model: 'claude-3-opus',
        tokens: { input: 100, output: 50 },
        cost: 0.01,
        latencyMs: 500,
        status: 'ok',
      });
      connector.recordRequest({
        traceId: 'test-2',
        provider: 'openai',
        model: 'gpt-4',
        tokens: { input: 200, output: 100 },
        cost: 0.02,
        latencyMs: 600,
        status: 'ok',
      });

      const requests = await connector.getRecentRequests();
      expect(requests[0].provider).toBe('openai'); // Most recent first
      expect(requests[1].provider).toBe('anthropic');
    });

    it('should_respectLimit_when_provided', async () => {
      for (let i = 0; i < 10; i++) {
        connector.recordRequest({
          traceId: `test-${i}`,
          provider: 'anthropic',
          model: 'claude-3-opus',
          tokens: { input: 100, output: 50 },
          cost: 0.01,
          latencyMs: 500,
          status: 'ok',
        });
      }

      const requests = await connector.getRecentRequests(5);
      expect(requests).toHaveLength(5);
    });
  });

  describe('subscribe', () => {
    it('should_callCallback_when_requestRecorded', async () => {
      const callback = vi.fn();
      connector.subscribe(callback);

      connector.recordRequest({
        traceId: 'test-1',
        provider: 'anthropic',
        model: 'claude-3-opus',
        tokens: { input: 100, output: 50 },
        cost: 0.01,
        latencyMs: 500,
        status: 'ok',
      });

      expect(callback).toHaveBeenCalledWith({
        type: 'request',
        data: expect.objectContaining({ provider: 'anthropic' }),
      });
    });

    it('should_returnUnsubscribeFunction_when_called', async () => {
      const callback = vi.fn();
      const unsubscribe = connector.subscribe(callback);

      unsubscribe();

      connector.recordRequest({
        traceId: 'test-1',
        provider: 'anthropic',
        model: 'claude-3-opus',
        tokens: { input: 100, output: 50 },
        cost: 0.01,
        latencyMs: 500,
        status: 'ok',
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('ring buffer behavior', () => {
    it('should_trimOldRequests_when_maxExceeded', async () => {
      const connector = new MemoryConnector(mockOrchestra, {
        maxRecentRequests: 5,
      });

      for (let i = 0; i < 10; i++) {
        connector.recordRequest({
          traceId: `test-${i}`,
          provider: 'anthropic',
          model: 'claude-3-opus',
          tokens: { input: 100, output: 50 },
          cost: 0.01,
          latencyMs: 500,
          status: 'ok',
        });
      }

      const requests = await connector.getRecentRequests(10);
      expect(requests).toHaveLength(5);
      // Should have the last 5 requests (5-9)
      expect(requests[0].traceId).toBe('test-9');
    });
  });
});
