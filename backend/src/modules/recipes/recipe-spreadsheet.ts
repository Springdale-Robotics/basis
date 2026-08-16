import Papa from 'papaparse';
import { INGREDIENTS_HEADER, INSTRUCTIONS_HEADER } from './recipe-line-classifier.js';

/**
 * Reading a collection of recipes out of a spreadsheet.
 *
 * People keep recipes in spreadsheets, and typing them one at a time into an
 * import box is not a realistic way to move a collection. The shape is ours
 * rather than theirs — a template to fill in, not a guess at whatever someone
 * already has — so this deliberately refuses anything that doesn't match
 * instead of trying to work out what the columns mean.
 *
 * Each row is turned into the canonical text the ordinary text import already
 * understands, which is what keeps this from becoming a second recipe parser.
 * Two properties of that parser, both established by tests, make the handover
 * exact: explicit headings stop it inferring where the ingredients end, and
 * numbered steps stop it re-dividing prose. So a spreadsheet says precisely
 * what it means and nothing is guessed at on the way through.
 */

/** Exactly the headings the template ships with. Nothing is inferred. */
export const TEMPLATE_COLUMNS = {
  title: 'Title',
  servings: 'Servings',
  prep: 'Prep',
  cook: 'Cook',
  ingredients: 'Ingredients',
  instructions: 'Instructions',
} as const;

const REQUIRED_COLUMNS = [TEMPLATE_COLUMNS.title, TEMPLATE_COLUMNS.ingredients];

/** A row's worth of recipe, before it becomes text. */
export interface SpreadsheetRecipe {
  rowNumber: number;
  title: string;
  servings?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  ingredients: string[];
  instructions: string[];
}

export interface SpreadsheetParseResult {
  recipes: SpreadsheetRecipe[];
  /** Rows that couldn't be used, named so they can be found and fixed. */
  skipped: Array<{ rowNumber: number; reason: string }>;
  warnings: string[];
}

/** Guards against a small file that unpacks into something enormous. */
export const MAX_ROWS = 200;
const MAX_CELL_CHARS = 5000;

