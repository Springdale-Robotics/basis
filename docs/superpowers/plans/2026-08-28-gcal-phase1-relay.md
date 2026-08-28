# Google Calendar Sync — Phase 1: Relay + Fix Option A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Calendar connectable from any Basis box — LAN, tunnel, any address — by routing OAuth through one static relay page that is the only redirect URI Google ever needs to know.

**Architecture:** A static page on `connect.home-basis.com` receives Google's redirect and bounces the browser on to the box. The box's address travels in the URL *fragment*, which browsers never send to a server, and is held in the relay origin's `localStorage` across the trip to Google — so the cloud host provably never learns where any household's box lives. The box's OAuth code is unchanged apart from which `redirect_uri` string it uses. This phase stays pull-only; nothing about the sync engine changes.

**Tech Stack:** Fastify + TypeScript (box backend), React + Vite (box frontend), plain ES-module JS (relay page), Caddy (cloud edge), vitest (both test suites).

**Spec:** `docs/superpowers/specs/2026-08-27-google-calendar-sync-design.md` — read the "Design", "The relay" and "Option A" sections before starting. The plan argues from the spec; where they disagree, the spec wins and the plan is wrong.

## Global Constraints

- **User-facing copy says "Basis", never "homemanager".** `homemanager` is the legacy repo and package name only.
- **`drizzle-kit generate` is broken in this repo** (it emits ESM `.js` specifiers it then cannot read). Migrations are hand-authored: the `.sql` file, an entry in `backend/drizzle/meta/_journal.json`, and a `meta/NNNN_snapshot.json`. *Phase 1 adds no migrations* — this constraint is here because it bites in phase 2.
- **Box↔cloud boundary rule (owner, 2026-07-04):** the cloud service must never sync household accounts or data. Coupling is limited to the claim code, the tunnel token, and the heartbeat. The relay is a static asset and moves no household data; keep it that way — no server code, no storage, no cookies, no logging of query strings.
- **Multi-tenancy:** every query filters by `householdId` from `request.user!.householdId`, and any caller-supplied id is verified to belong to that household. New household-scoped tables need an RLS policy. Phase 1 adds no tables and no new household-scoped routes.
- **Deploys are repo → deploy.** Never edit files on a box or on the cloud host directly. Steps marked **[OPS]** are runbook items for the owner to perform, not executor tasks.
- **Colors come from theme tokens**, never hardcoded hex, in any frontend change.

## Deviation from the spec

The spec's Testing section asks for "a Playwright run that starts on a fake box origin, walks the pre-flight, is redirected to a stub Google that bounces back with `code`/`state`, and asserts the browser lands on the box callback with both intact".

**There is no Playwright in this repo, and no frontend test infrastructure at all** — `frontend/package.json` has no test script, and no `playwright.config.*` exists anywhere. Standing up a browser test harness is a larger piece of work than this phase, and doing it badly is worse than not doing it.

So the relay's logic is extracted into a pure module and tested exhaustively in the cloud's existing vitest suite (Task 2), and the browser behaviour is verified by hand with written steps (Task 3 Step 3, Task 6 Step 5). The spec's other testing assertion — that the relay's access log contains no `code=` — is satisfied structurally instead: there is no access log at all, and Task 4 carries a comment forbidding one.

If browser tests arrive in this repo later, the Playwright case in the spec is still the right one to write.

**Second: Outlook does not get the relay in this phase.** The spec says Outlook "gets the relay for free in phase 1". It does not. The relay as built here is Google-shaped in three places: the Caddy block rewrites only the two Google paths, `lib.js` refuses to forward anywhere but `accounts.google.com`, and the pre-flight bounce is wired only at the Google call sites. Moving Outlook's redirect URI to the relay without those three would land every Outlook connect on a 404 with no stored return — strictly worse than today, where the Host-derived flow at least works for a registered host.

So Outlook keeps its `Host`-derived redirect for now. Giving it the relay is its own task: a `/oauth/outlook` path in the Caddy block, a provider-aware origin allowlist in `lib.js` (Microsoft's authorize host rather than Google's), and the pre-flight at the Outlook call sites.

## Out of Scope

- Two-way sync. Calendars stay `isReadOnly` at the end of this phase; that is phase 2.
- Option B (the Basis-owned Google client) and anything touching the paid tier. Phase 3.
- **basis#101** (CalDAV write handlers ignoring `isReadOnly`). It rides its own timeline and phase 2 supersedes it. Do not fix it here, and do not add `isReadOnly` checks to the CalDAV handlers as part of this work.
- **Outlook keeps working exactly as it does today, Host-derived redirect and all.** See the second deviation below — routing Outlook through the relay is not the free ride the spec suggests, and doing it halfway would leave it worse off than it is now.

---

### Task 1: Reserve `connect` as a subdomain

