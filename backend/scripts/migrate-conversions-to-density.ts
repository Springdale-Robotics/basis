/**
 * Migration script: Convert unitConversions arrays to density + quantityUnitWeights
 *
 * This reads all inventory_items that have non-empty unit_conversions JSONB,
 * extracts density (g/ml) from any volume↔weight conversions, and populates
 * quantity_unit_weights from any quantity↔weight conversions.
 *
 * For items without volume↔weight conversions, falls back to lookupDensity().
 *
 * Run with: npx tsx scripts/migrate-conversions-to-density.ts
 * (Requires DATABASE_URL env var)
 */

import postgres from 'postgres';
import { lookupDensity } from '../src/lib/ingredient-densities.js';
import { isCountUnit as isQuantityUnit } from '../src/lib/units.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

// Volume unit → milliliters conversion factors
const VOLUME_TO_ML: Record<string, number> = {
  'cup': 236.588,
  'cups': 236.588,
  'tbsp': 14.787,
  'tablespoon': 14.787,
  'tablespoons': 14.787,
  'tsp': 4.929,
  'teaspoon': 4.929,
  'teaspoons': 4.929,
  'fl oz': 29.5735,
  'ml': 1,
  'milliliter': 1,
  'milliliters': 1,
  'l': 1000,
  'liter': 1000,
  'liters': 1000,
  'litre': 1000,
  'litres': 1000,
  'pints': 473.176,
  'quarts': 946.353,
  'gallons': 3785.41,
};

// Weight unit → grams conversion factors
const WEIGHT_TO_G: Record<string, number> = {
  'g': 1,
  'gram': 1,
  'grams': 1,
  'kg': 1000,
  'kilogram': 1000,
  'kilograms': 1000,
  'oz': 28.3495,
  'ounce': 28.3495,
  'ounces': 28.3495,
  'lb': 453.592,
  'lbs': 453.592,
  'pound': 453.592,
  'pounds': 453.592,
  'mg': 0.001,
};

function isWeightUnit(unit: string): boolean {
  return unit.toLowerCase().trim() in WEIGHT_TO_G;
}

function isVolumeUnit(unit: string): boolean {
  return unit.toLowerCase().trim() in VOLUME_TO_ML;
}

interface OldConversion {
  fromUnit: string;
  toUnit: string;
  factor: number;
}

interface ItemRow {
  id: string;
  name: string;
  unit_conversions: OldConversion[] | null;
  density: string | null;
  quantity_unit_weights: Record<string, number> | null;
}

