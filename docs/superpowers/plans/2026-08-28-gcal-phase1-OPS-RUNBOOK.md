# Phase 1 Ops Runbook — the steps only you can run

Everything in `2026-08-28-gcal-phase1-relay.md` is implemented and committed on
`feat/gcal-phase1-relay`. These are the steps that need a human with production
access. They are ordered, and the order is load-bearing.

Nothing here has been simulated, guessed at, or partially done.

---

## Step 1 — Confirm nobody already holds `connect` (BLOCKING, do first)

The relay lives at `connect.home-basis.com`, and that hostname is about to
become the registered redirect URI on Google OAuth clients. Whoever controls it
receives an authorization code for every household that connects a calendar.
The code reserves the name against *future* claims; it cannot evict an existing
holder.

Against the **cloud** production database (`home-basis.com`, not a box):

```sql
SELECT id, subdomain, status FROM tenants
WHERE subdomain IN ('connect', 'connects', 'oauth-relay');
```

**Run 2026-08-28 — CLEAR.** `ssh basis-relay`, then
`sudo -u postgres psql -d basis_cloud`. No tenant holds any of the three names;
the whole `tenants` table is one row, `shelden | active`. This gate is passed
and does not need re-running unless a new tenant signs up before deploy.

A correction to the framing below, worth knowing if this ever needs re-running:
the Caddy block for `connect.home-basis.com` is a literal hostname, and Caddy
prefers it over the `*.home-basis.com` wildcard. So once Step 3 is deployed,
that hostname serves the relay whoever owns the tenant row — meaning the real
risk is **silently taking a paying customer's hostname and breaking their box**,
not codes being stolen. Codes only go astray if Step 4 runs before Step 3, which
is why the steps are ordered as they are.

- **Zero rows** → proceed to Step 2.
- **Any rows** → **stop**. Do not continue to Step 3. The relay hostname has to
  change, and that string appears in the Caddy block, `backend/src/modules/calendars/relay.ts`,
  both relay HTML pages' copy, and the connect-screen notice. Tell me and I'll
  change it everywhere.

---

## Step 2 — Deploy the cloud host

Normal repo → deploy. Two things ride along:

- `cloud/server/src/lib/reserved-subdomains.ts` — `connect`, `connects` and
  `oauth-relay` become unclaimable at checkout.
- `cloud/relay/` — static files only (`index.html`, `start.html`, `lib.js`,
  `start.js`, `callback.js`).
  The release workflow now stages them into the tarball alongside the server
  and frontend, so they ship and land at `/opt/basis-cloud/current/relay`
  with no separate build or copy step of your own.

---

## Step 3 — Validate the Caddyfile, then reload

**Validate before reloading.** A malformed Caddyfile takes down
`home-basis.com` and the tenant tunnels along with the relay.

`update.sh` does not touch `/etc/caddy/Caddyfile` — only `provision.sh` installs
it, and that only runs on first setup. A normal version deploy will otherwise
leave the running Caddyfile without the `connect.home-basis.com` block
entirely, and the hostname falls through to the `*.home-basis.com` frps
wildcard instead of serving the relay. Install the new copy explicitly before
validating:

```bash
sudo install -m 644 /opt/basis-cloud/current/deploy/Caddyfile /etc/caddy/Caddyfile
```

Then, on the cloud host, where the Cloudflare DNS plugin is built in:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Expect `Valid configuration`.

I have already validated this config two ways locally, so this is a
belt-and-braces check rather than the only one:

