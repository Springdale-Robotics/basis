import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
}

const REACHABILITY_TIMEOUT_MS = 5000;

/**
 * Never throws — the settings page calls this on load, and a rejection would
 * break the page rather than showing the "install Ollama" action.
 */
export async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listInstalledTags(): Promise<string[]> {
  try {
    const res = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
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

    onProgress({
      status: parsed.status ?? 'working',
      completed: parsed.completed ?? 0,
      total: parsed.total ?? 0,
    });
  };

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
}

export async function deleteModel(tag: string): Promise<void> {
  const res = await fetch(`${config.OLLAMA_HOST}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }),
  });
  if (!res.ok) {
    throw new Error(`Ollama refused the delete (${res.status}): ${await res.text()}`);
  }
}
