# Security & threat model

Basis is a **household-scale, single-tenant, self-hosted** application. This
document states the model the code is designed for and how isolation and access
are actually enforced, so operators can reason about the boundaries.

## Intended model: one household per install

Basis is designed to run **one household per installation**, on hardware the
household controls. The expected admin is the person who installed it; the
expected users are the people they live with. Basis is **not** designed for
mutually-adversarial users, and it is **not** designed to host multiple
unrelated households behind a single install as a shared service.

If you run more than one household on a single install, read the
"Administrative terminal" section below first — the default configuration gives
every household admin host-level access.

## Tenant isolation is enforced in the application layer

Every row is scoped to a `household_id`, and every query filters on it in the
service/route layer. **There is no PostgreSQL row-level-security (RLS) policy
layer** — do not assume the database will catch a missing tenant filter. When
adding a query, scoping to the caller's `household_id` (or `user_id`) is
mandatory; there is no second line of defense underneath it.

(An `rls.middleware.ts` helper exists but is not wired up and enables no
policies. It should not be relied on. Real DB-level RLS would be the right
hardening step before Basis could safely become multi-tenant.)

## Administrative terminal

The admin **Terminal** settings page opens a freeform shell (`bash -l`) running
as the backend service user, over an admin-authenticated WebSocket. This is
intentional: for the single-owner-admin install it is equivalent to that
person's own SSH session, and it powers the guided-install / remote-access
tooling.

Because it is host-level access, it is gated by config:

- `ENABLE_ADMIN_TERMINAL=true` (default) — the freeform shell is available to
  household admins.
- `ENABLE_ADMIN_TERMINAL=false` — the freeform shell is refused and hidden from
  the installer list. The fixed-argv installer commands (cloudflared install,
  self-update, etc.) still work.

**Set `ENABLE_ADMIN_TERMINAL=false` on any install that serves more than one
household**, or wherever a household admin should not have host access.

## Authentication

- Cookie sessions, `httpOnly` + `SameSite=Lax`, `Secure` keyed to the actual
  request scheme. Server-side session records with enforced expiry; individually
  revocable. "Log out other devices" revokes every *other* session.
- Passwords hashed with argon2id.
- App passwords for CalDAV — scoped per device, revocable, on a separate
  Basic-auth path that does not accept cookie sessions and cannot mint other app
  passwords.
- Login is rate-limited per source IP **and** per targeted account.
- **CSRF**: state-changing API requests require a double-submit token
  (`csrf-token` cookie echoed in the `X-CSRF-Token` header) in addition to the
  SameSite cookie. Disable only in dev via `DISABLE_CSRF=true`.

## Outbound request safety (SSRF)

User-driven server-side fetches (recipe URL/image import) are validated against
an SSRF guard that rejects loopback, private, link-local, and cloud-metadata
targets after DNS resolution. Override for local dev only with
`SSRF_ALLOW_PRIVATE=true`.

## Update integrity

Updates pull tarballs from GitHub Releases over HTTPS. The release workflow
publishes a SHA-256 sum alongside each tarball; the in-app updater verifies it
and refuses to install unverified or mismatched code. The updater takes a
pre-update database snapshot before running migrations. Update availability is
decided by semantic-version comparison, so an older release is never offered as
an "update".

## What lives where

- **Database** — per-household data, user records (argon2-hashed passwords),
  session tokens.
- **File storage** (`STORAGE_PATH`) — uploaded photos, videos, files.
- **`.env`** — secrets (DB password, `SESSION_SECRET`, `ENCRYPTION_KEY`).
  Keep it `600`, owned by the service user. Production installs generate random
  secrets; the committed dev values are for local development only.

## Reporting a vulnerability

Open a GitHub Security Advisory at
`github.com/Springdale-Robotics/basis/security/advisories/new`.
