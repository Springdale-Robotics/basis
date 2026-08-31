# Two-Way Google Calendar Sync for Self-Hosted Boxes

**Date:** 2026-08-27 (amended 2026-08-28 after review)
**Status:** Reviewed against the repo. Both sign-off items resolved by the owner
on 2026-08-28, and the client-secret spike has been run — see "Where the secret
lives". Not implemented.
**Branch:** `docs/google-calendar-sync-design`

## Problem

Basis syncs from Google Calendar today, but only in one direction and only for a
box whose address Google has been told about in advance. Both limits come from
the same place: OAuth.

Google requires every redirect URI to be registered ahead of time, matched
character for character — "Redirect URIs must use the HTTPS scheme, not plain
HTTP", and they "cannot contain ... wildcard characters" ([web-server
guide][g-web]). There is no API for registering one at onboarding. Every Basis
box lives at a different address — `http://192.168.1.152:3000` on a LAN, or
`https://shelden.home-basis.com` through Basis Remote — and most of them are
plain HTTP. `sync.routes.ts:68` builds the redirect from the request's `Host`
header, which works only for a host someone has already typed into a Google
Cloud console. For everyone else the flow fails before it starts.

Behind that, the sync engine is pull-only. `google-sync.service.ts` defines
`createGoogleEvent`, `updateGoogleEvent` and `deleteGoogleEvent`, but nothing
calls them; connecting a calendar sets it `isReadOnly: true`
(`sync.routes.ts:206`) and every event route refuses edits on a read-only
calendar. A pull runs hourly (`jobs/index.ts:450`). So today: read Google, never
write it, hour-old at best.

The goal is a household that can connect Google Calendar from any box, edit in
either place, and see the change on the other side — with the better experience
where the paid tier's infrastructure makes it possible.

## Corrections to the earlier discussion

Three things said in conversation before this doc were wrong, and the design
here does not rest on them:

- **"A Desktop/installed client with PKCE lets the relay stay a dumb bounce."**
  No. Google's installed-app clients permit only loopback redirects
  (`http://127.0.0.1:port`); custom schemes "are no longer supported" and
  arbitrary HTTPS URLs are not an option ([native-app guide][g-native]). Option
  B must be a *Web application* client, which reopens the client-secret
  question rather than dodging it. See "Where the secret lives".
- **"Push notifications can go through the relay."** Not for a box with no
  inbound path. A LAN-only box cannot receive a webhook from anything. Push is
  a paid-tier capability, because Basis Remote is what gives a box a public
  HTTPS address with a real certificate.
- **"Google polls an ICS feed hours to a day behind."** Unverified, and not
  needed: ICS is read-only in both directions and not push-based, which rules it
  out on its own.

## Verified constraints

Everything the design depends on, with its source.

| Constraint | Source |
|---|---|
| Redirect URIs: HTTPS only (localhost exempt), no wildcards, exact match. | [OAuth web-server guide][g-web] |
| The authorization `code` is delivered as a **query parameter** on the redirect. | [OAuth web-server guide][g-web] |
| Installed-app clients: loopback redirect only; custom schemes withdrawn. | [OAuth native-app guide][g-native] |
| `client_secret` is documented as "Optional" at the token endpoint, but Google **enforces** it for Web application clients. A PKCE-only exchange returns `invalid_request` / "client_secret is missing." | [OAuth web-server guide][g-web]; **measured 2026-08-28**, see the spike |
| Calendar scopes are **sensitive**, not restricted: "Examples of sensitive scopes include reading events stored in Google Calendar". Calendar does not appear on the restricted list (Gmail, Drive, Fit, Chat, Data Portability, Photos Ambient, Health). | [Sensitive-scope verification][g-sens], [Restricted scopes][g-restr] |
| Sensitive-scope verification needs: Search Console domain ownership, a privacy policy on the same domain, a public homepage, a demo video, scope justifications. No CASA security assessment. "Typically takes 3-5 business days". | [Sensitive-scope verification][g-sens] |
| Unverified apps requesting sensitive scopes show a warning screen and are capped at "100 new users in total". "The user cap applies over the entire lifetime of the project, and it cannot be reset or changed." | [Unverified apps][g-unver], [Verification FAQ][g-faq] |
| Consent screen in **Testing**: "Authorizations by a test user will expire seven days from the time of consent ... that [refresh] token will also expire." Limited to 100 listed test users. | [Manage app audience][g-aud] |
| Google CalDAV "refuses to authenticate a request unless it arrives over HTTPS with OAuth 2.0". Basic auth gets a 401. Old `/calendar/dav` endpoint is gone. | [CalDAV guide][g-caldav] |
| OOB (`urn:ietf:wg:oauth:2.0:oob`) copy-paste flow: "all existing clients are blocked" since 2023-01-31. | [OOB migration][g-oob] |
| Push webhooks must be HTTPS with a valid CA certificate; self-signed rejected. No domain registration step. Channels expire and "there's no automatic way to renew". Notifications carry no body — they are a signal to re-fetch. | [Calendar push guide][g-push] |

