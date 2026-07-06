# Area review — Calendar & CalDAV

Severity legend: CRITICAL / HIGH / MEDIUM / LOW. SUSPECTED = inferred from code, not executed.

## What exists

**Backend**
- `modules/calendars/` — REST CRUD (`calendars.routes.ts`, 1564 ln), recurrence engine on `rrule` (`recurrence.service.ts`), ICS import/export (`ics.service.ts`), public read-only ICS links (`public.routes.ts`), intra-household ACLs (`access.service.ts/routes/middleware`), one-way Google/Outlook pull sync (`google-sync.service.ts`, `outlook-sync.service.ts`, `sync.routes.ts`).
- `modules/caldav/` — hand-rolled CalDAV server at `/dav/*`: discovery (OPTIONS/PROPFIND/.well-known + iOS probe), MKCALENDAR, PROPPATCH, GET/PUT/DELETE, REPORTs (calendar-query, calendar-multiget, sync-collection, free-busy stub). ETags from `revision`, ctag/sync-token from `calendars`, RFC 6578 journal in `calendar_changes` maintained by DB triggers (`drizzle/0004`). Auth: HTTP Basic against app-passwords.
- Jobs: `calendar-reminder.worker.ts` (every minute), `calendar-sync.worker.ts` (hourly, +3-fail notification).
- Schema `db/schema/calendars.ts`: calendars, events (master/exception/cancelled, RRULE text + JSON EXDATE/RDATE), attendees, reminders, visibility, access rules, change journal.

**Frontend**
- `CalendarPage.tsx` (1035 ln) + `components/calendar/*`: Month/Week/Day/Agenda, event form + custom recurrence editor, edit/delete-recurring scope dialogs, HTML5 drag-to-reschedule, keyboard shortcuts, search, image-scan import, sharing/access presets.
- `ConnectDevicePage.tsx`: iOS one-tap `.mobileconfig` via QR, Android/DAVx5 + manual CalDAV instructions with app-password minting.

## Usability findings

1. **HIGH — Location silently dropped on event create.** `CalendarPage.tsx:256-264` omits `location` though the form collects it (`EventForm.tsx:487-493`) and the API supports it. Update path sends it.
2. **HIGH — "Edit all events" silently ignores time changes.** `CalendarPage.tsx:297-307` scope `all` omits `startTime`/`endTime`. Change 3:00→4:00, pick "All events" → no change, no feedback.
3. **HIGH — Recurring-scope actions on a modified occurrence hit the wrong row.** Exception rows return `isVirtualInstance: false` (`calendars.routes.ts:344-351`), so `eventId` becomes the exception row's id; backend sees `recurrenceRule=null` and skips scope handling (`:711`). "Delete all events" on a previously-edited occurrence deletes only that occurrence; "single" deletes the exception without an EXDATE so the occurrence *reappears at its original time*.
4. **MEDIUM — Dragging an already-modified occurrence errors** (`CalendarPage.tsx:357-362` always `createException` → 409). Dragging the same virtual instance twice also 409s.
5. **MEDIUM — No touch drag-and-drop.** Views use HTML5 `draggable` only — reschedule doesn't work on phones/tablets, the primary family device.
6. **MEDIUM — No reminder or attendee UI.** `EventForm.tsx`/`EventDetail.tsx` have no reminders/attendees section; the whole reminder pipeline is unreachable from the web UI — reminders only enter via CalDAV VALARM.
7. **MEDIUM — Month grid shows 6 weeks but fetches ~5** (`MonthView.tsx:154-169` vs `getEndDate` `CalendarPage.tsx:1052-1065`). For 5-week months the 6th row silently shows no events.
8. **LOW — iOS panel default device label is "Sam's iPhone"** (`ConnectDevicePage.tsx:153`) — hardcoded personal name shipped to every user.
9. **LOW — Recurrence display in edit form is lossy** (`RecurrenceEditor.tsx:420-503` drops multi-positional BYDAY, BYSETPOS, WKST). Re-saving a Google/iOS-synced event rewrites/simplifies its rule.
10. **GOOD:** Connect-device flow (QR + mobileconfig, per-device revocable app passwords), scope dialogs, access presets, always-visible kebab for touch, dirty-close guard.

## Reliability findings

