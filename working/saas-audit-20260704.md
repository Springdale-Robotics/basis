# Basis — Comprehensive SaaS Audit (2026-07-04)

Four-dimension audit: security/tenancy, backend/data/ops, frontend/product, testing/release.
Severity: Critical / High / Medium / Low.

## Verified critical/high (spot-checked in code)
- **RLS is fiction.** `middleware/rls.middleware.ts` defines `setRlsContext`/`clearRlsContext`;
  neither is ever called, and no `CREATE POLICY`/`ROW LEVEL SECURITY` exists in any migration.
  Tenant isolation = manual `eq(householdId)` filters only. One miss = cross-household breach.
- **Admin "Terminal" = host shell over websocket.** `installer-commands.ts:47-55` `shell-bash`
  → `bash -l` as service user, gated by one role bit; first user of every household is auto-admin;
  plus NOPASSWD `sudo systemctl`. RCE surface; catastrophic in any multi-household deployment.
- **`logoutAllSessions` inverted.** `auth.service.ts:130-134` deletes `eq(sessions.id, except)`
  (the current session) instead of `ne(...)`. "Log out my other devices" leaves attacker alive.
- **CSRF never wired.** Dep + `DISABLE_CSRF` flag + `AUTH_CSRF_INVALID` code all exist; never
  registered. Only defense is SameSite=Lax.
- Media metadata lost-update race + `eval(r_frame_rate)` in `media.worker.ts:79-82,165`.
- Photos endpoint loads whole library into memory, paginates in JS (`photos.routes.ts:94-114`).
- 3 indexes across 71 tables; every FK-filtered query seq-scans.
- Frontend: 0 tests / 284 files. 26 of 27 backend modules untested. Lint never runs in CI.
- Updater "update available" uses string `!==`, can offer downgrades (`install.routes.ts:106-108`).
- No route code-splitting (2.1 MB bundle) + no list virtualization.
- Backups are DB-only, same-host — uploaded media unprotected.

See full per-dimension findings in conversation / agent transcripts.
