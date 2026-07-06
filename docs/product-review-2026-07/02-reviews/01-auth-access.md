# Area review — Auth & access

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

- **Login/logout/sessions** (`auth/auth.routes.ts`, `auth.service.ts`): email+password with argon2, opaque 64-hex session ids in Postgres, cookie-based (`httpOnly`, `SameSite=Lax`, `secure` keyed off request scheme). Session list/revoke/logout-all exist and are wired to the UI.
- **Setup** (`setup/setup.routes.ts`): installer setup + split household/admin creation, gated on "no household exists yet".
- **Registration**: three paths — first-admin via setup, open `/auth/register` taking a raw `householdId`, and invite-based `/auth/register/invite` (`JoinPage.tsx`).
- **Member invites** (`households/households.routes.ts`, `member-invites.ts`): admin-only 7-day single-use codes with a role; list/revoke; `MembersSettingsPage.tsx` with auto-copy.
- **Password reset** (`auth.service.ts:200-243`): Redis-backed 1-hour token; resets password and revokes all sessions. **No email sending exists anywhere in the backend** (grep for nodemailer/smtp: zero hits); token only `console.log`ged in dev.
- **App passwords / CalDAV** (`app-passwords/*`, `basic-auth.middleware.ts`): per-device argon2-hashed secrets, shown once, scoped (`caldav`), revocable.
- **Permissions** (`services/permission.service.ts`, `permissions/permissions.routes.ts`): per-resource grants (user/role/group/household/device, view_busy→admin hierarchy) + household feature-level permissions (user>group>role resolution).
- **Groups** (`groups/groups.routes.ts`), **Users** (`users/users.routes.ts`).
- **RLS middleware** (`middleware/rls.middleware.ts`): exists but is dead code (see findings).

## Usability findings

