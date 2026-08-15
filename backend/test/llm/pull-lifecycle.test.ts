import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullModel: vi.fn(),
}));

vi.mock('../../src/modules/llm/ollama-client.js', () => ({
  pullModel: mocks.pullModel,
}));

const { startPull, getPull, registerLlmNamespace } = await import('../../src/modules/llm/llm.ws.js');

/** Minimal stand-in for the socket.io Server surface llm.ws actually uses. */
function fakeIo() {
  const emitted: Array<{ event: string; state: { state: string; completed?: number; total?: number } }> = [];
  const namespace = {
    emit: (event: string, state: never) => emitted.push({ event, state }),
    on: () => {},
    use: () => {},
  };
  return {
    emitted,
    server: { of: () => namespace } as never,
  };
}

let io: ReturnType<typeof fakeIo>;

beforeEach(() => {
  vi.useFakeTimers();
  io = fakeIo();
  registerLlmNamespace(io.server);
  mocks.pullModel.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pull deduplication', () => {
  it('joins an in-flight pull of the same tag instead of starting a second', async () => {
    // Two tabs, or two admins, clicking Install on the same model. Two real
    // downloads used to fight over one progress row.
    mocks.pullModel.mockImplementation(() => new Promise(() => {}));

    const first = startPull('qwen2.5vl:7b');
    const second = startPull('qwen2.5vl:7b');

    expect(second).toBe(first);
    expect(mocks.pullModel).toHaveBeenCalledTimes(1);
  });

  it('still starts separate pulls for different tags', async () => {
    mocks.pullModel.mockImplementation(() => new Promise(() => {}));

    const a = startPull('distinct-a:1b');
    const b = startPull('distinct-b:1b');

    expect(b).not.toBe(a);
    expect(mocks.pullModel).toHaveBeenCalledTimes(2);
  });

  it('allows re-pulling a tag once the previous pull has finished', async () => {
    mocks.pullModel.mockResolvedValue(undefined);

    const first = startPull('moondream');
    await vi.waitFor(() => expect(getPull(first)?.state).toBe('done'));

    const second = startPull('moondream');
    expect(second).not.toBe(first);
  });
});

// `pulls` is module-level process state by design, so tests use distinct tags
// rather than resetting it — which also means the dedupe above is exercised
// against a registry that really does persist.
describe('progress broadcasting', () => {
  it('paces frames instead of forwarding every chunk', async () => {
    // Ollama emits an NDJSON line per chunk; a multi-GB pull produced
    // thousands of socket frames per second, fanned out to every admin.
    let report: (p: { status: string; completed?: number; total?: number }) => void = () => {};
    mocks.pullModel.mockImplementation((_tag: string, onProgress: typeof report) => {
      report = onProgress;
      return new Promise(() => {});
    });

    startPull('paced:model');
    for (let i = 0; i < 500; i++) report({ status: 'downloading', completed: i, total: 500 });

    const progressFrames = io.emitted.filter((e) => e.event === 'pull:progress');
    expect(progressFrames.length).toBeLessThan(5);
  });

  it('keeps state current on every frame, even the ones it does not broadcast', async () => {
    // A client reconnecting mid-pull is replayed from state, so state must be
    // the latest numbers rather than the last ones put on the wire.
    let report: (p: { status: string; completed?: number; total?: number }) => void = () => {};
    mocks.pullModel.mockImplementation((_tag: string, onProgress: typeof report) => {
      report = onProgress;
      return new Promise(() => {});
    });

    const id = startPull('stateful:model');
    for (let i = 0; i < 100; i++) report({ status: 'downloading', completed: i, total: 100 });

    expect(getPull(id)?.completed).toBe(99);
  });

  it('always broadcasts the terminal frame', async () => {
    mocks.pullModel.mockResolvedValue(undefined);

    const id = startPull('moondream');
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('done'));

    const last = io.emitted.filter((e) => e.event === 'pull:progress').at(-1);
    expect(last?.state.state).toBe('done');
  });

  it('does not zero the byte counts on a frame that carries none', async () => {
    // Ollama's terminal {"status":"success"} line has no completed/total, and
    // defaulting them to 0 snapped the bar to 0% just as it finished.
    let report: (p: { status: string; completed?: number; total?: number }) => void = () => {};
    mocks.pullModel.mockImplementation((_tag: string, onProgress: typeof report) => {
      report = onProgress;
      return new Promise(() => {});
    });

    const id = startPull('terminal:model');
    report({ status: 'downloading', completed: 900, total: 1000 });
    report({ status: 'success' });

    expect(getPull(id)?.completed).toBe(900);
    expect(getPull(id)?.total).toBe(1000);
  });
});
