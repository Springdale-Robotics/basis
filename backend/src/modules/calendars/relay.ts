/**
 * The OAuth relay at connect.home-basis.com.
 *
 * Google requires every redirect URI to be registered in advance and matched
 * character for character, and offers no API to register one at onboarding.
 * Every Basis box lives at a different address, and most are plain HTTP, so
 * a Host-derived redirect only ever worked for a box whose address someone
 * had already typed into a Google Cloud console.
 *
 * Instead there is exactly one redirect URI, forever: a static page on the
 * cloud host that bounces the browser back to whichever box started the
 * flow. See docs/superpowers/specs/2026-08-27-google-calendar-sync-design.md.
 *
 * Deliberately not configurable. The value is compiled into every household's
 * Google client registration; a box that used a different one would fail the
 * token exchange, and a box that could be pointed elsewhere would be a way to
 * redirect authorization codes.
 */
export const RELAY_BASE = 'https://connect.home-basis.com';

export function googleRedirectUri(): string {
  return `${RELAY_BASE}/oauth/google`;
}

// Outlook deliberately has no entry here. The relay is Google-shaped —
// lib.js forwards only to accounts.google.com and the Caddy block rewrites
// only the Google paths — so pointing Outlook at it would 404 every connect.
// See "Deviation from the spec".

/**
 * The pre-flight page. The frontend sends the browser here first, with the
 * box's own origin and the Google auth URL in the fragment, so the relay
 * knows where to return to without any server ever seeing the box address.
 */
export function relayStartUrl(): string {
  return `${RELAY_BASE}/oauth/google/start`;
}
