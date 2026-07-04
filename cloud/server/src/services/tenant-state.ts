import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tenants, tunnelTokens, type TenantStatus } from '../db/schema/index.js';

/**
 * Small in-memory caches so the frp plugin's Ping op (fired per client
 * heartbeat, ~every 30s per box) never hits Postgres, and so the dashboard
 * can show live connection state without querying frps.
 *
 * Single-process by design; every DB write that changes a tenant's status,
 * throttle flag, or tokens must call invalidateTenantState().
 */

export interface TenantState {
  id: string;
  subdomain: string;
  status: TenantStatus;
  throttled: boolean;
  /** sha256 hashes of currently-valid (unrevoked) tunnel tokens. */
  validTokenHashes: Set<string>;
}

const STATE_TTL_MS = 30_000;

interface CacheEntry {
  state: TenantState | null;
  expiresAt: number;
}

const stateCache = new Map<string, CacheEntry>();

export function invalidateTenantState(tenantId: string): void {
  stateCache.delete(tenantId);
}

export async function getTenantState(tenantId: string): Promise<TenantState | null> {
  const cached = stateCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  let state: TenantState | null = null;
  if (tenant) {
    const tokens = await db
      .select({ tokenHash: tunnelTokens.tokenHash })
      .from(tunnelTokens)
      .where(and(eq(tunnelTokens.tenantId, tenantId), isNull(tunnelTokens.revokedAt)));
    state = {
      id: tenant.id,
      subdomain: tenant.subdomain,
      status: tenant.status,
      throttled: tenant.throttled,
      validTokenHashes: new Set(tokens.map((t) => t.tokenHash)),
    };
  }
  stateCache.set(tenantId, { state, expiresAt: Date.now() + STATE_TTL_MS });
  return state;
}

/**
 * One-shot Ping rejection flags. Used to force frpc to reconnect so NewProxy
 * re-runs (e.g. to start/stop injecting a bandwidth limit after a throttle
 * transition). The next Ping for the tenant is rejected exactly once.
 */
const kickOnce = new Set<string>();

export function requestReconnect(tenantId: string): void {
  kickOnce.add(tenantId);
}

export function consumeReconnectRequest(tenantId: string): boolean {
  return kickOnce.delete(tenantId);
}

// ─── live connection state (fed by frp Login/CloseProxy + the usage poll) ──

interface ConnectionState {
  connected: boolean;
  updatedAt: number;
}

const connections = new Map<string, ConnectionState>();

export function setConnection(tenantId: string, connected: boolean): void {
  connections.set(tenantId, { connected, updatedAt: Date.now() });
}

export function getConnection(tenantId: string): boolean {
  const entry = connections.get(tenantId);
  if (!entry) return false;
  // The usage poll refreshes every minute; treat anything older than five
  // minutes as unknown/offline (e.g. after a control-plane restart).
  if (Date.now() - entry.updatedAt > 5 * 60_000) return false;
  return entry.connected;
}
