import { describe, expect, it, vi } from 'vitest';
import { createNoOverlapPoller } from '../polling';

describe('createNoOverlapPoller', () => {
  it('does not run two polling cycles at the same time', async () => {
    let release: (() => void) | undefined;
    const poll = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    const setIntervalFn = vi.fn(() => timer);
    const clearIntervalFn = vi.fn();
    const runner = createNoOverlapPoller(poll, 1000, setIntervalFn, clearIntervalFn);

    const first = runner.run();
    const second = runner.run();

    await expect(second).resolves.toBe(false);
    expect(poll).toHaveBeenCalledTimes(1);

    release?.();
    await expect(first).resolves.toBe(true);
    runner.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(timer);
  });

  it('releases the guard after a failed cycle', async () => {
    const poll = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(undefined);
    const runner = createNoOverlapPoller(poll, 1000, vi.fn(() => ({ unref: vi.fn() }) as unknown as ReturnType<typeof setInterval>), vi.fn());

    await expect(runner.run()).rejects.toThrow('temporary');
    await expect(runner.run()).resolves.toBe(true);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});
