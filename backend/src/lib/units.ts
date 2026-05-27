// Canonical unit registry — single source of truth for the unit system.
//
// Base units: grams (weight), cups (volume)
// Density bridges the two: g/cup
//
// Categories:
//   weight    — locked, user cannot add. Converts via base_value (grams).
//   volume    — locked, user cannot add. Converts via base_value (cups).
//   count     — built-in set + household-expandable custom units.
//   negligible — skip in all math (depletion, consolidation, shopping).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnitCategory = 'weight' | 'volume' | 'count' | 'negligible';

export interface UnitDefinition {
  /** Canonical key used in the database and all backend math. */
  key: string;
  /** Human-readable display name. */
  name: string;
  category: UnitCategory;
  /**
   * Conversion factor to base unit.
   *   weight:  1 <unit> = base_value grams
   *   volume:  1 <unit> = base_value cups
   *   count:   null (requires per-item conversion)
   *   negligible: null (skipped)
   */
  baseValue: number | null;
  /** All lowercase alias strings that should resolve to this unit during parsing. */
  aliases: string[];
  /** Whether this unit is enabled by default for new households. */
  defaultEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Weight units (base: grams)
// ---------------------------------------------------------------------------

export const WEIGHT_UNITS: UnitDefinition[] = [
  {
    key: 'mg',
    name: 'milligram',
    category: 'weight',
    baseValue: 0.001,
    aliases: ['milligram', 'milligrams', 'milligramme', 'milligrammes'],
    defaultEnabled: true,
  },
  {
    key: 'g',
    name: 'gram',
    category: 'weight',
    baseValue: 1,
    aliases: ['gram', 'grams', 'gm', 'gramme', 'grammes'],
    defaultEnabled: true,
  },
  {
    key: 'dag',
    name: 'decagram',
    category: 'weight',
    baseValue: 10,
    aliases: ['decagram', 'decagrams', 'dkg', 'dekagram'],
    defaultEnabled: false,
  },
  {
    key: 'hg',
    name: 'hectogram',
    category: 'weight',
    baseValue: 100,
    aliases: ['hectogram', 'hectograms'],
    defaultEnabled: false,
  },
  {
    key: 'kg',
    name: 'kilogram',
    category: 'weight',
    baseValue: 1000,
    aliases: ['kilogram', 'kilograms', 'kilogramme', 'kilogrammes', 'kilo', 'kilos'],
    defaultEnabled: true,
  },
  {
    key: 'oz',
    name: 'ounce',
    category: 'weight',
    baseValue: 28.3495,
    aliases: ['ounce', 'ounces'],
    defaultEnabled: true,
  },
  {
    key: 'lb',
    name: 'pound',
    category: 'weight',
    baseValue: 453.592,
    aliases: ['pound', 'pounds', 'lbs', '#'],
    defaultEnabled: true,
  },
  {
    key: 'st',
    name: 'stone',
    category: 'weight',
    baseValue: 6350.29,
    aliases: ['stone', 'stones'],
    defaultEnabled: false,
  },
];

// ---------------------------------------------------------------------------
// Volume units (base: cups)
// ---------------------------------------------------------------------------

export const VOLUME_UNITS: UnitDefinition[] = [
  {
    key: 'mL',
    name: 'milliliter',
    category: 'volume',
    baseValue: 1 / 236.588, // 0.004227
    aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'cc'],
    defaultEnabled: true,
  },
  {
    key: 'cL',
    name: 'centiliter',
    category: 'volume',
    baseValue: 10 / 236.588, // 0.04227
    aliases: ['cl', 'centiliter', 'centiliters', 'centilitre', 'centilitres'],
    defaultEnabled: false,
  },
  {
    key: 'dL',
    name: 'deciliter',
    category: 'volume',
    baseValue: 100 / 236.588, // 0.4227
    aliases: ['dl', 'deciliter', 'deciliters', 'decilitre', 'decilitres'],
    defaultEnabled: false,
  },
  {
    key: 'L',
    name: 'liter',
    category: 'volume',
    baseValue: 1000 / 236.588, // 4.22675
    aliases: ['l', 'liter', 'liters', 'litre', 'litres'],
    defaultEnabled: true,
  },
  {
    key: 'tsp',
    name: 'teaspoon',
    category: 'volume',
    baseValue: 1 / 48, // 0.02083
    aliases: ['teaspoon', 'teaspoons', 't', 'ts'],
    defaultEnabled: true,
  },
  {
    key: 'tbsp',
    name: 'tablespoon',
    category: 'volume',
    baseValue: 1 / 16, // 0.0625
    aliases: ['tablespoon', 'tablespoons', 'tbs', 'tbl', 'tblsp', 'tblspn'],
    defaultEnabled: true,
  },
  {
    key: 'dsp',
    name: 'dessertspoon',
    category: 'volume',
    baseValue: 11.838 / 236.588, // 0.05002
    aliases: ['dessertspoon', 'dessertspoons', 'dspn', 'dessert spoon'],
    defaultEnabled: false,
  },
  {
    key: 'fl oz',
    name: 'fluid ounce',
    category: 'volume',
    baseValue: 1 / 8, // 0.125
    aliases: ['floz', 'fluid ounce', 'fluid ounces', 'fl. oz', 'fl. oz.'],
    defaultEnabled: true,
  },
  {
    key: 'gi',
    name: 'gill',
    category: 'volume',
    baseValue: 0.5,
    aliases: ['gill', 'gills'],
    defaultEnabled: false,
  },
  {
    key: 'cup',
    name: 'cup',
    category: 'volume',
    baseValue: 1,
    aliases: ['cups', 'c'],
    defaultEnabled: true,
  },
  {
    key: 'pt',
    name: 'pint',
    category: 'volume',
    baseValue: 2,
    aliases: ['pint', 'pints'],
    defaultEnabled: true,
  },
  {
    key: 'qt',
    name: 'quart',
    category: 'volume',
    baseValue: 4,
    aliases: ['quart', 'quarts'],
    defaultEnabled: true,
  },
  {
    key: 'gal',
    name: 'gallon',
    category: 'volume',
    baseValue: 16,
    aliases: ['gallon', 'gallons'],
    defaultEnabled: true,
  },
  {
    key: 'jig',
    name: 'jigger',
    category: 'volume',
    baseValue: 44.36 / 236.588, // 0.1875
    aliases: ['jigger', 'jiggers'],
    defaultEnabled: false,
  },
  {
    key: 'metric cup',
    name: 'metric cup',
    category: 'volume',
    baseValue: 250 / 236.588, // 1.057
    aliases: ['metric cups'],
    defaultEnabled: false,
  },
  {
    key: 'au tbsp',
    name: 'Australian tablespoon',
    category: 'volume',
    baseValue: 20 / 236.588, // 0.08454
    aliases: ['australian tablespoon', 'australian tablespoons'],
    defaultEnabled: false,
  },
  {
    key: 'jp cup',
    name: 'Japanese cup',
    category: 'volume',
    baseValue: 200 / 236.588, // 0.8454
    aliases: ['japanese cup', 'japanese cups'],
    defaultEnabled: false,
  },
  {
    key: 'go',
    name: 'Japanese go',
    category: 'volume',
    baseValue: 180 / 236.588, // 0.7609
    aliases: ['gō', '合'],
    defaultEnabled: false,
  },
  // Imperial UK
  {
    key: 'imp fl oz',
    name: 'imperial fluid ounce',
    category: 'volume',
    baseValue: 28.413 / 236.588, // 0.1201
    aliases: ['imperial fluid ounce', 'imperial fluid ounces', 'imp. fl oz'],
    defaultEnabled: false,
  },
  {
    key: 'imp pt',
    name: 'imperial pint',
    category: 'volume',
    baseValue: 568.261 / 236.588, // 2.402
    aliases: ['imperial pint', 'imperial pints'],
    defaultEnabled: false,
  },
  {
    key: 'imp qt',
    name: 'imperial quart',
    category: 'volume',
    baseValue: 1136.52 / 236.588, // 4.804
    aliases: ['imperial quart', 'imperial quarts'],
    defaultEnabled: false,
  },
  {
    key: 'imp gal',
    name: 'imperial gallon',
    category: 'volume',
    baseValue: 4546.09 / 236.588, // 19.215
    aliases: ['imperial gallon', 'imperial gallons'],
    defaultEnabled: false,
  },
];

