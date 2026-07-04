/**
 * Shared storage-meter color logic.
 *
 * Storage usage meters color-shift as capacity runs out:
 * - >= 95% used: destructive (critically full)
 * - >= 80% used: warning (getting full)
 * - otherwise: success (healthy)
 */
export function getStorageMeterClass(percent: number): string {
  if (percent >= 95) return 'bg-destructive';
  if (percent >= 80) return 'bg-warning';
  return 'bg-success';
}

/** Text-color companion to getStorageMeterClass; empty string when healthy. */
export function getStorageMeterTextClass(percent: number): string {
  if (percent >= 95) return 'text-destructive';
  if (percent >= 80) return 'text-warning';
  return '';
}
