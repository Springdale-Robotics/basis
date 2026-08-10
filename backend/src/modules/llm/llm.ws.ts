import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { logger } from '../../lib/logger.js';
import { requireAdminSocket } from '../../websocket/require-admin-socket.js';
import { pullModel } from './ollama-client.js';

export interface PullState {
  id: string;
  tag: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  status: string;
  completed: number;
  total: number;
  error?: string;
}

/**
 * In-memory, deliberately. A pull is box-local and singleton-ish, and Ollama
 * caches blobs on disk — so a lost pull costs only the progress display, and
 * re-issuing resumes from what was already fetched. A persistent queue would
 * buy nothing.
 */
const pulls = new Map<string, PullState>();
const controllers = new Map<string, AbortController>();

/** How long a finished pull stays readable before it is reaped. */
const TERMINAL_RETENTION_MS = 10 * 60 * 1000;

let io: Server | null = null;

function emit(state: PullState): void {
  io?.of('/llm').emit('pull:progress', state);
}

export function startPull(tag: string): string {
  const id = randomUUID();
  const controller = new AbortController();
  const state: PullState = {
    id, tag, state: 'running', status: 'starting', completed: 0, total: 0,
  };

  pulls.set(id, state);
  controllers.set(id, controller);

  void pullModel(
    tag,
    (progress) => {
      Object.assign(state, progress);
      emit(state);
    },
    controller.signal
  )
    .then(() => {
      state.state = 'done';
      state.status = 'done';
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      state.state = controller.signal.aborted ? 'cancelled' : 'failed';
      // Keep Ollama's own wording — the user needs to tell disk-full from
      // network-refused.
      if (state.state === 'failed') state.error = message;
      logger.warn({ tag, error: message }, 'Ollama pull ended abnormally');
    })
    .finally(() => {
      controllers.delete(id);
      emit(state);
      // Terminal states linger briefly so a client that reconnects right after
      // a pull finishes still sees the outcome, then are reaped. Without this
      // the map grows for the life of the process — slowly, since this is an
      // admin-only action, but without any bound.
      const reap = setTimeout(() => pulls.delete(id), TERMINAL_RETENTION_MS);
      // Do not hold the event loop open on a timer nobody is waiting for.
      reap.unref?.();
    });

  return id;
}

export function getPull(pullId: string): PullState | undefined {
  return pulls.get(pullId);
}

export function cancelPull(pullId: string): boolean {
  const controller = controllers.get(pullId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * socket.io namespace for LLM model-pull progress.
 *
 * Trust model: authenticated via session cookie, admin role required — the
 * same gate /install uses, and now literally the same code (see
 * websocket/require-admin-socket.ts). This namespace exposes what is
 * installed on the host, so it must be gated exactly as /install is.
 */
export function registerLlmNamespace(server: Server): void {
  io = server;
  const ns = server.of('/llm');

  requireAdminSocket(ns, '/llm');

  ns.on('connection', (socket) => {
    // Replay live pulls so a client that reconnects mid-download catches up.
    for (const state of pulls.values()) {
      if (state.state === 'running') socket.emit('pull:progress', state);
    }
    socket.on('pull:cancel', (payload: { pullId: string }) => {
      cancelPull(payload?.pullId);
    });
  });
}
