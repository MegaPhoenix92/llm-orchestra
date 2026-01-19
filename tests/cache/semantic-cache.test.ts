import { describe, it, expect, vi } from 'vitest';
import { SemanticCache } from '../../src/cache/semantic-cache.js';
import { createMockRequest, createMockResponse } from '../utils/mocks.js';

describe('SemanticCache', () => {
  it('should_returnCachedResponse_when_requestMatches', async () => {
    const cache = new SemanticCache({ enabled: true });
    const request = createMockRequest();
    const response = createMockResponse({ content: 'Cached response' });

    await cache.set(request, response);
    const cached = await cache.get(request);

    expect(cached).not.toBeNull();
    expect(cached?.content).toBe('Cached response');
  });

  it('should_missCache_when_signatureDiffers', async () => {
    const cache = new SemanticCache({ enabled: true });
    const request = createMockRequest({ model: 'model-a' });
    const otherRequest = createMockRequest({ model: 'model-b' });

    await cache.set(request, createMockResponse());
    const cached = await cache.get(otherRequest);

    expect(cached).toBeNull();
  });

  it('should_expireEntries_when_ttlExceeded', async () => {
    const cache = new SemanticCache({ enabled: true, ttlSeconds: 1 });
    const request = createMockRequest();
    const response = createMockResponse();

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    await cache.set(request, response);

    nowSpy.mockReturnValue(2000);
    const cached = await cache.get(request);

    expect(cached).toBeNull();
    nowSpy.mockRestore();
  });

  it('should_evictLeastRecent_when_overMaxSize', async () => {
    const cache = new SemanticCache({ enabled: true, maxSize: 1 });
    const requestA = createMockRequest({ model: 'model-a' });
    const requestB = createMockRequest({ model: 'model-b' });

    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    await cache.set(requestA, createMockResponse({ content: 'A' }));
    nowSpy.mockReturnValue(1000);
    await cache.set(requestB, createMockResponse({ content: 'B' }));
    nowSpy.mockReturnValue(2000);

    const cachedA = await cache.get(requestA);
    const cachedB = await cache.get(requestB);
    nowSpy.mockRestore();

    expect(cachedA).toBeNull();
    expect(cachedB?.content).toBe('B');
  });
});
