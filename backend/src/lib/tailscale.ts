import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(execCallback);

/**
 * Wraps the `tailscale` CLI so the rest of the app can ask: is Tailscale
 * available on this host, is the user signed in, can we make HTTPS work for
 * our backend automatically?
 *
 * We shell out to the CLI rather than talking to the local socket directly —
 * the CLI is more stable across Tailscale versions and easier to debug.
 *
 * All exec calls go through a small wrapper that can be substituted in tests
 * (see `__setExecForTests`).
 */
export type TailscaleIssue =
  | 'not_installed'
  | 'needs_login'
  | 'needs_operator'
  | 'daemon_offline'
  | 'cli_timeout'
  | 'unknown_error';

export interface TailscaleStatus {
  available: boolean;
  hostname?: string; // e.g. "homemanager.example.ts.net" (trailing dot stripped)
  tailnet?: string; // e.g. "example.ts.net"
  tailscaleIPs?: string[];
  issues: TailscaleIssue[];
}

export interface ServeStatus {
  configured: boolean;
  httpsPort?: number;
  target?: string; // e.g. "http://127.0.0.1:3000"
  raw?: unknown;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  issue?: TailscaleIssue;
}

const EXEC_TIMEOUT_MS = 5_000;

let _exec: typeof execAsync = execAsync;

/** Test seam — swap the exec implementation for deterministic unit tests. */
export function __setExecForTests(fn: typeof execAsync | null): void {
  _exec = fn ?? execAsync;
}

async function runTailscale(args: string[]): Promise<{ stdout: string; stderr: string }> {
  // Avoid shell quoting; pass args as a single command string we control.
  const cmd = ['tailscale', ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  return _exec(cmd, { timeout: EXEC_TIMEOUT_MS });
}

function classifyExecError(err: unknown): TailscaleIssue {
  const e = err as { code?: string | number; killed?: boolean; stderr?: string; message?: string };
  if (e.killed && (e.code === null || e.code === 'TIMEOUT')) return 'cli_timeout';
  const text = `${e.stderr ?? ''} ${e.message ?? ''}`.toLowerCase();
  if (text.includes('command not found') || text.includes('not recognized') || (e.code as string) === 'ENOENT') {
    return 'not_installed';
  }
  if (text.includes('not logged in') || text.includes('needs login')) return 'needs_login';
  if (text.includes('operator') || text.includes('permission denied')) return 'needs_operator';
  if (text.includes('connection refused') || text.includes('socket')) return 'daemon_offline';
  return 'unknown_error';
}

/**
 * Detect Tailscale on this host. Always returns a structured result — never
 * throws. Callers use the `issues` array to decide whether to surface a
 * remediation step to the user.
 */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await runTailscale(['status', '--json']);
    const parsed = JSON.parse(stdout) as {
      BackendState?: string;
      MagicDNSSuffix?: string;
      Self?: { DNSName?: string; TailscaleIPs?: string[] };
    };
    if (parsed.BackendState !== 'Running') {
      const issue: TailscaleIssue =
        parsed.BackendState === 'NeedsLogin'
          ? 'needs_login'
          : parsed.BackendState === 'Stopped'
          ? 'daemon_offline'
          : 'unknown_error';
      return { available: false, issues: [issue] };
    }
    const dns = parsed.Self?.DNSName?.replace(/\.$/, '');
    if (!dns) {
      return { available: false, issues: ['unknown_error'] };
    }
    return {
      available: true,
      hostname: dns,
      tailnet: parsed.MagicDNSSuffix,
      tailscaleIPs: parsed.Self?.TailscaleIPs,
      issues: [],
    };
  } catch (err) {
    const issue = classifyExecError(err);
    logger.debug({ err }, 'tailscale status failed');
    return { available: false, issues: [issue] };
  }
}

