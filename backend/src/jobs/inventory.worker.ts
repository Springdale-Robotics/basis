import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { inventoryItems, inventoryStock, leftovers, notifications } from '../db/schema/index.js';
import { eq, and, lte, gte, isNotNull, isNull, inArray, sql } from 'drizzle-orm';
import { queueNotification } from './index.js';
import { emitLowStockAlert, emitExpiringAlert } from '../websocket/events.js';
import { sumStock } from '../lib/stock-total.js';
import { logger } from '../lib/logger.js';
import type { InventoryJobData } from './index.js';

export async function processInventoryJob(job: Job<InventoryJobData>): Promise<void> {
  const { type, householdId } = job.data;

  const log = logger.child({ jobId: job.id, type, householdId });
  log.debug('Processing inventory job');

  // The recurring jobs carry no householdId — run for every household.
  const householdIds = householdId
    ? [householdId]
    : (await db.query.households.findMany({ columns: { id: true } })).map((h) => h.id);

  // One household's failure must not abort (or, via BullMQ's whole-job
  // retry, re-run) the others — the old first-error throw re-notified every
  // household that had already succeeded, three times.
  let firstError: unknown = null;
  for (const hid of householdIds) {
    try {
      switch (type) {
        case 'check_low_stock':
          await checkLowStock(hid);
          break;
        case 'check_expiring':
          await checkExpiringItems(hid);
          break;
        case 'check_leftovers_expiring':
          await checkLeftoversExpiring(hid);
          break;
      }
    } catch (error) {
      log.error({ error, failedHouseholdId: hid }, 'Inventory check failed for household');
      firstError = firstError ?? error;
    }
  }
  log.debug('Inventory job completed');
  // Still surface the failure to BullMQ; the dedupe checks make a retry safe.
  if (firstError) throw firstError;
}

/**
 * Has an equivalent notification already been created since `since`?
 * Matches on type + householdId + the given data fields (jsonb ->> lookups).
 * This is what stops the daily worker from re-notifying about the same low
 * item or long-expired tranche every single day, forever.
 */
export async function alreadyNotified(
  householdId: string,
  type: 'low_stock' | 'expiring_soon' | 'leftover_expiring',
  dataMatch: Record<string, string>,
  since: Date,
): Promise<boolean> {
  const conditions = [
    eq(notifications.householdId, householdId),
    eq(notifications.type, type),
    gte(notifications.createdAt, since),
  ];
  for (const [key, value] of Object.entries(dataMatch)) {
    conditions.push(sql`${notifications.data}->>${key} = ${value}`);
  }
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Total on-hand quantity for an item, expressed in its default unit (shared
 * implementation in lib/stock-total.ts). Tranches whose unit can't be bridged
 * are added at face value (best-effort) rather than dropped, so we never
 * under-count and raise a false "low stock".
 */
function totalInDefaultUnit(
  stock: Array<{ quantity: string; unit: string | null }>,
  defaultUnit: string | null,
  density: number | null,
  quantityUnitSizes: Record<string, { quantity: number; unit: string }> | null
): number {
  const { convertedTotal, unconvertedRaw } = sumStock(stock, defaultUnit, density, quantityUnitSizes);
  return convertedTotal + unconvertedRaw;
}

async function checkLowStock(householdId: string): Promise<void> {
  // Only items the household actively keeps in stock, with a reorder threshold.
  const items = await db.query.inventoryItems.findMany({
    where: and(
      eq(inventoryItems.householdId, householdId),
      eq(inventoryItems.keepInStock, true),
      isNotNull(inventoryItems.minStockQuantity)
    ),
  });
  if (items.length === 0) return;

  const stockRows = await db
    .select({ itemId: inventoryStock.itemId, quantity: inventoryStock.quantity, unit: inventoryStock.unit })
    .from(inventoryStock)
    .where(inArray(inventoryStock.itemId, items.map((i) => i.id)));

  const stockByItem = new Map<string, Array<{ quantity: string; unit: string | null }>>();
  for (const s of stockRows) {
    if (!stockByItem.has(s.itemId)) stockByItem.set(s.itemId, []);
    stockByItem.get(s.itemId)!.push({ quantity: s.quantity, unit: s.unit });
  }

  let lowCount = 0;
  for (const item of items) {
    const min = Number(item.minStockQuantity);
    if (Number.isNaN(min)) continue;
    const total = totalInDefaultUnit(
      stockByItem.get(item.id) ?? [],
      item.defaultUnit,
      item.density ? Number(item.density) : null,
      item.quantityUnitSizes as Record<string, { quantity: number; unit: string }> | null
    );
    if (total > min) continue;

    // Remind at most weekly per item, not every day it stays low.
    if (await alreadyNotified(householdId, 'low_stock', { itemId: item.id }, daysAgo(7))) {
      continue;
    }
    lowCount += 1;

    emitLowStockAlert(householdId, {
      itemId: item.id,
      locationId: item.defaultAreaId || undefined,
      action: 'low_stock',
      item: { id: item.id, name: item.name, total, minQuantity: min, unit: item.defaultUnit },
    });

    await queueNotification({
      type: 'low_stock',
      householdId,
      title: 'Low Stock Alert',
      message: `${item.name} is running low (${total} ${item.defaultUnit || 'units'} on hand, keep ${min})`,
      data: { itemId: item.id, itemName: item.name, currentQuantity: total, minQuantity: min, unit: item.defaultUnit ?? undefined },
    });
  }

  logger.info({ householdId, lowStockCount: lowCount }, 'Low stock check completed');
}

async function checkExpiringItems(householdId: string): Promise<void> {
  const now = new Date();
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + 7); // 7-day warning window
  const thresholdStr = threshold.toISOString().split('T')[0];

  // inventory_stock has no household column; scope via the household's items.
  const items = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .where(eq(inventoryItems.householdId, householdId));
  if (items.length === 0) return;
  const nameById = new Map(items.map((i) => [i.id, i.name]));

  const expiring = await db
    .select({ id: inventoryStock.id, itemId: inventoryStock.itemId, expiryDate: inventoryStock.expiryDate })
    .from(inventoryStock)
    .where(
      and(
        inArray(inventoryStock.itemId, items.map((i) => i.id)),
        isNotNull(inventoryStock.expiryDate),
        lte(inventoryStock.expiryDate, thresholdStr)
      )
    );

  let notified = 0;
  for (const stock of expiring) {
    const name = nameById.get(stock.itemId) ?? 'An item';
    const [y, m, d] = stock.expiryDate!.split('-').map(Number);
    const expiry = new Date(y, m - 1, d);
    const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
    const isExpired = daysUntilExpiry <= 0;
    const urgency = isExpired ? 'expired' : daysUntilExpiry <= 3 ? 'urgent' : 'warning';

    // Floor: a tranche that expired over a week ago has been announced (or
    // predates notifications entirely) — stop notifying about it forever.
    if (daysUntilExpiry < -7) continue;

    // One notification per tranche per urgency level (warning → urgent →
    // expired), not one per day it sits in the window.
    if (
      await alreadyNotified(
        householdId,
        'expiring_soon',
        { stockId: stock.id, urgency },
        daysAgo(60),
      )
    ) {
      continue;
    }
    notified += 1;

    emitExpiringAlert(householdId, {
      itemId: stock.itemId,
      action: 'expiring',
      item: { id: stock.itemId, name, expiryDate: stock.expiryDate, daysUntilExpiry, urgency },
    });

    await queueNotification({
      type: 'expiring_soon',
      householdId,
      title: isExpired ? 'Item Expired' : 'Expiring Soon',
      message: isExpired
        ? `${name} has expired`
        : `${name} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`,
      data: { itemId: stock.itemId, itemName: name, daysUntilExpiry, stockId: stock.id, urgency },
    });
  }

  logger.info({ householdId, expiringCount: notified }, 'Expiring items check completed');
}