async function migrate() {
  console.log('Starting migration: unitConversions -> density + quantityUnitWeights\n');

  const sql = postgres(connectionString!, { max: 1 });

  try {
    // Read all items - use raw SQL since unitConversions may still exist in DB
    const items = await sql<ItemRow[]>`
      SELECT id, name, unit_conversions, density, quantity_unit_weights
      FROM inventory_items
    `;

    console.log(`Found ${items.length} total items\n`);

    let updatedCount = 0;
    let densityFromConversion = 0;
    let densityFromLookup = 0;
    let quantityWeightsFound = 0;
    let skipped = 0;

    for (const item of items) {
      const conversions: OldConversion[] = Array.isArray(item.unit_conversions) ? item.unit_conversions : [];
      const existingDensity = item.density ? parseFloat(item.density) : null;
      const existingWeights = item.quantity_unit_weights || {};

      let newDensity: number | null = existingDensity;
      const newQuantityWeights: Record<string, number> = { ...existingWeights };
      let changed = false;

      // Process existing conversions
      for (const conv of conversions) {
        const from = conv.fromUnit.toLowerCase().trim();
        const to = conv.toUnit.toLowerCase().trim();
        const factor = conv.factor;

        if (!factor || factor <= 0) continue;

        // Case 1: volume -> weight (e.g., 1 cup = 120g flour)
        // density = grams / ml
        if (isVolumeUnit(from) && isWeightUnit(to) && !newDensity) {
          const ml = VOLUME_TO_ML[from];
          const grams = factor * WEIGHT_TO_G[to] / WEIGHT_TO_G['g']; // factor is already in target unit
          // factor means: 1 [fromUnit] = factor [toUnit]
          // So: 1 cup = factor grams => density = factor * (g_per_toUnit) / ml_per_fromUnit
          const toGrams = WEIGHT_TO_G[to] ?? null;
          const fromMl = VOLUME_TO_ML[from] ?? null;
          if (toGrams !== null && fromMl !== null) {
            // factor is in toUnit, convert to grams: factor * toGrams if toUnit isn't g
            // Actually factor means 1 fromUnit = factor toUnit
            // So grams = factor * (grams per toUnit)
            // density = grams / ml = (factor * toGrams) / fromMl
            newDensity = Math.round(((factor * toGrams) / fromMl) * 10000) / 10000;
            densityFromConversion++;
            changed = true;
            console.log(`  ${item.name}: density from ${from}->${to} (factor ${factor}): ${newDensity} g/ml`);
          }
        }

        // Case 2: weight -> volume (e.g., 1 g = 0.00189 cups)
        if (isWeightUnit(from) && isVolumeUnit(to) && !newDensity) {
          const fromGrams = WEIGHT_TO_G[from] ?? null;
          const toMl = VOLUME_TO_ML[to] ?? null;
          if (fromGrams !== null && toMl !== null) {
            // 1 fromUnit = factor toUnit
            // fromGrams grams = factor * toMl ml
            // density = fromGrams / (factor * toMl)
            newDensity = Math.round((fromGrams / (factor * toMl)) * 10000) / 10000;
            densityFromConversion++;
            changed = true;
            console.log(`  ${item.name}: density from ${from}->${to} (factor ${factor}): ${newDensity} g/ml`);
          }
        }

        // Case 3: quantity -> weight (e.g., 1 bag = 500g)
        if (isQuantityUnit(from) && isWeightUnit(to)) {
          const toGrams = WEIGHT_TO_G[to] ?? null;
          if (toGrams !== null && !newQuantityWeights[from]) {
            newQuantityWeights[from] = Math.round(factor * toGrams * 100) / 100;
            quantityWeightsFound++;
            changed = true;
            console.log(`  ${item.name}: quantityWeight ${from} = ${newQuantityWeights[from]}g`);
          }
        }

        // Case 4: weight -> quantity (e.g., 1 g = 0.002 bags => 1 bag = 500g)
        if (isWeightUnit(from) && isQuantityUnit(to)) {
          const fromGrams = WEIGHT_TO_G[from] ?? null;
          if (fromGrams !== null && factor > 0 && !newQuantityWeights[to]) {
            newQuantityWeights[to] = Math.round((fromGrams / factor) * 100) / 100;
            quantityWeightsFound++;
            changed = true;
            console.log(`  ${item.name}: quantityWeight ${to} = ${newQuantityWeights[to]}g (from reverse)`);
          }
        }
      }

      // Fall back to lookupDensity for items without a density
      if (!newDensity) {
        const suggested = lookupDensity(item.name);
        if (suggested !== null) {
          newDensity = suggested;
          densityFromLookup++;
          changed = true;
          console.log(`  ${item.name}: density from lookup: ${newDensity} g/ml`);
        }
      }

      // Update the item if anything changed
      if (changed) {
        const hasWeights = Object.keys(newQuantityWeights).length > 0;
        await sql`
          UPDATE inventory_items
          SET
            density = ${newDensity ? String(newDensity) : null},
            quantity_unit_weights = ${hasWeights ? sql.json(newQuantityWeights) : sql.json({})}
          WHERE id = ${item.id}
        `;
        updatedCount++;
      } else {
        skipped++;
      }
    }

    console.log('\n--- Migration Summary ---');
    console.log(`Total items:              ${items.length}`);
    console.log(`Updated:                  ${updatedCount}`);
    console.log(`  Density from conversion: ${densityFromConversion}`);
    console.log(`  Density from lookup:     ${densityFromLookup}`);
    console.log(`  Quantity weights found:  ${quantityWeightsFound}`);
    console.log(`Skipped (no changes):     ${skipped}`);
    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

migrate();
