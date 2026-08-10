import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isReachable, listInstalledTags, pullModel, deleteModel, type PullProgress,
} from '../../src/modules/llm/ollama-client.js';

afterEach(() => vi.unstubAllGlobals());

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('isReachable', () => {
  it('is true when the tags endpoint answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"models":[]}', { status: 200 })));
    expect(await isReachable()).toBe(true);
  });

  it('is false — never throws — when the connection is refused', async () => {
    // The settings page calls this on load; a throw would break the page
    // rather than showing the install action.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await isReachable()).toBe(false);
  });

  it('is false on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    expect(await isReachable()).toBe(false);
  });
});

describe('listInstalledTags', () => {
  it('returns the model names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llava:7b' }] }), { status: 200 })
    ));
    expect(await listInstalledTags()).toEqual(['qwen2.5:7b', 'llava:7b']);
  });

  it('returns an empty list when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await listInstalledTags()).toEqual([]);
  });

  it('returns an empty list when the body is not valid JSON', async () => {
    // The third never-throw path: HTTP 200 but res.json() rejects. The settings
    // page calls this on load, so a throw here breaks the page rather than
    // showing the install action.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 })));
    expect(await listInstalledTags()).toEqual([]);
  });
});

describe('pullModel', () => {
  it('reports progress from each NDJSON line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'downloading', completed: 500, total: 1000 }),
      JSON.stringify({ status: 'success' }),
    ])));

    const seen: PullProgress[] = [];
    await pullModel('qwen2.5:7b', (p) => seen.push(p));

    expect(seen.map((p) => p.status)).toEqual(['pulling manifest', 'downloading', 'success']);
    expect(seen[1]).toMatchObject({ completed: 500, total: 1000 });
  });

  it('tolerates a partial line split across chunks', async () => {
    // NDJSON arrives in arbitrary chunks; a naive split on newline drops data.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"status":"downlo'));
        controller.enqueue(encoder.encode('ading","completed":1,"total":2}\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const seen: PullProgress[] = [];
    await pullModel('x:1b', (p) => seen.push(p));
    expect(seen).toEqual([{ status: 'downloading', completed: 1, total: 2 }]);
  });

  it('surfaces Ollama own error text', async () => {
    // Disk-full and network-refused need different user responses, so the
    // message must not be flattened into something generic.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      ndjsonResponse([JSON.stringify({ error: 'no space left on device' })])
    ));
    await expect(pullModel('x:1b', () => {})).rejects.toThrow(/no space left on device/);
  });

  it('throws when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad tag', { status: 404 })));
    await expect(pullModel('nope:1b', () => {})).rejects.toThrow();
  });

  it('handles a final line with no trailing newline', async () => {
    // Ollama's last frame often arrives unterminated; without the post-loop
    // flush the success status would be silently dropped.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"status":"downloading","completed":1,"total":2}\n'));
        controller.enqueue(encoder.encode('{"status":"success"}'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const seen: PullProgress[] = [];
    await pullModel('x:1b', (p) => seen.push(p));
    expect(seen.map((p) => p.status)).toEqual(['downloading', 'success']);
  });
});

describe('deleteModel', () => {
  it('sends the tag and resolves on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await deleteModel('qwen2.5:7b');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/delete');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body)).name).toBe('qwen2.5:7b');
  });

  it('throws with the server text on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('model not found', { status: 404 })));
    await expect(deleteModel('nope:1b')).rejects.toThrow(/model not found/);
  });
});
