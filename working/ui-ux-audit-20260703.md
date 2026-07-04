# UI/UX Audit — 2026-07-03

Five parallel audit passes over `frontend/src` (191 components, ~15 domains): component reuse, visual consistency, UX pattern repeatability, layout/placement, and UI reliability. Findings consolidated and prioritized below. All paths relative to repo root unless noted.

## Executive summary

The design system is in better shape than the code that uses it. `frontend/src/index.css` defines a full semantic token set (`--success`, `--warning`, `--error`, `--info`, each with foreground/muted variants **and tuned dark-mode values**), `components/shared/` has EmptyState, ConfirmDialog, LoadingSpinner, SearchInput, UserAvatar, and ErrorBoundary, and `PageHeader`/`AppShell` centralize page chrome. The dominant problem is not missing abstractions — **it's that the abstractions exist and are ignored**: `UserAvatar` has zero importers while 9 files hand-roll avatars; `ConfirmDialog` has 3 importers vs ~8 hand-rolled copies; `formatBytes` is defined 7 times.

The most serious findings are reliability, not cosmetics:

1. **Real-time sync is dead for most domains.** Frontend listens for `list:update`, `inventory:update`, `shopping-list:update`, `file:update`, etc. (`providers/WebSocketProvider.tsx:60-202`) but the backend only emits for **calendars, tasks, and one recipe path**. Two phones on a shared shopping list desync until window-focus refetch (5-min staleTime). Live notifications never arrive at all — backend emits `notification:new` with `{notificationId, notification}`, frontend listens for `notification` with a flat payload (double mismatch).
2. **Query failures render as fake empty states app-wide.** `isError` is handled in exactly 2 places; every list page shows "No recipes yet — add your first recipe!" when the backend is down.
3. **Silent mutation failures.** The entire lists domain has 0 `onError` handlers across 11 mutations; inventory has 14/17 silent; calendar event create/update/delete silent. No global MutationCache/QueryCache error handler exists.
4. **Unconfirmed destructive deletes** for tasks (incl. bulk delete of N tasks), calendar events, inventory leftovers/areas, and bug reports — with no undo pattern anywhere, so unconfirmed = unrecoverable.
5. **Dead media detail routes.** `/movies/:id`, `/music/albums/:id` etc. are defined and linked from every card, but the pages never read params — clicking a poster changes the URL and nothing else.

---

## A. Reliability (highest severity)

### A1. HIGH — Backend never emits most WebSocket events the frontend listens for
- Frontend handlers: `frontend/src/providers/WebSocketProvider.tsx:60-202`.
- Backend emit call sites exist only in `backend/src/modules/calendars/calendars.routes.ts`, `backend/src/modules/tasks/tasks.routes.ts`, `backend/src/modules/recipes/recipes.routes.ts:969` (cooking deduction), and notification workers. Lists, inventory, shopping-list, files, households modules emit nothing.
- `backend/src/websocket/events.ts` never emits `shopping-list:update`, `recipe:delete`, `list:delete`, `file:delete`, `calendar:update/delete`, `household:update`, `user:update`.
- Meal plans have no realtime events at all (no `meal-plan` event in `types/socket.ts` or backend).
- Failure: two family members at the grocery store double-buy/double-check items; kitchen tablet meal plan desyncs from the planning phone.
- Fix: add emits to the route handlers — frontend is already wired.

### A2. HIGH — Notifications event name + payload mismatch
- Backend: `notification:new` with `{ notificationId, notification }` (`backend/src/websocket/events.ts:182-188`). Frontend: listens for `notification` with flat `{ id, type, title, body }` (`WebSocketProvider.tsx:157-175`, `types/socket.ts`).
- Task/calendar reminders (`backend/src/jobs/calendar-reminder.worker.ts:154`) never surface as live toasts; badge only updates on focus refetch.

### A3. HIGH — Query errors render as fake empty states
- `isError` handled only in `pages/settings/FeaturePermissionsPage.tsx:157` and `pages/recipes/ImportRecipeDialog.tsx:761`. All ~14 domains use `isLoading ? Skeleton : length===0 ? EmptyState : list` (e.g. `pages/recipes/RecipesPage.tsx:158-174`).
- QueryClient (`providers/QueryProvider.tsx`) has no QueryCache/MutationCache onError; `retry: 1`; staleTime 5 min.
- Fix: global QueryCache onError toast + per-page `isError` branch with retry.

