export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} days ago`;
  return formatDate(iso);
}

export function formatGB(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  return `${gb.toFixed(1)} GB`;
}

export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