// ---------------------------------------------------------------------------
// Count units (built-in, household-expandable)
// ---------------------------------------------------------------------------

export const COUNT_UNITS: UnitDefinition[] = [
  { key: 'each', name: 'each', category: 'count', baseValue: null, aliases: ['ea'], defaultEnabled: true },
  { key: 'dozen', name: 'dozen', category: 'count', baseValue: null, aliases: ['doz', 'dz'], defaultEnabled: true },
  { key: 'piece', name: 'piece', category: 'count', baseValue: null, aliases: ['pieces', 'pc', 'pcs'], defaultEnabled: true },
  { key: 'slice', name: 'slice', category: 'count', baseValue: null, aliases: ['slices'], defaultEnabled: true },
  { key: 'portion', name: 'portion', category: 'count', baseValue: null, aliases: ['portions'], defaultEnabled: true },
  { key: 'serving', name: 'serving', category: 'count', baseValue: null, aliases: ['servings'], defaultEnabled: true },
  { key: 'can', name: 'can', category: 'count', baseValue: null, aliases: ['cans', 'tin', 'tins'], defaultEnabled: true },
  { key: 'jar', name: 'jar', category: 'count', baseValue: null, aliases: ['jars'], defaultEnabled: true },
  { key: 'bottle', name: 'bottle', category: 'count', baseValue: null, aliases: ['bottles'], defaultEnabled: true },
  { key: 'bag', name: 'bag', category: 'count', baseValue: null, aliases: ['bags'], defaultEnabled: true },
  { key: 'box', name: 'box', category: 'count', baseValue: null, aliases: ['boxes'], defaultEnabled: true },
  { key: 'pack', name: 'pack', category: 'count', baseValue: null, aliases: ['packs', 'packet', 'packets', 'package', 'packages', 'pkg'], defaultEnabled: true },
  { key: 'case', name: 'case', category: 'count', baseValue: null, aliases: ['cases'], defaultEnabled: true },
  { key: 'bunch', name: 'bunch', category: 'count', baseValue: null, aliases: ['bunches'], defaultEnabled: true },
  { key: 'head', name: 'head', category: 'count', baseValue: null, aliases: ['heads'], defaultEnabled: true },
  { key: 'clove', name: 'clove', category: 'count', baseValue: null, aliases: ['cloves'], defaultEnabled: true },
  { key: 'sprig', name: 'sprig', category: 'count', baseValue: null, aliases: ['sprigs'], defaultEnabled: true },
  { key: 'stalk', name: 'stalk', category: 'count', baseValue: null, aliases: ['stalks'], defaultEnabled: true },
  { key: 'stick', name: 'stick', category: 'count', baseValue: null, aliases: ['sticks'], defaultEnabled: true },
  { key: 'strip', name: 'strip', category: 'count', baseValue: null, aliases: ['strips'], defaultEnabled: true },
  { key: 'fillet', name: 'fillet', category: 'count', baseValue: null, aliases: ['fillets', 'filet', 'filets'], defaultEnabled: true },
  { key: 'breast', name: 'breast', category: 'count', baseValue: null, aliases: ['breasts'], defaultEnabled: true },
  { key: 'thigh', name: 'thigh', category: 'count', baseValue: null, aliases: ['thighs'], defaultEnabled: true },
  { key: 'drumstick', name: 'drumstick', category: 'count', baseValue: null, aliases: ['drumsticks'], defaultEnabled: true },
  { key: 'wing', name: 'wing', category: 'count', baseValue: null, aliases: ['wings'], defaultEnabled: true },
  { key: 'patty', name: 'patty', category: 'count', baseValue: null, aliases: ['patties'], defaultEnabled: true },
  { key: 'link', name: 'link', category: 'count', baseValue: null, aliases: ['links'], defaultEnabled: true },
  { key: 'ear', name: 'ear', category: 'count', baseValue: null, aliases: ['ears'], defaultEnabled: true },
  { key: 'bulb', name: 'bulb', category: 'count', baseValue: null, aliases: ['bulbs'], defaultEnabled: true },
  { key: 'leaf', name: 'leaf', category: 'count', baseValue: null, aliases: ['leaves'], defaultEnabled: true },
  { key: 'sheet', name: 'sheet', category: 'count', baseValue: null, aliases: ['sheets'], defaultEnabled: true },
  { key: 'block', name: 'block', category: 'count', baseValue: null, aliases: ['blocks'], defaultEnabled: true },
  { key: 'wedge', name: 'wedge', category: 'count', baseValue: null, aliases: ['wedges'], defaultEnabled: true },
  { key: 'scoop', name: 'scoop', category: 'count', baseValue: null, aliases: ['scoops'], defaultEnabled: true },
  { key: 'rasher', name: 'rasher', category: 'count', baseValue: null, aliases: ['rashers'], defaultEnabled: true },
  { key: 'floret', name: 'floret', category: 'count', baseValue: null, aliases: ['florets'], defaultEnabled: true },
  { key: 'rib', name: 'rib', category: 'count', baseValue: null, aliases: ['ribs'], defaultEnabled: true },
  { key: 'spear', name: 'spear', category: 'count', baseValue: null, aliases: ['spears'], defaultEnabled: true },
  { key: 'knob', name: 'knob', category: 'count', baseValue: null, aliases: ['knobs'], defaultEnabled: true },
  { key: 'pat', name: 'pat', category: 'count', baseValue: null, aliases: ['pats'], defaultEnabled: true },
  { key: 'cube', name: 'cube', category: 'count', baseValue: null, aliases: ['cubes'], defaultEnabled: true },
  { key: 'sachet', name: 'sachet', category: 'count', baseValue: null, aliases: ['sachets'], defaultEnabled: true },
  { key: 'tube', name: 'tube', category: 'count', baseValue: null, aliases: ['tubes'], defaultEnabled: true },
  { key: 'pouch', name: 'pouch', category: 'count', baseValue: null, aliases: ['pouches'], defaultEnabled: true },
  { key: 'tray', name: 'tray', category: 'count', baseValue: null, aliases: ['trays'], defaultEnabled: true },
];