### A4. HIGH — Silent mutation failures by domain
- **Lists: zero error handling domain-wide.** `components/lists/useListMutations.ts:18-60` (8 item mutations — resilient API rethrows non-network errors so these are reachable), `pages/lists/ListDetailPage.tsx:49-73`, `ListsPage.tsx:197-205`, Create/EditListDialog, `components/dashboard/PendingListsCard.tsx:43`.
- **Inventory:** 14 of 17 mutations in `pages/inventory/InventoryPage.tsx:469-666` silent (only :516, :547, :717 have onError); `ManageStockDialog.tsx:79`, `AddToListDialog.tsx:117,130`.
- **Calendar:** event create (:244), update (:262), delete (:383) in `CalendarPage.tsx` silent — form dialog stays open with no message; `EventDetail.tsx:96` RSVP silent.
- **Tasks:** delete (:330) and claim (:339) silent; completeMutation (:293) rolls back the optimistic checkbox with no explanation.
- **Recipes/meal plan:** `MealActionDialog.tsx:112,120`, `AddMealDialog.tsx:113,131`, `BulkImportRecipeDialog.tsx:150,187,212`, most of ImportRecipeDialog.
- **Notifications:** `hooks/useNotifications.ts:26-47`, `NotificationCenter.tsx:60-81` all silent.
- Toast coverage ratio per domain (mutations : toasts) — files 14:24 (exemplary), settings 52:81, calendar 29:36, inventory 34:10, recipes 29:16, tasks 7:3, lists 11:0.
- Fix: global `MutationCache` onError default (opt-out per mutation) covers nearly all of this in one change. Files' paired success+error toasts are the reference implementation.

### A5. HIGH — Unconfirmed destructive deletes
Instant, no dialog, no undo:
- Tasks: row dropdown delete (`TasksPage.tsx:625` → `TaskRow.tsx:408`), edit-dialog delete (`TaskEditDialog.tsx:469`), **bulk delete of N selected tasks** (`TasksPage.tsx:401-404`). Delete also has no onError toast (:330-337).
- Calendar: non-recurring event delete (`CalendarPage.tsx:450-463`, fired from `EventDetail.tsx:340`); recurring events DO get a dialog.
- Inventory: leftover delete (`InventoryPage.tsx:1578`), area delete (:1601 via `AreaForm.tsx:154`) — while item delete DOES confirm (:1622).
- Settings: bug report delete (`BugReportsSettingsPage.tsx:177`).
Properly confirmed (the pattern to copy): recipes, lists, files, calendar-the-calendar, groups/members/backups. Fine unconfirmed: list items, shopping items, notifications.

### A6. HIGH — Offline writes are invisible; queue can duplicate or silently drop
- `lib/offline/listsOffline.ts` (IndexedDB read path) imported nowhere — dead code; `ListDetailPage.tsx:43-47` queries the API directly.
- Offline item writes queue via `listsApiResilient.ts:57-65` + `useListMutations.ts`, but success handler only `invalidateQueries` — refetch fails offline, ghost item never appears. User retries → `drainQueue` (`lib/offline/sync.ts:104`) replays all attempts → duplicates.
- `sync.ts:119-123` silently discards queued mutations on 4xx; `OfflineIndicator` ignores `lastError`.
- Fix: `setQueryData` ghost insert on offline write; wire the offline read path or delete it; surface discards.

### A7. HIGH — Media detail routes are dead clicks
- `App.tsx:101-105` defines `/movies/:id`, `/tv/:id`, `/music/albums/:id`, `/music/artists/:id` — all render the same list components. Cards link to them (`MoviesPage.tsx:225,283,338`; `MusicPage.tsx:249,287`) but no router hooks exist in those pages. URL changes, identical list re-renders.
- Fix: build detail views or remove the links/routes.