The relay lives at `connect.home-basis.com`. `cloud/server/src/lib/reserved-subdomains.ts` reserves ~110 names — `oauth`, `auth`, `relay`, `cloud` among them — but not `connect`. Until it is reserved a paying customer can claim it at checkout, and once that hostname is the registered redirect URI on the Google client, whoever holds it receives an authorization code for every household that connects a calendar.

**This task must land, deploy, and have its [OPS] check run before Task 4 registers the URI with Google.** The ordering is the whole point of the task.

**Files:**
- Modify: `cloud/server/src/lib/reserved-subdomains.ts`
- Test: `cloud/server/test/subdomains.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. `validateSubdomainFormat(name: string): SubdomainRejection | null` keeps its existing signature; only the reserved set grows.

- [ ] **Step 1: Write the failing test**

Add to the existing reserved-name block in `cloud/server/test/subdomains.test.ts`. The current block reads `it.each(['www', 'api', 'admin', 'mail', 'billing', 'basis', 'relay'])`; add a separate case so the intent is documented:

```typescript
  it.each(['connect', 'connects', 'oauth-relay'])(
    'rejects %s — reserved for the OAuth relay host',
    (name) => {
      expect(validateSubdomainFormat(name)).toBe('reserved');
    }
  );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd cloud/server && npx vitest run test/subdomains.test.ts`
Expected: FAIL — `expected null to be 'reserved'` for all three names.

- [ ] **Step 3: Add the names to the reserved set**

In `cloud/server/src/lib/reserved-subdomains.ts`, add to the `RESERVED_SUBDOMAINS` set. Put them on the line with the other auth-ish names so the grouping stays readable:

```typescript
  'login', 'signin', 'signup', 'register', 'auth', 'sso', 'oauth', 'static',
  'connect', 'connects', 'oauth-relay',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd cloud/server && npx vitest run test/subdomains.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add cloud/server/src/lib/reserved-subdomains.ts cloud/server/test/subdomains.test.ts
git commit -m "feat(cloud): reserve connect subdomain for the OAuth relay

The relay page will live at connect.home-basis.com and become the single
registered redirect URI on the Google client. A customer holding that
hostname would receive an authorization code for every household that
connects a calendar."
```

- [ ] **Step 6: [OPS] Verify no tenant already holds it**

This runs against the cloud production database, by the owner. It is a read; it changes nothing.

```sql
SELECT id, subdomain, status FROM tenants
WHERE subdomain IN ('connect', 'connects', 'oauth-relay');
```

Expected: zero rows. **If any row comes back, stop and escalate** — the plan needs a different relay hostname, and every later task's `connect.home-basis.com` string changes with it. Do not proceed to Task 4 on a non-empty result.

---

### Task 2: The relay's URL logic, as a tested pure module

The relay page is a static asset with no server behind it, so its logic has to be a plain ES module that both the page and the test suite can import. This task builds the logic and its tests; Task 3 builds the HTML that calls it.

`cloud/server/vitest.config.ts` sets `include: ['test/**/*.test.ts']`, which governs *which files are tests*, not what a test may import — a test at `cloud/server/test/` can import `../../relay/lib.js` with no config change.

**Files:**
- Create: `cloud/relay/lib.js`
- Test: `cloud/server/test/relay-url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all imported by Task 3's HTML:
  - `parseStartFragment(fragment: string): { returnUrl: string, to: string }` — throws `Error` on anything malformed.
  - `buildCallbackUrl(returnUrl: string, search: string): string` — the box URL to send the browser to.
  - `classifyCallback(search: string): { kind: 'code' } | { kind: 'error', message: string }` — what Google sent back.

- [ ] **Step 1: Write the failing tests**

