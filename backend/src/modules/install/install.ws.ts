import type { Server } from 'socket.io';
import * as pty from 'node-pty';
import { db } from '../../config/database.js';
import { sessions, users } from '../../db/schema/index.js';
import { eq, and, gt } from 'drizzle-orm';
import { logger } from '../../lib/logger.js';
import { buildArgv, runPostCheck } from './installer-commands.js';

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const [k, ...v] = pair.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

/**
 * socket.io namespace for "guided install" terminals.
 *
 * Trust model:
 * - Authenticated via session cookie (same as REST).
 * - Admin role required.
 * - Commands are allowlisted in installer-commands.ts — clients pass an id,
 *   never a freeform argv.
 * - One PTY per socket connection. Killed on disconnect.
 *
 * Wire protocol (client → server):
 *   - "start"  { id, cols, rows }    request PTY for installer `id`
 *   - "data"   string                stdin from xterm to PTY
 *   - "resize" { cols, rows }        terminal resize event
 *   - "stop"                         kill the PTY early
 *
 * Wire protocol (server → client):
 *   - "ready"     { id }                 PTY spawned, accepting input
 *   - "data"      string                 stdout/stderr chunk
 *   - "exit"      { code, postCheckOk }  PTY exited; postCheckOk indicates
 *                                        the installer's success heuristic
 *   - "error"     { message }            fatal error (auth, unknown command,
 *                                        spawn failure)
 */
export function registerInstallNamespace(io: Server): void {
  const ns = io.of('/install');

  ns.use(async (socket, next) => {
    try {
      const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
      const sessionId = cookies['session'];
      if (!sessionId) return next(new Error('Authentication required'));

      const now = new Date();
      const result = await db
        .select({ session: sessions, user: users })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
        .limit(1);

      if (result.length === 0) return next(new Error('Session expired'));
      const { user } = result[0];
      if (user.role !== 'admin') return next(new Error('Admin role required'));

      // Stash on the socket for later logging.
      (socket as any).userId = user.id;
      (socket as any).householdId = user.householdId;
      next();
    } catch (err) {
      logger.error({ err }, '/install namespace auth failed');
      next(new Error('Authentication failed'));
    }
  });

  ns.on('connection', (socket) => {
    const log = logger.child({
      ns: 'install',
      socketId: socket.id,
      userId: (socket as any).userId,
    });
    log.info('Guided install socket connected');

    let term: pty.IPty | null = null;
    let currentId: string | null = null;

    socket.on('start', async (payload: { id: string; cols?: number; rows?: number }) => {
      if (term) {
        socket.emit('error', { message: 'A PTY is already running on this socket' });
        return;
      }
      try {
        const argv = await buildArgv(payload.id);
        currentId = payload.id;
        log.info({ id: payload.id }, 'Spawning guided install PTY');

        term = pty.spawn(argv[0], argv.slice(1), {
          name: 'xterm-256color',
          cols: payload.cols ?? 100,
          rows: payload.rows ?? 30,
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
        });

        term.onData((data) => socket.emit('data', data));
        term.onExit(async ({ exitCode }) => {
          const postCheckOk =
            currentId !== null ? await runPostCheck(currentId) : undefined;
          log.info({ exitCode, postCheckOk }, 'Guided install PTY exited');
          socket.emit('exit', { code: exitCode, postCheckOk });
          term = null;
          currentId = null;
        });

        socket.emit('ready', { id: payload.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ err, id: payload.id }, 'Failed to spawn PTY');
        socket.emit('error', { message });
      }
    });

    socket.on('data', (data: string) => {
      if (term) term.write(data);
    });

    socket.on('resize', ({ cols, rows }: { cols: number; rows: number }) => {
      if (term) {
        try {
          term.resize(cols, rows);
        } catch (err) {
          log.debug({ err }, 'PTY resize failed (likely already exited)');
        }
      }
    });

    socket.on('stop', () => {
      if (term) {
        log.info('Stopping PTY by client request');
        term.kill('SIGTERM');
      }
    });

    socket.on('disconnect', () => {
      if (term) {
        log.info('Socket disconnected — killing PTY');
        try {
          term.kill('SIGTERM');
        } catch {
          /* already dead */
        }
        term = null;
      }
    });
  });
}
