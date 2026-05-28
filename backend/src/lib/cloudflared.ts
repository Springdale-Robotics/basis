import { exec as execCallback, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { logger } from './logger.js';
import { config } from '../config/index.js';

const execAsync = promisify(execCallback);

const LOCAL_CLOUDFLARED = resolve(process.cwd(), 'bin', 'cloudflared');

/** Local origin a tunnel forwards to — the dashboard Service value. */
const localServiceUrl = `http://localhost:${config.PORT}`;

/**
 * Resolve which cloudflared binary to use. The "Install cloudflared" guided
 * flow downloads into the local bin dir — prefer it over $PATH so a fresh
 * install picks up immediately without restarting the backend.
 */
function cloudflaredBinary(): string {
  return existsSync(LOCAL_CLOUDFLARED) ? LOCAL_CLOUDFLARED : 'cloudflared';
}

/**
 * Wraps the `cloudflared` CLI for Cloudflare Tunnel setup.
 *
 * Strategy: we spawn `cloudflared tunnel run --token <TOKEN>` as a child of the
 * backend process rather than installing it as a systemd service. This avoids
 * sudo (the household-app principle is one install command, then UI-only
 * config) at the cost of tying tunnel lifetime to backend lifetime — fine for a
 * self-hosted household app where the backend stays running.
 *
 * Token is supplied by the user from the Cloudflare Zero Trust dashboard. We
 * never see Cloudflare credentials beyond that token.
 */
export type CloudflaredIssue =
  | 'not_installed'
  | 'spawn_failed'
  | 'child_exited'
  | 'unknown_error';

export interface CloudflaredStatus {
  installed: boolean;
  version?: string;
  running: boolean;
  /** Set if the most recent spawn failed or the child exited unexpectedly. */
  lastError?: string;
  issues: CloudflaredIssue[];
  /**
   * The local origin a Cloudflare tunnel should forward to — i.e. what goes in
   * the dashboard's Public Hostname → Service box (Type HTTP, this host:port).
   * Token-based tunnels configure ingress in the Cloudflare dashboard, not
   * here, so we surface this so the UI can tell the user the exact value.
   */
  localServiceUrl: string;
}

const EXEC_TIMEOUT_MS = 5_000;

let _exec: typeof execAsync = execAsync;

export function __setExecForTests(fn: typeof execAsync | null): void {
  _exec = fn ?? execAsync;
}

// ─── child-process supervision ────────────────────────────────────────────

let child: ChildProcess | null = null;
let lastError: string | undefined;

function isAlive(): boolean {
  return !!child && child.exitCode === null && !child.killed;
}

async function detectInstalled(): Promise<{ installed: boolean; version?: string }> {
  try {
    const { stdout } = await _exec(`${cloudflaredBinary()} --version`, {
      timeout: EXEC_TIMEOUT_MS,
    });
    const m = stdout.match(/cloudflared version ([^\s]+)/);
    return { installed: true, version: m?.[1] };
  } catch (err) {
    logger.debug({ err }, 'cloudflared --version failed');
    return { installed: false };
  }
}

export async function getCloudflaredStatus(): Promise<CloudflaredStatus> {
  const { installed, version } = await detectInstalled();
  if (!installed) {
    return { installed: false, running: false, issues: ['not_installed'], localServiceUrl };
  }
  const running = isAlive();
  return {
    installed: true,
    version,
    running,
    lastError,
    issues: lastError && !running ? ['child_exited'] : [],
    localServiceUrl,
  };
}

/**
 * Spawn `cloudflared tunnel run --token <TOKEN>` as a backend-managed child.
 * Idempotent: if already running, returns the existing status.
 */
export async function startTunnel(token: string): Promise<CloudflaredStatus> {
  if (isAlive()) {
    return getCloudflaredStatus();
  }
  const { installed } = await detectInstalled();
  if (!installed) {
    return { installed: false, running: false, issues: ['not_installed'], localServiceUrl };
  }

  return new Promise((resolve) => {
    try {
      const proc = spawn(
        cloudflaredBinary(),
        ['tunnel', '--no-autoupdate', 'run', '--token', token],
        { stdio: ['ignore', 'pipe', 'pipe'], detached: false }
      );

      let resolved = false;
      const finish = (status: CloudflaredStatus) => {
        if (resolved) return;
        resolved = true;
        resolve(status);
      };

      proc.stdout?.on('data', (d) => logger.debug({ src: 'cloudflared' }, d.toString().trim()));
      proc.stderr?.on('data', (d) => logger.debug({ src: 'cloudflared' }, d.toString().trim()));

      proc.on('error', (err) => {
        lastError = err.message;
        child = null;
        logger.warn({ err }, 'cloudflared spawn error');
        finish({
          installed: true,
          running: false,
          lastError: err.message,
          issues: ['spawn_failed'],
          localServiceUrl,
        });
      });

      proc.on('exit', (code, signal) => {
        const reason = `exited with code=${code} signal=${signal}`;
        // Only update lastError if this was unexpected — a stop() call sets
        // child=null before killing, so the on('exit') handler won't see child.
        if (child === proc) {
          lastError = reason;
          child = null;
          logger.warn({ code, signal }, 'cloudflared exited unexpectedly');
        }
      });

      child = proc;
      lastError = undefined;

      // Give it a moment to bail out on bad token / unparseable args before
      // returning success. 750ms is enough for cloudflared to print and exit on
      // a clearly-broken token without being annoying to the user.
      setTimeout(() => {
        finish({
          installed: true,
          version: undefined,
          running: isAlive(),
          lastError,
          issues: isAlive() ? [] : ['child_exited'],
          localServiceUrl,
        });
      }, 750);
    } catch (err) {
      logger.warn({ err }, 'cloudflared spawn threw synchronously');
      resolve({
        installed: true,
        running: false,
        lastError: (err as Error).message,
        issues: ['spawn_failed'],
        localServiceUrl,
      });
    }
  });
}

export function stopTunnel(): { stopped: boolean } {
  if (!child) return { stopped: false };
  const proc = child;
  child = null;
  lastError = undefined;
  try {
    proc.kill('SIGTERM');
    // Force-kill if it hasn't exited in 5s.
    setTimeout(() => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill('SIGKILL');
      }
    }, 5_000);
    return { stopped: true };
  } catch (err) {
    logger.warn({ err }, 'cloudflared kill failed');
    return { stopped: false };
  }
}

/** Restart the tunnel if a token was previously stored. Used on backend startup. */
export async function resumeTunnel(token: string | null | undefined): Promise<void> {
  if (!token) return;
  if (isAlive()) return;
  logger.info('Resuming Cloudflare tunnel from persisted token');
  await startTunnel(token);
}