Create `cloud/server/test/relay-url.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  buildCallbackUrl,
  classifyCallback,
  parseStartFragment,
} from '../../relay/lib.js';

describe('parseStartFragment', () => {
  const frag = (r: string, t: string) =>
    `return=${encodeURIComponent(r)}&to=${encodeURIComponent(t)}`;

  it('reads both values out of the fragment', () => {
    const result = parseStartFragment(
      frag('http://192.168.1.152:3000', 'https://accounts.google.com/o/oauth2/v2/auth?x=1')
    );
    expect(result.returnUrl).toBe('http://192.168.1.152:3000');
    expect(result.to).toBe('https://accounts.google.com/o/oauth2/v2/auth?x=1');
  });

  it('tolerates a leading hash', () => {
    const result = parseStartFragment('#' + frag('http://box.local', 'https://accounts.google.com/x'));
    expect(result.returnUrl).toBe('http://box.local');
  });

  it.each([
    ['', 'empty fragment'],
    ['return=http%3A%2F%2Fbox.local', 'no destination'],
    [frag('', 'https://accounts.google.com/x'), 'empty return'],
    [frag('javascript:alert(1)', 'https://accounts.google.com/x'), 'javascript: return'],
    [frag('//evil.example', 'https://accounts.google.com/x'), 'protocol-relative return'],
    [frag('/settings', 'https://accounts.google.com/x'), 'relative return'],
    [frag('http://box.local', 'http://evil.example/steal'), 'destination is not Google'],
  ])('rejects %s (%s)', (fragment) => {
    expect(() => parseStartFragment(fragment)).toThrow();
  });
});

describe('buildCallbackUrl', () => {
  it('appends the box callback path and passes the query through intact', () => {
    const url = buildCallbackUrl('http://192.168.1.152:3000', '?code=abc%2F123&state=xyz');
    expect(url).toBe(
      'http://192.168.1.152:3000/api/v1/calendars/sync/google/callback?code=abc%2F123&state=xyz'
    );
  });

  it('does not double a trailing slash on the return URL', () => {
    const url = buildCallbackUrl('https://shelden.home-basis.com/', '?code=a&state=b');
    expect(url).toBe(
      'https://shelden.home-basis.com/api/v1/calendars/sync/google/callback?code=a&state=b'
    );
  });

  it('rejects a return URL that is not http(s)', () => {
    expect(() => buildCallbackUrl('javascript:alert(1)', '?code=a')).toThrow();
  });
});

describe('classifyCallback', () => {
  it('recognises a code', () => {
    expect(classifyCallback('?code=abc&state=xyz')).toEqual({ kind: 'code' });
  });

  it('reports the error Google sent', () => {
    const result = classifyCallback('?error=access_denied&state=xyz');
    expect(result.kind).toBe('error');
    expect(result).toHaveProperty('message', expect.stringContaining('access_denied'));
  });

  it('treats a query with neither code nor error as an error', () => {
    expect(classifyCallback('?state=xyz').kind).toBe('error');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloud/server && npx vitest run test/relay-url.test.ts`
Expected: FAIL — cannot resolve `../../relay/lib.js`.

- [ ] **Step 3: Write the module**

Create `cloud/relay/lib.js`:

```javascript
/**
 * URL logic for the Basis OAuth relay at connect.home-basis.com.
 *
 * The relay's whole job is to be a redirect URI Google will accept — one
 * fixed HTTPS address — and then hand the browser on to whichever box
 * started the flow. It has no server, no storage beyond this origin's
 * localStorage, and it must never learn a box address in a way that could
 * reach the cloud host: the box URL travels in the URL fragment, which
 * browsers do not send to servers.
 *
 * Kept free of DOM access so it can be tested directly; index.html and
 * start.html are the only callers that touch window.
 */

const CALLBACK_PATH = '/api/v1/calendars/sync/google/callback';

/** Google is the only place we will ever send a user mid-flow. */
const GOOGLE_AUTH_ORIGIN = 'https://accounts.google.com';

function assertBoxUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('The address of your Basis box is not a valid URL.');
  }
  // Absolute http(s) only. A protocol-relative or relative value would
  // resolve against this origin, and a javascript: URL would execute here.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The address of your Basis box must be http or https.');
  }
  return parsed;
}

/**
 * Read the `#return=...&to=...` fragment the box sent us to.
 * Throws with a message fit to show the user if anything is missing or unsafe.
 */
export function parseStartFragment(fragment) {
  const params = new URLSearchParams(
    fragment.startsWith('#') ? fragment.slice(1) : fragment
  );

  const returnUrl = params.get('return');
  const to = params.get('to');

  if (!returnUrl || !to) {
    throw new Error('This link is incomplete. Start again from your Basis box.');
  }

  assertBoxUrl(returnUrl);

  let destination;
  try {
    destination = new URL(to);
  } catch {
    throw new Error('This link is malformed. Start again from your Basis box.');
  }
  if (destination.origin !== GOOGLE_AUTH_ORIGIN) {
    throw new Error('This link does not point at Google. Start again from your Basis box.');
  }

  return { returnUrl, to };
}

/**
 * Where to send the browser once Google has redirected back to us.
 * The query string is passed through byte for byte — it carries `code` and
 * `state`, and the box validates `state` itself.
 */
export function buildCallbackUrl(returnUrl, search) {
  const base = assertBoxUrl(returnUrl);
  const origin = base.origin;
  const query = search.startsWith('?') ? search : `?${search}`;
  return `${origin}${CALLBACK_PATH}${query}`;
}

