# Two-Way Google Calendar Sync for Self-Hosted Boxes

**Date:** 2026-08-27
**Status:** Design for review, not implemented
**Branch:** none yet

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
| `client_secret` is documented as "Optional" at the token endpoint. Whether Google *enforces* it for Web application clients is not stated. | [OAuth web-server guide][g-web] — **open spike, see below** |
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
from their own box, in their own browser. For paid boxes a *fallback* is safe:
if `localStorage` is empty (different browser), the relay may redirect to
`https://<sub>.home-basis.com/…` where `<sub>` comes from `state` and matches
`^[a-z0-9-]+$` — a closed set of hosts we control. No other fallback.

**Requirements on the relay host.**
- Static HTML + a few lines of JS. No server code, no storage, no cookies.
- Caddy must **not log query strings** on `/oauth/*`. Google delivers `code` as
  a query parameter, so it will transit the relay's access log otherwise. The
  code is single-use, short-lived and useless without the client secret, but
  the rule is that household material never lands on the cloud.
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
3. **Deliver it to paid boxes over the existing claim/heartbeat channel.**
   *Chosen.* On claim (and refreshed on heartbeat), the control plane returns
   `{ googleClientId, googleClientSecret }` alongside the tunnel token; the box
   stores it `encrypt()`ed like everything else in `sync_credentials`. Config
   flows *down*; nothing about the household flows *up*. This is within the
   letter of the boundary rule — the channel is the one the rule already
   names — but it widens what travels on it, so it is called out here for
   the owner's explicit sign-off rather than assumed.

Honest cost of (3): one secret shared across every paid box. A leak from any
single box burns it for all. Rotation is the same channel in reverse: the
control plane issues a new secret, boxes pick it up at next heartbeat, and the
old one is deleted in the Google console. Whether existing refresh tokens
survive a secret rotation is not stated in Google's docs — the spike below
should check it, because the answer decides whether a rotation is invisible to
households or forces every paid box to reconnect.

**Open spike, listed not resolved:** whether Google's token endpoint actually
enforces `client_secret` for Web application clients. The docs mark it
"Optional"; folklore says a Web client gets `client_secret is missing`. One
throwaway client and one `curl` settles it. If PKCE-only works, the secret
disappears from (3) entirely and B becomes strictly simpler. The same spike
should rotate that client's secret and check whether a refresh token issued
under the old one still refreshes. Do the spike first; do not research it
further.

**Entitlement.** B is offered when the box is in `basis_remote` mode with a
live tunnel and has received client config on the claim channel. A stays
available to everyone, including paid boxes, as an override.

### The sync engine

The same engine for A and B. The difference is only how it learns about
remote changes.

**Unlock local edits.** A Google-synced calendar stops being `isReadOnly`.
Every event route that currently refuses on `isReadOnly` instead proceeds and,
if `calendar.isSynced && syncProvider === 'google'`, enqueues an outbound job.

**Outbound.** Wire the three existing functions behind a per-calendar
queue (`concurrency: 1` so a household's writes to one calendar stay ordered).
Create → `createGoogleEvent`, store the returned Google id in `external_id`.
Update → `updateGoogleEvent` by `external_id`. Delete → `deleteGoogleEvent`,
then the local row. Recurrence in v1: masters go out; **editing a single
occurrence of a synced series is v2** — inbound already handles
master/exception, outbound exception editing is where the edge cases live.

**Echo suppression.** A change we push comes straight back on the next pull as
"remote changed". Add `calendar_events.remote_updated` (Google's `updated`
timestamp, set on every push and every pull). On pull, an event whose Google
`updated` equals the stored `remote_updated` is unchanged — skip it. This is
also what `sync-reconcile.ts` needs to stop rewriting rows it already has.

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

1. **Relay + fix A.** Static relay page on the cloud host, pre-flight bounce in
   the frontend, redirect URI change in `sync.routes.ts`, Production-not-Testing
   guidance in the connect flow and the error path, query-log scrubbing in
   Caddy. Still pull-only. Unblocks every self-hosted box immediately and
   creates the redirect URI that B will reuse. No Google verification needed.
2. **Two-way engine.** Unlock, outbound queue, `remote_updated`, echo
   suppression, conflict policy, tighter polling. Works for A; needs nothing
   from the cloud.
3. **Option B.** Client-secret spike; privacy policy + demo video; submit
   verification; claim-channel delivery of client config (with the owner's
   sign-off on the coupling); connect-without-a-project UI; `watch` channels
   and the renewal job.

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
[ha-src]: https://github.com/home-assistant/my.home-assistant.io/blob/main/src/entrypoints/my-redirect.ts
[ha-core]: https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/config_entry_oauth2_flow.py
