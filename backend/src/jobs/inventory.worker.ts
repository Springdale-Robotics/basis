import { Job } from 'bullmq';
import { db } from '../config/database.js';
import { inventoryItems, households, leftovers } from '../db/schema/index.js';
import { eq, and, lt, lte, isNotNull, isNull } from 'drizzle-orm';
import { queueNotification } from './index.js';
import { emitLowStockAlert, emitExpiringAlert } from '../websocket/events.js';
import { logger } from '../lib/logger.js';
import type { InventoryJobData } from './index.js';

export async function processInventoryJob(job: Job<InventoryJobData>): Promise<void> {
  const { type, householdId } = job.data;

  const log = logger.child({ jobId: job.id, type, householdId });
  log.debug('Processing inventory job');

  try {
    switch (type) {
      case 'check_low_stock':
        await checkLowStock(householdId);
        break;
      case 'check_expiring':
        await checkExpiringItems(householdId);
        break;
      case 'check_leftovers_expiring':
        await checkLeftoversExpiring(householdId);
        break;
      case 'update_quantities':
        await updateQuantities(householdId);
        break;
    }

    log.debug('Inventory job completed');
  } catch (error) {
    log.error({ error }, 'Inventory job failed');
    throw error;
  }
}

async function checkLowStock(householdId: string): Promise<void> {
  // Find items where quantity <= minQuantity
  const allItems = await db.query.inventoryItems.findMany({
    where: eq(inventoryItems.householdId, householdId),
  });

  const lowStockItems = allItems.filter(
    (item) => item.minQuantity !== null && item.quantity <= item.minQuantity
  );

  logger.info(
    { householdId, lowStockCount: lowStockItems.length },
    'Low stock check completed'
  );

  for (const item of lowStockItems) {
    // Emit real-time alert
    emitLowStockAlert(householdId, {
      itemId: item.id,
      locationId: item.locationId || undefined,
      action: 'low_stock',
      item: {
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        minQuantity: item.minQuantity,
        unit: item.unit,
      },
    });

    // Queue notification
    await queueNotification({
      type: 'low_stock',
      householdId,
      title: 'Low Stock Alert',
      message: `${item.name} is running low (${item.quantity} ${item.unit || 'units'} remaining)`,
      data: {
        itemId: item.id,
        itemName: item.name,
        quantity: item.quantity,
        minQuantity: item.minQuantity,
      },
    });
  }
}

async function checkExpiringItems(householdId: string): Promise<void> {
  const now = new Date();
  const warningThreshold = new Date();
  warningThreshold.setDate(warningThreshold.getDate() + 7); // 7 days warning

  // Find items expiring within 7 days
  const expiringItems = await db.query.inventoryItems.findMany({
    where: and(
      eq(inventoryItems.householdId, householdId),
      isNotNull(inventoryItems.expiryDate),
      lte(inventoryItems.expiryDate, warningThreshold)
    ),
  });

  logger.info(
    { householdId, expiringCount: expiringItems.length },
    'Expiring items check completed'
  );

  for (const item of expiringItems) {
    const daysUntilExpiry = Math.ceil(
      (item.expiryDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    const isExpired = daysUntilExpiry <= 0;
    const urgency = isExpired ? 'expired' : daysUntilExpiry <= 3 ? 'urgent' : 'warning';

    // Emit real-time alert
    emitExpiringAlert(householdId, {
      itemId: item.id,
      locationId: item.locationId || undefined,
      action: 'expiring',
      item: {
        id: item.id,
        name: item.name,
        expiryDate: item.expiryDate,
        daysUntilExpiry,
        urgency,
      },
    });

    // Queue notification
    const message = isExpired
      ? `${item.name} has expired!`
      : `${item.name} will expire in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`;

    await queueNotification({
      type: 'expiring_soon',
      householdId,
      title: isExpired ? 'Item Expired' : 'Expiring Soon',
      message,
      data: {
        itemId: item.id,
        itemName: item.name,
        expiryDate: item.expiryDate,
        daysUntilExpiry,
        urgency,
      },
    });
  }
}

async function checkLeftoversExpiring(householdId: string): Promise<void> {
  const now = new Date();
  const warningThreshold = new Date();
  warningThreshold.setDate(warningThreshold.getDate() + 3); // 3 days warning for leftovers

  // Find active leftovers expiring within 3 days
  const expiringLeftovers = await db.query.leftovers.findMany({
    where: and(
      eq(leftovers.householdId, householdId),
      isNull(leftovers.finishedAt),
      lte(leftovers.expiryDate, warningThreshold.toISOString().split('T')[0])
    ),
  });

  logger.info(
    { householdId, expiringCount: expiringLeftovers.length },
    'Expiring leftovers check completed'
  );

  for (const leftover of expiringLeftovers) {
    // Parse the expiry date as local date
    const [year, month, day] = leftover.expiryDate.split('-').map(Number);
    const expiryDate = new Date(year, month - 1, day);
    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Calculate age
    const preparedDate = new Date(leftover.preparedAt);
    const ageInDays = Math.floor(
      (now.getTime() - preparedDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    const isExpired = daysUntilExpiry <= 0;

    // Build the message
    let message: string;
    if (isExpired) {
      message = `Leftover "${leftover.name}" (${ageInDays} days old) has expired!`;
    } else if (daysUntilExpiry === 1) {
      message = `Leftover "${leftover.name}" (${ageInDays} days old) expires tomorrow!`;
    } else {
      message = `Leftover "${leftover.name}" (${ageInDays} days old) expires in ${daysUntilExpiry} days`;
    }

    // Queue notification
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
      },
    });
  }
}

async function updateQuantities(householdId: string): Promise<void> {
  // This could be used for auto-consumption tracking or other quantity updates
  // For now, just log that it was called
  logger.debug({ householdId }, 'Update quantities called (no-op for now)');
}

// Schedule inventory checks for all households
export async function scheduleInventoryChecksForAllHouseholds(): Promise<void> {
  const allHouseholds = await db.query.households.findMany({
    columns: { id: true },
  });

  const { inventoryQueue } = await import('./index.js');

  for (const household of allHouseholds) {
    // Schedule low stock check daily at 8 AM
    await inventoryQueue.add(
      'check_low_stock',
      { type: 'check_low_stock', householdId: household.id },
      {
        repeat: { pattern: '0 8 * * *' }, // Daily at 8 AM
        jobId: `inventory:low_stock:${household.id}`,
      }
    );

    // Schedule expiring check daily at 9 AM
    await inventoryQueue.add(
      'check_expiring',
      { type: 'check_expiring', householdId: household.id },
      {
        repeat: { pattern: '0 9 * * *' }, // Daily at 9 AM
        jobId: `inventory:expiring:${household.id}`,
      }
    );

    // Schedule leftovers expiring check daily at 9 AM (alongside regular expiring check)
    await inventoryQueue.add(
      'check_leftovers_expiring',
      { type: 'check_leftovers_expiring', householdId: household.id },
      {
        repeat: { pattern: '0 9 * * *' }, // Daily at 9 AM
        jobId: `inventory:leftovers_expiring:${household.id}`,
      }
    );
  }

  logger.info({ count: allHouseholds.length }, 'Scheduled inventory checks for all households');
}
