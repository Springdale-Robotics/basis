/**
 * Subdomains customers may never claim — infrastructure names, anything that
 * could be used to impersonate us, and common service prefixes.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'api', 'app', 'admin', 'administrator', 'mail', 'email', 'smtp',
  'imap', 'pop', 'mx', 'webmail', 'relay', 'frp', 'frps', 'tunnel', 'vpn',
  'status', 'docs', 'doc', 'blog', 'help', 'support', 'contact', 'billing',
  'stripe', 'pay', 'payments', 'checkout', 'dashboard', 'account', 'accounts',
  'login', 'signin', 'signup', 'register', 'auth', 'sso', 'oauth', 'static',
  'cdn', 'assets', 'img', 'images', 'media', 'files', 'download', 'downloads',
  'ns', 'ns1', 'ns2', 'dns', 'dev', 'staging', 'stage', 'test', 'testing',
  'demo', 'beta', 'internal', 'intranet', 'git', 'gitlab', 'github', 'basis',
  'home', 'cloud', 'remote', 'proxy', 'gateway', 'portal', 'store', 'shop',
  'news', 'forum', 'community', 'wiki', 'security', 'abuse', 'legal',
  'privacy', 'terms', 'autoconfig', 'autodiscover', 'matomo', 'analytics',
  'metrics', 'grafana', 'prometheus', 'root', 'system', 'sys', 'official',
]);

const FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/;

export type SubdomainRejection = 'invalid_format' | 'reserved' | 'punycode';

/**
 * Validate a candidate subdomain (must already be lowercased by the caller).
 * Availability (taken / tombstoned) is checked separately against the DB.
 */
export function validateSubdomainFormat(name: string): SubdomainRejection | null {
  if (name.length < 3 || name.length > 30) return 'invalid_format';
  if (!FORMAT.test(name)) return 'invalid_format';
  if (name.startsWith('xn-')) return 'punycode'; // before the '--' check — homograph names embed one
  if (name.includes('--')) return 'invalid_format';
  if (RESERVED_SUBDOMAINS.has(name)) return 'reserved';
  return null;
}
