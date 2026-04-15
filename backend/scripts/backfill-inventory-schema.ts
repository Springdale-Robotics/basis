/**
 * Backfill script for the inventory schema changes (Phase 1).
 *
 * 1A.3: Backfill existing stock entries with confidence=50, source='migration',
 *        original_quantity=quantity, verified_at=null
 *
 * 1B.2: Backfill existing inventory areas with location_type guessed from name
 *
 * Run with: cd backend && npx tsx scripts/backfill-inventory-schema.ts
 * Requires DATABASE_URL env var (auto-set by dev.sh).
 */

import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required');
  console.error('Run this script via: cd backend && npx tsx scripts/backfill-inventory-schema.ts');
  process.exit(1);
}

const sql = postgres(connectionString);

async function backfillStockTranches() {
  console.log('\n=== 1A.3: Backfilling inventory_stock tranches ===');

  // Set confidence=50 for all existing entries that have default (100) and no verified_at
  // These are pre-existing entries from before the confidence system — we don't know
  // their true state, so 50 is a neutral starting point.
  const result = await sql`
    UPDATE inventory_stock
    SET
      confidence = 50,
      source = 'migration',
      original_quantity = COALESCE(original_quantity, quantity),
      verified_at = NULL
    WHERE source = 'manual'
      AND verified_at IS NULL
      AND original_quantity IS NULL
  `;

  console.log(`  Updated ${result.count} stock entries`);
}

async function backfillAreaLocationTypes() {
  console.log('\n=== 1B.2: Backfilling inventory_areas location types ===');

  // Guess location_type from area name
  const areas = await sql`
    SELECT id, name, location_type FROM inventory_areas
    WHERE location_type = 'other'
  `;

  let updated = 0;
  for (const area of areas) {
    const name = area.name.toLowerCase();
    let locationType: string | null = null;

    if (name.includes('fridge') || name.includes('refrigerator') || name.includes('icebox')) {
      locationType = 'fridge';
    } else if (name.includes('freezer') || name.includes('deep freeze')) {
      locationType = 'freezer';
    } else if (
      name.includes('pantry') ||
      name.includes('cupboard') ||
      name.includes('cabinet') ||
      name.includes('shelf') ||
      name.includes('closet') ||
      name.includes('dry storage')
    ) {
      locationType = 'pantry';
    }

    if (locationType) {
      await sql`
        UPDATE inventory_areas
        SET location_type = ${locationType}
        WHERE id = ${area.id}
      `;
      console.log(`  "${area.name}" -> ${locationType}`);
      updated++;
    }
  }

  console.log(`  Updated ${updated} of ${areas.length} areas (${areas.length - updated} left as 'other')`);
}

async function main() {
  console.log('Starting inventory schema backfill...');

  try {
    await backfillStockTranches();
    await backfillAreaLocationTypes();
    console.log('\nBackfill complete.');
  } catch (err) {
    console.error('Backfill failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
