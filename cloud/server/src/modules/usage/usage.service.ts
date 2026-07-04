import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { usageLedger } from '../../db/schema/index.js';

/** First-of-month UTC, as a YYYY-MM-DD date string (usage_ledger.month). */
export function currentMonthKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

export function bytesToGb(bytes: number): number {
  return Math.round((bytes / 1e9) * 100) / 100;
}

export async function getMonthUsage(
  tenantId: string
): Promise<{ monthGB: number; bytesIn: number; bytesOut: number; warned80: boolean }> {
  const row = await db.query.usageLedger.findFirst({
    where: and(eq(usageLedger.tenantId, tenantId), eq(usageLedger.month, currentMonthKey())),
  });
  if (!row) return { monthGB: 0, bytesIn: 0, bytesOut: 0, warned80: false };
  return {
    monthGB: bytesToGb(row.bytesIn + row.bytesOut),
    bytesIn: row.bytesIn,
    bytesOut: row.bytesOut,
    warned80: row.warned80,
  };
}

/** Upsert-add a transfer delta for the current month. Returns the new totals. */
export async function addUsageDelta(
  tenantId: string,
  deltaIn: number,
  deltaOut: number
): Promise<{ bytesIn: number; bytesOut: number }> {
  const month = currentMonthKey();
  const [row] = await db
    .insert(usageLedger)
    .values({ tenantId, month, bytesIn: deltaIn, bytesOut: deltaOut })
    .onConflictDoUpdate({
      target: [usageLedger.tenantId, usageLedger.month],
      set: {
        bytesIn: sql`${usageLedger.bytesIn} + ${deltaIn}`,
        bytesOut: sql`${usageLedger.bytesOut} + ${deltaOut}`,
        updatedAt: new Date(),
      },
    })
    .returning({ bytesIn: usageLedger.bytesIn, bytesOut: usageLedger.bytesOut });
  return row;
}

export async function markWarned80(tenantId: string): Promise<void> {
  await db
    .update(usageLedger)
    .set({ warned80: true })
    .where(and(eq(usageLedger.tenantId, tenantId), eq(usageLedger.month, currentMonthKey())));
}