// ---------------------------------------------------------------------------
// Negligible units (skipped in all math)
// ---------------------------------------------------------------------------

export const NEGLIGIBLE_UNITS: UnitDefinition[] = [
  { key: 'to taste', name: 'to taste', category: 'negligible', baseValue: null, aliases: ['to taste', 'tt'], defaultEnabled: true },
  { key: 'pinch', name: 'pinch', category: 'negligible', baseValue: null, aliases: ['pinches'], defaultEnabled: true },
  { key: 'dash', name: 'dash', category: 'negligible', baseValue: null, aliases: ['dashes'], defaultEnabled: true },
  { key: 'drop', name: 'drop', category: 'negligible', baseValue: null, aliases: ['drops'], defaultEnabled: true },
  { key: 'drizzle', name: 'drizzle', category: 'negligible', baseValue: null, aliases: ['drizzles'], defaultEnabled: true },
  { key: 'splash', name: 'splash', category: 'negligible', baseValue: null, aliases: ['splashes'], defaultEnabled: true },
  { key: 'handful', name: 'handful', category: 'negligible', baseValue: null, aliases: ['handfuls'], defaultEnabled: true },
  { key: 'smidgen', name: 'smidgen', category: 'negligible', baseValue: null, aliases: ['smidge', 'smidgeon'], defaultEnabled: true },
  { key: 'garnish', name: 'garnish', category: 'negligible', baseValue: null, aliases: [], defaultEnabled: true },
  { key: 'as needed', name: 'as needed', category: 'negligible', baseValue: null, aliases: ['a/n', 'as required'], defaultEnabled: true },
];

