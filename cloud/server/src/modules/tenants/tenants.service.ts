import { and, eq, ne } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  claimCodes,
  subscriptions,
  tenants,
  tunnelTokens,
  type Tenant,
} from '../../db/schema/index.js';
import { validateSubdomainFormat } from '../../lib/reserved-subdomains.js';
import { newClaimCode, sha256Hex } from '../../lib/tokens.js';
import { capGbForTier, type Tier } from '../../lib/stripe.js';
import { getConnection, invalidateTenantState } from '../../services/tenant-state.js';
import { getMonthUsage } from '../usage/usage.service.js';

const CLAIM_CODE_TTL_MS = 60 * 60 * 1000; // 1h

export type AvailabilityReason =
  | 'invalid format'
  | 'reserved'
  | 'taken'
  | 'reserved for its previous owner';

export async function checkSubdomainAvailability(
  name: string,
  forAccountId?: string
): Promise<{ available: boolean; reason?: AvailabilityReason }> {
  const formatIssue = validateSubdomainFormat(name);
  if (formatIssue === 'reserved') return { available: false, reason: 'reserved' };
  if (formatIssue) return { available: false, reason: 'invalid format' };

  const rows = await db.query.tenants.findMany({ where: eq(tenants.subdomain, name) });
  for (const row of rows) {
    if (row.status !== 'canceled') {
      // Their own live tenant shouldn't read as "taken by someone else".
      if (forAccountId && row.accountId === forAccountId) continue;
      return { available: false, reason: 'taken' };
    }
    if (
      row.tombstonedUntil &&
      row.tombstonedUntil.getTime() > Date.now() &&
      row.accountId !== forAccountId
    ) {
      return { available: false, reason: 'reserved for its previous owner' };
    }
  }
  return { available: true };
}

export type CreateTenantError =
  | 'SUBDOMAIN_INVALID'
  | 'SUBDOMAIN_RESERVED'
  | 'SUBDOMAIN_TAKEN'
  | 'TENANT_EXISTS';

export async function createTenant(
  accountId: string,
  subdomain: string
): Promise<Tenant | CreateTenantError> {
  const formatIssue = validateSubdomainFormat(subdomain);
  if (formatIssue === 'reserved') return 'SUBDOMAIN_RESERVED';
  if (formatIssue) return 'SUBDOMAIN_INVALID';

  const availability = await checkSubdomainAvailability(subdomain, accountId);
  if (!availability.available) {
    return availability.reason === 'reserved' ? 'SUBDOMAIN_RESERVED' : 'SUBDOMAIN_TAKEN';
  }

  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, accountId),
  });

  if (existing && existing.status !== 'canceled') return 'TENANT_EXISTS';

  if (existing) {
    // Re-subscribing after cancellation: reuse the row (the account-unique
    // index means we can't insert a second one), reset the lifecycle.
    const [updated] = await db
      .update(tenants)
      .set({
        subdomain,
        status: 'unpaid',
        throttled: false,
        tombstonedUntil: null,
        canceledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, existing.id))
      .returning();
    invalidateTenantState(existing.id);
    return updated;
  }

  try {
    const [tenant] = await db.insert(tenants).values({ accountId, subdomain }).returning();
    return tenant;
  } catch (err: unknown) {
    // Unique-index race (someone claimed it between check and insert).
    if ((err as { code?: string }).code === '23505') return 'SUBDOMAIN_TAKEN';
    throw err;
  }
}

export interface TenantSummary {
  id: string;
  subdomain: string;
  hostname: string;
  status: Tenant['status'];
  throttled: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
  lastHeartbeatAt: string | null;
  tier: Tier | null;
  isComp: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  usage: { monthGB: number; capGB: number | null; warned80: boolean };
}

export async function getTenantSummary(
  accountId: string,
  relayDomain: string
): Promise<TenantSummary | null> {
  const tenant = await db.query.tenants.findFirst({
    where: and(eq(tenants.accountId, accountId), ne(tenants.status, 'canceled')),
  });
  // Show canceled tenants too (so the dashboard can explain), but prefer a
  // live one when both somehow exist.
  const effective =
    tenant ??
    (await db.query.tenants.findFirst({ where: eq(tenants.accountId, accountId) }));
  if (!effective) return null;

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, effective.id),
  });
  const usage = await getMonthUsage(effective.id);
  const tier = (sub?.tier ?? null) as Tier | null;

  return {
    id: effective.id,
    subdomain: effective.subdomain,
    hostname: `${effective.subdomain}.${relayDomain}`,
    status: effective.status,
    throttled: effective.throttled,
    connected: getConnection(effective.id),
    lastConnectedAt: effective.lastConnectedAt?.toISOString() ?? null,
    lastHeartbeatAt: effective.lastHeartbeatAt?.toISOString() ?? null,
    tier,
    isComp: sub?.isComp ?? false,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    usage: {
      monthGB: usage.monthGB,
      capGB: tier ? capGbForTier(tier) : null,
      warned80: usage.warned80,
    },
  };
}

export type ClaimCodeError = 'NO_TENANT' | 'SUBSCRIPTION_REQUIRED';

/** Claim codes are only issuable for tenants that can actually tunnel. */
export async function issueClaimCode(
  accountId: string
): Promise<{ code: string; expiresAt: Date } | ClaimCodeError> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, accountId),
  });
  if (!tenant) return 'NO_TENANT';
  if (tenant.status !== 'active' && tenant.status !== 'past_due') {
    return 'SUBSCRIPTION_REQUIRED';
  }

  const code = newClaimCode();
  const expiresAt = new Date(Date.now() + CLAIM_CODE_TTL_MS);

  await db.transaction(async (tx) => {
    // A new code voids any outstanding ones — one live code per tenant.
    await tx
      .update(claimCodes)
      .set({ expiresAt: new Date(0) })
      .where(eq(claimCodes.tenantId, tenant.id));
    await tx.insert(claimCodes).values({
      tenantId: tenant.id,
      codeHash: sha256Hex(code),
      expiresAt,
    });
  });

  return { code, expiresAt };
}

export async function revokeTunnelTokens(accountId: string): Promise<boolean> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.accountId, accountId),
  });
  if (!tenant) return false;
  await db
    .update(tunnelTokens)
    .set({ revokedAt: new Date() })
    .where(eq(tunnelTokens.tenantId, tenant.id));
  invalidateTenantState(tenant.id);
  return true;
}