### Medium reliability
- **M-R1.** WebSocket context reads `socketRef.current` during render — consumers get stale `socket: null`/`isConnected` (`WebSocketProvider.tsx:210-213`); no reconnect catch-up invalidation (:50-53); `cooking:timer:*` handlers (:178-193) are fully dead (backend never emits) with a stale `activeSession` closure; `useCookingSession.ts:23` timer emits can no-op.
- **M-R2.** Checklist/dashboard toggles double-fire: no optimistic update, no per-item pending disable (`ChecklistView.tsx:347,364`, `PendingListsCard.tsx:43`, `PendingTasksCard.tsx:26`). TasksPage :235-328 is the good snapshot/rollback reference.
- **M-R3.** Undebounced search → request per keystroke: `RecipesPage.tsx:25,34,128-130`, `AddMealDialog.tsx:61,79-81` (SearchInput/useDebounce already exist).
- **M-R4.** `AddToListDialog.tsx:64-71` never resets state on reopen — next add inherits previous quantity/unit. (Correct pattern: `EditListDialog.tsx:41-48`, `TaskEditDialog.tsx:135-153`.)
- **M-R5.** Form data loss on outside click: only `RecipeForm.tsx:171,368` guards. TaskEditDialog, event form, CreateListDialog, and especially the multi-step `ImportRecipeDialog` (handleClose :347 wipes OCR/preview state) lose everything on a stray click.
- **L.** Error boundaries are good (app-level `App.tsx:50` + per-route `AppShell.tsx:41`) but `componentDidCatch` only console.errors — no bug-report submission despite the app having that backend. 401 handling is correct. Catch-all route silently redirects to /dashboard (`App.tsx:112`) — a 404 page would be less disorienting. `apiUpload` (`api/client.ts:203,210`) throws raw SyntaxError on non-JSON error bodies and skips the 401 hook.

---

## B. Component reuse (the stated top concern)

### B1. HIGH — Shared components exist but are ignored
| Shared component | Importers | Hand-rolled copies |
|---|---|---|
| `shared/UserAvatar` | **0** | 9 (Header:37, ProfileSettings:65, MembersSettings:76, GroupsSettings, TaskRow:361, AssigneePicker, EventDetail:153, WishlistView:145, ChecklistView:34) — divergent initials logic ("SU" vs "S") and fallback sizes (text-[9px]/[10px]) |
| `shared/SearchInput` (debounce+clear) | 2 (Files, Inventory) | 9 (RecipesPage:124, ListsPage, MusicPage, AddMealDialog, IngredientMatchRow, CalendarSearch, RecipeForm, AddToListDialog, AreaForm) — mostly no debounce |
| `shared/ConfirmDialog` | 3 (Files, ListDetail, RecipeDetail) | ~8 raw AlertDialogs (GroupsSettings:229, MembersSettings:473, CalendarForm:556, ThemeSettings, BackupSettings, InventoryPage, CalendarPublicLinkCard) + `window.confirm` in RecipeForm:828 |
| `shared/EmptyState` | 6 | ~21 inline (9 in media pages, ChecklistView:300/NotesView:144/WishlistView:181, NotificationPanel:40, TodaysMealsCard:40, GroupsSettings:171, BackupSettings:152, SystemSettings:213, CalendarPage:619, BugReports:108, RewardsPage:87, AgendaView:55) |
| `shared/LoadingSpinner`/`LoadingPage` | 1 (SetupPage) | ~10 identical centered-spinner blocks (JoinPage:88, ProtectedRoute:16, ImportRecipeDialog:989, CalendarSettingsPage ×3, CalendarSyncSettings:323, RecipeImageInput:154) |
| `components/files/FileBrowser.tsx` | **0** — dead code; FilesPage (1185 lines) re-implements it inline | |

### B2. HIGH — Utility duplication
- `formatBytes` defined **7×**: StorageIndicator:9, UploadDialog:33, VideosPage:32, StorageSettingsPage:18, SystemSettingsPage:18 (signature drift), BackupSettingsPage:24, FilesPage:106. Belongs in `lib/utils.ts`.
- Error-message extraction: `lib/api-error.ts:51` `getErrorMessage()` used consistently only in FilesPage; 19+ sites inline `error instanceof Error ? ...` instead.
- Storage meter percent→color logic copy-pasted: `StorageIndicator.tsx:17-19` = `StorageSettingsPage.tsx:26-28`.
- Due-date chip logic ("today"/"tomorrow"/overdue) duplicated 4×: TasksPage:81, TaskRow:64-76, QuickAddInput:30, ChecklistView.
- Local `formatDate` shadows `lib/utils` in BugReportsSettingsPage:49; date-for-input converters duplicated in LeftoverForm:53, CalendarEventsPreview:53,67.

