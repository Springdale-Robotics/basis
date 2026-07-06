# Area review — Tasks & chores

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

**Backend** (`backend/src/modules/tasks/tasks.routes.ts`, single 600-line file; schema in `backend/src/db/schema/tasks.ts`):
- One `tasks` table serving two kinds: `task` (one-shot, completes) and `chore` (stays `pending` forever; completion bumps `lastCompletedAt` and recomputes `dueDate`).
- Two recurrence modes: `schedule` (iCal RRULE via `rrule` pkg) and `reset_on_complete` (cadenceDays after completion).
- Polymorphic assignment (user XOR group, DB CHECK constraint), claim endpoint for group tasks, reorder endpoint, pin, sortOrder.
- Rewards: `rewards` (points + lifetimePoints per user) and `rewardHistory`; points awarded on complete; admin adjust endpoint. Rewards feature-flagged off by default (`useFeatureFlags.ts:21`).
- WebSocket emits: `task:update`, `task:completed`, `task:delete`, `task:assigned`, reward events (`backend/src/websocket/events.ts:156-171,249`).
- Notification plumbing: `task_due` type exists in DB enum, prefs (`settings.taskDue`), and `notification.worker.ts` mapping.

**Frontend** (`frontend/src/pages/tasks/TasksPage.tsx`, `RewardsPage.tsx`; components in `frontend/src/components/tasks/`):
- Tabs (Tasks/Chores) with pending-count badges, All/Mine filter, 4 sort modes persisted per-kind in localStorage, show-completed toggle.
- Quick-add with natural-language parsing (`frontend/src/lib/taskParser.ts`, ~660 lines): dates, times, recurrence, assignees — surfaced as dismissible chips, never auto-rewriting the title; a "flip" button converts schedule↔reset-on-complete.
- Full edit dialog (recurrence builder, dirty-close guard), drag-reorder, bulk mode via shift-click, swipe-left-to-complete on touch, `N` keyboard shortcut, ChoreDecayMeter urgency bar, optimistic create/complete, skeleton/error/empty states throughout.

## Usability findings

