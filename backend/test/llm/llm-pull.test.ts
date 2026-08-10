import { afterEach, describe, expect, it, vi } from 'vitest';

const pullModel = vi.fn();
vi.mock('../../src/modules/llm/ollama-client.js', () => ({ pullModel }));

const { startPull, getPull, cancelPull } = await import('../../src/modules/llm/llm.ws.js');

afterEach(() => pullModel.mockReset());

describe('pull registry', () => {
  it('tracks progress reported by the client', async () => {
    pullModel.mockImplementation(async (_tag: string, onProgress: (p: unknown) => void) => {
      onProgress({ status: 'downloading', completed: 50, total: 100 });
    });

    const id = startPull('qwen2.5:7b');
    await vi.waitFor(() => expect(getPull(id)?.completed).toBe(50));
    expect(getPull(id)?.total).toBe(100);
  });

  it('marks a pull done on success', async () => {
    pullModel.mockResolvedValue(undefined);
    const id = startPull('qwen2.5:3b');
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('done'));
  });

  it('keeps the error text when a pull fails', async () => {
    // Disk-full and network-refused need different user responses, so the
    // message must survive rather than becoming "pull failed".
    pullModel.mockRejectedValue(new Error('no space left on device'));
    const id = startPull('qwen2.5:7b');
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('failed'));
    expect(getPull(id)?.error).toMatch(/no space left/);
  });

  it('cancelling aborts the underlying request', async () => {
    let seenSignal: AbortSignal | undefined;
    pullModel.mockImplementation(
      async (_t: string, _p: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    const id = startPull('qwen2.5:7b');
    await vi.waitFor(() => expect(seenSignal).toBeDefined());
    expect(cancelPull(id)).toBe(true);
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('cancelled'));
  });

  it('returns false when cancelling an unknown pull', () => {
    expect(cancelPull('nope')).toBe(false);
  });

  it('reaps a finished pull after the retention window, but not before', async () => {
    // Unbounded growth of the registry was a review finding: every pull,
    // whatever its outcome, used to leave a permanent Map entry.
    vi.useFakeTimers();
    try {
      pullModel.mockResolvedValue(undefined);
      const id = startPull('qwen2.5:3b');

      // Flush the pullModel promise chain (then/finally) without advancing
      // the clock — the timer these settle isn't the reap timer itself.
      await vi.advanceTimersByTimeAsync(0);
      expect(getPull(id)?.state).toBe('done');

      // A client reconnecting right after completion must still see the
      // outcome — just under the retention window, the entry survives.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
      expect(getPull(id)?.state).toBe('done');

      // Past the window, the entry is gone.
      await vi.advanceTimersByTimeAsync(1);
      expect(getPull(id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