export async function getServeStatus(): Promise<ServeStatus> {
  try {
    const { stdout } = await runTailscale(['serve', 'status', '--json']);
    const trimmed = stdout.trim();
    if (!trimmed || trimmed === '{}') {
      return { configured: false };
    }
    const parsed = JSON.parse(trimmed) as {
      TCP?: Record<string, { HTTPS?: boolean }>;
      Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
    };
    const httpsPort = parsed.TCP
      ? Object.entries(parsed.TCP)
          .filter(([, v]) => v.HTTPS)
          .map(([k]) => parseInt(k, 10))[0]
      : undefined;
    let target: string | undefined;
    if (parsed.Web) {
      for (const handlers of Object.values(parsed.Web)) {
        for (const h of Object.values(handlers.Handlers ?? {})) {
          if (h.Proxy) {
            target = h.Proxy;
            break;
          }
        }
        if (target) break;
      }
    }
    return {
      configured: !!(httpsPort && target),
      httpsPort,
      target,
      raw: parsed,
    };
  } catch (err) {
    logger.debug({ err }, 'tailscale serve status failed');
    return { configured: false };
  }
}

/**
 * Tell Tailscale to expose our backend over HTTPS on the tailnet.
 *
 * `tailscale serve --bg --https=443 http://localhost:<port>` fronts the
 * backend with a real Let's Encrypt cert chained to ISRG Root X1 — iOS
 * Calendar trusts this out of the box. Idempotent: if the same target is
 * already configured, returns success without re-running.
 */
export async function configureServe(httpPort: number): Promise<OperationResult> {
  const target = `http://localhost:${httpPort}`;
  const current = await getServeStatus();
  if (current.configured && current.httpsPort === 443 && current.target === `http://127.0.0.1:${httpPort}`) {
    return { success: true };
  }
  // Tailscale rewrites localhost to 127.0.0.1 in its config — match that on
  // the comparison above so idempotency works.
  try {
    await runTailscale(['serve', '--bg', '--https=443', target]);
    return { success: true };
  } catch (err) {
    const issue = classifyExecError(err);
    const e = err as { stderr?: string; message?: string };
    return {
      success: false,
      issue,
      error: (e.stderr || e.message || 'tailscale serve failed').trim(),
    };
  }
}

export async function disableServe(): Promise<OperationResult> {
  try {
    await runTailscale(['serve', 'reset']);
    return { success: true };
  } catch (err) {
    const issue = classifyExecError(err);
    const e = err as { stderr?: string; message?: string };
    return { success: false, issue, error: e.stderr ?? e.message ?? 'reset failed' };
  }
}

/**
 * Tailscale Funnel — same machinery as serve, but exposes the proxied URL to
 * the public internet via Tailscale's relay. Used for the public ICS feed so
 * Google Calendar etc. can subscribe even when the rest of the server is
 * tailnet-only.
 *
 * `path` should be the URL prefix to expose (e.g. "/api/v1/calendars/public").
 * Tailscale requires Funnel to be explicitly enabled per tailnet via the
 * admin console; a 403 here means "go enable Funnel" not "code bug".
 */
export async function configureFunnel(
  path: string,
  httpPort: number
): Promise<OperationResult> {
  try {
    await runTailscale([
      'funnel',
      '--bg',
      `--set-path=${path}`,
      `http://localhost:${httpPort}${path}`,
    ]);
    return { success: true };
  } catch (err) {
    const issue = classifyExecError(err);
    const e = err as { stderr?: string; message?: string };
    return {
      success: false,
      issue,
      error: (e.stderr || e.message || 'tailscale funnel failed').trim(),
    };
  }
}

export async function disableFunnel(path: string): Promise<OperationResult> {
  try {
    await runTailscale(['funnel', `--set-path=${path}`, 'off']);
    return { success: true };
  } catch (err) {
    const issue = classifyExecError(err);
    const e = err as { stderr?: string; message?: string };
    return { success: false, issue, error: e.stderr ?? e.message ?? 'funnel disable failed' };
  }
}