Precedent: Home Assistant registers **one** redirect URI for every integration —
`https://my.home-assistant.io/redirect/oauth` — regardless of where the instance
runs. Its core helper picks that URI whenever the `my` component is loaded
(`async_get_redirect_uri` → `MY_AUTH_CALLBACK_PATH`) and lands the browser on
the instance's own `/auth/external/callback`. The relay page reads the instance
URL from `localStorage`, redirects with `document.location.assign(...)`, and if
no URL is stored sends the user to a page to set one. Nothing is posted to a
server; the bounce is entirely client-side ([my-redirect.ts][ha-src],
[config_entry_oauth2_flow.py][ha-core]). The `redirect.json` entry is marked
`deprecated: true`, but core's dev branch still routes OAuth through it; the
flag retires it from the *link-creation UI*, not from the architecture.

## What the repo has today

- `google-sync.service.ts` (534 lines): OAuth client, `syncCalendarFromGoogle`
  (pull with windowed deletes and no-op detection via `sync-reconcile.ts`),
  and the three unused outbound functions. Scopes are already the minimal
  sensitive pair: `calendar.readonly` + `calendar.events`.
- `sync.routes.ts`: connect/callback/select/disconnect. State is a random token
  in Redis with a TTL, keyed to user and household. Tokens are stored
  `encrypt()`ed in `calendars.sync_credentials`.
- `calendar_events.external_id` holds the Google event id. There is no etag or
  remote-updated column.
- **Three write paths reach `calendar_events`, and they share no service
  layer.** The REST routes write to the table directly at ~20 sites in
  `calendars.routes.ts`. CalDAV writes through `events.service.ts:applyPutBody`
  and the DELETE handler at `caldav.routes.ts:438`. The pull writes from
  `google-sync.service.ts`. There is no `createEvent()` helper any of them
  call.
- **Two Postgres triggers fire on every one of those writes**
  (`drizzle/0004_calendar_sync_triggers.sql`). `calendar_event_sync_trg`
  (AFTER INSERT/UPDATE/DELETE) bumps `calendars.sync_token`, rerolls `ctag`,
  and appends a `calendar_changes` row carrying
  `COALESCE(recurring_event_id, id)` and the change type — but not
  `external_id`. `calendar_event_revision_trg` (BEFORE UPDATE) bumps
  `revision`, which is what CalDAV ETags are built from.