1. **HIGH — sync-collection REPORT emits malformed XML.** `caldav.routes.ts:807-809` concatenates the closing `<d:sync-token>` *after* `</d:multistatus>` — content after the document root (RFC 6578 requires it inside multistatus). The test only regexes for the token, so CI passes while strict clients (iOS, DAVx5) reject the response and fall back to full re-downloads or fail incremental sync.
2. **HIGH — Recurring events expand on the wrong local day / DST drift.** `recurrence.service.ts:243-263` expands with UTC `dtstart`; `calendars.timezone` exists but is never used. A weekly event created Mon 8 PM PST is Tue 04:00 UTC, so `BYDAY=MO` recurs Sunday evening local; all recurring times shift an hour across DST.
3. **HIGH — Reminders broken for recurring events and misfire for past events.** `calendar-reminder.worker.ts:24-77` computes fire time from the master row's `startTime` only — a series fires once (immediately if it started in the past) and `sent=true` forever; no per-occurrence expansion; no staleness cap. Scans the entire unsent table every minute.
4. **HIGH — Reminders created via CalDAV notify the whole household.** CalDAV PUT inserts `eventReminders` with no `userId` (`events.service.ts:570-577`); `sendEventReminder` → `emitNotification(householdId, null, …)` broadcasts household-wide. A personal iPhone alarm becomes everyone's notification.
5. **HIGH — "Two-way" external sync is one-way with silent clobbering.** Synced calendars are `isReadOnly: false // Allow two-way sync`, but `createGoogleEvent`/`updateGoogleEvent`/`deleteGoogleEvent` (and Outlook) are never called. Local edits are overwritten on the next hourly pull; locally created events never reach the provider.
6. **HIGH — Windowed pull sync deletes history.** `google-sync.service.ts:226-239` fetches only [now−3mo, now+1y], then `:398-404` deletes any local row whose `externalId` isn't in that window — synced events older than 3 months are purged every sync. SUSPECTED same in Outlook.
7. **MEDIUM — Every pull sync rewrites every event, exploding CalDAV sync state.** Unconditional `update` (`google-sync.service.ts:309-316`) → triggers bump `revision` (ETag churn, clients re-fetch everything) and append N `calendar_changes` rows per sync. `calendar_changes` has **no pruning** — unbounded growth plus hourly client churn.
8. **MEDIUM — CalDAV PUT uses the URL slug as the UUID primary key** (`events.service.ts:437`). Clients naming resources with non-UUID slugs get a Postgres error → 500. Same for MKCALENDAR.
9. **MEDIUM — All-day round-trip inconsistent.** Web stores all-day at local noon (`EventForm.tsx:292-299`); CalDAV/Google store UTC midnight with an exclusive DTEND never adjusted. iPhone all-day events render as 2-day bars on the wrong day for negative UTC offsets.
10. **MEDIUM — 'following' split/truncation is crude** (`truncateRRule` sets `UNTIL = instance − 24h`; re-serialization can embed a spurious `DTSTART` into the stored rule; drops the EXDATE list on the new master).
11. **MEDIUM — EXDATE/exception matching is UTC-date-granular** (`recurrence.service.ts:209-229` compares `toISOString().split('T')[0]`) — occurrences whose local vs UTC dates differ match incorrectly.
12. **LOW — CalDAV XML parsing is regex-based** (`xml.ts:69-92`); namespace-prefixed/CDATA bodies may mis-parse; `calendar-query` ignores non-time-range filters.
13. **LOW — Sync failure counter packed into the `syncError` string as `msg|count:N`** — an error message containing `|count:` corrupts it, and the raw string is shown to users.
14. **LOW — If-Match on PUT of a since-deleted resource creates instead of 412; weak-ETag prefixes unhandled.**

## Test coverage

**CalDAV: good integration coverage** (`backend/test/caldav/`: discovery, access, PUT/GET/DELETE + preconditions + VALARM round-trip, REPORTs, DB triggers, `tsdav` smoke test) — but assertions are regex/substring, so XML well-formedness bugs (R1) pass. **Zero tests** for the recurrence engine (highest bug density), REST recurring scopes, external sync, reminder worker, and all frontend calendar code.

## Top 5 recommendations

1. **Fix the sync-collection envelope** (move `<d:sync-token>` inside `multistatus`) and make CalDAV tests XML-parse responses — cheapest fix, biggest client-compat payoff.
2. **Make recurrence expansion timezone-aware** (use the schema's `timezone`), fix EXDATE/exception matching to exact-instant, and add a recurrence.service unit-test suite (BYDAY-across-midnight, DST, UNTIL/COUNT, 'following' splits).
3. **Repair exception-row scope paths** — route edits/deletes of modified occurrences through the master; make drag upsert rather than 409.
4. **Overhaul reminders** — per-occurrence for recurring events, skip stale reminders, per-user targeting for CalDAV alarms, and a reminders UI in EventForm.
5. **Make external pull sync non-destructive and quiet** — stop deleting out-of-window events, skip no-op updates (use Google `syncToken`/`updatedMin`), prune `calendar_changes`, and either wire up push or mark synced calendars read-only. Fix the create-event `location` drop while in there.