- **HIGH — No un-complete, but the UI promises one.** `TaskRow.tsx:252-255` labels the completed-state circle "Mark incomplete", yet clicking it calls `onComplete` again (`TaskRow.tsx:191-198`). There is no un-complete endpoint at all. Combined with swipe-to-complete (80px threshold) and no undo toast, accidental completions are unrecoverable — and with rewards enabled, each re-click **awards points again** (see Reliability #1).
- **MEDIUM — Points go to the completer, not the assignee** (`tasks.routes.ts:357`). A parent ticking off a kid's chore silently pockets the kid's points. No "complete on behalf of".
- **MEDIUM — Rewards UI is self-only.** `RewardsPage.tsx` shows only the logged-in user's points/history. Leaderboard (`GET /tasks/rewards`) and admin adjust exist in the API with zero frontend callers — parents cannot view or adjust kids' points anywhere in the UI. Route also isn't gated by the `rewards` flag (only the nav item is, `useNavItems.ts:44`).
- **MEDIUM — Schedule-mode copy contradicts behavior.** Edit dialog says "Calendar-anchored — next due stays fixed regardless of when you complete it" (`TaskEditDialog.tsx:363-366`), but the backend computes next-due from completion time (see Reliability #5). Completing a Monday chore early on Saturday leaves it still due that same Monday.
- **LOW — Non-recurring chore never leaves the list.** Completing it sets status back to `pending` with `dueDate=null` (`tasks.routes.ts:329-332`); it lingers showing "Done today". No way to retire a chore except delete.
- **LOW — "Show completed" is buried inside the Sort dropdown** (`TasksPage.tsx:547-549`) and is meaningless on the Chores tab.
- **LOW — Parser "for <name>" false positives**: "buy gift for mom" auto-suggests assigning to a user named Mom; unique-prefix matching can misfire (`taskParser.ts:579-601`). Mitigated by the dismissible chip.
- **LOW — Optimistic rows are interactive.** Completing/editing an optimistic row before the server responds fires requests against a bogus id → error toast (`TasksPage.tsx:243`).
- **LOW — Dead-code sortable disable**: `useSortable({ disabled: ... ? false : false })` (`TaskRow.tsx:141-144`) always `false` — botched expression; dragging stays enabled in bulk mode.
- **Positive:** loading/error/empty states consistently handled; quick-add chip UX genuinely good; per-kind sort persistence and drag→manual auto-switch thoughtful.

## Reliability findings

1. **CRITICAL — Completion is replayable and re-awards points.** `POST /:id/complete` (`tasks.routes.ts:300-399`) never checks `task.status`. Re-completing an already-completed task awards `rewardPoints` every time — trivially farmable by a kid. Bulk-complete fires N parallel completes with the same property.
2. **HIGH — Rewards math is non-atomic and non-transactional.** Read-modify-write in JS (`tasks.routes.ts:358-391`): concurrent completions lose/double-award; task update, reward update, history insert are separate statements. `rewards` has **no unique constraint on (householdId, userId)** (`schema/tasks.ts:84-95`) — find-then-insert races into duplicate reward rows, after which points silently split.
3. **HIGH — Task-due reminders don't exist.** `task_due` is in the enum, prefs, and worker mapping — but no producer ever scans `tasks.dueDate` (the sole `task_due` enqueue is the calendar-reminder worker reusing the type for events). Task reminders are a dead feature users can "enable" in prefs.
4. **HIGH — Real-time sync misses completions.** Completion emits only `task:completed` (`events.ts:165-167`), but `WebSocketProvider.tsx:143-149` listens only for `task:update`/`task:delete`. Other family members' devices don't refresh when someone completes a task — the core multi-device moment. `task:assigned` and reward events likewise emitted into the void.
5. **MEDIUM — Schedule recurrence loses time-of-day and mishandles early completion.** `computeNextDueDate` (`tasks.routes.ts:113-121`) parses RRULE with **no DTSTART** — dtstart anchors to "now", so next due inherits the completion timestamp's time and drifts every cycle. Early completion returns the same still-upcoming occurrence. DST behavior SUSPECTED shaky.
6. **MEDIUM — PATCH bypasses cross-field validation.** `updateTaskSchema` is `baseTaskSchema.partial()` without the `superRefine` (`tasks.routes.ts:81-83`): PATCH `recurrenceMode='schedule'` with no rule silently nulls the due date on next completion; PATCHing assignee on a group task hits the DB CHECK → unhandled 500.
7. **MEDIUM — `dueDate`/`lastCompletedAt` are `timestamp` without timezone** (`schema/tasks.ts:50,63`) while calendar events deliberately use `withTimezone: true`. SUSPECTED off-by-UTC-offset on a non-UTC server.
8. **MEDIUM — Bulk ops are N unbatched requests with silent failures.** `deleteMutation`/`claimMutation` have no onError (`TasksPage.tsx:342-361`); bulk delete's dialog closes on first success while siblings are in flight.
9. **LOW — Group-membership N+1** on TasksPage mount despite backend `mine=true` support (`TasksPage.tsx:145-164`).
10. **LOW — `page` query param parsed and ignored** (`tasks.routes.ts:97`); hard 200 cap silently truncates.
11. **LOW — sortOrder `MAX+1` on create races**; reorder from a filtered tab rewrites global order for just those ids — benign today.

## Test coverage

**Zero tests touch this area.** No tests for `tasks.routes.ts` (completion semantics, rewards, claim, reorder), none for `computeNextDueDate`/recurrence (highest-risk pure function in scope), none for `taskParser.ts` (~660 lines of ordered regex heuristics — textbook unit-test material), no frontend tests at all.

## Top 5 recommendations

1. **Make completion safe and atomic**: reject/no-op re-completion; wrap task update + reward award + history in one `db.transaction` with SQL-level increments; unique index on `rewards(household_id, user_id)` with upsert. Add a real un-complete endpoint and wire the "Mark incomplete" circle to it.
2. **Ship or remove task-due reminders**: add a repeatable job scanning `tasks.dueDate` (mirroring `inventory:expiring`), respecting the `taskDue` pref.
3. **Fix websocket completion sync**: listen for `task:completed` (and reward events) in `WebSocketProvider.tsx`, or emit `task:update` on completion. Near one-line fix for the app's core multi-device promise.
4. **Anchor schedule recurrence to the task's dueDate** (`dtstart = task.dueDate`, advance past pending occurrence); port `superRefine` onto `updateTaskSchema`; migrate task timestamps to `withTimezone: true` (hand-authored migration per repo convention).
5. **Add the cheap high-value tests first**: unit tests for `taskParser.ts` and `computeNextDueDate`, then route-level tests for complete/rewards covering replay and concurrency.