- `caddy validate` in a `caddy:2-alpine` container, with the four
  `tls { dns cloudflare … }` stanzas stripped (the stock image lacks that
  plugin, which is the *only* reason it can't validate the file as-is) →
  **Valid configuration**.
- Ran Caddy for real against the actual `root`/`rewrite`/`file_server` lines and
  fetched every public path. Results below under "What I verified".

You will also see a pre-existing warning, `Caddyfile input is not formatted`, at
line 9. It appears identically on the commit *before* this work, so it is not
from these changes. `caddy fmt` would rewrite unrelated lines; I left it.

Then reload, and confirm over the real certificate:

```bash
curl -sI https://connect.home-basis.com/oauth/google       # expect 200
curl -sI https://connect.home-basis.com/oauth/google/start # expect 200
curl -sI https://connect.home-basis.com/lib.js             # expect 200 — see note
curl -sI https://connect.home-basis.com/start.js           # expect 200 — see note
curl -sI https://connect.home-basis.com/callback.js        # expect 200 — see note
```

Those last three matter more than they look. Both pages load their glue
script (`start.js` / `callback.js`, each importing `/lib.js`) with an
**absolute** specifier because Caddy rewrites the pages to nested paths while
the files sit at the root. If any of the three 404s, both pages render and
silently do nothing.

---

## Step 4 — Register the redirect URI with Google

This is per-household under Option A: each household's own Google Cloud project
needs it. Register exactly, character for character:

```
https://connect.home-basis.com/oauth/google
```

Google string-matches this and rejects anything that differs — including a
trailing slash.

While in the console, set the consent screen's publishing status to **"In
production"**. On "Testing", Google expires refresh tokens seven days after
consent and the calendar quietly stops syncing a week later. The app now warns
about this twice — on the connect screen and in the sync error — but the fix is
here, in the console.

---

## Step 5 — Deploy the box, and connect a calendar

Deploy the backend and frontend to the box, then connect a Google calendar from
Settings → Calendars.

This is the one path I could not exercise: the dev environment has no
`GOOGLE_CLIENT_ID`, so `/sync/google/connect` throws before returning an auth
URL. Everything downstream of that response is verified; the response itself
carrying `relayStart` is not.

What you should see: the browser stops at
`connect.home-basis.com/oauth/google/start`, goes to Google, comes back, and
lands on your box's callback. If it instead stops at the relay saying "This
browser did not start the connection", the pre-flight didn't store the return
address — tell me and I'll look.

---

## Read this before you call phase 1 done

**Option A does not work the way the spec says it does.** The spec has each
household pasting its own Google client id and secret into Basis. There is no
such UI anywhere in the frontend — credentials come from `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` environment variables on the box, and the settings page
tells a household to "contact your administrator". On a self-hosted box the
administrator and the household are usually the same person, so this works; it
is not the self-serve story the spec describes.

What phase 1 genuinely delivers is the fix to the actual blocker: **OAuth now
works from any box address instead of only a pre-registered one.** Credential
entry is a separate piece of work that no phase currently owns, because the spec
assumed it already existed.

A consequence you'll see immediately: the new connect-screen notice says
"register this redirect URI on **your** OAuth client", and the line below it
says "contact your administrator". Two messages for two different readers. I
left the copy alone rather than rewriting it to fit the env-var model, because
that would bake in an answer to a question you haven't decided yet.

**Outlook is unchanged.** The spec said it gets the relay for free in phase 1.
It doesn't: `lib.js` forwards only to `accounts.google.com`, and the Caddy block
rewrites only the Google paths. Pointing Outlook at the relay would 404 every
Outlook connect — worse than its current state. It keeps its `Host`-derived
redirect, which still only works from a pre-registered address.

---

## What I verified, so you don't re-do it

Relay logic, in a browser, against the real pages:

- A non-Google destination is refused; no open redirect.
- Google's `access_denied` surfaces as readable text.
- A callback arriving in a browser that didn't start the flow refuses to forward
  the code anywhere.
- Full round trip lands on the box callback with `code` and `state`
  byte-identical, `%2F` still encoded.
- The box address appears **only** in the fragment and in the relay origin's
  `localStorage` — it is absent from the URL sent to Google. This is the security
  property the whole design exists for.
- The authorization code is scrubbed from the URL and never retained in history
  (`history.length` 13 → 14 across a full round trip; an `assign` would have
  left 15).
- **The stored return address is keyed by the OAuth `state`.** With a hostile
  entry planted at `basis.return.attackerstate`, a callback arriving as
  `?code=…&state=victimstate456` did NOT read it: the page forwarded nowhere,
  showed "This browser did not start the connection", and scrubbed the code.
  The legitimate path still works — the entry is written under the state taken
  from the auth URL, read under the state Google echoes back, and removed after
  use. This is the poisoning attack a review raised, defeated.

Caddy, running for real (with the final header block and the extracted scripts):

```
/oauth/google        → 200  <title>Returning to Basis</title>
/oauth/google/start  → 200  <title>Connecting to Google — Basis</title>
/lib.js              → 200
/start.js            → 200
/callback.js         → 200
/oauth/google/lib.js → 404      ← exactly why the absolute imports were required
/oauth/google?code=… → 200, 0 redirects (internal rewrite, query survives)

Cache-Control: no-cache
Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'unsafe-inline'
```

The CSP does not block the extracted modules — the callback page ran its logic
and produced its message, which is only reachable if the module loaded.

Frontend ↔ relay seam, using both real implementations rather than a
reimplementation — the relay's own `parseStartFragment` and `relayHandoffUrl`
copied byte-for-byte out of `calendars.ts`: the Google auth URL survives the
encode/decode round trip **byte-for-byte**. That is the bug that would have
passed every unit test on both sides and still broken every real connect.

Tests: full backend suite 691 passed / 35 skipped, `cloud/server` 77/77.