- **CRITICAL — password reset is a dead end that lies to the user.** `auth.routes.ts:244-249` has `// TODO: Send email with reset link` and only logs the token in dev; no mailer exists. Yet `ForgotPasswordForm.tsx` says "We've sent a password reset link to your email address." A locked-out family member waits for an email that never comes; the only recovery is an admin with DB/CLI access. (The `cloud/` comp-CLI reset is a separate product; this repo's in-app flow is broken end-to-end in prod.)
- **MEDIUM — no sliding sessions.** `auth.middleware.ts:31-60` bumps `lastActiveAt` but never `expiresAt`; the only extension path is `POST /auth/refresh`, and `authApi.refreshSession` is never called anywhere in the frontend. Every user is hard-logged-out 7 days after login (`SESSION_MAX_AGE_MS` default 604800000) regardless of activity — a weekly "why am I logged out" for the whole family.
- **MEDIUM — submit buttons don't disable during the request.** `JoinPage.tsx:207` (also Forgot/Reset forms) fire `mutation.mutate` un-awaited, so RHF's `isSubmitting` clears immediately; should use `mutation.isPending`. A double-click on Join fires two invite registrations, the second failing with "duplicate email". `LoginForm.tsx` does it right.
- **LOW — expired-invite screen offers a dead-end CTA.** `JoinPage.tsx:115-117`'s "Create Household" links to `/setup`, which refuses once setup is done. Should say "ask the person who invited you for a new link".
- **LOW — device disconnect has no confirmation** (`AppPasswordsCard.tsx:87-96`) — one mis-tap revokes CalDAV creds and silently breaks that phone's sync. Violates the repo's ConfirmDialog convention.
- **LOW — "Remove Member" warning understates blast radius** (`MembersSettingsPage.tsx:449-462`): says "cannot be undone" but not that the member's authored content is destroyed (see cascade finding).

## Reliability findings

- **CRITICAL — `/auth/register` is open to anyone who knows a `householdId`, enabling privilege escalation.** `auth.routes.ts:58-84` / `auth.service.ts:65-120`: no invite, admin approval, or setup-gate; any request with a valid household UUID creates a `member` (or `admin` if the household has zero users). The householdId is not secret inside the family — `/auth/me` returns it to every logged-in user — so a `kid`/`visitor` can self-register a fresh email as a full `member`, bypassing every kid-permission default. With remote access enabled, this endpoint is internet-reachable, gated only by rate limiting and UUID guessability.
- **HIGH — permission update/delete never verifies the permissionId belongs to the authorized resource.** `permissions.routes.ts:103-163` checks `canAccess(resourceType, resourceId, 'admin')` on URL params, then calls `updatePermissionLevel(permissionId, level)` / `revokePermission(permissionId)` which filter only on `permissions.id`. Any user with admin on *one* resource (creators get admin by default) can pass their resource in the URL and an arbitrary `permissionId` in the path to edit/delete any permission row in the DB, including other households'.
- **HIGH — the documented RLS layer is dead code.** `setRlsContext`/`clearRlsContext` are imported nowhere; no migration contains `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY`; and `set_config(..., true)` is transaction-local — a no-op on the pooled non-transactional `postgres-js` connection. CLAUDE.md advertises "Row-level security via `app.household_id`", but isolation is 100% application-level `eq(householdId)` filters — one forgotten `where` is a cross-tenant leak with no backstop. (This is the root cause behind cross-tenant findings in inventory, media, calendar, devices.)
- **HIGH — member removal silently destroys the member's authored data via FK cascades.** `households.routes.ts:196-217` does a bare `db.delete(users)`; `recipes.createdBy`, `groups.createdBy`, `permissions.createdBy`, `memberInvites.invitedBy` all cascade on user delete. Removing a member deletes every recipe they added, every group they created, and every permission grant they authored — including household-wide default grants, changing other members' access. Calendars got this right (`onDelete: 'set null'`); the rest didn't.
- **MEDIUM — invite acceptance is not transactional and is racy.** `auth.service.ts:321-391`: validate/insert/`status='accepted'` are three statements with no transaction and no atomic compare-and-set. Two concurrent submissions of a single-use code both succeed; if insert succeeds but status update fails, the invite stays reusable. `register` first-user-admin check races the same way (two concurrent registrations can both become admin).
- **MEDIUM — email update check contradicts the schema and 500s.** `users.routes.ts:70-86` enforces uniqueness per household, but `users.email` is globally unique. Changing email to one used in another household passes the app check, hits the DB constraint, and there's no 23505 mapping → generic 500. Also: email changes need no password re-confirmation, and an admin can change other members' emails (in-household takeover vector).
- **MEDIUM — module-level `groupCache` shared across concurrent requests, cleared only on some paths** (`permission.service.ts:74-79, 198-211`). Routes calling `canAccess` directly (all of `permissions.routes.ts`) never clear it; revoking a group membership may not take effect until an unrelated request clears the cache — non-deterministic staleness.
- **MEDIUM — `batchCanAccess` grants admins access to everything with no household check** (`permission.service.ts:455-461`), unlike `canAccess`. Used by photos/videos/music/caldav. SUSPECTED limited today but an inconsistent bypass, and `connected_household_user` suggests multi-household is coming.
- **MEDIUM — no rate limiting on CalDAV Basic auth.** `/dav` mounts outside the API scope; `basic-auth.middleware.ts` has no limiter, so app-password guessing is throttled only by argon2 verify cost — itself a CPU-amplification vector (each bad attempt burns a full argon2 verify per candidate row).
- **MEDIUM — `changePassword` doesn't revoke other sessions** (`auth.service.ts:245-269`), while `resetPassword` does. After a password change, an attacker's session (and stolen app passwords, also untouched) keeps working up to 7 days.
- **LOW — login user enumeration via timing** (unknown email returns immediately; known email pays argon2; no dummy-hash). **LOW — two admins can concurrently demote each other to zero admins** (no last-admin guard). **LOW — `validateInviteCode` writes (status→expired) on a public unauthenticated GET.**

## Test coverage

**Covered:** CalDAV Basic-auth handshake and calendar-specific permission resolution (`test/caldav/access.test.ts` — but that's `access.service.ts`, not generic `permission.service.ts`). **Not covered (zero tests):** all of `auth.service.ts` (login, register, invites, reset, change-password), `permission.service.ts`, `households.routes.ts` (invites, role change, removal cascades), groups, users, app-passwords directly, CSRF, rate limiters. **Frontend:** no test files at all.

## Top 5 recommendations

1. **Close `/auth/register`** — require an invite code (or an explicit admin-enabled "open registration" setting). The one finding that lets a kid account mint itself a member today.
2. **Ship password reset for real or remove the pretense** — add SMTP, or (better for a self-hosted box) an admin "reset member password" action; stop the frontend claiming an email was sent.
3. **Scope permission mutations to the authorized resource** — filter on `(id, resourceType, resourceId)`, not `id` alone. One-line `where` fixes for a real escalation.
4. **Fix user-delete cascades** — change `createdBy`/`invitedBy` FKs to `set null` (as calendars do) or reassign on removal; make the remove-member dialog state what's deleted.
5. **Decide on RLS** — either wire `setRlsContext` into per-request transactions and add policies, or delete it and correct CLAUDE.md so nobody assumes a DB backstop; then add the missing service-level tests.