### B3. HIGH — The four media pages are copy-pasted siblings
- Empty-state Card block duplicated 9×, card+skeleton components duplicated per page (MovieCardSkeleton ≈ AlbumCardSkeleton ≈ ArtistCardSkeleton), `TimelineGroupSection` verbatim in PhotosPage:284-310 vs VideosPage:288-314.
- Lightbox modal duplicated verbatim (PhotosPage:319-425 vs VideosPage:322-407), hand-rolled `fixed inset-0` instead of Dialog — no focus trap or scroll lock, raw inline `<svg>` X icon.
- Extract: `MediaCard`, `MediaCardSkeleton`, `TimelineSection`, `MediaLightbox`; use `EmptyState`.

### B4. HIGH — Inventory "Label + Combobox" field trio duplicated 12+ files
- Same unit/category/area combobox block, each re-deriving `options.map(u => ({value:u,label:u}))`: ItemForm:228/432, FixIncompleteItemDialog:201, LeftoverForm:225, ReconcileDialog:117, CheckOffItemDialog:157, ManageStockDialog:473, PutAwayDialog:481/579, UnitConversionPromptDialog:111, BulkAddDialog:62, RelinkDialog:143, InventoryPage:1214, RecipeForm:255, IngredientMatchRow ×3. Copy drift already visible ("No unit found" vs "No unit found."). Extract `UnitCombobox`/`CategoryCombobox`/`AreaCombobox` + shared option constants.

### Medium reuse
- `ServingsStepper` duplicated verbatim (AddMealDialog:366-434 vs MealActionDialog:199-238); 3 more ad-hoc +/- steppers (RecipeDetailPage:556, CheckOffItemDialog:130, LeftoverCard:135) → generic `QuantityStepper`.
- Create/Edit dialog pairs share ~70% (CreateListDialog vs EditListDialog is the clearest — should be one `ListFormDialog` with `list?` prop). The open/reset/mutate/close skeleton repeats across 53 DialogContent files → a `FormDialog` wrapper would remove most chrome.
- Drag-drop upload zone re-implemented 4× (UploadDialog, RecipeImageInput, ImageParseDialog, BulkImportRecipeDialog) → `FileDropzone`.
- Two unrelated components both named `BulkAddDialog` (lists 77-line vs inventory 423-line) with overlapping paste-lines parsing.
- Hand-rolled badge pills where `ui/badge` exists: HouseholdSettingsPage:282,301,327; SettingsPage:131; RecipePreview:223.

---

## C. Visual consistency

### C1. HIGH — Semantic tokens bypassed; dark mode broken in spots
- 119 hardcoded-palette lines in 47 non-ui files (green 61, amber 40, orange 17, red 14, yellow 14, blue 7) vs partial token adoption (`destructive` 201 uses — good; `success` 26, `warning` 30, `info` 11, `error` 3).
- Broken in dark mode (light pastels, no `dark:`): SetupComplete:12, ForgotPasswordForm:47, ResetPasswordForm:73 (`bg-green-100`); CalendarForm:346, CalendarPublicLinkCard:160 (`bg-green-50 text-green-700`). ~26 more dark-shade-text lines go low-contrast (RemoteAccessSettingsPage:426,469,600,775; FilesPage:861,986; ManageStockDialog:295; IngredientMatchRow:226,311,373; RecipeDetailPage:790).
- Single highest-leverage fix: migrate green/amber/yellow/orange call sites to the existing `success`/`warning` token pairs — fixes most dark-mode issues simultaneously.

