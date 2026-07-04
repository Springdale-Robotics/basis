import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { tenants } from '../../db/schema/index.js';
import { sha256Hex } from '../../lib/tokens.js';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import {
  consumeReconnectRequest,
  getTenantState,
  setConnection,
} from '../../services/tenant-state.js';

/**
 * Decision logic for frps server-plugin RPCs. frps consults us on:
 *   Login      — a box connected: authenticate user (tenantId) + metas.token
 *   NewProxy   — a box registered its proxy: enforce shape + subdomain,
 *                inject a server-enforced bandwidth limit when throttled
 *   Ping       — box heartbeat (~30s): the enforcement hook; rejecting drops
 *                the client (frps has no kick API — this IS the kick)
 *   CloseProxy — bookkeeping for the dashboard's connected badge
 *
 * Responses (frp server_plugin protocol):
 *   { reject: true, reject_reason }         — deny
 *   { reject: false, unchange: true }       — allow as-is
 *   { unchange: false, content: {...} }     — allow with modified config
 */

type FrpDecision =
  | { reject: true; reject_reason: string }
  | { reject: false; unchange: true }
  | { unchange: false; content: Record<string, unknown> };

const ALLOW: FrpDecision = { reject: false, unchange: true };
// Coarse on purpose: reject reasons reach the customer's frpc logs, and must
// not leak whether a tenant exists or why exactly it was refused.
const DENY: FrpDecision = { reject: true, reject_reason: 'not authorized' };

interface FrpUser {
  user?: string;
  metas?: Record<string, string>;
  run_id?: string;
}

function tunnelAllowed(status: string): boolean {
  return status === 'active' || status === 'past_due';
}

async function authenticate(user: string | undefined, token: string | undefined) {
  if (!user || !token) return null;
  const state = await getTenantState(user);
  if (!state) return null;
  if (!state.validTokenHashes.has(sha256Hex(token))) return null;
  return state;
}

export async function handleLogin(content: {
  user?: string;
  metas?: Record<string, string>;
  client_address?: string;
}): Promise<FrpDecision> {
  const state = await authenticate(content.user, content.metas?.token);
  if (!state || !tunnelAllowed(state.status)) {
    logger.info(
      { op: 'Login', user: content.user, from: content.client_address, decision: 'reject' },
      'frp login rejected'
    );
    return DENY;
  }

  setConnection(state.id, true);
  void db
    .update(tenants)
    .set({ lastConnectedAt: new Date() })
    .where(eq(tenants.id, state.id))
    .catch(() => undefined);

  logger.info(
    { op: 'Login', user: content.user, from: content.client_address, decision: 'allow' },
    'frp login'
  );
  return ALLOW;
}

export async function handleNewProxy(content: {
  user?: FrpUser;
  proxy_name?: string;
  proxy_type?: string;
  subdomain?: string;
  custom_domains?: string[];
  [key: string]: unknown;
}): Promise<FrpDecision> {
  const user = content.user?.user;
  const state = await authenticate(user, content.user?.metas?.token);
  if (!state || !tunnelAllowed(state.status)) return DENY;

  // frps names proxies "<user>.<name>" — the box always registers "web".
  const bareName = content.proxy_name?.replace(`${user}.`, '');
  if (content.proxy_type !== 'http' || bareName !== 'web') {
    logger.warn(
      { op: 'NewProxy', user, type: content.proxy_type, name: content.proxy_name },
      'frp proxy shape rejected'
    );
    return DENY;
  }
  if (content.subdomain !== state.subdomain) {
    logger.warn(
      { op: 'NewProxy', user, subdomain: content.subdomain, expected: state.subdomain },
      'frp cross-tenant subdomain rejected'
    );
    return DENY;
  }
  if (content.custom_domains && content.custom_domains.length > 0) {
    return DENY;
  }

  if (state.throttled) {
    // Server-enforced rate limit for over-cap Basic tenants. "MB" in frp's
    // bandwidth syntax is megabytes/s; convert from megabits.
    const kbPerSecond = Math.max(64, Math.round((config.THROTTLE_BASIC_MBPS * 1024) / 8));
    logger.info({ op: 'NewProxy', user, throttleKB: kbPerSecond }, 'frp proxy throttled');
    return {
      unchange: false,
      content: {
        ...content,
        bandwidth_limit: `${kbPerSecond}KB`,
        bandwidth_limit_mode: 'server',
      },
    };
  }

  return ALLOW;
}

export async function handlePing(content: { user?: FrpUser }): Promise<FrpDecision> {
  const user = content.user?.user;
  const state = await authenticate(user, content.user?.metas?.token);
  if (!state || !tunnelAllowed(state.status)) {
    logger.info({ op: 'Ping', user, decision: 'reject' }, 'frp ping rejected — dropping client');
    if (state) setConnection(state.id, false);
    return DENY;
  }
  // One-shot kick so frpc reconnects and NewProxy re-runs (throttle on/off).
  if (consumeReconnectRequest(state.id)) {
    logger.info({ op: 'Ping', user }, 'frp ping rejected once to force reconnect');
    return DENY;
  }
  return ALLOW;
}

export async function handleCloseProxy(content: { user?: FrpUser }): Promise<FrpDecision> {
  const user = content.user?.user;
  if (user) {
    const state = await getTenantState(user);
    if (state) setConnection(state.id, false);
  }
  return ALLOW;
}
