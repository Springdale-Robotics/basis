import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

export interface PullProgress {
  status: string;
  /**
   * Absent on frames that carry no byte counts — notably Ollama's terminal
   * {"status":"success"} line. Defaulting those to 0 made the progress bar
   * snap to 0% for one frame just as the download finished.
   */
  completed?: number;
  total?: number;
}

const REACHABILITY_TIMEOUT_MS = 5000;

export type InstalledTags =
  | { reachable: true; tags: string[] }
  | { reachable: false; tags: []; error: string };

/**
 * Reachability and the installed list from ONE request.
 *
 * They used to be two calls to the same endpoint, and callers combined the
 * results as if they agreed. When the second timed out while the first
 * succeeded, the caller saw "Ollama is up, nothing installed" — which the
 * settings page renders as a destructive "Selected model isn't installed"
 * alert with every row reverted to Install, and which made PUT /settings
 * reject a perfectly good model. One request cannot disagree with itself.
 *
 * Never throws: this is called on page load, and a rejection would break the
 * page rather than showing the "install Ollama" action.
 */
export async function fetchInstalledTags(): Promise<InstalledTags> {
  try {
    const res = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { reachable: false, tags: [], error: `Ollama returned ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return { reachable: true, tags: (data.models ?? []).map((m) => m.name) };
  } catch (error) {
    return {
      reachable: false,
      tags: [],
      error: error instanceof Error ? error.message : 'Ollama is not reachable',
    };
  }
}

/**
 * Never throws. Kept as its own export because the image-parse provider and
 * the installer post-check want a cheap yes/no and nothing else.
 */
export async function isReachable(): Promise<boolean> {
  return (await fetchInstalledTags()).reachable;
}

/**
 * Streams Ollama NDJSON pull progress. Pulls are resumable — Ollama caches
 * blobs on disk — so a dropped stream costs only the progress display, and
 * re-issuing picks up where it left off.
 */
export async function pullModel(
  tag: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${config.OLLAMA_HOST}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama refused the pull (${res.status}): ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: { status?: string; error?: string; completed?: number; total?: number };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      logger.debug({ line: trimmed }, 'Unparseable line in Ollama pull stream');
      return;
    }

    // Ollama reports failures in-band rather than via HTTP status.
    if (parsed.error) throw new Error(parsed.error);

    // Pass byte counts through only when the frame actually carried them, so
    // a terminal frame without them leaves the last real numbers standing.
    onProgress({
      status: parsed.status ?? 'working',
      ...(parsed.completed !== undefined ? { completed: parsed.completed } : {}),
      ...(parsed.total !== undefined ? { total: parsed.total } : {}),
    });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      // A chunk boundary can land mid-line, so keep the remainder buffered.
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) handleLine(line);
    }

    if (buffer.trim()) handleLine(buffer);
  } finally {
    // Ollama reports failures in-band, so handleLine throws from inside the
    // loop with the body still unconsumed — that holds the connection open
    // for the life of the process, one leaked socket per failed pull.
    // Cancelling a stream that already ended is a no-op, so this is safe on
    // the success path too.
    await reader.cancel().catch(() => {});
  }
}

/** Unlinking a large model's blobs takes longer than a status probe, but it
 *  still has to be bounded — this was the one call in the module without a
 *  timeout, so a wedged Ollama hung the delete route forever. */
const DELETE_TIMEOUT_MS = 30_000;

export async function deleteModel(tag: string): Promise<void> {
  const res = await fetch(`${config.OLLAMA_HOST}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }),
    signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Ollama refused the delete (${res.status}): ${await res.text()}`);
  }
}
