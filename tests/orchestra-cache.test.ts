import { describe, it, expect, vi } from 'vitest';
import type { OrchestraConfig } from '../src/types/index.js';
import { createMockRequest, createMockResponse } from './utils/mocks.js';

describe('Orchestra caching', () => {
  it('should_returnCachedResponse_when_enabled', async () => {
    const { Orchestra } = await import('../src/orchestra.js');

    const config: OrchestraConfig = {
      providers: {},
      cache: { enabled: true },
    };

    const orchestra = new Orchestra(config);
    const response = createMockResponse({
      content: 'Fresh response',
      provider: 'anthropic',
      model: 'test-model',
    });

    const routeMock = vi.fn().mockResolvedValue({ response, attempts: [] });
    (orchestra as any).router = { route: routeMock };

    const request = createMockRequest({ model: 'test-model' });
    const first = await orchestra.complete(request);
    const second = await orchestra.complete(request);

    expect(routeMock).toHaveBeenCalledTimes(1);
    expect(second.meta.cached).toBe(true);
    expect(second.content).toBe(first.content);
    expect(second.meta.cost).toBe(0);
    expect(second.meta.tokens.totalTokens).toBe(0);

    await orchestra.shutdown();
  });
});
