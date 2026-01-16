/**
 * Vitest global test setup
 */

import { beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Global setup
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';

  // Suppress console output during tests (optional)
  // vi.spyOn(console, 'log').mockImplementation(() => {});
  // vi.spyOn(console, 'warn').mockImplementation(() => {});
  // vi.spyOn(console, 'error').mockImplementation(() => {});
});

// Cleanup after all tests
afterAll(() => {
  vi.restoreAllMocks();
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Cleanup after each test
afterEach(() => {
  vi.clearAllTimers();
});

// Global fetch mock (for tracing export tests)
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({}),
});
