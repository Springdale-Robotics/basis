/**
 * Minimal semver comparison for the update checker.
 *
 * Our release tags look like `0.1.14-alpha` (optionally `v`-prefixed). We need
 * a real ordering — a plain string `!==` treats `0.1.9` as newer than `0.1.14`
 * and would happily offer a downgrade as an "update".
 *
 * Handles: numeric MAJOR.MINOR.PATCH core, plus an optional dash-prefixed
 * prerelease tag. A version WITH a prerelease sorts BEFORE the same core
 * without one (`1.0.0-alpha` < `1.0.0`), matching the semver spec. Prerelease
 * identifiers are compared numerically when both numeric, else lexically.
 */

function parse(v: string): { core: number[]; pre: string[] } {
  const cleaned = v.trim().replace(/^v/, '');
  const [coreStr, preStr] = cleaned.split('-', 2);
  const core = coreStr.split('.').map((n) => {
    const parsed = parseInt(n, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  while (core.length < 3) core.push(0);
  const pre = preStr ? preStr.split('.') : [];
  return { core, pre };
}

/** Returns >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }

  // No prerelease outranks a prerelease on the same core.
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.pre[i];
    const bi = pb.pre[i];
    if (ai === undefined) return -1; // shorter prerelease set sorts first
    if (bi === undefined) return 1;
    const an = parseInt(ai, 10);
    const bn = parseInt(bi, 10);
    const aNum = String(an) === ai;
    const bNum = String(bn) === bi;
    if (aNum && bNum) {
      if (an !== bn) return an - bn;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric identifiers sort before alphanumeric
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1;
    }
  }
  return 0;
}
