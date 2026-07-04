import { and, eq, isNull, lt } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  claimCodes,
  subscriptions,
  tenants,
  usagePollState,
} from '../db/schema/index.js';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { capGbForTier, type Tier } from '../lib/stripe.js';
import { listHttpProxies } from './frps-admin.client.js';
import {
  invalidateTenantState,
  requestReconnect,
  setConnection,
} from './tenant-state.js';
import {
  addUsageDelta,
  bytesToGb,
  currentMonthKey,
  markWarned80,
} from '../modules/usage/usage.service.js';

/**
 * Polls the frps admin API and accumulates per-tenant transfer into the
 * monthly ledger, then enforces tier caps.
 *
 * frps `today_*` counters live in memory and reset on frps restart AND at
 * midnight. We therefore persist the last observed counters per proxy
 * (usage_poll_state) and add deltas; when a counter goes backwards we treat
 * the current value as the delta (everything since the reset). Worst case we
 * lose one poll interval of traffic around a reset — acceptable for billing
 * that only gates at hundreds of GB.
 */

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastSweepDay = '';
let observedMonth = currentMonthKey();

/**
 * Delta between the last observed frps counter and the current one. A counter
 * that went backwards means frps restarted or rolled over at midnight — count
 * everything since the reset.
 */
export function computeDelta(last: number, current: number): number {
  return current >= last ? current - last : current;
}

export function startUsageMeter(): void {
  if (timer) return;
  timer = setInterval(() => void pollOnce(), config.USAGE_POLL_INTERVAL_MS);
  timer.unref();
  void pollOnce();
  logger.info(
    { intervalMs: config.USAGE_POLL_INTERVAL_MS },
    'Usage meter started'
  );
}

export function stopUsageMeter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function pollOnce(): Promise<void> {
  if (running) return; // don't overlap slow polls
  running = true;
  try {
    await handleMonthRollover();
    await meterTraffic();
    await dailySweep();
  } catch (err) {
    logger.warn({ err }, 'Usage meter poll failed (will retry next interval)');
  } finally {
    running = false;
  }
}

async function meterTraffic(): Promise<void> {
  let proxies;
  try {
    proxies = await listHttpProxies();
  } catch (err) {
    logger.debug({ err }, 'frps admin API unreachable — skipping usage poll');
    return;
  }

  for (const proxy of proxies) {
    // Proxy names are "<tenantId>.web".
    const tenantId = proxy.name.endsWith('.web')
      ? proxy.name.slice(0, -'.web'.length)
      : null;
    if (!tenantId) continue;

    setConnection(tenantId, proxy.status === 'online' && proxy.curConns >= 0);

    const prior = await db.query.usagePollState.findFirst({
      where: eq(usagePollState.proxyName, proxy.name),
    });

    const deltaIn = computeDelta(prior?.lastIn ?? 0, proxy.todayTrafficIn);
    const deltaOut = computeDelta(prior?.lastOut ?? 0, proxy.todayTrafficOut);

    await db
      .insert(usagePollState)
      .values({
        proxyName: proxy.name,
        lastIn: proxy.todayTrafficIn,
        lastOut: proxy.todayTrafficOut,
        polledAt: new Date(),
      })
      .onConflictDoUpdate({
        target: usagePollState.proxyName,
        set: {
          lastIn: proxy.todayTrafficIn,
          lastOut: proxy.todayTrafficOut,
          polledAt: new Date(),
        },
      });

    if (deltaIn === 0 && deltaOut === 0) continue;

    const totals = await addUsageDelta(tenantId, deltaIn, deltaOut);
    await enforceCaps(tenantId, bytesToGb(totals.bytesIn + totals.bytesOut));
  }
}

async function enforceCaps(tenantId: string, monthGB: number): Promise<void> {
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
  if (!tenant) return;
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.tenantId, tenantId),
  });
  const tier = (sub?.tier ?? 'basic') as Tier;
  const capGB = capGbForTier(tier);

  if (monthGB >= capGB * 0.8) {
    // Idempotent-enough: markWarned80 just sets a flag the dashboard reads.
    await markWarned80(tenantId);
  }

  if (tier === 'basic') {
    if (monthGB >= capGB && !tenant.throttled) {
      logger.info({ tenantId, monthGB, capGB }, 'Basic tenant over cap — throttling');
      await db.update(tenants).set({ throttled: true, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
      invalidateTenantState(tenantId);
      // Force a reconnect so NewProxy re-runs and injects the bandwidth limit.
      requestReconnect(tenantId);
    }
  } else if (monthGB >= capGB) {
    // Streaming soft cap: log for manual review, never auto-enforce.
    logger.warn({ tenantId, monthGB, capGB }, 'Streaming tenant over soft cap');
  }
}

async function handleMonthRollover(): Promise<void> {
  const month = currentMonthKey();
  if (month === observedMonth) return;
  observedMonth = month;
  logger.info({ month }, 'Usage month rollover — clearing throttles');
  const throttledTenants = await db.query.tenants.findMany({
    where: eq(tenants.throttled, true),
  });
  for (const tenant of throttledTenants) {
    await db
      .update(tenants)
      .set({ throttled: false, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));
    invalidateTenantState(tenant.id);
    requestReconnect(tenant.id); // reconnect without the bandwidth limit
  }
}

/** Once a day: expire grace periods, purge dead claim codes. */
async function dailySweep(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (today === lastSweepDay) return;
  lastSweepDay = today;

  const now = new Date();

  // Grace expired → suspend.
  const lapsed = await db
    .select({ tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .innerJoin(tenants, eq(subscriptions.tenantId, tenants.id))
    .where(
      and(
        lt(subscriptions.graceUntil, now),
        eq(tenants.status, 'past_due'),
        eq(subscriptions.isComp, false)
      )
    );
  for (const row of lapsed) {
    logger.info({ tenantId: row.tenantId }, 'Grace period expired — suspending tenant');
    await db
      .update(tenants)
      .set({ status: 'suspended', updatedAt: now })
      .where(eq(tenants.id, row.tenantId));
    invalidateTenantState(row.tenantId);
  }

  // Expired, never-used claim codes are just noise — delete.
  await db
    .delete(claimCodes)
    .where(and(lt(claimCodes.expiresAt, now), isNull(claimCodes.usedAt)));
}