function splitCell(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toNumber(value: string): number | undefined {
  const digits = value.match(/\d+/);
  return digits ? parseInt(digits[0], 10) : undefined;
}

/**
 * Turn a sheet — a header row followed by data rows — into recipes.
 *
 * Kept separate from reading the file so the interesting behaviour is testable
 * without one.
 */
export function rowsToRecipes(rows: string[][]): SpreadsheetParseResult {
  const warnings: string[] = [];
  const skipped: Array<{ rowNumber: number; reason: string }> = [];

  const headerRow = rows.find((row) => row.some((cell) => cell.trim().length > 0));
  if (!headerRow) {
    throw new Error('That file appears to be empty.');
  }

  // Case and surrounding space are forgiven; the words are not.
  const headings = headerRow.map((cell) => cell.trim().toLowerCase());
  const columnOf = (name: string) => headings.indexOf(name.toLowerCase());

  const missing = REQUIRED_COLUMNS.filter((name) => columnOf(name) === -1);
  if (missing.length > 0) {
    throw new Error(
      `This doesn't look like the Basis recipe template — it needs ${REQUIRED_COLUMNS.join(
        ' and '
      )} columns, and ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing. ` +
        'Download the template and paste your recipes into it.'
    );
  }

  const at = (row: string[], name: string) => {
    const index = columnOf(name);
    const value = index === -1 ? '' : (row[index] ?? '');
    return value.length > MAX_CELL_CHARS ? value.slice(0, MAX_CELL_CHARS) : value;
  };

  const dataRows = rows.slice(rows.indexOf(headerRow) + 1);
  const recipes: SpreadsheetRecipe[] = [];

  for (const [index, row] of dataRows.entries()) {
    // +2 because a spreadsheet's first row is 1 and the header took it.
    const rowNumber = rows.indexOf(headerRow) + index + 2;

    if (row.every((cell) => cell.trim().length === 0)) continue;

    if (recipes.length >= MAX_ROWS) {
      skipped.push({ rowNumber, reason: `Only the first ${MAX_ROWS} recipes are read at once.` });
      continue;
    }

    const title = at(row, TEMPLATE_COLUMNS.title).trim();
    if (!title) {
      skipped.push({ rowNumber, reason: 'No title.' });
      continue;
    }

    // A line that reads as a section heading would tell the text parser
    // something the spreadsheet never said, so it is dropped rather than
    // passed on. It carries no recipe content either way.
    const rawIngredients = splitCell(at(row, TEMPLATE_COLUMNS.ingredients));
    const ingredients = rawIngredients.filter(
      (line) => !INGREDIENTS_HEADER.test(line) && !INSTRUCTIONS_HEADER.test(line)
    );
    if (ingredients.length !== rawIngredients.length) {
      warnings.push(`Row ${rowNumber}: dropped a line reading like a section heading.`);
    }

    if (ingredients.length === 0) {
      skipped.push({ rowNumber, reason: `No ingredients for "${title}".` });
      continue;
    }

    recipes.push({
      rowNumber,
      title,
      servings: toNumber(at(row, TEMPLATE_COLUMNS.servings)),
      prepMinutes: toNumber(at(row, TEMPLATE_COLUMNS.prep)),
      cookMinutes: toNumber(at(row, TEMPLATE_COLUMNS.cook)),
      ingredients,
      instructions: splitCell(at(row, TEMPLATE_COLUMNS.instructions)),
    });
  }

  return { recipes, skipped, warnings };
}

/**
 * The recipe as text the ordinary import understands, saying exactly what the
 * spreadsheet said.
 *
 * Headings are explicit so the ingredients/method boundary is never inferred,
 * and steps are numbered so a line holding two sentences stays one step — the
 * writer already divided them by putting them on separate lines.
 */
export function toCanonicalText(recipe: SpreadsheetRecipe): string {
  const lines: string[] = [recipe.title];

  if (recipe.servings) lines.push(`Servings: ${recipe.servings}`);
  if (recipe.prepMinutes) lines.push(`Prep Time: ${recipe.prepMinutes} minutes`);
  if (recipe.cookMinutes) lines.push(`Cook Time: ${recipe.cookMinutes} minutes`);

  lines.push(TEMPLATE_COLUMNS.ingredients, ...recipe.ingredients);

  if (recipe.instructions.length > 0) {
    lines.push(TEMPLATE_COLUMNS.instructions);
    recipe.instructions.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
  }

  return lines.join('\n');
}

/** Read a .csv, quoting and all — the template's cells contain newlines. */
export function readCsv(text: string): string[][] {
  // A file saved by Excel often starts with a byte-order mark, which would
  // otherwise become part of the first heading and fail the column check.
  const withoutBom = text.replace(/^\uFEFF/, '');
  const parsed = Papa.parse<string[]>(withoutBom, { skipEmptyLines: false });
  return parsed.data.map((row) => row.map((cell) => (cell ?? '').toString()));
}

/** Read a .xlsx/.xls workbook's first sheet. */
export async function readWorkbook(buffer: Buffer): Promise<string[][]> {
  const { default: readXlsxFile } = await import('read-excel-file/node');
  const result = (await readXlsxFile(buffer)) as unknown;

  // Returns one entry per sheet — `[{ sheet, data }]` — rather than rows, so
  // unwrap the first sheet. Handled defensively because the shape differs
  // between call forms and a wrong guess here reads as "empty file".
  const sheets = Array.isArray(result) ? result : [];
  const first = sheets[0] as { data?: unknown[] } | unknown[] | undefined;
  const rows = (
    first && !Array.isArray(first) && Array.isArray(first.data) ? first.data : sheets
  ) as Array<Array<unknown>>;

  // Every cell becomes text regardless of whether the workbook stored it as a
  // number, a date or a string.
  return rows.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) =>
      cell === null || cell === undefined ? '' : String(cell)
    )
  );
}

/** Read whichever of the accepted formats this is. */
export async function readSpreadsheet(buffer: Buffer, filename: string): Promise<string[][]> {
  return /\.csv$/i.test(filename) ? readCsv(buffer.toString('utf8')) : readWorkbook(buffer);
}