// ---------------------------------------------------------------------------
// Combined registry & lookup helpers
// ---------------------------------------------------------------------------

/** All built-in units in a single flat array. */
export const ALL_UNITS: UnitDefinition[] = [
  ...WEIGHT_UNITS,
  ...VOLUME_UNITS,
  ...COUNT_UNITS,
  ...NEGLIGIBLE_UNITS,
];

/** Map from canonical key -> UnitDefinition. */
const UNIT_BY_KEY = new Map<string, UnitDefinition>();

/** Map from any alias (lowercase) -> canonical key. */
const ALIAS_TO_KEY = new Map<string, string>();

// Build lookup maps
for (const unit of ALL_UNITS) {
  UNIT_BY_KEY.set(unit.key, unit);
  // The key itself is also a valid lookup (lowercase)
  ALIAS_TO_KEY.set(unit.key.toLowerCase(), unit.key);
  for (const alias of unit.aliases) {
    ALIAS_TO_KEY.set(alias.toLowerCase(), unit.key);
  }
}

/**
 * Resolve any unit string (key, alias, or display name) to its canonical key.
 * Returns the canonical key, or the input lowercased/trimmed if no match (unknown unit).
 */
export function resolveUnit(input: string): string {
  if (!input) return '';
  const lower = input.toLowerCase().trim();
  return ALIAS_TO_KEY.get(lower) ?? lower;
}

