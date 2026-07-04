import dns from 'dns';
import ipaddr from 'ipaddr.js';
import { config } from '../config/index.js';

const lookup = dns.promises.lookup;

/**
 * SSRF guard for outbound fetches driven by user-supplied URLs (recipe URL
 * import, recipe image fetch). Without this, a member can make the server
 * request internal targets — cloud metadata (169.254.169.254), the local
 * Ollama on 127.0.0.1:11434, or any LAN service — and exfiltrate fragments of
 * the response through the parser.
 *
 * We reject any hostname that resolves to a non-public address. This is DNS-A
 * validation, so a determined attacker could still rebind between this check
 * and the actual connect (TOCTOU); closing that fully requires pinning the
 * connection to the validated IP, which the platform fetch doesn't expose.
 * Rejecting on resolve blocks the overwhelming majority of practical SSRF.
 */

function isDisallowedAddress(addr: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  // range() classifies into 'unicast' (public) vs private/loopback/linkLocal/
  // reserved/uniqueLocal/etc. Only globally-routable unicast is allowed.
  const range = addr.range();
  if (range !== 'unicast') return true;
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) reports as unicast at the v6 level;
  // re-check the embedded v4.
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    return isDisallowedAddress((addr as ipaddr.IPv6).toIPv4Address());
  }
  return false;
}

/**
 * Throws if `rawUrl` is not a safe public http(s) target. Returns the parsed
 * URL on success. Bypass with SSRF_ALLOW_PRIVATE=true for dev against localhost.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }

  if (config.SSRF_ALLOW_PRIVATE) return url;

  const host = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Literal IP in the URL — validate directly, no DNS.
  if (ipaddr.isValid(host)) {
    if (isDisallowedAddress(ipaddr.parse(host))) {
      throw new Error('URL resolves to a non-public address');
    }
    return url;
  }

  // Resolve the hostname and reject if ANY returned address is non-public.
  let records: Array<{ address: string }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error('Could not resolve URL host');
  }
  if (records.length === 0) {
    throw new Error('Could not resolve URL host');
  }
  for (const { address } of records) {
    if (!ipaddr.isValid(address) || isDisallowedAddress(ipaddr.parse(address))) {
      throw new Error('URL resolves to a non-public address');
    }
  }

  return url;
}
