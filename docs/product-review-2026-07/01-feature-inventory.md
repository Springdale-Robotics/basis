# Basis — Feature Inventory (July 2026)

Every user-facing feature, grouped by review area. Derived from `backend/src/modules/*`,
`backend/src/jobs/*`, `frontend/src/pages/*`, `services/*`, and `cloud/`.

## 1. Auth & access
- Email/password login with cookie sessions (Lucia, sessions in Postgres)
- Password reset
- Household model (multi-tenant, row-level security via `app.household_id`)
- Member invites (spouse/kids join a household)
- Groups within a household
- Per-member permissions
- App passwords (device-scoped credentials for CalDAV clients)
- User profiles

## 2. Tasks & chores
- Tasks with due dates, assignees, recurrence
- Chores tab (recurring household chores)
- Rewards/points (feature-toggled)
- Quick-add with inline date/assignee parsing
- Bulk operations, sorting, filtering
- Task reminders via notification worker

## 3. Calendar
- Household + personal calendars, color-coded
- Events with recurrence (RRULE), all-day events
- Month / week / day / agenda views, drag-to-reschedule
- Built-in CalDAV **server** (subscribe from iPhone/Android with app passwords)
- External calendar **sync** (calendar-sync worker)
- Event reminders (calendar-reminder worker)
- Device connect flow (QR code for iOS setup)

## 4. Lists
- Checklists / reminder lists / notes
- Shopping lists (integration target for recipes & inventory)
- Wishlists
- List templates
- Pinned items, sections, sort ordering
- Real-time shared editing across household members

## 5. Recipes & meal planning
- Recipe CRUD with images, servings, prep/cook times, ingredient groups
- Import from URL (JSON-LD → scraping → LLM fallback chain)
- Import from pasted text (LLM-assisted)
- Scan handwritten recipe card (AI image parse)
- Ingredient parsing via CRF service (`services/ingredient-parser`)
- Ingredient ↔ inventory matching
- Meal plan (weekly planning)
- Cook flow → leftovers / inventory decrement
- Add recipe ingredients to shopping list

## 6. Inventory
- Pantry/household inventory with locations & quantities
- Basic vs advanced modes
- Expiry date tracking + expiry notifications (inventory worker)
- Leftovers tracking
- Integration with cook flow and shopping lists

## 7. Media & files
- Photo library (upload, thumbnails via media worker)
- Movies, Music, Videos libraries (streaming)
- File storage/sharing within household
- Thumbnail generation (configurable sizes/quality)

## 8. Platform & ops
- First-run setup wizard
- In-app self-update (install module; release-via-tag flow)
- System page (storage, health, terminal)
- Scheduled backups (system-backup worker) + restore
- Health endpoints
- In-app bug reports → relay worker (`worker/bug-report-relay`)
- Device management
- Remote access: Tailscale integration (+ health worker), Connect flow
- **Basis Remote** (paid `lastname.home-basis.com` tunnel; `cloud/` workspace: frps relay, Stripe billing, suspension enforcement)
- Cleanup worker (expired sessions, temp files)

## 9. Cross-cutting UX
- Dashboard (family home screen; also used as TV dashboard)
- Real-time sync: Socket.io events → React Query invalidation
- Offline indicator
- Feature tiers/toggles (basic vs advanced per household)
- Global mutation toasts, ConfirmDialog pattern
- Dark mode, mobile-responsive layouts
- Notifications system (in-app + push?)

## 10. AI system
- **Image parse** ("scan"): photo of handwritten list/recipe card/schedule →
  structured list / recipe / calendar events, with review-edit-confirm UX
  - Providers: HandwritingOCR.com API, or local two-stage VLM+LLM pipeline
    (`services/vlm-llm`: FastAPI + Ollama; fast/accurate/thorough/counsel modes,
    preprocessing, multi-pass, verification)
- **LLM provider abstraction** (`services/llm-provider.ts`): Anthropic (preferred) → Ollama fallback
- **LLM recipe parsing**: fallback for URL import + pasted-text import
- **CRF ingredient parser** (non-LLM ML, `services/ingredient-parser`)
- `ENABLE_AI_FEATURES` config flag (currently unused — see deep dive)
- AI status endpoint (GPU detection, expected processing time shown in UI)