/**
 * Get the UnitDefinition for a canonical key.
 * Returns undefined for unknown/custom units.
 */
export function getUnit(key: string): UnitDefinition | undefined {
  return UNIT_BY_KEY.get(key);
}

/**
 * Get the unit category for any unit string (resolves aliases first).
 * Returns 'unknown' for unrecognized units (likely custom count units).
 */
export function getUnitCategory(input: string): UnitCategory | 'unknown' {
  const key = resolveUnit(input);
  const unit = UNIT_BY_KEY.get(key);
  return unit?.category ?? 'unknown';
}

/**
 * Check if a unit is negligible (should be skipped in all math).
 */
export function isNegligible(input: string): boolean {
  return getUnitCategory(input) === 'negligible';
}

/**
 * Check if a unit is a count unit (built-in or unknown/custom).
 * Null/empty unit is treated as implicit "each" (count).
 */
export function isCountUnit(input: string | null | undefined): boolean {
  if (!input) return true; // null unit = bare quantity = implicit each
  const cat = getUnitCategory(input);
  return cat === 'count' || cat === 'unknown';
}

/**
 * Convert a quantity to the base unit for its category.
 *   weight -> grams
 *   volume -> cups
 * Returns null for count, negligible, or unknown units.
 */
export function toBaseUnit(quantity: number, input: string): { value: number; base: 'g' | 'cup' } | null {
  const key = resolveUnit(input);
  const unit = UNIT_BY_KEY.get(key);
  if (!unit || unit.baseValue == null) return null;

  if (unit.category === 'weight') {
    return { value: quantity * unit.baseValue, base: 'g' };
  }
  if (unit.category === 'volume') {
    return { value: quantity * unit.baseValue, base: 'cup' };
  }
  return null;
}

/**
 * Convert from a base unit (grams or cups) to a target unit.
 * Returns null if the target is not in the matching category.
 */
export function fromBaseUnit(value: number, base: 'g' | 'cup', targetInput: string): number | null {
  const key = resolveUnit(targetInput);
  const unit = UNIT_BY_KEY.get(key);
  if (!unit || unit.baseValue == null || unit.baseValue === 0) return null;

  if (base === 'g' && unit.category === 'weight') {
    return value / unit.baseValue;
  }
  if (base === 'cup' && unit.category === 'volume') {
    return value / unit.baseValue;
  }
  return null;
}

/**
 * Convert between any two units in the same category (weight or volume).
 * Returns null if units are in different categories or either is count/negligible.
 */
export function convertSameCategory(quantity: number, fromInput: string, toInput: string): number | null {
  const fromKey = resolveUnit(fromInput);
  const toKey = resolveUnit(toInput);
  if (fromKey === toKey) return quantity;

  const fromUnit = UNIT_BY_KEY.get(fromKey);
  const toUnit = UNIT_BY_KEY.get(toKey);
  if (!fromUnit || !toUnit) return null;
  if (fromUnit.baseValue == null || toUnit.baseValue == null) return null;
  if (fromUnit.category !== toUnit.category) return null;
  if (fromUnit.category !== 'weight' && fromUnit.category !== 'volume') return null;

  // from -> base -> to
  const baseValue = quantity * fromUnit.baseValue;
  return baseValue / toUnit.baseValue;
}

/**
 * Per-item container/quantity-unit sizes. Each entry maps a custom unit (the
 * key, often a count unit like "bottle") to its size in some standard unit
 * (any weight or volume key). The convert engine resolves these to standard
 * units up front, so density only matters when bridging weight ↔ volume.
 *
 * Example:
 *   { bottle: { quantity: 16, unit: 'fl oz' }, bag: { quantity: 5, unit: 'lb' } }
 */