### C2. HIGH — Same concept, different colors
- **"Expiring/warning" renders in 4 hues**: `warning` token (UseUpSoonCard, ShoppingListItem:81, ChoreDecayMeter:51), amber (InventoryPage:864, PutAwayDialog:391, PermissionBadge:57), yellow (NotificationCenter:34, ConfidenceBadge:20), orange (AreaCard:66,152,167, InventoryPage:888, OfflineIndicator:36, NotificationCenter:33). InventoryPage alone uses amber, orange, AND the warning token for the same concept.
- **"Success" = 3 greens**: token vs `green-500/600` (61 uses in 25 files) vs emerald (MealPlanPage:433,463).
- **3 different default calendar blues**: `calendar-utils.ts:4` `#4A90D9` vs `CalendarView.tsx:130,198,251` `#3b82f6` vs `CalendarSettingsPage.tsx:75,280` `#3B82F6` / `CalendarSyncSettings.tsx:63` `#4285F4`. A colorless calendar renders different blues in sidebar dot vs event chips.
- Status maps to tokenize: NotificationCenter:33-39 (7 raw hues; purple `connection_request` likely dead post-federation), ConfidenceBadge:14-26, LeftoverCard:69-70.

### Medium/low visual
- CardTitle overridden to 4 different size/weight combos (default text-2xl, ×5 text-base/semibold, ×4 text-base/medium, ×4 text-base, ×5 text-lg). CardContent padding: p-6 default vs p-4 ×12, p-3 ×10, p-2 ×4.
- Dead CSS: `.card-skylight`/`.btn-skylight*` (index.css:121-144) 0 usages; `shadow-skylight*` ×4 vs ad-hoc shadows ×65.
- Icon drift: success-check icon at h-3/h-3.5/h-4/h-5 across 4 files. Yellow-500 folder icons collide semantically with yellow-500 storage warnings.
- Intentional/OK: lightbox `bg-black/90` chrome, QR white, terminal, brand hexes, list-type badges (these DO handle dark:).

---

## D. UX pattern repeatability

### D1. HIGH — Two form systems, different everything
- 15 files: react-hook-form + zodResolver, inline error messages, `<form>` so Enter submits (LoginForm, EventForm, ItemForm, RecipeForm, 4 settings pages).
- ~40 dialogs: ad-hoc useState, validation = disabled-until-nonempty, no error messages, bare onClick buttons so **Enter does nothing** (TaskEditDialog, Create/EditListDialog, ItemDetailSheet, AddMealDialog...). Only BulkAddDialog:256 hand-rolls onKeyDown.
- Dialog close timing mixed: most close onSuccess; TasksPage create closes onSettled (:275-278). Optimistic updates only in tasks + lists-offline → two perceived-speed models for "add item".
- Unsaved-changes guard exists ONLY for recipes, and uses `window.confirm` (RecipeForm:822-828) — the app's sole dirty-guard and sole window.confirm.

### D2. Toast/feedback inconsistency
- `TOAST_LIMIT = 1` (`hooks/useToast.ts:4`) + per-item `forEach(mutate)` bulk patterns (TasksPage:397-404) = N-item operations show one item's toast.
- Copy drift: `title: 'Error'` ×33 vs descriptive titles; tasks' error toasts omit `variant: 'destructive'` (TasksPage:290).

### D3. Loading/empty states
- Loading is the most consistent family (content-shaped skeletons in all 14 domains). Divergences: JoinPage bare spinner; LoadingSpinner dead code.
- Empty states: EmptyState in 6 domains; media pages hand-roll similar cards without CTAs; calendar agenda/settings/dashboard use bare `<p>`.

---

## E. Layout & placement

### E1. HIGH — Hover-only row actions unreachable on touch
Two competing systems: always-visible kebab (tasks TaskRow:387, inventory InventoryPage:950, ShoppingListItem:90, LeftoverCard:194, ListDetailPage:121) vs `opacity-0 group-hover:opacity-100` with no touch/focus fallback (ListsPage:240, ChecklistView:160,171 + drag handle :116, WishlistView:111, NotesView:97, FilesPage:877,1013, FileBrowser:195,259, CalendarSidebar:192, CalendarPage:651,725, NotificationItem:96, MealPlanPage:306 add-meal). App explicitly supports mobile — pin/duplicate/delete on lists, file actions, calendar-sidebar actions are invisible on phones. Canonical: kebab pattern; minimum: `focus-visible:opacity-100` + always-visible on `(hover: none)`.