async function checkLeftoversExpiring(householdId: string): Promise<void> {
  const now = new Date();
  const warningThreshold = new Date();
  warningThreshold.setDate(warningThreshold.getDate() + 3); // 3-day warning for leftovers

  const expiringLeftovers = await db.query.leftovers.findMany({
    where: and(
      eq(leftovers.householdId, householdId),
      isNull(leftovers.finishedAt),
      lte(leftovers.expiryDate, warningThreshold.toISOString().split('T')[0])
    ),
  });

  for (const leftover of expiringLeftovers) {
    if (!leftover.expiryDate) continue;
    const [year, month, day] = leftover.expiryDate.split('-').map(Number);
    const expiryDate = new Date(year, month - 1, day);
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000);
    const ageInDays = Math.floor((now.getTime() - new Date(leftover.preparedAt).getTime()) / 86400000);
    const isExpired = daysUntilExpiry <= 0;
    const urgency = isExpired ? 'expired' : 'warning';

    // Same floor + per-urgency dedupe as stock expiry: unfinished leftovers
    // live forever, and used to generate a fresh notification every day.
    if (daysUntilExpiry < -7) continue;
    if (
      await alreadyNotified(
        householdId,
        'leftover_expiring',
        { leftoverId: leftover.id, urgency },
        daysAgo(60),
      )
    ) {
      continue;
    }

    const message = isExpired
      ? `Leftover "${leftover.name}" (${ageInDays} days old) has expired!`
      : daysUntilExpiry === 1
        ? `Leftover "${leftover.name}" (${ageInDays} days old) expires tomorrow!`
        : `Leftover "${leftover.name}" (${ageInDays} days old) expires in ${daysUntilExpiry} days`;

    await queueNotification({
      type: 'leftover_expiring',
      householdId,
      title: isExpired ? 'Leftover Expired' : 'Leftover Expiring Soon',
      message,
      data: {
        leftoverId: leftover.id,
        leftoverName: leftover.name,
        daysUntilExpiry,
        preparedAt: leftover.preparedAt.toISOString(),
        urgency,
      },
    });
  }

  logger.info(
    { householdId, expiringCount: expiringLeftovers.length },
    'Expiring leftovers check completed'
  );
}
