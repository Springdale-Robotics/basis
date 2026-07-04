import { config } from '../config/index.js';
import { logger } from './logger.js';

/**
 * HTTP client for the Basis Remote control plane (home-basis.com).
 *
 * Two calls exist: redeeming a one-time claim code for tunnel credentials,
 * and a periodic heartbeat that reports subscription status + bandwidth
 * usage back to the box. Kept separate from the frpc supervisor
 * (basis-remote.ts) so each can be tested in isolation.
 */

const REQUEST_TIMEOUT_MS = 10_000;

export interface ClaimResult {
  tenantId: string;
  subdomain: string;
  hostname: string;
  relay: { serverAddr: string; serverPort: number };
  tunnelToken: string;
}

export type ClaimErrorCode =
  | 'CLAIM_CODE_INVALID'
  | 'CLAIM_CODE_EXPIRED'
  | 'CLAIM_CODE_USED'
  | 'CLOUD_UNREACHABLE'
  | 'CLOUD_ERROR';

export class ClaimError extends Error {
  constructor(
    public readonly code: ClaimErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ClaimError';
  }
}

export interface HeartbeatResult {
  status: 'active' | 'suspended' | 'canceled';
  tier: string;
  usage: { monthGB: number; capGB: number };
}

/** 401/403 from the heartbeat — the tunnel token is no longer recognized. */
export class HeartbeatAuthError extends Error {
  constructor(message = 'Tunnel token rejected by the cloud') {
    super(message);
    this.name = 'HeartbeatAuthError';
  }
}

/** Network-level or 5xx failure — status unknown, keep last known state. */
export class CloudUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudUnreachableError';
  }
}

let _fetch: typeof fetch = fetch;

export function __setFetchForTests(fn: typeof fetch | null): void {
  _fetch = fn ?? fetch;
}

const KNOWN_CLAIM_CODES: ReadonlySet<string> = new Set([
  'CLAIM_CODE_INVALID',
  'CLAIM_CODE_EXPIRED',
  'CLAIM_CODE_USED',
]);

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return _fetch(`${config.BASIS_CLOUD_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Redeem a one-time claim code for tunnel credentials. Codes are single-use
 * and short-lived — callers must persist the result before acting on it, so
 * a downstream failure (frpc spawn, etc.) doesn't burn the code.
 */
export async function claimBox(claimCode: string): Promise<ClaimResult> {
  let res: Response;
  try {
    res = await post('/api/v1/boxes/claim', { claimCode });
  } catch (err) {
    logger.warn({ err }, 'Basis Remote claim request failed to reach the cloud');
    throw new ClaimError('CLOUD_UNREACHABLE', 'Could not reach home-basis.com — check the box\'s internet connection');
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok || !payload?.success) {
    const code = payload?.error?.code as string | undefined;
    const message = (payload?.error?.message as string | undefined) ?? `Claim failed (HTTP ${res.status})`;
    if (code && KNOWN_CLAIM_CODES.has(code)) {
      throw new ClaimError(code as ClaimErrorCode, message);
    }
    throw new ClaimError('CLOUD_ERROR', message);
  }

  const data = payload.data;
  if (
    !data?.tenantId ||
    !data?.subdomain ||
    !data?.hostname ||
    !data?.tunnelToken ||
    !data?.relay?.serverAddr ||
    typeof data?.relay?.serverPort !== 'number'
  ) {
    throw new ClaimError('CLOUD_ERROR', 'Cloud returned an incomplete claim response');
  }

  return {
    tenantId: data.tenantId,
    subdomain: data.subdomain,
    hostname: data.hostname,
    relay: { serverAddr: data.relay.serverAddr, serverPort: data.relay.serverPort },
    tunnelToken: data.tunnelToken,
  };
}

/**
 * Report liveness and fetch subscription status + usage for this box.
 * Throws HeartbeatAuthError on 401/403 (token revoked / box unlinked) and
 * CloudUnreachableError for anything network-shaped.
 */
export async function sendHeartbeat(tunnelToken: string): Promise<HeartbeatResult> {
  let res: Response;
  try {
    res = await post('/api/v1/boxes/heartbeat', {}, { Authorization: `Bearer ${tunnelToken}` });
  } catch (err) {
    throw new CloudUnreachableError(err instanceof Error ? err.message : String(err));
  }

  if (res.status === 401 || res.status === 403) {
    throw new HeartbeatAuthError();
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok || !payload?.success) {
    throw new CloudUnreachableError(
      (payload?.error?.message as string | undefined) ?? `Heartbeat failed (HTTP ${res.status})`
    );
  }

  const data = payload.data;
  if (!data?.status || !data?.usage) {
    throw new CloudUnreachableError('Cloud returned an incomplete heartbeat response');
  }

  return {
    status: data.status,
    tier: data.tier ?? 'unknown',
    usage: { monthGB: Number(data.usage.monthGB ?? 0), capGB: Number(data.usage.capGB ?? 0) },
  };
}
