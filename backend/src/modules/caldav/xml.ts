/**
 * Minimal XML helpers for CalDAV responses. We compose responses by hand
 * (rather than pulling in a full XML library) because the response shapes are
 * rote and the indentation matters for some pedantic clients.
 *
 * Inbound XML (PROPFIND/REPORT request bodies) is parsed via fast-xml-parser
 * in the per-route handlers.
 */

const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => XML_ENTITIES[c] ?? c);
}

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * Build a `<d:multistatus>` envelope with the given `<d:response>` children.
 * Namespaces declared up-front so children can use the short prefixes without
 * redeclaring.
 */
export function multistatus(responses: string[]): string {
  return (
    `${XML_DECL}\n` +
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">\n` +
    responses.join('\n') +
    `\n</d:multistatus>\n`
  );
}

export interface ResponseBuilder {
  /** Full href of the resource (relative or absolute) */
  href: string;
  /** Properties that resolved successfully */
  found?: string;
  /** Properties that were not found (404) */
  notFound?: string[];
}

export function response(b: ResponseBuilder): string {
  const parts: string[] = [`  <d:response>\n    <d:href>${escapeXml(b.href)}</d:href>`];
  if (b.found) {
    parts.push(
      `    <d:propstat>\n      <d:prop>\n${b.found}      </d:prop>\n      <d:status>HTTP/1.1 200 OK</d:status>\n    </d:propstat>`
    );
  }
  if (b.notFound && b.notFound.length) {
    const props = b.notFound.map((p) => `        <${p}/>`).join('\n');
    parts.push(
      `    <d:propstat>\n      <d:prop>\n${props}\n      </d:prop>\n      <d:status>HTTP/1.1 404 Not Found</d:status>\n    </d:propstat>`
    );
  }
  parts.push(`  </d:response>`);
  return parts.join('\n');
}

/**
 * Parse a PROPFIND request body and return the requested property local names.
 * If the body is empty or `<d:allprop/>` is used, returns the sentinel '*'.
 * Strips namespace prefixes — handlers match on local name only.
 */
export function parsePropfindRequestedProps(body: string | undefined | null): string[] | '*' {
  if (!body || !body.trim()) return '*';
  const lower = body.toLowerCase();
  if (lower.includes('<allprop')) return '*';
  if (!lower.includes('<prop')) return '*';
  // Naive extraction of element local names inside <prop>...</prop>. The CalDAV
  // namespaces (DAV:, urn:ietf:params:xml:ns:caldav, calendarserver.org)
  // require us to match by local name; a real XML parser is overkill for the
  // tiny element list clients send.
  // Strip everything up to and including the opening <prop> tag.
  const openIdx = body.search(/<(?:[\w-]+:)?prop\b[^>]*>/i);
  if (openIdx < 0) return '*';
  const afterOpen = body.slice(openIdx).replace(/^<(?:[\w-]+:)?prop\b[^>]*>/i, '');
  // Strip the closing </prop> and beyond.
  const closeIdx = afterOpen.search(/<\/(?:[\w-]+:)?prop\s*>/i);
  const propBlock = closeIdx >= 0 ? afterOpen.slice(0, closeIdx) : afterOpen;
  // Each child element: optionally `prefix:`, then local name, capture name.
  const matches = propBlock.matchAll(/<(?:[\w-]+:)?([\w-]+)\b[^>]*\/?>/g);
  const names = new Set<string>();
  for (const m of matches) {
    if (m[1]) names.add(m[1].toLowerCase());
  }
  return [...names];
}

export function wantsProp(requested: string[] | '*', name: string): boolean {
  if (requested === '*') return true;
  return requested.includes(name.toLowerCase());
}
