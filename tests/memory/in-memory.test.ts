import { describe, it, expect, vi } from 'vitest';
import { InMemoryMemoryBackend } from '../../src/memory/in-memory.js';


describe('InMemoryMemoryBackend', () => {
  it('should_storeAndRetrieveMessages', async () => {
    const backend = new InMemoryMemoryBackend({ maxItems: 10 });
    const messages = [{ role: 'user', content: 'hello' }];

    await backend.set('session-1', messages);
    const stored = await backend.get('session-1');

    expect(stored).toEqual(messages);
  });

  it('should_appendMessages', async () => {
    const backend = new InMemoryMemoryBackend({ maxItems: 10 });
    await backend.set('session-1', [{ role: 'user', content: 'hello' }]);
    await backend.append('session-1', [{ role: 'assistant', content: 'hi' }]);

    const stored = await backend.get('session-1');
    expect(stored).toHaveLength(2);
  });

  it('should_pruneToMaxItems', async () => {
    const backend = new InMemoryMemoryBackend({ maxItems: 1 });
    await backend.set('session-1', [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);

    const stored = await backend.get('session-1');
    expect(stored).toHaveLength(1);
    expect(stored[0].content).toBe('b');
  });

  it('should_expireSessions_when_ttlExceeded', async () => {
    const backend = new InMemoryMemoryBackend({ ttlSeconds: 1 });
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValue(0);
    await backend.set('session-1', [{ role: 'user', content: 'hello' }]);

    nowSpy.mockReturnValue(2000);
    const stored = await backend.get('session-1');

    expect(stored).toEqual([]);
    nowSpy.mockRestore();
  });
});
