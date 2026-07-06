# Autonomous fix prompt

Paste the block below into a fresh Claude Code session in this repo. It's written to run
unattended and get as far as possible without you.

---

You are working autonomously in the Basis repo (`/home/sam/dev/homemanager`) to fix the
issues found in the July 2026 product review. I am stepping away — do not ask me questions;
make the smallest safe decision, record it, and keep going.

## Source of truth
Read these first, in order:
1. `docs/product-review-2026-07/04-summary.md` — the priority order (P0→P3) and the three
   systemic themes. This is your worklist.
2. The specific `docs/product-review-2026-07/02-reviews/*.md` and the two deep dives
   (`03-ai-deep-dive.md`, `05-inventory-deep-dive.md`) for the file:line detail behind each
   finding you're about to fix.

Trust but verify: the review cites `file:line`, but the tree may have moved. Re-read the
actual code before each change; if a finding no longer reproduces, note it and move on.

## Scope — do this
Work **P0 first, then P1, then P2**, in that order. Within each, do the fixes that have a
clear correct behavior: the tenancy/permission scoping holes, task-completion idempotency +
atomic rewards, permission-mutation scoping, offline toggle/claim/drain fixes, websocket
event-contract fixes, recipe cook-flow wiring, inventory notification dedupe + the single
`totalQuantity` refactor, calendar recurrence/timezone/reminder/exception fixes, media
scanner FK + range-request + bulk-permission fixes, update-path fixes, and wrapping
multi-statement writes in transactions. Add a test with each fix (see workflow).

## Scope — do NOT do (leave for me)
- **The AI roadmap in `03-ai-deep-dive.md`** — that's net-new feature work, not a fix.
- **Video transcoding / HLS** and **HEIC conversion** — architecture decisions with real
  cost; leave a `DECISIONS.md` note, don't build.
- **Deleting dead inventory schema** (`receipt_scans`, `custom_units`, unused columns) —
  destructive and reversible-only-with-care; flag it, don't drop it.
- **The RLS in-or-out architectural call** — see the decision rule below.
- Any change to the production box, deploys, or `cloud/` billing. Repo edits only.

## Decision rule (so you never stop)
When a fix needs a product/architecture choice, pick the smallest reversible option, write a
one-line entry in `docs/product-review-2026-07/DECISIONS.md` (create it) with the finding,
the choice, and why, then continue. Specific pre-made calls:
- **RLS:** do NOT attempt to wire Postgres RLS this pass. Instead, fix isolation the way the
  rest of the app already does it — add explicit household-ownership checks to every route
  the reviews flag (inventory `deplete`/`reconcile`/`out-of-stock`/`POST /stock`/`relink`/
  `areas/reorder`/`confidence`, permission update/delete, media album-add/genres/listen +
  bulk delete/move, device rules, calendar `linked-recipes`, recipe cook-session). Add a
  route-level test proving cross-household access is denied. Add a TODO + DECISIONS note that
  the DB-level RLS backstop is still unbuilt, and correct the CLAUDE.md "row-level security"
  claim to describe what's actually true.
- **Password reset:** don't add SMTP. Implement an admin "reset member password" action
  (fits a self-hosted box) and change the forgot-password UI copy to stop claiming an email
  was sent. DECISIONS note.
- **`/auth/register`:** require a valid invite code (remove the open-registration path);
  keep the first-admin setup path.

## Per-fix workflow (do this for every change)
1. Re-read the code; confirm the finding.
2. Make the change, matching surrounding style and the repo conventions below.
3. **Add a test that would have caught the bug** — a backend route/unit test (vitest). If the
   area has no test file yet, create one. Backend has no frontend test tooling; for
   frontend-only fixes, add a backend test where the real logic lives, or note "frontend,
   untestable without tooling" in the commit.
4. Verify: `cd backend && npm run typecheck` and run the relevant test
   (`npx vitest run path/to/test.ts`). For frontend edits, `cd frontend && npm run typecheck`.
5. Commit (see git rules). One logical fix per commit, message referencing the finding
   (e.g. `fix(inventory): scope /deplete to household (P0 tenancy)`).

## Repo conventions (from CLAUDE.md + project memory — follow exactly)
- **Migrations:** `drizzle-kit generate` is broken here. Hand-author the SQL migration, its
  journal entry, and the snapshot. (Needed for the rewards unique constraint, any FK
  `onDelete` changes, etc.)
- **Git:** `main` forbids merge commits and expects PR checks. Do NOT push to `main`. Create
  a branch (e.g. `review-fixes-p0`), commit there with linear history. End commit messages
  with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Don't open a PR or push
  unless everything typechecks and the touched tests pass.
- **Transactions:** copy the proven pattern in `recipes.routes.ts` cook-finish
  (`db.transaction` + `.for('update')`).
- **Frontend:** tokens-only colors, `ConfirmDialog` for destructive actions, `useNavItems`
  for nav, global mutation toasts. Respect the warn-tuned lint configs.
- Product name is **Basis**; `homemanager` is only the legacy package/repo name.

## Progress tracking (so I can see what happened)
Keep `docs/product-review-2026-07/FIX-LOG.md` updated as you go: one line per finding —
`[done|skipped|blocked] <area> <short desc> — <commit sha or reason>`. Update it after each
commit, not at the end, so a crash doesn't lose the record.

## When you finish or get stuck
Work until you've cleared P0 and P1 (P2 if time), or until every remaining item is either
out-of-scope or genuinely needs me. Then stop and write a final summary at the top of
`FIX-LOG.md`: what's fixed and verified, what's in DECISIONS.md awaiting my review, and what's
still open and why. Don't invent work beyond the review to stay busy.