export type QuantityUnitSizes = Record<string, { quantity: number; unit: string }>;

/**
 * If `unitInput` has a size entry, return the equivalent (quantity, unit) in
 * the underlying standard unit. Follows chains up to a small depth in case a
 * custom unit resolves to another custom unit.
 */
function resolveQuantityUnit(
  qty: number,
  unitInput: string,
  sizes: QuantityUnitSizes | undefined,
): { quantity: number; unitKey: string } {
  let q = qty;
  let key = resolveUnit(unitInput);
  if (!sizes) return { quantity: q, unitKey: key };
  // Follow up to 5 levels so chained custom units (e.g. case → bottle → fl oz)
  // resolve without runaway recursion if the user defines a cycle.
  for (let depth = 0; depth < 5; depth += 1) {
    const entry = sizes[key];
    if (!entry || entry.quantity <= 0) return { quantity: q, unitKey: key };
    q *= entry.quantity;
    key = resolveUnit(entry.unit);
  }
  return { quantity: q, unitKey: key };
}

/**
 * Convert between any units using density and per-item quantity sizes.
 *
 * Priority:
 * 1. Resolve any custom quantity units through `qtySizes` to standard units
 * 2. Same category (weight<->weight, volume<->volume): direct math via base units
 * 3. Cross-category (weight<->volume via density in g/cup)
 *
 * @param quantity       Amount to convert
 * @param fromInput      Source unit (key, alias, or display name)
 * @param toInput        Target unit
 * @param densityGPerCup Item density in grams per cup (nullable)
 * @param qtySizes       Per-item container sizes (e.g., { bottle: { quantity: 16, unit: 'fl oz' } })
 */
export function convert(
  quantity: number,
  fromInput: string,
  toInput: string,
  densityGPerCup?: number | null,
  qtySizes?: QuantityUnitSizes,
): number | null {
  // 1. Resolve custom count units up front. If a stock unit is "bottle" with
  //    size { 16, fl oz }, we treat the from-side as 16 × quantity fl oz.
  const { quantity: fromQ, unitKey: fromKey } = resolveQuantityUnit(quantity, fromInput, qtySizes);
  const { quantity: toFactor, unitKey: toKey } = resolveQuantityUnit(1, toInput, qtySizes);
  if (fromKey === toKey) return fromQ / toFactor;

  const fromCat = getUnitCategory(fromKey);
  const toCat = getUnitCategory(toKey);

  // Negligible units: no conversion
  if (fromCat === 'negligible' || toCat === 'negligible') return null;

  // After size resolution, either side may still be a count unit (no size
  // defined). Those can't be bridged to weight/volume without more info.
  if (fromCat === 'count' || fromCat === 'unknown') return null;
  if (toCat === 'count' || toCat === 'unknown') return null;

  // 2. Same category (weight or volume): direct math
  if (fromCat === toCat) {
    const converted = convertSameCategory(fromQ, fromKey, toKey);
    return converted == null ? null : converted / toFactor;
  }

  // 3. Cross-category (weight <-> volume): use density
  if (densityGPerCup == null) return null;

  if (fromCat === 'weight' && toCat === 'volume') {
    const fromBase = toBaseUnit(fromQ, fromKey);
    if (!fromBase || fromBase.base !== 'g') return null;
    const cups = fromBase.value / densityGPerCup;
    const converted = fromBaseUnit(cups, 'cup', toKey);
    return converted == null ? null : converted / toFactor;
  }

  if (fromCat === 'volume' && toCat === 'weight') {
    const fromBase = toBaseUnit(fromQ, fromKey);
    if (!fromBase || fromBase.base !== 'cup') return null;
    const grams = fromBase.value * densityGPerCup;
    const converted = fromBaseUnit(grams, 'g', toKey);
    return converted == null ? null : converted / toFactor;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Default enabled unit keys (for new household settings)
// ---------------------------------------------------------------------------

export const DEFAULT_ENABLED_UNITS: string[] = ALL_UNITS
  .filter(u => u.defaultEnabled)
  .map(u => u.key);