- **The CalDAV write handlers never check `isReadOnly`** — they gate on
  `getEffectivePermission` alone (`caldav.routes.ts:328`, `:396`). That is a
  live bug today, filed as
  [basis#101](https://github.com/Springdale-Robotics/basis/issues/101): a
  CalDAV edit to a synced calendar is reverted by the next pull, a create
  survives as a local-only row that never reaches Google, and a delete is
  resurrected. It also means the set of places that refuse on `isReadOnly` is
  *not* the set of places that write events — which shapes the outbound design
  below.
- `basis-remote.ts` knows the box's paid subdomain and public hostname when the
  tunnel is up.
- `cloud/` runs the control plane at `home-basis.com` (Fastify, own Postgres,
  Caddy with a Let's Encrypt wildcard) and serves the marketing SPA.

The product-boundary rule (owner, 2026-07-04): *the cloud service must never
sync household accounts or data; box↔cloud coupling is only the one-time claim
code, the tunnel token, and the heartbeat.* Every choice below is checked
against it.

## Design

Two ways to connect, one relay, one sync engine.

- **Option A — bring your own Google project.** Free tier. The household
  creates a Google Cloud project and pastes its client id and secret into
  Basis, as today. What changes is that the redirect points at our relay
  instead of the box, so it works from any address.
- **Option B — the Basis Google client.** Paid tier (Basis Remote). Basis owns
  one verified OAuth client; the household just clicks Connect. The tunnel's
  public HTTPS also enables push notifications, so sync is near-real-time
  instead of polled.

Both use the same relay page and the same engine. A is the fallback that costs
us nothing and keeps working if B is ever unavailable.

### The relay: `connect.home-basis.com/oauth/google`

A static page on the existing cloud host. It is the only redirect URI either
Google client ever needs to know.

**Getting the browser back to the box.** Google will redirect the user's browser
to the relay with `?code=…&state=…`. The relay has to send that browser on to
the box, and for a LAN box there is no way for the relay to know the box's
address — nor should it. So the box's frontend does a *pre-flight bounce* first:

1. User clicks Connect on the box. The frontend navigates the top-level window
   to `https://connect.home-basis.com/oauth/google/start#return=<box-url>&to=<google-auth-url>`.
2. The relay page stores `return` in `localStorage` (its own origin), then
   `location.assign(to)` — off to Google.
3. Google consents, redirects to `https://connect.home-basis.com/oauth/google?code=…&state=…`.
4. The relay page reads `return` from `localStorage` and does
   `location.assign(`${return}/api/v1/calendars/sync/google/callback?code=…&state=…`)`.
5. The box's existing callback runs exactly as now: validates `state` against
   Redis, exchanges the code, stores tokens.

Both values in step 1 travel in the **URL fragment**, not the query string. A
fragment is never sent to the server, so the relay host provably never receives
the box's address. This is the HA mechanism with one improvement: HA prompts
for the instance URL on first use; the pre-flight makes that unnecessary.

**Why not carry the return URL in `state`?** The relay cannot verify a
signature from an unknown box, so a state-carried URL would make the relay an
open redirector that sends authorization codes wherever an attacker says.
`localStorage` is written only by a top-level navigation the user initiated
from their own box, in their own browser.

An earlier draft allowed one fallback for paid boxes: if `localStorage` is
empty, recover the subdomain from `state`. **Dropped in v1.** State is an
opaque random token today (the Redis key `oauth:google:${state}`); recovering a
subdomain from it would mean giving state a structure the box has to parse, and
it would put the household's subdomain into Google's request logs and the
relay's referrer chain. What it buys is recovery when consent finishes in a
different browser from the one it started in — rare, and the recovery is
"start again from the box", which already works. If `localStorage` is empty the
relay says so and links back to the box's own settings page.

**Requirements on the relay host.**
- **Reserve `connect` as a subdomain first, before the URI is registered with
  Google.** `cloud/server/src/lib/reserved-subdomains.ts` reserves ~110 names —
  `oauth`, `auth`, `relay`, `cloud`, `remote` among them — but not `connect`.
  Until it is reserved, a paying customer can claim
  `connect.home-basis.com` at checkout, and once that hostname is the
  registered redirect URI on both Google clients, whoever holds it receives an
  authorization code for every household that connects a calendar. One line,
  plus a check that no tenant already holds it. The ordering matters more than
  the change.
- **`connect.home-basis.com` needs its own Caddy site block.**
  `cloud/deploy/Caddyfile` has three blocks today, and `*.home-basis.com` sends
  everything else through `forward_auth /frp-gate` into frps — nothing serves
  static assets. Caddy prefers the more specific matcher, so an explicit
  `connect.home-basis.com` block with `file_server` and its own
  `tls dns cloudflare` stanza wins over the wildcard. The wildcard certificate
  already covers the name.
- Static HTML + a few lines of JS. No server code, no storage, no cookies.
- **Keep query strings out of any access log on this host.** Google delivers
  `code` as a query parameter. Today this costs nothing: the Caddyfile has no
  `log` directive at all, so no access log is written for any of the three
  sites. This is therefore a constraint to preserve, not a change to make —
  worth a comment in the new site block so that whoever adds logging later
  knows to exclude `/oauth/*`. (The same constraint binds the box, whose
  callback also receives `?code=`.)
- One consent-screen redirect URI on each Google client, ever.

Boundary check: the relay moves no household data to the cloud. Household
addresses stay in the browser; tokens stay on the box. This is a static asset,
not a new coupling.

### Option A: bring your own credentials

Mostly what exists. Changes:

- The auth URL is built with `redirect_uri = https://connect.home-basis.com/oauth/google`
  (replacing the `Host`-derived one in `sync.routes.ts:65-70` and `:108-111`).
- The connect screen tells the household to register that one URI in *their*
  Google client. HA's docs show this is allowed for a domain the household
  does not own.
- **Loud, blocking guidance to publish the consent screen to "In production".**
  In Testing, refresh tokens die after seven days and the calendar silently
  stops syncing a week later. This is the single most common failure in HA's
  Google setup and it presents as "sync broke", not as a config mistake. The
  connect flow should say it before the user leaves for Google, and the sync
  error path should recognise the resulting `invalid_grant` and say it again.
- Their own app is unverified; their own household are the only users, so the
  100-user cap is irrelevant and the warning screen is a one-time click.

### Option B: the Basis client (paid tier)

One Google Cloud project owned by Basis, one Web application client, redirect
URI = the relay, scopes = `calendar.readonly` + `calendar.events`. Sensitive
tier, so verification is the document-and-video process, 3–5 business days,
no security assessment — and it must be done before B ships, because the
unverified cap is 100 users for the life of the project and cannot be reset.
We have a public homepage. Needed: `home-basis.com` ownership in Search
Console (we control its DNS, so this is a TXT record), a privacy policy on
that domain, and the demo video.

**Where the secret lives.** A Web client's token exchange carries
`client_secret`. The box does the exchange (it holds the tokens), so the box
needs the secret. Options considered:

1. **Cloud token proxy** — box sends the code to the cloud, cloud adds the
   secret, returns tokens. *Rejected:* every household's Google tokens would
   pass through the cloud on connect and on every refresh. That is the thing
   the boundary rule exists to forbid.
2. **Publish the secret** in the open-source repo. *Rejected:* Google treats a
   Web client's secret as confidential; a public one invites the client being
   flagged or rotated out from under every box at once.
3. **Deliver it on the existing claim/heartbeat payload.** On claim and
   refreshed on heartbeat, the control plane returns
   `{ googleClientId, googleClientSecret }` alongside the tunnel token.
   *Rejected on review.* It is additive and downward-only, so it does not break
   the boundary rule — but every paid box would cache the secret whether or not
   its household ever touches Google, and a box that stops heartbeating keeps
   whatever it last saw, so a canceled tenant holds a live secret indefinitely.
   It also widens the recurring contract that `basis-cloud.ts` validates.
4. **Serve it from a separate cloud endpoint the box calls on demand, only
   when a household starts a Google connect.** *Chosen — owner sign-off
   2026-08-28.* Same authentication as the heartbeat (bearer tunnel token),
   same direction, same blast radius if it leaks; the box stores the response
   `encrypt()`ed like everything else in `sync_credentials`. What it adds over
   (3) is that only boxes actually using Google ever hold the secret; the
   entitlement check happens at the moment of use, so a suspended or canceled
   tenant simply does not get one; and there is a single place to audit which
   tenants hold it. Costs one endpoint and one round trip at connect time.

Note the suspension gotcha that makes (4) worth the extra endpoint: enforcement
in Basis Remote is two-layer, and a box that stops calling home keeps its last
cached state. Anything handed out on a recurring broadcast is therefore handed
out permanently. Anything fetched on demand is not.

Honest cost of (4), unchanged from (3): one secret shared across every paid
box, and a leak from any single box burns it for all. Rotation is less alarming
than it first looks — a Google OAuth client can hold **two live secrets at
once** (add, migrate, disable, delete; two is the maximum), so a rotation is a
rolling migration with an overlap window rather than a hard cutover ([manage
OAuth clients][g-rotate]). Boxes pick up the new secret at their next connect
and the old one is disabled once nothing is using it. Whether existing refresh
tokens survive the *delete* step is still not stated in Google's docs; the
spike below checks it, but with an overlap window available the answer is
informational rather than a release blocker.

The new client-config fields must be **optional** in the box's validation. `basis-cloud.ts` throws `ClaimError('CLOUD_ERROR')` and
`CloudUnreachableError` on any payload it considers incomplete, so an older box
has to survive a cloud that has started sending more, and a newer box has to
survive a cloud that has not deployed yet.

**Spike — run 2026-08-28. Answered: the secret is mandatory.**

Against a throwaway Web application client, an authorization-code exchange
carrying a valid `code_verifier` and no `client_secret` is rejected:

```
{ "error": "invalid_request", "error_description": "client_secret is missing." }
```

The same code shape with the secret attached succeeds and returns a refresh
token. So the "Optional" in Google's parameter table does not describe Web
application clients, and the folklore is right. PKCE alone will not carry
Option B.

This closes the question that could have deleted this whole section: there is
no version of Option B where a box holds only a client id. Decision (4) above
stands as the way the secret reaches paid boxes, and everything that follows
from it — encryption at rest, one shared secret across the fleet, the rotation
story — is real work rather than a contingency.

The harness is at `~/basis-gcal-review-2026-08-27/gcal-spike/` if it needs
re-running against a different client type.

**Still open, now informational rather than blocking:** whether a refresh token
issued under one secret survives that secret being deleted. Two secrets can be
live at once, so rotation has an overlap window and the answer only matters at
the final delete step — where it is recoverable by re-adding. The harness
README has the procedure.

**Entitlement.** B is offered when the box is in `basis_remote` mode with a
live tunnel and has received client config on the claim channel. A stays
available to everyone, including paid boxes, as an override.

### The sync engine

The same engine for A and B. The difference is only how it learns about
remote changes.

**Unlock local edits.** A Google-synced calendar stops being `isReadOnly`. The
five REST sites in `calendars.routes.ts` and `ics.service.ts:164` that refuse on
that flag instead proceed.

Leave Outlook alone. `sync.routes.ts:534` sets `isReadOnly: true` for Outlook
the same way, and Outlook has no outbound path — unlocking it would recreate
basis#101 on a different provider. The unlock must be conditional on
`syncProvider === 'google'`, not on `isSynced`.

**Where outbound work is discovered — not per-route hooks.** The obvious design
is "every route that used to refuse now enqueues an outbound job instead". It is
the wrong one, and basis#101 is the reason: the set of places that refuse on
`isReadOnly` is not the set of places that write events. CalDAV writes and never
refused, so it would get no hook and edits from the household's phone calendar
would never reach Google. There is no shared mutation helper to hang hooks on
either — the REST routes write to `calendar_events` directly at ~20 sites.
Per-site enqueue hooks would reproduce exactly the bug class this design just
found.

Discover the work from **state plus the journal** instead, which catches all
three write paths for free because Postgres triggers already see all three:

- **Creates** need no hook at all. A row on a synced Google calendar with
  `external_id IS NULL` has never been to Google. Push it, store the returned
  id.
- **Updates** need no hook either. A row whose `updated_at` is newer than its
  `remote_updated` has been changed locally since Google last saw it. Push it.
- **Deletes** are the one case state cannot express, because the row is gone.
  These come from the `calendar_changes` journal that
  `calendar_event_sync_trg` already writes on every delete. **One amendment is
  required:** the journal records `COALESCE(recurring_event_id, id)` and the
  change type, and `external_id` dies with the row — so there is nothing to
  call `deleteGoogleEvent` with. The trigger needs to capture `OLD.external_id`
  onto the delete row (a new nullable column on `calendar_changes`). Without
  it, journal-driven outbound is create/update-only.

The journal is also read by CalDAV's sync-token replay
(`caldav/sync.service.ts`), so the outbound worker keeps its own cursor per
calendar and never deletes rows it has consumed.

*Rejected alternative:* introduce a shared `createEvent()/updateEvent()/
deleteEvent()` service that all three paths call, and enqueue from there. It is
the tidier long-term shape, but it means touching ~20 REST call sites plus the
CalDAV service, and a single missed site is a silently-dropped sync — the same
failure mode, just harder to spot. Worth doing on its own merits some day;
not worth coupling this feature to it.

**Outbound.** Wire the three existing functions behind a per-calendar queue
(`concurrency: 1` so a household's writes to one calendar stay ordered).
Create → `createGoogleEvent`, store the returned Google id in `external_id`.
Update → `updateGoogleEvent` by `external_id`. Delete → `deleteGoogleEvent`
using the id captured on the journal row; tolerate 404/410, which just means
the event was already gone on Google's side. Recurrence in v1: masters go out;
**editing a single occurrence of a synced series is v2** — inbound already
handles master/exception, outbound exception editing is where the edge cases
live.

**And "a single occurrence" includes deleting one.** That does not create an
exception row: both routes that cancel an occurrence add an EXDATE to the
*master* and bump its `updated_at`, so it arrives at any outbound path looking
like an ordinary master edit. Pushing it destroys data — `updateGoogleEvent`
replaces Google's whole recurrence array, wiping exclusions it held, and the
pull keeps only `recurrence[0]`, so the local row never learns them back; the
sweep then stamps the row clean and never retries. Until the recurrence array
round-trips both ways, a synced calendar must **refuse** single-occurrence edits
and cancellations at the point of action, rather than accept them locally and
diverge silently. (Found 2026-08-31, implementing phase 2.)

Fixing basis#101 is folded into this: once outbound exists, the answer for
CalDAV writes to a synced calendar is "they sync" rather than "they are
refused", and no `isReadOnly` check needs adding to the CalDAV handlers. Until
phase 2 ships, refusing is the correct interim behaviour — so the issue is
worth fixing on its own timeline rather than waiting for this.

**Echo suppression.** A change we push comes straight back on the next pull as
"remote changed". Add `calendar_events.remote_updated` (Google's `updated`
timestamp, set on every push and every pull). On pull, an event whose Google
`updated` equals the stored `remote_updated` is unchanged — skip it. This is
also what `sync-reconcile.ts` needs to stop rewriting rows it already has, and
it is what keeps the state-derived update rule above from looping: after a push,
`remote_updated` catches up with `updated_at`, so the row stops qualifying.

**`remote_updated` writes must be invisible to both triggers.** This is the
trap `sync-reconcile.ts` already documents from the last time it was sprung —
unconditional rewrites "bumped each row's revision via the CalDAV triggers,
churning ETags (clients re-download everything) and appending unbounded
`calendar_changes` journal rows". A write that touches only `remote_updated`
would today fire `calendar_event_revision_trg` (bumping `revision`, so every
subscribed CalDAV client re-downloads the event) *and*
`calendar_event_sync_trg` (bumping `sync_token`, rerolling `ctag`, appending a
journal row). An outbound push would bump the revision twice: once for the
user's actual edit, once for recording what Google returned.

So phase 2 must make a `remote_updated`-only update a no-op for both triggers,
and the change belongs in `drizzle/0004_calendar_sync_triggers.sql`'s
successors. Verify against that file — it is the authority on what the triggers
currently do.

**Conflicts.** Last writer wins by timestamp, comparing the local `updated_at`
against Google's `updated`. No merge UI. Recorded in the sync log so a
surprised user can see what happened. This is the same policy every consumer
calendar sync uses and a household calendar does not justify more.

**Learning about remote changes.**
- *Polling* (everyone): the existing hourly job, tightened to every 5 minutes
  for calendars that have been touched locally in the last hour, hourly
  otherwise. Cheap because echo suppression makes an unchanged pull a no-op.
- *Push* (paid tier): on connect, `events.watch` with `address =
  https://<sub>.home-basis.com/api/v1/calendars/sync/google/notify`. The
  tunnel's Let's Encrypt certificate satisfies "valid SSL certificate". The
  endpoint validates the channel id and token, then enqueues a pull for that
  calendar — the notification carries no body, so a pull is the only response.
  A renewal job re-`watch`es each channel before its expiry, because there is
  no auto-renew. If the tunnel is down, notifications simply fail and the
  polling floor still runs.

**Disconnect.** Stop the channel (`channels.stop`), drop the tokens, and leave
the local events in place, unsynced.

## Phases

1. **Relay + fix A.** Reserve `connect` in the cloud's reserved-subdomain list
   **first**, and confirm no tenant holds it. Then: the `connect.home-basis.com`
   site block in the Caddyfile, the static relay page behind it, the pre-flight
   bounce in the frontend, the redirect URI change in `sync.routes.ts` (both the
   authorize step at `:65-70` and the token exchange at `:108-111`), and
   Production-not-Testing guidance in the connect flow and the error path. Still
   pull-only. Unblocks every self-hosted box immediately and creates the
   redirect URI that B will reuse. No Google verification needed.
2. **Two-way engine.** Unlock (Google only), the `external_id` column on
   `calendar_changes`, the outbound queue driven from state plus journal
   deletes, `remote_updated` with both triggers taught to ignore it, conflict
   policy, tighter polling. Works for A; needs nothing from the cloud.
   Supersedes basis#101.
3. **Option B.** Spike done — the secret is required, so none of this is
   contingent any more. Privacy policy + demo video; submit verification; the
   on-demand client-config endpoint on the cloud and the box side that calls
   it; connect-without-a-project UI; `watch` channels and the renewal job.

Each phase ships on its own and is useful on its own. Phase 3 is gated on
verification clearing, which is outside our control; phases 1 and 2 are not.

## Out of scope

- Outlook. Same shape, different provider; it gets the relay for free in phase
  1 and the engine in phase 2, but its push mechanism (Graph subscriptions) is
  its own piece of work.
- Per-occurrence edits of synced recurring series going outbound (v2).
- Attendee/RSVP sync, reminders sync, calendar ACL sync.
- A conflict-resolution UI.

## Testing

- **Relay:** a Playwright run that starts on a fake box origin, walks the
  pre-flight, is redirected to a stub "Google" that bounces back with
  `code`/`state`, and asserts the browser lands on the box callback with both
  intact and that the relay's access log contains no `code=`.
- **Engine:** backend tests with a mocked Calendar API for create/update/delete
  outbound, echo suppression (push then pull → no-op), conflict ordering, and
  the notify endpoint's channel validation. Tenancy test for the notify route
  — it is unauthenticated by nature, so it must be scoped by channel token to
  a single calendar and nothing else.
- **Write-path coverage:** the same outbound assertion run once per write path
  — REST, and CalDAV PUT/DELETE. This is the test that would have caught
  basis#101, and the one that keeps the state-plus-journal discovery honest if
  someone later adds a fourth way to write an event.
- **Trigger behaviour:** a `remote_updated`-only update must leave `revision`,
  `calendars.sync_token` and `ctag` untouched and append no `calendar_changes`
  row. Assert on the columns, not on the SQL.
- **Verification-readiness:** a checklist, not a test: privacy policy live,
  video recorded, scopes justified.

[g-web]: https://developers.google.com/identity/protocols/oauth2/web-server
[g-native]: https://developers.google.com/identity/protocols/oauth2/native-app
[g-sens]: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
[g-restr]: https://support.google.com/cloud/answer/13464325
[g-unver]: https://support.google.com/cloud/answer/7454865
[g-faq]: https://support.google.com/cloud/answer/13463817
[g-aud]: https://support.google.com/cloud/answer/15549945
[g-caldav]: https://developers.google.com/workspace/calendar/caldav/v2/guide
[g-oob]: https://developers.google.com/identity/protocols/oauth2/resources/oob-migration
[g-push]: https://developers.google.com/workspace/calendar/api/guides/push
[g-rotate]: https://support.google.com/cloud/answer/15549257
[ha-src]: https://github.com/home-assistant/my.home-assistant.io/blob/main/src/entrypoints/my-redirect.ts
[ha-core]: https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/config_entry_oauth2_flow.py
