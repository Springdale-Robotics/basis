# Area review — Cross-cutting UX & frontend architecture

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

- **Dashboard** (`pages/dashboard/DashboardPage.tsx`): `TodayHero` (greeting, today's events count, featured meal) + 5 cards — Today's Events, Today's Meals, Use Up Soon (expiry), Pending Tasks, Pending Lists — responsive 1/2/3-col grid.
- **Routing** (`App.tsx`): all pages lazy-loaded except Login; protected `AppShell` with per-page `ErrorBoundary` keyed on pathname, app-level ErrorBoundary + Suspense, in-shell 404.
- **API client** (`api/client.ts`): fetch wrapper with envelope unwrapping, global 401 handler, CSRF double-submit with one auto-retry on stale token, XHR upload with progress.
- **Realtime**: `WebSocketProvider.tsx` — single socket.io connection, joins household room, maps ~20 server events to `invalidateQueries`; on reconnect (not first connect) invalidates the entire cache. Backend has cookie-session auth middleware, household/user rooms, and a Redis pub/sub bridge so worker-process emits reach the API process's sockets.
- **Offline**: lists-only layer (`lib/offline/`) — IndexedDB queue + snapshot, ghost items, drain-on-reconnect with discard-on-permanent-failure, surfaced by `OfflineIndicator.tsx`.
- **Global mutation error toast** via `MutationCache.onError` with `meta.silenceError`/own-`onError` opt-outs.
- **Navigation**: `useNavItems.ts` single source of truth (desktop Sidebar + mobile bottom bar + "More" sheet), filtered by household feature flags AND per-user feature permissions.
- **Feature tiers**: household feature toggles, per-user permissions, basic/advanced inventory tier.
- **Theming**: light/dark/system, presets, custom palettes, font size, radius. **Stores**: auth (persisted, `isAuthenticated` deliberately not persisted — good), ui, theme, player, cooking, timer.

## Usability findings

1. **[MEDIUM] Dashboard ignores feature toggles.** `DashboardPage.tsx:13-19` renders all five cards unconditionally. A household that disables recipes/inventory/tasks still sees "Today's Meals", "Use Up Soon", and "Pending Tasks" cards firing queries against disabled features. Undermines the toggles' promise.
2. **[MEDIUM] Disabled features remain reachable by URL.** Routes in `App.tsx` are not feature-gated and no page-level gate exists. Toggling a feature off only hides nav items (`FeatureSettingsPage.tsx:142-144` says only "don't appear in the sidebar"). Deep links, history, and dashboard card links still land on fully functional pages. Confusing "off" vs "hidden" semantics.
3. **[LOW] Feature-flag flash on load** — `useFeatureFlags.ts` merges persisted-store flags with an API fetch; before the query resolves, items can appear then vanish. SUSPECTED.
4. **[LOW] FeatureSettingsPage disables ALL switches while any save is pending** — rapid multi-toggle feels broken; a per-key pending state would be smoother.
5. **[GOOD] Navigation coherence is strong** — shared `useNavItems` for all three surfaces, mobile bar promotes 5 primary tabs + "More" sheet, `pb-safe`/`useBottomStack` keep content clear of stacked bottom bars (nav + music player + offline pill).
6. **[GOOD] Consistent card pattern** — loading skeleton → compact `ErrorState` with retry → empty-state copy → data. 42 files use `Skeleton`; consistency high.
7. **[LOW] Accessibility basics partial** — 40 `aria-label` occurrences, sheet uses `sr-only` title/description, but no `prefers-reduced-motion` or `:focus-visible` handling in `index.css`. SUSPECTED gaps.
8. **[INFO] First-session experience** — dashboard degrades to empty-state copy rather than onboarding prompts; `TodayHero` quick-actions help. No guided "add your first X". Setup wizard exists, not deeply reviewed here.

## Reliability findings

1. **[HIGH] Offline drain discards on 5xx despite intending transient handling.** `lib/offline/sync.ts:109-117`: the comment says "4xx permanent; 5xx and network transient", but the code only returns `false` (retry-later) when the message matches `NetworkError|Failed to fetch`. An `ApiError` from a 500/502/503 (server restarting as connectivity returns — likely on a self-hosted box) is thrown and **permanently discarded** by `drainQueue`. `ApiError` carries `status`; the check should branch on it. User data loss with only a toast.
2. **[HIGH] Task completion never reaches other clients.** Backend emits only `task:completed` (`tasks.routes.ts:393`), but the frontend has no listener for it (absent from `WebSocketProvider.tsx` and `types/socket.ts`). Same for `reward:earned`. "Kid checks off chore, parent's screen doesn't update" — the core realtime demo failing. (Cross-referenced in the tasks review.)
3. **[MEDIUM] More emitted-but-unhandled events**: `inventory:low_stock`/`expiring`/`cooking_deduction`, `calendar:sync:*`, `calendar:shared/unshared`, `device:update`, `task:assigned`, `user:status` — all emitted with zero frontend listeners. Either dead weight or missing UX (calendar sync failure is invisible in real time).
4. **[MEDIUM] Offline edit-after-create loses the edit (SUSPECTED).** A queued `addItem` gives a ghost id; a subsequent offline `updateItem`/`toggleItem` on that ghost id replays after the server created the item under a new id → 404 → permanent discard. Nothing rewrites queued payload ids after replay.
5. **[MEDIUM] `isNetworkError` treats any `TypeError` as offline** (`listsApiResilient.ts:9-13`), so a genuine frontend bug inside the API layer silently enqueues the mutation and shows fake success.
6. **[LOW] Reconnect handling is otherwise correct** — `invalidateQueries()` on any reconnect closes the missed-event window; `refetchOnWindowFocus` + 5-min staleTime is a reasonable backstop. No user-visible "realtime unavailable" state (minor).
7. **[LOW] Optimistic-update vs WS race largely mitigated by design** — most mutations invalidate rather than optimistically write, and WS events also invalidate (idempotent). SUSPECTED-minor.
8. **[LOW] Upload path gaps** — XHR error path `JSON.parse(xhr.responseText)` throws on non-JSON error bodies (proxy 502 HTML); the XHR path lacks the CSRF-refresh retry the fetch path has and doesn't call the 401 handler.
9. **[LOW] Offline indicator only knows about lists** — mutations in every other domain fail hard offline with only the global error toast, yet the pill says "changes will sync when you reconnect".
10. **[INFO]** Error boundary coverage is good (app-level + per-route, keyed reset, self-limiting auto bug-report). Backend WS auth and the worker→API Redis emit bridge are solid; single-instance assumption documented.

## Test coverage

- **Frontend: zero.** No test script in `frontend/package.json`, no vitest/jest config, no `*.test.*` anywhere under `frontend/`. The offline queue/drain logic — the most failure-prone code in the app — is completely untested.
- **E2E: none** (Playwright exists only as an MCP dev tool, not repo tooling — hence the pile of `*.png` at repo root from manual driving).
- **Backend: 13 `*.test.ts` files** (vitest). The websocket emit → client invalidation contract is untested on either side, which is exactly where finding #2 slipped through.

## Top 5 recommendations

1. **Fix offline drain error classification** (`sync.ts:109-117`): branch on `ApiError.status` — retry 5xx/network, discard only 4xx. A genuine data-loss bug on self-hosted boxes that restart.
2. **Reconcile the WS event contract**: emit `task:update` alongside `task:completed` (or add client listeners), then add a shared event-name type/contract test between `backend/src/websocket/events.ts` and `frontend/src/types/socket.ts` so emitted-but-unhandled events fail CI.
3. **Make feature toggles mean something**: gate dashboard cards and add a route-level `FeatureGate` so toggled-off features are consistently absent, not just de-linked.
4. **Stand up frontend testing** (vitest + testing-library), starting with the offline layer (ghost/replay, drain discard rules, id-remap gap) and `useNavItems` flag/permission filtering.
5. **Handle offline create→edit chains**: after a queued create replays, map the ghost id to the server id and rewrite remaining queue entries (or coalesce edits into the queued create).
