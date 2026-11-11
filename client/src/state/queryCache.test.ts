import { describe, expect, it, vi } from 'vitest';
import { QueryCache } from './queryCache';

describe('QueryCache (P2.1)', () => {
  it('fetches once per key, shares in-flight requests and does not cache failures', async () => {
    const q = new QueryCache();
    const fetch = vi.fn(async () => 42);
    const [a, b] = await Promise.all([q.get('k', fetch), q.get('k', fetch)]);
    expect([a, b, await q.get('k', fetch)]).toEqual([42, 42, 42]);
    expect(fetch).toHaveBeenCalledTimes(1);

    const flaky = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('ok');
    await expect(q.get('f', flaky)).rejects.toThrow('down');
    expect(await q.get('f', flaky)).toBe('ok');
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('invalidates by prefix', async () => {
    const q = new QueryCache();
    q.set('tree:s1', 1);
    q.set('tree:s2', 2);
    q.invalidate('tree:s1');
    expect([q.peek('tree:s1'), q.peek('tree:s2')]).toEqual([undefined, 2]);
  });
});