/** What did Google put on the redirect back to us? */
export function classifyCallback(search) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  const error = params.get('error');
  if (error) {
    return {
      kind: 'error',
      message:
        error === 'access_denied'
          ? 'You declined access at Google (access_denied). Nothing was connected.'
          : `Google returned an error: ${error}`,
    };
  }

  if (!params.get('code')) {
    return {
      kind: 'error',
      message: 'Google did not send an authorization code. Start again from your Basis box.',
    };
  }

  return { kind: 'code' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloud/server && npx vitest run test/relay-url.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add cloud/relay/lib.js cloud/server/test/relay-url.test.ts
git commit -m "feat(relay): URL logic for the OAuth relay page

Pure module so the bounce logic is testable without a browser. Rejects
relative, protocol-relative and javascript: return URLs, and refuses to
forward anywhere but accounts.google.com."
```

---

### Task 3: The relay pages

Two static pages on the relay origin. `start.html` stores the box address and leaves for Google; `index.html` receives Google's redirect and sends the browser home. Between them the box address lives only in this origin's `localStorage`, in the user's own browser.

**Files:**
- Create: `cloud/relay/start.html`
- Create: `cloud/relay/index.html`
- Modify: `cloud/relay/lib.js` (no change expected; listed because Task 2 owns it)

**Interfaces:**
- Consumes: `parseStartFragment`, `buildCallbackUrl`, `classifyCallback` from `cloud/relay/lib.js` (Task 2).
- Produces: two files Caddy serves. `start.html` is reached at `/oauth/google/start`, `index.html` at `/oauth/google`. Task 4 wires those paths; Task 5's backend hardcodes them.

- [ ] **Step 1: Write the start page**

Create `cloud/relay/start.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Connecting to Google — Basis</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        max-width: 32rem;
        margin: 4rem auto;
        padding: 0 1.5rem;
        line-height: 1.6;
        color: #1f2933;
        background: #fff;
      }
      @media (prefers-color-scheme: dark) {
        body { color: #e4e7eb; background: #16181d; }
      }
      .error { color: #b4232c; }
      @media (prefers-color-scheme: dark) { .error { color: #ff8a8a; } }
    </style>
  </head>
  <body>
    <h1>Connecting to Google</h1>
    <p id="status">One moment…</p>
    <script type="module">
      // Absolute, not './lib.js'. Caddy serves this page at /oauth/google/start
      // while the file sits at the relay root, so a relative specifier would
      // resolve to /oauth/google/lib.js and 404.
      import { parseStartFragment } from '/lib.js';

      const status = document.getElementById('status');
      try {
        const { returnUrl, to } = parseStartFragment(window.location.hash);
        // Stored on THIS origin, in this browser only. It is how we find our
        // way back after Google redirects here with no memory of the box.
        window.localStorage.setItem('basis.return', returnUrl);
        window.location.assign(to);
      } catch (err) {
        status.textContent = err.message;
        status.className = 'error';
      }
    </script>
  </body>
</html>
```

- [ ] **Step 2: Write the callback page**

Create `cloud/relay/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="referrer" content="no-referrer" />
    <title>Returning to Basis</title>
    <style>
      body {
        font-family: system-ui, sans-serif;
        max-width: 32rem;
        margin: 4rem auto;
        padding: 0 1.5rem;
        line-height: 1.6;
        color: #1f2933;
        background: #fff;
      }
      @media (prefers-color-scheme: dark) {
        body { color: #e4e7eb; background: #16181d; }
      }
      .error { color: #b4232c; }
      @media (prefers-color-scheme: dark) { .error { color: #ff8a8a; } }
    </style>
  </head>
  <body>
    <h1>Returning to Basis</h1>
    <p id="status">One moment…</p>
    <script type="module">
      // Absolute — see the note in start.html. Served at /oauth/google, a
      // relative specifier would resolve to /oauth/lib.js.
      import { buildCallbackUrl, classifyCallback } from '/lib.js';

      const status = document.getElementById('status');
      const fail = (message) => {
        status.textContent = message;
        status.className = 'error';
      };

      const verdict = classifyCallback(window.location.search);
      if (verdict.kind === 'error') {
        fail(verdict.message);
      } else {
        const returnUrl = window.localStorage.getItem('basis.return');
        if (!returnUrl) {
          // Consent finished in a different browser from the one that started
          // it. There is deliberately no way for this page to guess the box's
          // address — see "Why not carry the return URL in state" in the spec.
          fail(
            'This browser did not start the connection, so Basis cannot tell ' +
              'which box to return you to. Open Basis on your box and start ' +
              'the connection again from Settings → Calendars.'
          );
        } else {
          try {
            window.localStorage.removeItem('basis.return');
            window.location.assign(buildCallbackUrl(returnUrl, window.location.search));
          } catch (err) {
            fail(err.message);
          }
        }
      }
    </script>
  </body>
</html>
```

- [ ] **Step 3: Verify the pages load and bounce, by hand**

There is no browser test infrastructure in this repo, so this is a manual check. Serve the directory and walk both pages:

```bash
cd cloud/relay && python3 -m http.server 9099
```

Note this server exposes the pages at `/start.html` and `/index.html`, not at the `/oauth/google...` paths Caddy rewrites to. That difference is exactly why the imports above are absolute: a relative `./lib.js` would work here and 404 in production. Task 4's [OPS] step re-checks it against the real paths.

Then, in a browser:

1. `http://localhost:9099/start.html#return=http%3A%2F%2Flocalhost%3A9099%2Fdone&to=https%3A%2F%2Faccounts.google.com%2Fo%2Foauth2%2Fv2%2Fauth%3Fx%3D1`
   Expected: the browser leaves for Google's consent screen (it will complain about a missing client_id — that is fine, it proves the bounce).
2. Back at `http://localhost:9099/start.html#return=http%3A%2F%2Flocalhost%3A9099&to=http%3A%2F%2Fevil.example`
   Expected: stays put, shows "This link does not point at Google."
3. `http://localhost:9099/?error=access_denied&state=x`
   Expected: "You declined access at Google (access_denied)."
4. With devtools → Application → Local Storage cleared, load `http://localhost:9099/?code=abc&state=x`
   Expected: the "this browser did not start the connection" message, and no navigation.

Stop the server when done.

- [ ] **Step 4: Commit**

```bash
git add cloud/relay/start.html cloud/relay/index.html
git commit -m "feat(relay): static pages for the Google OAuth bounce

start.html stores the box address from the URL fragment and leaves for
Google; index.html reads it back and forwards the code to the box. The
fragment is never sent to a server, so the relay host never learns a
household's address."
```

---

### Task 4: Serve the relay from Caddy

`cloud/deploy/Caddyfile` has three site blocks today, and `*.home-basis.com` sends everything not matched more specifically through `forward_auth /frp-gate` into frps. Nothing serves static assets. Caddy prefers the more specific matcher, so an explicit `connect.home-basis.com` block wins over the wildcard.

**Files:**
- Modify: `cloud/deploy/Caddyfile`
- (no `provision.sh` change — see Step 2)

**Interfaces:**
- Consumes: `cloud/relay/` (Tasks 2–3).
- Produces: `https://connect.home-basis.com/oauth/google` and `/oauth/google/start`, live. Task 5 hardcodes the first as the redirect URI.

- [ ] **Step 1: Add the site block**

In `cloud/deploy/Caddyfile`, insert *before* the `*.home-basis.com` block so a reader meets it in specificity order:

```caddyfile
# OAuth relay. The single redirect URI registered on our Google client, and
# on every household's own client under Option A. Static files only — no
# server, no storage, no cookies.
#
# Do NOT add an access log to this site, and if one is ever added globally,
# exclude /oauth/*. Google delivers the authorization `code` as a query
# parameter, and household material must never land on the cloud host.
connect.home-basis.com {
	tls {
		dns cloudflare {env.CLOUDFLARE_API_TOKEN}
	}

	root * /opt/basis-cloud/current/cloud/relay
	# /oauth/google → index.html (Google's redirect target)
	# /oauth/google/start → start.html (the pre-flight bounce)
	rewrite /oauth/google/start /start.html
	rewrite /oauth/google /index.html
	file_server
}
```

- [ ] **Step 2: Confirm no deploy step is needed**

None is. `provision.sh` deploys the repo to `$APP_ROOT/current` (`APP_ROOT="/opt/basis-cloud"`, line 46) and serves the marketing SPA straight out of that checkout — `FRONTEND_DIST=$APP_ROOT/current/frontend/dist`, line 202. The relay is three static files already in the repo at `cloud/relay/`, so the Caddy `root` above points at `/opt/basis-cloud/current/cloud/relay` and a normal deploy publishes them. Nothing to build, nothing to copy.

Read lines 195-210 and 300-310 of `provision.sh` to confirm the checkout path is still what this step claims before relying on it. If `APP_ROOT` or the `current` symlink has moved, update the `root` line in Step 1 to match — do not add a copy step.

- [ ] **Step 3: Validate the Caddyfile syntax**

Run: `caddy validate --config cloud/deploy/Caddyfile --adapter caddyfile`
Expected: `Valid configuration`.

If `caddy` is not installed locally, this is an [OPS] step to run on the cloud host before reloading. Do not skip it — a malformed Caddyfile takes down home-basis.com along with the relay.

- [ ] **Step 4: Commit**

```bash
git add cloud/deploy/Caddyfile
git commit -m "feat(cloud): serve the OAuth relay at connect.home-basis.com

Its own site block, so the wildcard tunnel vhost does not swallow it.
Carries a comment forbidding access logs on /oauth/* — Google delivers the
authorization code as a query parameter."
```

- [ ] **Step 5: [OPS] Deploy, then register the redirect URI with Google**

By the owner, in order. **Task 1 Step 6 must have come back empty before this runs.**

1. Deploy the cloud host from the repo and reload Caddy.
2. Confirm `https://connect.home-basis.com/oauth/google` serves the callback page over a valid certificate, and that `https://connect.home-basis.com/oauth/google/start` serves the start page.
3. **With devtools open on both pages, confirm `/lib.js` loads (200, not 404).** The pages are rewritten to from nested paths while the module sits at the relay root, so this is the one thing the local `http.server` check cannot catch. A 404 here means the pages render but do nothing.
4. In the Google Cloud console for *the household-facing documentation example only* — there is no Basis-owned client until phase 3 — note the URI to publish in the connect instructions:
   `https://connect.home-basis.com/oauth/google`

---

### Task 5: Point the box's OAuth flow at the relay

`sync.routes.ts` builds `redirect_uri` from the request's `Host` header in two places — the authorize step and the token exchange. Google requires the value to be registered in advance and to match character for character at both steps, which is why the flow only ever worked for a box whose address someone had already typed into a Google console.

Both sites become the same constant. **They must not diverge:** Google compares the `redirect_uri` at the token exchange against the one used at authorize, and any difference fails the exchange with `redirect_uri_mismatch`.

The connect response also gains `relayStart`, the address of the pre-flight page, so the frontend can build the bounce. Task 6 consumes it; ship both together — a frontend reading a field the backend does not send would break the connect button.

**Files:**
- Modify: `backend/src/modules/calendars/sync.routes.ts` (Google only: lines ~65-70 and ~108-111)
- Create: `backend/src/modules/calendars/relay.ts`
- Test: `backend/test/calendars/relay.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks at build time. At runtime it depends on Task 4 having deployed the relay.
- Produces:
  - `RELAY_BASE = 'https://connect.home-basis.com'`
  - `googleRedirectUri(): string` → `https://connect.home-basis.com/oauth/google`
  - `relayStartUrl(): string` → `https://connect.home-basis.com/oauth/google/start`
  - The `POST /sync/google/connect` response body becomes `{ success: true, data: { authUrl: string, relayStart: string } }`. Task 6 reads both.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/relay.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { googleRedirectUri, relayStartUrl } from '../../src/modules/calendars/relay.js';

describe('relay URLs', () => {
  it('uses the one registered Google redirect URI', () => {
    expect(googleRedirectUri()).toBe('https://connect.home-basis.com/oauth/google');
  });

  it('points the pre-flight at the start page', () => {
    expect(relayStartUrl()).toBe('https://connect.home-basis.com/oauth/google/start');
  });

  it('is HTTPS and has no query string — Google requires both', () => {
    const parsed = new URL(googleRedirectUri());
    expect(parsed.protocol).toBe('https:');
    expect(parsed.search).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/relay.test.ts`
Expected: FAIL — cannot find module `relay.js`.

- [ ] **Step 3: Write the module**

Create `backend/src/modules/calendars/relay.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/calendars/relay.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it at all four call sites**

In `backend/src/modules/calendars/sync.routes.ts`:

Add the import beside the existing local imports:

```typescript
import { googleRedirectUri, relayStartUrl } from './relay.js';
```

Then replace the **two Google** Host-derived blocks. They currently read:

```typescript
      const protocol = request.headers['x-forwarded-proto'] || 'http';
      const host = request.headers['x-forwarded-host'] || request.headers.host;
      const redirectUri = `${protocol}://${host}/api/v1/calendars/sync/google/callback`;
```

Replace both — the authorize step and the token exchange — with:

```typescript
      const redirectUri = googleRedirectUri();
```

**Leave the two Outlook blocks exactly as they are.** They keep deriving from the `Host` header. Delete the now-unused `protocol`/`host` locals at the two Google sites only. If nothing else in the handler reads `request.headers`, the parameter may become unused — leave the signature alone, Fastify supplies it.

In the Google connect handler, return the start URL alongside the auth URL:

```typescript
      return {
        success: true,
        data: { authUrl, relayStart: relayStartUrl() },
      };
```

- [ ] **Step 6: Verify the whole backend still typechecks and tests green**

Run: `cd backend && npm run typecheck && npm run lint`
Expected: both clean. An unused-variable lint error means a `protocol`/`host` local survived a deletion.

Run: `cd backend && npx vitest run test/calendars/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/calendars/relay.ts backend/src/modules/calendars/sync.routes.ts backend/test/calendars/relay.test.ts
git commit -m "feat(calendars): route Google OAuth through the relay

The redirect URI was built from the request Host header at both the
authorize step and the token exchange, so the flow only worked for a box
whose address was already registered in a Google console. Both sites now
use the one relay URI, which is the only address Google ever needs.

Outlook is untouched — the relay only forwards to accounts.google.com, so
giving Outlook the same URI would 404 every connect.

The connect response gains relayStart so the frontend can pre-flight."
```

---

### Task 6: The pre-flight bounce in the frontend

The relay cannot know where a LAN box lives, and must not be told by any server. So the browser tells it, in a URL fragment, on the way out: the frontend sends the top-level window to the relay's start page with the box's own origin and the Google auth URL attached.

`window.location.origin` is the right source for the return address — it is literally the address the household is using right now, whatever it is.

**Files:**
- Modify: `frontend/src/pages/settings/CalendarSettingsPage.tsx:137` (Google) and `:151` (Outlook)
- Modify: `frontend/src/components/calendar/CalendarSyncSettings.tsx:85`
- Modify: `frontend/src/api/calendars.ts:204` (response type)

**Interfaces:**
- Consumes: `{ authUrl, relayStart }` from `POST /calendars/sync/google/connect` (Task 5).
- Produces: nothing other tasks import.

- [ ] **Step 1: Widen the API response type**

In `frontend/src/api/calendars.ts`, the Google connect call currently reads:

```typescript
    apiPost<{ authUrl: string }>('/calendars/sync/google/connect'),
```

Make it:

```typescript
    apiPost<{ authUrl: string; relayStart: string }>('/calendars/sync/google/connect'),
```

Leave the Outlook call at line ~261 alone. Outlook's redirect URI moved in Task 5, but its connect flow is untouched in this phase and it does not pre-flight.

- [ ] **Step 2: Add the bounce helper**

Also in `frontend/src/api/calendars.ts`, beside the connect calls:

```typescript
/**
 * Send the browser to the OAuth relay rather than straight to Google.
 *
 * The relay is the one redirect URI Google will accept, and it has no way to
 * know where this box lives — nor should it, since it is hosted on the Basis
 * cloud and household addresses must never reach it. So the box's own origin
 * rides in the URL fragment, which browsers never send to a server, and the
 * relay keeps it in its own localStorage for the trip to Google and back.
 */
export function relayHandoffUrl(relayStart: string, authUrl: string): string {
  const params = new URLSearchParams({
    return: window.location.origin,
    to: authUrl,
  });
  return `${relayStart}#${params.toString()}`;
}
```

- [ ] **Step 3: Use it at the Google call sites**

In `frontend/src/pages/settings/CalendarSettingsPage.tsx`, the Google handler at line ~137 currently reads:

```typescript
      window.location.href = data.authUrl;
```

Make it:

```typescript
      window.location.href = relayHandoffUrl(data.relayStart, data.authUrl);
```

Add `relayHandoffUrl` to the existing import from `@/api/calendars`.

Apply the same change in `frontend/src/components/calendar/CalendarSyncSettings.tsx` at line ~85.

**Leave line ~151 of `CalendarSettingsPage.tsx` alone** — that is the Outlook handler, and Outlook keeps navigating straight to its auth URL in this phase.

- [ ] **Step 4: Verify it builds**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: both clean. A type error on `data.relayStart` means Step 1 was missed.

- [ ] **Step 5: Verify the handoff by hand**

There is no frontend test infrastructure in this repo, so check it in the running app:

```bash
./dev.sh start
```

Open Settings → Calendars, click Connect for Google, and **stop at the address bar before consenting**. The URL should be `https://connect.home-basis.com/oauth/google/start#return=http%3A%2F%2Flocalhost%3A5173&to=https%3A%2F%2Faccounts.google.com%2F...`.

Confirm the two things that matter:
- `return` and `to` are after the `#`, not after a `?`. If they are in the query string the box address is being sent to the cloud host, which is the one thing this design exists to prevent.
- The `to=` value is a Google URL whose `redirect_uri` parameter is `https://connect.home-basis.com/oauth/google`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/calendars.ts frontend/src/pages/settings/CalendarSettingsPage.tsx frontend/src/components/calendar/CalendarSyncSettings.tsx
git commit -m "feat(calendars): pre-flight the Google connect through the relay

The browser now stops at the relay's start page on the way out, leaving
the box's own origin in the URL fragment so the relay can find its way
back after Google. Fragments are never sent to a server, so the cloud
host does not learn the address."
```

---

### Task 7: Tell households to publish their consent screen

A Google project left on the "Testing" publishing status expires refresh tokens seven days after consent. The calendar then stops syncing, a week later, with no visible cause — it is the most common failure in Home Assistant's equivalent setup, and it presents as "sync broke", not as a configuration mistake.

Two places have to say so: the connect screen, before the household leaves for Google, and the sync error path, when the seven days are up and the symptom appears.

**Files:**
- Modify: `frontend/src/pages/settings/CalendarSettingsPage.tsx` (connect-screen copy)
- Modify: `backend/src/modules/calendars/google-sync.service.ts` (error mapping)
- Test: `backend/test/calendars/sync-errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `describeGoogleSyncError(err: unknown): string` from `google-sync.service.ts`, used by the sync worker's error path.

- [ ] **Step 1: Write the failing test**

Create `backend/test/calendars/sync-errors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { describeGoogleSyncError } from '../../src/modules/calendars/google-sync.service.js';

describe('describeGoogleSyncError', () => {
  it('explains invalid_grant as the seven-day Testing expiry', () => {
    const message = describeGoogleSyncError(
      Object.assign(new Error('invalid_grant'), { response: { data: { error: 'invalid_grant' } } })
    );
    expect(message).toContain('Testing');
    expect(message).toContain('reconnect');
  });

  it('recognises invalid_grant from a bare message too', () => {
    expect(describeGoogleSyncError(new Error('invalid_grant: Token has been expired or revoked.')))
      .toContain('Testing');
  });

  it('passes other errors through readably', () => {
    expect(describeGoogleSyncError(new Error('Quota exceeded'))).toContain('Quota exceeded');
  });

  it('survives a non-Error being thrown', () => {
    expect(typeof describeGoogleSyncError('something odd')).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/calendars/sync-errors.test.ts`
Expected: FAIL — `describeGoogleSyncError` is not exported.

- [ ] **Step 3: Write the error mapper**

Add to `backend/src/modules/calendars/google-sync.service.ts`:

```typescript
/**
 * Turn a Google API failure into something a household can act on.
 *
 * The case worth special-casing is `invalid_grant`. A Google Cloud project
 * whose consent screen is still on the "Testing" publishing status expires
 * every refresh token seven days after consent, so a calendar that connected
 * fine simply stops a week later. The API error says nothing about why, and
 * the household has no reason to connect the two events.
 */
export function describeGoogleSyncError(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err);

  const code =
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? raw;

  if (typeof code === 'string' && code.includes('invalid_grant')) {
    return (
      'Google rejected the saved credentials (invalid_grant). This usually means ' +
      'the Google Cloud project is still on the "Testing" publishing status, which ' +
      'expires access seven days after you connect. In the Google Cloud console, ' +
      'set the consent screen to "In production", then reconnect the calendar in Basis.'
    );
  }

  return raw;
}
```

Then use it where the pull records a failure. Find the `catch` in `syncCalendarFromGoogle` that writes `syncError`, and pass the caught error through `describeGoogleSyncError` before storing it, replacing whatever raw message is stored today.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run test/calendars/sync-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the connect-screen warning**

In `frontend/src/pages/settings/CalendarSettingsPage.tsx`, in the Google connect section — beside the fields where the household enters its client id and secret, above the Connect button — add this. `Alert` lives at `@/components/ui/alert` and exports `Alert`, `AlertTitle`, `AlertDescription` with `variant` of `'default' | 'destructive'`; `AlertCircle` is already imported from `lucide-react` at the top of this file.

```tsx
<Alert className="mb-4">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Set your consent screen to &ldquo;In production&rdquo; first</AlertTitle>
  <AlertDescription>
    While a Google Cloud project is on &ldquo;Testing&rdquo;, Google expires access seven
    days after you connect and your calendar quietly stops syncing. You will also need to
    add this as an authorised redirect URI on your OAuth client:{' '}
    <code className="rounded bg-muted px-1 py-0.5 text-xs">
      https://connect.home-basis.com/oauth/google
    </code>
  </AlertDescription>
</Alert>
```

Add `Alert, AlertTitle, AlertDescription` to the imports. `variant` is left at its default — this is guidance before the fact, not an error. Colors come from `bg-muted`, a theme token; do not hardcode hex.

- [ ] **Step 6: Verify it builds and reads well**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: clean.

Then `./dev.sh start`, open Settings → Calendars, and confirm the notice is visible without scrolling past the Connect button, and that the redirect URI in it is selectable text a household can copy.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/calendars/google-sync.service.ts backend/test/calendars/sync-errors.test.ts frontend/src/pages/settings/CalendarSettingsPage.tsx
git commit -m "feat(calendars): warn about the Testing consent screen, twice

A Google project left on Testing expires refresh tokens seven days after
consent, and the calendar stops syncing with no visible cause. Say so on
the connect screen before the household leaves for Google, and again in
the sync error when invalid_grant comes back a week later."
```

---

## Done when

- A box on a LAN address can complete a Google Calendar connection end to end, with the household's own Google project, and no address of that box has been typed into a Google console.
- `https://connect.home-basis.com/oauth/google` is the only redirect URI registered anywhere.
- `connect` cannot be claimed as a customer subdomain.
- Calendars are still created `isReadOnly: true`. Nothing about sync direction has changed — that is phase 2.
