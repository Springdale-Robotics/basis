/**
 * Client-side mirror of the server's subdomain rules: 3-30 chars, lowercase
 * a-z, 0-9 and hyphens; no leading, trailing, or double hyphen. The server
 * remains authoritative (reserved names, races) — this only gates the
 * availability check and gives instant feedback.
 */
export function validateSubdomain(name: string): string | null {
  if (name.length < 3) return 'At least 3 characters.';
  if (name.length > 30) return 'At most 30 characters.';
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'Lowercase letters, numbers, and hyphens only.';
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return 'Cannot start or end with a hyphen.';
  }
  if (name.includes('--')) return 'No double hyphens.';
  return null;
}

/** Normalize as the user types: lowercase, strip spaces. */
export function normalizeSubdomainInput(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '').slice(0, 40);
}
