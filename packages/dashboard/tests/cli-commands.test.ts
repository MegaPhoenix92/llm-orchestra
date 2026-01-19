/**
 * CLI Commands Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { statsCommand } from '../src/cli/commands/stats.js';
import { healthCommand } from '../src/cli/commands/health.js';
import { costsCommand } from '../src/cli/commands/costs.js';
import { tracesCommand } from '../src/cli/commands/traces.js';

// Mock fetch globally using vi.stubGlobal for proper cleanup
const mockFetch = vi.fn();

// Capture console output
const consoleLogs: string[] = [];
const consoleErrors: string[] = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalProcessExit = process.exit;

beforeEach(() => {
  consoleLogs.length = 0;
  consoleErrors.length = 0;
  // Use vi.stubGlobal for fetch to ensure proper restoration
  vi.stubGlobal('fetch', mockFetch);
  console.log = (...args: unknown[]) => {
    consoleLogs.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  };
  process.exit = vi.fn() as unknown as typeof process.exit;
  mockFetch.mockReset();
});

afterEach(() => {
  // Restore all stubbed globals including fetch
  vi.unstubAllGlobals();
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  process.exit = originalProcessExit;
});

describe('statsCommand', () => {
  const mockStats = {
    totalRequests: 100,
    totalTokens: { input: 5000, output: 3000 },
    totalCost: 1.5,
    requestsPerMinute: 10,
    uptime: 3600000, // 1 hour
    activeProviders: ['anthropic', 'openai'],
  };

  it('should_displayStats_when_fetchSucceeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockStats,
    });

    await statsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('100');
    expect(output).toContain('5,000');
    expect(output).toContain('3,000');
    expect(output).toContain('$1.5000');
    expect(output).toContain('anthropic');
    expect(output).toContain('openai');
  });

  it('should_formatUptimeInHours_when_uptimeIsLarge', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockStats, uptime: 7200000 }), // 2 hours
    });

    await statsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('2h');
  });

  it('should_formatUptimeInDays_when_uptimeIsVeryLarge', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockStats, uptime: 90000000 }), // > 1 day
    });

    await statsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('d');
  });

  it('should_handleEmptyProviders_when_noActiveProviders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...mockStats, activeProviders: [] }),
    });

    await statsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).not.toContain('Active Providers');
  });

  it('should_displayError_when_fetchFails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await statsCommand('http://localhost:3737');

    expect(consoleErrors.join('\n')).toContain('Error fetching stats');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should_displayError_when_networkFails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await statsCommand('http://localhost:3737');

    expect(consoleErrors.join('\n')).toContain('Network error');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('healthCommand', () => {
  const mockHealth = {
    providers: [
      { name: 'anthropic', available: true, avgLatencyMs: 500, lastChecked: Date.now() },
      { name: 'openai', available: false, lastChecked: Date.now() },
    ],
  };

  it('should_displayProviderHealth_when_fetchSucceeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockHealth,
    });

    await healthCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('anthropic');
    expect(output).toContain('openai');
    expect(output).toContain('500ms');
  });

  it('should_showAvailable_when_providerIsAvailable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        providers: [{ name: 'anthropic', available: true, lastChecked: Date.now() }],
      }),
    });

    await healthCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('Available');
  });

  it('should_showUnavailable_when_providerIsDown', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        providers: [{ name: 'openai', available: false, lastChecked: Date.now() }],
      }),
    });

    await healthCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('Unavailable');
  });

  it('should_showDash_when_noLatencyData', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        providers: [{ name: 'openai', available: true, lastChecked: Date.now() }],
      }),
    });

    await healthCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('-');
  });

  it('should_displayMessage_when_noProviders', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ providers: [] }),
    });

    await healthCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('No providers configured');
  });

  it('should_displayError_when_fetchFails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await healthCommand('http://localhost:3737');

    expect(consoleErrors.join('\n')).toContain('Error fetching health');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('costsCommand', () => {
  const mockCosts = {
    totalCost: 15.5,
    byProvider: {
      anthropic: {
        requests: 100,
        tokens: { input: 50000, output: 25000 },
        cost: 10.0,
        avgLatencyMs: 500,
      },
      openai: {
        requests: 50,
        tokens: { input: 25000, output: 12500 },
        cost: 5.5,
        avgLatencyMs: 300,
      },
    },
    byModel: {
      'claude-3-opus': {
        requests: 100,
        tokens: { input: 50000, output: 25000 },
        cost: 10.0,
      },
      'gpt-4': {
        requests: 50,
        tokens: { input: 25000, output: 12500 },
        cost: 5.5,
      },
    },
  };

  it('should_displayCostBreakdown_when_fetchSucceeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCosts,
    });

    await costsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('$15.5000');
    expect(output).toContain('anthropic');
    expect(output).toContain('openai');
    expect(output).toContain('claude-3-opus');
    expect(output).toContain('gpt-4');
  });

  it('should_displayByProvider_when_providersExist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCosts,
    });

    await costsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('By Provider');
    expect(output).toContain('$10.0000');
    expect(output).toContain('500ms');
  });

  it('should_displayByModel_when_modelsExist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCosts,
    });

    await costsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('By Model');
    expect(output).toContain('claude-3-opus');
  });

  it('should_handleEmptyProviders_when_noData', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalCost: 0,
        byProvider: {},
        byModel: {},
      }),
    });

    await costsCommand('http://localhost:3737');

    const output = consoleLogs.join('\n');
    expect(output).toContain('$0.0000');
    expect(output).not.toContain('By Provider:');
    expect(output).not.toContain('By Model:');
  });

  it('should_displayError_when_fetchFails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await costsCommand('http://localhost:3737');

    expect(consoleErrors.join('\n')).toContain('Error fetching costs');
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});

describe('tracesCommand', () => {
  const mockTraces = {
    traces: [
      {
        id: 'trace-001-abcdef',
        name: 'chat-completion',
        durationMs: 1500,
        status: 'ok' as const,
        startTime: Date.now() - 5000,
      },
      {
        id: 'trace-002-ghijkl',
        name: 'embedding-request',
        durationMs: 200,
        status: 'ok' as const,
        startTime: Date.now() - 10000,
      },
      {
        id: 'trace-003-mnopqr',
        name: 'failed-request',
        status: 'error' as const,
        startTime: Date.now() - 15000,
      },
    ],
  };

  it('should_displayTraces_when_fetchSucceeds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTraces,
    });

    await tracesCommand('http://localhost:3737', 20);

    const output = consoleLogs.join('\n');
    expect(output).toContain('chat-completion');
    expect(output).toContain('embedding-request');
    expect(output).toContain('failed-request');
  });

  it('should_showDuration_when_available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockTraces,
    });

    await tracesCommand('http://localhost:3737', 20);

    const output = consoleLogs.join('\n');
    expect(output).toContain('1500ms');
    expect(output).toContain('200ms');
  });

  it('should_showDash_when_noDuration', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        traces: [{ id: 'trace-1', name: 'pending', status: 'pending', startTime: Date.now() }],
      }),
    });

    await tracesCommand('http://localhost:3737', 20);

    const output = consoleLogs.join('\n');
    expect(output).toContain('-');
  });

  it('should_passLimitToApi_when_provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ traces: [] }),
    });

    await tracesCommand('http://localhost:3737', 5);

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3737/api/traces?limit=5');
  });

  it('should_displayMessage_when_noTraces', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ traces: [] }),
    });

    await tracesCommand('http://localhost:3737', 20);

    const output = consoleLogs.join('\n');
    expect(output).toContain('No traces found');
  });

  it('should_truncateTraceId_when_displayed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        traces: [
          {
            id: 'very-long-trace-id-that-should-be-truncated',
            name: 'test',
            status: 'ok',
            startTime: Date.now(),
          },
        ],
      }),
    });

    await tracesCommand('http://localhost:3737', 20);

    const output = consoleLogs.join('\n');
    // ID should be truncated to 16 chars
    expect(output).toContain('very-long-trace-');
    expect(output).not.toContain('very-long-trace-id-that-should-be-truncated');
  });

  it('should_displayError_when_fetchFails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    await tracesCommand('http://localhost:3737', 20);

    expect(consoleErrors.join('\n')).toContain('Error fetching traces');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('should_colorStatusOk_when_statusIsOk', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        traces: [{ id: 'trace-1', name: 'test', status: 'ok', startTime: Date.now() }],
      }),
    });

    await tracesCommand('http://localhost:3737', 20);

    // Output will contain ANSI color codes for green
    const output = consoleLogs.join('\n');
    expect(output).toContain('ok');
  });

  it('should_colorStatusError_when_statusIsError', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        traces: [{ id: 'trace-1', name: 'test', status: 'error', startTime: Date.now() }],
      }),
    });

    await tracesCommand('http://localhost:3737', 20);

    const output = consoleLogs.join('\n');
    expect(output).toContain('error');
  });
});
