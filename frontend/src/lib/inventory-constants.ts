// Shared constants for inventory items

export const categoryOptions = [
  'Produce',
  'Dairy',
  'Meat',
  'Seafood',
  'Bakery',
  'Frozen',
  'Canned Goods',
  'Dry Goods',
  'Beverages',
  'Snacks',
  'Condiments',
  'Spices',
  'Cleaning',
  'Personal Care',
  'Other',
] as const;

export const unitOptions = [
  'pieces',
  'lbs',
  'oz',
  'kg',
  'g',
  'liters',
  'ml',
  'cups',
  'tbsp',
  'tsp',
  'gallons',
  'quarts',
  'pints',
  'boxes',
  'bags',
  'cans',
  'bottles',
  'jars',
  'packs',
] as const;

export type CategoryOption = (typeof categoryOptions)[number];
export type UnitOption = (typeof unitOptions)[number];