### E2. HIGH — Mobile nav diverges from desktop gating
- `Sidebar.tsx:93-103` filters by feature flags AND permissions; `MobileNav.tsx:37-40` filters only by permissions — disabled features remain reachable on mobile. Vocabulary also diverges (flags `'calendar'`/`'inventory'` vs permission names `'calendars'`/`'shopping_list'`). Fix: shared `useNavItems()`.
- MobileNav's "More" sheet renders the desktop `<Sidebar/>` verbatim (MobileNav:82-101) including the meaningless Collapse toggle; Sidebar's `fixed` root only coincidentally lines up inside the sheet.
- Fixed-bottom stack collision on mobile: MobileNav (z-50) vs OfflineIndicator (`bottom-3 right-3 z-50` — sits ON the nav) vs MusicPlayer (`bottom-0 z-40` — renders UNDER the nav) + BugReport FAB.

### Medium layout
- Create-action placement varies: header-right primary (recipes/files/inventory/calendar/lists) vs no header add at all for tasks (QuickAddInput inline, header holds an outline "More options" — TasksPage:440-453) vs contextual header + faux-input card (ShoppingListPage:163-196) vs hover-Plus grid cells (MealPlanPage:306).
- Toolbar layout ad-hoc per page (search-left/controls-right vs tabs-left/search-right vs tabs+filter no-search vs Inventory's three-row stack at InventoryPage:1185-1263); sort UI in 3 idioms.
- Settings sub-pages have no section h1 (only "Settings"), so mobile users can't tell which section they're in; 3 nav entries (Notifications, Devices, Sessions — lib/constants.ts:42,49,53) lead to "coming soon" stubs with no badge.
- `/calendar/connect` (App.tsx:74) unreachable from the Calendar page — only linked from Settings and profile.
- Dialog widths: arbitrary px (`sm:max-w-[450px]` ×6, `[500px]` ×4, more) vs t-shirt sizes; several drop the `sm:` prefix, constraining phones too (AddToMealPlanDialog:71, GenerateShoppingListDialog:117, MealActionDialog:165). Footer anatomy (Cancel-outline left / confirm right) is the codebase's strongest convention (~20 dialogs); only AddMealDialog:237 diverges arbitrarily.
- Low: Dashboard TodayHero h1 scale (text-3xl/4xl vs PageHeader's 2xl/3xl); nav label drift (Sidebar "Tasks" vs page "Tasks & Chores"; MobileNav "Home"/"Shop"); PageHeader description carries stats vs prose vs an embedded component; ThemeSettingsPage downsizes CardTitle.

---

## Recommended fix order (by leverage)

1. **Backend WebSocket emits** for lists/inventory/shopping-list/files/meal-plans + fix the notification event name/payload (A1, A2). Frontend is already wired; this makes the app's core promise (family real-time sync) true.
2. **Global MutationCache onError + per-page isError branches** (A3, A4, and most of D2 collapse into this one change in QueryProvider).
3. **Route all durable-object deletes through shared ConfirmDialog** (A5 + B1's ConfirmDialog consolidation — one pass).
4. **Adopt existing shared components** — UserAvatar, SearchInput, EmptyState, LoadingSpinner (B1) and hoist `formatBytes`/`getErrorMessage` (B2). Lowest effort, immediate consistency; also fixes M-R3 (debounce) for free.
5. **Color token migration**: green/amber/yellow/orange → `success`/`warning` tokens; unify the calendar-blue constant (C1, C2). Fixes dark mode as a side effect.
6. **Touch-visible row actions + shared nav gating + mobile bottom-stack offsets** (E1, E2).
7. **Media domain**: wire or remove the dead detail routes (A7); extract MediaCard/TimelineSection/MediaLightbox while in there (B3).
8. **Offline write visibility** — ghost inserts via setQueryData, surface queue discards, wire or delete listsOffline (A6).
9. Then: FormDialog wrapper + Enter-to-submit + dirty guards (D1, M-R5), inventory combobox components (B4), toolbar/header-action template (E medium), dialog width normalization.

Items 1–4 are mostly mechanical and could each be a focused PR.
