// Helpers for displaying & converting meal-plan servings/multipliers.
// Servings are stored as `count = base × multiplier(6-dp decimal)`. The 6th
// decimal place means an integer like 8 can come back as 7.999998 after a
// 1.333333× round-trip — these helpers paper over that drift in the UI.

export function formatServings(n: number): string {
  const rounded = Math.round(n);
  if (Math.abs(n - rounded) < 0.01) return String(rounded);
  const half = Math.round(n * 2) / 2;
  if (Math.abs(n - half) < 0.01) return half.toFixed(1);
  return n.toFixed(2);
}

export function formatMultiplier(n: number): string {
  // 2-dp at most, trailing zeros dropped (1.50 → "1.5", 1.00 → "1").
  return String(Math.round(n * 100) / 100);
}

export function snapNearInteger(n: number): number {
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 0.01 ? rounded : n;
}

/** Compute `count / base` at the precision the DB column can store. */
export function multiplierFromServings(count: number, base: number): number {
  return Number((count / base).toFixed(6));
}
