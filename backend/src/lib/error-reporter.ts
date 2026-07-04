import { config } from '../config/index.js';
import { logger } from './logger.js';
import { getAppVersion } from './app-version.js';
import { hostname } from 'os';

/**
 * Best-effort backend error telemetry. When ERROR_WEBHOOK_URL is configured,
 * unexpected 5xx errors and uncaught exceptions/rejections are POSTed as compact
 * JSON so operators aren't blind to production failures (there is otherwise no
 * server-side crash reporting — only local logs).
 *
 * Deduped by error signature over a short window so a crash loop can't flood the
 * sink, and fully non-throwing: reporting an error must never itself take down a
 * request path or the shutdown sequence.
 */

const DEDUP_WINDOW_MS = 10 * 60_000;
const seen = new Map<string, number>();

function signature(kind: string, message: string, stack?: string): string {
  const firstFrame = stack?.split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
  return `${kind}:${message}:${firstFrame.trim()}`;
}

function shouldSend(sig: string, now: number): boolean {
  const last = seen.get(sig);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  seen.set(sig, now);
  // Opportunistic cleanup so the map can't grow unbounded.
  if (seen.size > 500) {
    for (const [k, t] of seen) if (now - t >= DEDUP_WINDOW_MS) seen.delete(k);
  }
  return true;
}

export interface ErrorReportContext {
  requestId?: string;
  method?: string;
  route?: string;
}

/**
 * Report a server error to the configured sink. No-op when unconfigured.
 * Never throws. `timeoutMs` is kept short so it can be awaited on the crash
 * path without stalling shutdown.
 */
export async function reportServerError(
  kind: 'uncaughtException' | 'unhandledRejection' | 'http_5xx',
  err: unknown,
  context: ErrorReportContext = {},
  timeoutMs = 3_000
): Promise<void> {
  const url = config.ERROR_WEBHOOK_URL;
  if (!url) return;

  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;

    const now = Date.now();
    if (!shouldSend(signature(kind, message, stack), now)) return;

    const body = JSON.stringify({
      kind,
      message,
      stack,
      version: await getAppVersion(),
      host: hostname(),
      timestamp: new Date(now).toISOString(),
      ...context,
    });

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (reportErr) {
    // Telemetry is best-effort — log locally and move on.
    logger.warn({ reportErr }, 'Failed to deliver error report');
  }
}
