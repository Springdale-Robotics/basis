import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * WS event contract: every event name the backend emits must have a consumer
 * in the frontend (or be explicitly allowlisted as emit-only). This is the
 * class of bug where completion emitted `task:completed` but the frontend
 * only listened for `task:update` — the core "kid checks off a chore, parent
 * sees it" flow silently broken with no error anywhere.
 */

const here = dirname(fileURLToPath(import.meta.url));
const eventsSource = readFileSync(
  join(here, '../../src/websocket/events.ts'),
  'utf-8',
);
const frontendProvider = readFileSync(
  join(here, '../../../frontend/src/providers/WebSocketProvider.tsx'),
  'utf-8',
);

/**
 * Events deliberately emitted without a global frontend listener. Every entry
 * needs a reason — additions to this list should be rare.
 */
const EMIT_ONLY_ALLOWLIST: Record<string, string> = {
  'calendar:sync:started': 'transient signal; UI shows result via sync:completed/failed',
  'user:status': 'presence signal; no presence UI exists yet',
};

function emittedEvents(): string[] {
  // Matches the string literal event-name argument of the emit helpers.
  const re = /emitTo(?:Household|User|Room)\([^,]+,\s*'([^']+)'/g;
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(eventsSource))) {
    names.add(m[1]);
  }
  return [...names].sort();
}

describe('websocket event contract', () => {
  const events = emittedEvents();

  it('finds the emitted event inventory (sanity)', () => {
    expect(events.length).toBeGreaterThan(15);
    expect(events).toContain('task:completed');
    expect(events).toContain('list:update');
  });

  it.each(events)('emitted event "%s" has a frontend listener or is allowlisted', (event) => {
    if (EMIT_ONLY_ALLOWLIST[event]) return;
    expect(
      frontendProvider.includes(`'${event}'`),
      `Backend emits "${event}" but WebSocketProvider.tsx never listens for it. ` +
        `Add a listener (usually a React Query invalidation) or allowlist it with a reason.`,
    ).toBe(true);
  });
});
