# Basis Product Review — July 2026

**Goal:** Inventory every important feature of Basis, review each for usability and
reliability, and produce a deep dive on the local AI system — is it reaching its full
potential for families, and what would make it truly compelling (opt-in, since it needs
beefier hardware or an external model)?

**Status legend:** ⬜ not started · 🔄 in progress · ✅ done

**COMPLETE (2026-07-05).** All deliverables written. Backend test suite run: **119 passed /
10 skipped** (skips = CRF ingredient-parser tests, Python sidecar unreachable); 13 test
files, all backend, coverage concentrated on CalDAV + pure libs. Start with `04-summary.md`.

## Deliverables

| File | Contents |
|---|---|
| `00-PLAN.md` | This tracking plan |
| `01-feature-inventory.md` | Complete feature list |
| `02-reviews/*.md` | Per-area usability + reliability reviews |
| `03-ai-deep-dive.md` | Local AI system: current state, gap analysis, roadmap |
| `04-summary.md` | Executive summary: top findings + prioritized recommendations |
| `05-inventory-deep-dive.md` | Inventory system: full explainer (data model, flows, integrations) + reliability audit — requested extra depth |

## Feature inventory (review areas)

| # | Area | Features | Status |
|---|---|---|---|
| 1 | Auth & access | Login/sessions (Lucia), app passwords, permissions, households, groups, member invites, user profiles | ✅ |
| 2 | Tasks & chores | Tasks, chores, recurrence, assignees, rewards, quick-add, bulk ops | ✅ |
| 3 | Calendar | Calendars, events, recurrence, CalDAV sync (external + serving), reminders, day/week/month/agenda views | ✅ |
| 4 | Lists | Shopping lists, checklists, wishlists, notes, templates, pinned items, sections | ✅ |
| 5 | Recipes & meal planning | Recipe CRUD, URL import, ingredient matching/parsing, recipe images, meal plan, cook flow → leftovers | ✅ |
| 6 | Inventory | Pantry inventory, expiry tracking, leftovers, basic/advanced modes, inventory worker | ✅ |
| 7 | Media & files | Photos, movies, music, videos, files, thumbnails, media worker, streaming | ✅ |
| 8 | Platform & ops | Setup wizard, install/self-update, system page, backups, health, bug reports, devices, Tailscale/Connect, Basis Remote (cloud) | ✅ |
| 9 | Cross-cutting UX | Dashboard, real-time sync (WebSocket → React Query), offline indicator, settings & feature tiers, navigation, mobile | ✅ |
| 10 | **AI system (deep dive)** | Image parse (scan handwriting → list/recipe/event), vision providers (HandwritingOCR API / Ollama VLM+LLM), LLM provider abstraction (Anthropic/Ollama), LLM recipe parsing, `ENABLE_AI_FEATURES` flag | ✅ |

## Method

- One parallel review agent per area (1–9), each reading routes/services/schema/frontend
  pages/tests for its features. Each reports: what the feature does, usability findings,
  reliability findings, test coverage, top recommendations — severity-tagged.
- Backend test suite run once for a live reliability signal.
- AI deep dive (10) done in the main session: full read of the AI code paths, data-access
  gap analysis (what household data the AI can/can't see), and a staged roadmap to a
  family-compelling local AI — off by default, Ollama or external API as the engine.
- Synthesis pass at the end: dedupe, rank, write `04-summary.md`, update statuses here.

## Known context

- Prod = native systemd on separate box ("basis"), v0.1.12-alpha; latest v0.1.14-alpha.
- AI config today: `ENABLE_AI_FEATURES` defaults **false**; `IMAGE_PARSE_PROVIDER`
  auto → HandwritingOCR (if key) → local VLM+LLM (`llava:7b` + `qwen2.5:7b` via Ollama,
  3-min CPU timeout); recipe parsing prefers Anthropic (`claude-haiku-4-5`) → Ollama.
- Local services: `services/vlm-llm` (two-stage vision pipeline), `services/ingredient-parser`.
