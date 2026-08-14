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

export interface SafeFetchOptions {
  /** Give up after this long, including redirects. */
  timeoutMs?: number;
  /** Refuse a response body larger than this. */
  maxBytes?: number;
  /** How many redirects to follow before giving up. */
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  body: Buffer;
  contentType: string | null;
  /** Where we ended up, which may differ from the requested URL. */
  finalUrl: string;
}

/**
 * Fetch a user-supplied URL with the guards a user-supplied URL needs.
 *
 * `assertPublicUrl` alone only validates the URL you hand it. Left to follow
 * redirects itself, fetch will happily be steered from a public host to
 * 169.254.169.254 without anything re-checking — so redirects are followed
 * manually here, validating each hop.
 *
 * It also bounds the two things an unbounded fetch gets wrong: a server that
 * accepts the connection and never responds (the recipe URL importer had no
 * timeout at all and would hold the request open indefinitely), and a response
 * far too large to parse.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const {
    timeoutMs = 15_000,
    maxBytes = 5 * 1024 * 1024,
    maxRedirects = 5,
    headers = {},
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = rawUrl;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      await assertPublicUrl(currentUrl);

      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirect from ${currentUrl} had no destination`);
        // Resolve relative redirects against the URL we just requested.
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }

      const declaredLength = response.headers.get('content-length');
      if (declaredLength && Number(declaredLength) > maxBytes) {
        throw new Error('That page is too large to read.');
      }

      // Trust the body over the header: content-length can lie or be absent.
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > maxBytes) {
        throw new Error('That page is too large to read.');
      }

      return {
        body,
        contentType: response.headers.get('content-type'),
        finalUrl: currentUrl,
      };
    }

    throw new Error('Too many redirects');
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`That page took too long to respond (over ${Math.round(timeoutMs / 1000)}s).`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
