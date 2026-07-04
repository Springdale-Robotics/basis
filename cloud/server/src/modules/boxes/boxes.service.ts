import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  claimCodes,
  subscriptions,
  tenants,
  tunnelTokens,
} from '../../db/schema/index.js';
import { newTunnelToken, normalizeClaimCode, sha256Hex } from '../../lib/tokens.js';
import { capGbForTier, type Tier } from '../../lib/stripe.js';
import { config } from '../../config/index.js';
import { invalidateTenantState } from '../../services/tenant-state.js';
import { getMonthUsage } from '../usage/usage.service.js';

export interface ClaimPayload {
  tenantId: string;
  subdomain: string;
  hostname: string;
  relay: { serverAddr: string; serverPort: number };
  tunnelToken: string;
}

export type RedeemError = 'CLAIM_CODE_INVALID' | 'CLAIM_CODE_EXPIRED' | 'CLAIM_CODE_USED';

/**
 * Redeem a one-time claim code: mark it used, rotate the tenant's tunnel
 * tokens (all priors revoked), return the new credentials.
 */
export async function redeemClaimCode(rawCode: string): Promise<ClaimPayload | RedeemError> {
  const code = normalizeClaimCode(rawCode);
  if (!code) return 'CLAIM_CODE_INVALID';
  const codeHash = sha256Hex(code);

  const row = await db.query.claimCodes.findFirst({
    where: eq(claimCodes.codeHash, codeHash),
  });
  if (!row) return 'CLAIM_CODE_INVALID';
  if (row.usedAt) return 'CLAIM_CODE_USED';
  if (row.expiresAt.getTime() <= Date.now()) return 'CLAIM_CODE_EXPIRED';

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, row.tenantId) });
  if (!tenant) return 'CLAIM_CODE_INVALID';
  // Codes are only issued to active tenants, but a subscription can lapse
  // between issue and redeem.
  if (tenant.status !== 'active' && tenant.status !== 'past_due') {
    return 'CLAIM_CODE_EXPIRED';
  }

  const token = newTunnelToken();

  const claimed = await db.transaction(async (tx) => {
    // Guard against a concurrent redeem of the same code.
    const marked = await tx
      .update(claimCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(claimCodes.id, row.id), isNull(claimCodes.usedAt)))
      .returning({ id: claimCodes.id });
    if (marked.length === 0) return false;

    await tx
      .update(tunnelTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(tunnelTokens.tenantId, tenant.id), isNull(tunnelTokens.revokedAt)));
    await tx.insert(tunnelTokens).values({
      tenantId: tenant.id,
      tokenHash: sha256Hex(token),
    });
    return true;
  });
  if (!claimed) return 'CLAIM_CODE_USED';

  invalidateTenantState(tenant.id);

  return {
    tenantId: tenant.id,
    subdomain: tenant.subdomain,
    hostname: `${tenant.subdomain}.${config.RELAY_SERVER_ADDR}`,
    relay: { serverAddr: config.RELAY_SERVER_ADDR, serverPort: config.RELAY_SERVER_PORT },
    tunnelToken: token,
  };
}

export interface HeartbeatPayload {
  status: 'active' | 'suspended' | 'canceled';
  tier: Tier | 'none';
  usage: { monthGB: number; capGB: number };
}

/** Map internal tenant lifecycle onto the coarse box-facing contract. */
export function boxStatusFor(
  tenantStatus: 'unpaid' | 'active' | 'past_due' | 'suspended' | 'canceled'
): HeartbeatPayload['status'] {
  switch (tenantStatus) {
    case 'active':
    case 'past_due': // in-grace — the box shouldn't alarm the family yet
      return 'active';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
    case 'suspended':
      return 'suspended';
  }
}

export async function processHeartbeat(bearerToken: string): Promise<HeartbeatPayload | null> {
  const tokenHash = sha256Hex(bearerToken);
  const token = await db.query.tunnelTokens.findFirst({
    where: and(eq(tunnelTokens.tokenHash, tokenHash), isNull(tunnelTokens.revokedAt)),
  });
  if (!token) return null;

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, token.tenantId),
  });
  if (!tenant) return null;

  const now = new Date();
  await db.update(tunnelTokens).set({ lastUsedAt: now }).where(eq(tunnelTokens.id, token.id));
  await db.update(tenants).set({ lastHeartbeatAt: now }).where(eq(tenants.id, tenant.id));

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenant.id),
  });
  const tier = (sub?.tier ?? null) as Tier | null;
  const usage = await getMonthUsage(tenant.id);

  return {
    status: boxStatusFor(tenant.status),
    tier: tier ?? 'none',
    usage: { monthGB: usage.monthGB, capGB: tier ? capGbForTier(tier) : 0 },
  };
}
