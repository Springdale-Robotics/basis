# Basis AI System — Deep Dive (July 2026)

**The question:** Is the local AI system reaching its full potential for families? What
would it take to make it genuinely compelling — off by default, since it needs beefier
hardware or an external model?

**The short answer:** No. Today AI in Basis is an *input funnel* — it converts photos and
web pages into structured rows, and does that with real engineering care. But it never
*reads* anything the family already has. It has no memory, no context, no voice in the
product. The household data — calendar, chores, pantry, recipes, meal plans, lists — is
exactly the substrate a family assistant needs, it's already permission-scoped and
row-level-secured, and none of it is exposed to the model. Meanwhile the foundation has
real gaps: the master AI toggle is dead config, and the production installer never
provisions the local AI stack, so on a typical family box the AI features silently don't
exist.

---

## 1. What exists today

### 1.1 Three AI entry points — all input-side

| Entry point | Path | What it does |
|---|---|---|
| **Scan** (image parse) | `backend/src/modules/image-parse/` | Photo of handwritten list / recipe card / schedule → structured list, recipe, or calendar events. Session model: upload → queue → VLM read → LLM structure → review/edit → confirm → rows created. |
| **Recipe URL import** | `recipes/url-parser.service.ts`, `recipe-import.service.ts:607,697` | JSON-LD → scrape → **LLM fallback** on the page text when confidence is low. |
| **Recipe text parse** | `recipes.routes.ts:1234` → `services/llm-recipe-parser.ts` | Pasted recipe text → structured recipe via LLM. |

Plus one non-LLM ML component: the **CRF ingredient parser** (`services/ingredient-parser`),
used to structure ingredient lines, with graceful degradation warnings when it's down.

### 1.2 Provider architecture

Two separate abstraction layers, both cleanly done:

- **Text LLM** (`services/llm-provider.ts`): Anthropic (`claude-haiku-4-5`, needs API key)
  preferred → Ollama (`qwen2.5:7b` at `OLLAMA_HOST`) fallback → null. Callers all handle
  null (feature degrades, doesn't crash).
- **Vision** (`image-parse/ai-providers/`): `IMAGE_PARSE_PROVIDER` = `auto` |
  `handwriting-ocr` (cloud API, needs key) | `vlm-llm` (local). The local path is a
  dedicated FastAPI sidecar (`services/vlm-llm`, ~4.6k lines of Python) driving Ollama:
  image preprocessing (deskew/contrast), multi-pass VLM extraction, verification &
  self-correction passes, region extraction, and four modes (fast / accurate / thorough /
  counsel). Models: `minicpm-v` on GPU, `moondream` on CPU, `qwen2.5:7b` for structuring.

This is genuinely sophisticated — the counsel/multi-pass machinery is more than most
self-hosted apps attempt. The investment went into squeezing accuracy out of small local
models, and it shows.

### 1.3 The UX around it

`ImageParseDialog.tsx` is honest about hardware reality: GPU/CPU badge, per-stage
progress (Vision AI → Text Structuring), time-remaining estimate, and mode labels that
say **"~2-3 minutes (GPU) / ~15-20 minutes (CPU)"** for thorough mode. Review-before-
commit is universal: nothing the AI produces touches real data until the user confirms.

---

## 2. Findings on what exists (usability & reliability)

**F1 · HIGH — `ENABLE_AI_FEATURES` is dead config.** Defined at `config/index.ts:69`
(default false), referenced nowhere else in backend or frontend. There is no master AI
switch; availability is emergent from which keys/hosts happen to be configured. For a
privacy-positioned family product, "is AI on?" must be an explicit, visible household
setting — especially before any feature that *reads* family data.

**F2 · HIGH — Production never gets local AI.** `scripts/install.sh` and the in-app
updater don't install Ollama, pull models, or set up the `services/vlm-llm` sidecar
(no references to either anywhere in scripts/ or the install module). Defaults point at
`http://localhost:8010` / `:11434`, which exist only in the dev docker-compose world. So
on a real family box: scan fails with "AI service is not available," recipe import
silently loses its LLM fallback tier, and nothing tells the family why or how to fix it.
**The local AI stack is effectively dev-only today.**

**F3 · MEDIUM — CPU-mode latency makes local vision a demo, not a feature.** 15–20
minutes per thorough scan (the UI's own estimate) on the hardware most families own.
The flow at least runs as a background job with a resumable session, but there's no
notification when a long scan finishes — the user has to keep the dialog open or come
back and re-open it (SUSPECTED: verify whether a websocket/notification fires on
completion).

**F4 · MEDIUM — "Local-first" ordering is inverted for text.** `getLLMProvider()` always
prefers the Anthropic API over local Ollama when a key is present. Defensible on
accuracy, but it means a family that configures *both* silently sends recipe/page text
to a cloud API. Provider preference should be an explicit household choice
(`AI_PREFER_LOCAL`), surfaced in settings, not an implicit ordering.

**F5 · LOW — JSON-parse fragility from small models.** `llm-recipe-parser.ts` strips one
markdown fence then `JSON.parse`s; qwen-class models intermittently emit trailing prose
or partial JSON. There's no retry-with-repair loop. Failures degrade gracefully (null →
heuristics), so cost is accuracy, not crashes.

**F6 · LOW — No cost/rate guardrails on the Anthropic path.** Each import/scan fallback
is an uncapped API call; a kid re-importing 50 URLs is real money. Fine at alpha scale;
needs a household-level daily cap before Basis Remote-style paid customers arrive.

**Solid:** session TTL + image cleanup (uploaded photos deleted on confirm/cancel/expiry —
good privacy hygiene); every AI write path goes through review/confirm; SSRF protection
exists for URL fetching (`lib/ssrf.ts`); household scoping enforced on all image-parse
queries.

---

## 3. The gap: what a family AI should be

Basis sits on the most valuable private dataset a family has, already structured and
already permission-modeled. Nothing reads it. Concretely, the model today never sees:

- The calendar ("what's our week look like? any conflicts Thursday?")
- Tasks/chores ("what's left today? who's been slacking on dishes?" — chore fairness)
- Inventory + expiry ("what can I cook tonight with what we have? what's about to go bad?")
- Recipes + meal plan ("plan next week around soccer nights and what's in the pantry")
- Shopping lists ("we're out of the usual — build the Costco run")
- Leftovers ("what needs eating first?")

Each bullet is a question a family actually asks out loud, at dinner, every week. That's
the full potential: **Basis as the only assistant that can answer them without the
family's life leaving the house.** Cloud assistants can't get this data (and shouldn't);
Basis already has it, RLS-scoped per household, with per-member permissions.

The strategic asset nobody planned: the image-parse **session → review → edit → confirm**
pattern is exactly the right safety UX for *any* AI write. "AI proposes, family
disposes" already exists in code and just needs generalizing.

---

## 4. Roadmap to compelling

Off by default throughout: a household-level **AI settings page** with an explicit
opt-in, an engine choice, and a plain-language data disclosure. Each stage ships value
alone.

### Stage 0 — Make the foundation real (prerequisite, ~small)
- Wire `ENABLE_AI_FEATURES` as the actual master gate on every AI route + UI surface,
  settable per household in Settings (not env-only). Default off.
- **AI engine setup flow** in Settings → detect hardware (RAM/GPU — the `gpuAccelerated`
  probe already exists), then offer: (a) *Local* — guided Ollama + model install via the
  existing installer machinery, with honest speed expectations per tier; (b) *External
  API* — paste an Anthropic key, with an explicit "text you import/scan will be sent to
  Anthropic" consent screen; (c) *Off*.
- Ship the `vlm-llm` sidecar + Ollama as optional components in `install.sh`/self-update
  (systemd units, model pull with progress). Until this exists, everything else is moot.
- Add `AI_PREFER_LOCAL` and surface provider order in the settings UI (fixes F4).
- JSON repair/retry wrapper on LLM structured output (F5); per-household daily API-call
  cap (F6).

### Stage 1 — "Ask Basis": read-only household Q&A (the compelling unlock)
- A chat surface (and dashboard widget) backed by **tool calling over the existing
  service layer** — not raw SQL, not a RAG dump. Define ~10 read tools:
  `get_calendar_events(range)`, `get_tasks(filter)`, `get_inventory(expiring_within)`,
  `get_recipes(query)`, `get_meal_plan(week)`, `get_lists()`, `get_leftovers()`, etc.
  Each tool call runs through the same household-RLS + member-permission path as the
  REST routes, so **the model can only ever see what the asking member can see** — the
  kid's assistant doesn't leak the parents' calendar. This is the architecture decision
  that makes everything else safe.
- Engine: qwen2.5-class local models handle tool calling adequately for single-step
  queries; Anthropic engine handles multi-step planning. Same `LLMProvider` abstraction,
  extended with a `completeWithTools()` method.
- Killer first queries to optimize for: "what can I make tonight" (inventory × recipes),
  "what's expiring", "what's on this weekend", "what does [kid] still have to do today".

### Stage 2 — Proposed actions with confirm (generalize the scan pattern)
- Let the assistant *draft* writes: add to shopping list, schedule an event, plan next
  week's meals, create chores. Every draft lands in a review card (the image-parse
  confirm UX, generalized to an `ai_proposals` table) — nothing commits without a tap.
- Natural-language quick-add everywhere ("dentist for Maya next Tues 3pm", "chicken,
  tortillas, and whatever taco stuff we're missing") — this is the daily-habit feature.

### Stage 3 — Proactive intelligence (opt-in per feature, digest-first)
- **Weekly family brief** (Sunday evening notification): week's calendar shape +
  conflicts, expiring food + "use it up" recipe suggestions, chore completion summary,
  suggested meal plan seeded from pantry + schedule density (busy night → quick recipe).
- Expiry-driven dinner nudges; shopping-list prediction from consumption patterns
  (inventory history is already being recorded); calendar conflict detection on event
  creation.
- All generated locally on schedule (BullMQ worker — the job infrastructure exists),
  delivered through the existing notification system. No always-listening anything.

### Deep dive A — "an MCP server per feature" so the AI can read *and* write everywhere

Your instinct is right, and it's more right than you may realize: **Basis already has the
per-feature server layer.** Every module (`tasks`, `calendars`, `inventory`, `lists`,
`recipes`, `files`, …) is already a self-contained service with typed routes, Zod
schemas, permission gating, and household scoping. An MCP server per feature would, in
effect, re-expose that same surface to a model. So the question isn't "can we build 12
MCP servers" — it's "what's the *right* adapter over the service layer we already have,"
and MCP is one of two reasonable answers.

**Two ways to expose the tools, and when each wins:**

1. **In-process tool registry (recommended default).** Define tools as thin wrappers over
   the existing service functions, in the backend, called directly by the LLM abstraction's
   `completeWithTools()`. No new process, no transport, no serialization tax. Each tool
   runs inside the *authenticated request's* household + permission context automatically —
   which is the whole ballgame for safety (see below). This is the fastest path to Stage 1
   and the one I'd ship first.

2. **Real MCP servers (per feature or one gateway).** Worth it specifically when you want
   the tools reachable by clients *outside* Basis's own request loop — e.g. the user points
   Claude Desktop, a local agent, or a future voice device at "my house" and it can act on
   the family's data through a standard protocol. MCP's value is the standardized boundary
   and the ecosystem of clients, not raw capability. The cost is that you now own an
   auth/session bridge (MCP's transport is not your cookie-session world) and a second
   place where household scoping must be enforced — exactly the class of bug this review
   found all over the REST layer (unscoped routes, dead RLS). **Do not build MCP servers
   until RLS or consistent per-route scoping is real**, or you will have doubled your
   cross-tenant attack surface.

**Recommended shape:** build the in-process tool registry now (Stage 1), structured so each
tool is a pure `(ctx, args) => result` over a service function. Then a *single* MCP gateway
server (not twelve) can wrap that same registry later with near-zero extra code — one
process, one auth bridge to get right, feature tools namespaced (`tasks.create`,
`inventory.consume`). "One MCP server per feature" is the wrong granularity operationally
(12 processes, 12 auth bridges, 12 things to supervise on a family box with 2 GB of RAM);
"one gateway over a per-feature tool registry" gives you the same conceptual cleanliness
without the process sprawl.

**Write tools are where this gets both compelling and dangerous.** Reading is low-stakes;
letting the model `inventory.consume`, `calendar.createEvent`, `tasks.complete`,
`lists.addItem` is the actual product. Two hard rules, both of which Basis is unusually
well-positioned for:
- **Every write tool routes through the same service function the UI uses** — never bespoke
  SQL. That means the model inherits the (few) invariants those functions enforce *and*
  their bugs. Given this review found cross-tenant holes and missing transactions in
  exactly those functions (inventory especially), **hardening the service layer is a
  prerequisite for AI writes, not a parallel track.** The upside: fixing them once fixes
  them for humans and the AI together.
- **Writes are proposals, not commits (the Stage 2 pattern).** The model calls a write
  tool → it produces a *draft* in an `ai_proposals` table → the family taps to confirm.
  This is the generalization of the image-parse review flow you already ship, and it caps
  the blast radius of a hallucinated `consume 500 units of milk` to "a card the user
  declines." For a small set of low-stakes, easily-reversible writes (add to shopping
  list, add a checklist item) you can later allow direct commit with an undo, but start
  everything behind confirm.

**Feasibility verdict:** High, and higher than a from-scratch assessment would suggest,
*because the per-feature service decomposition already exists*. The work is an adapter +
a tool registry + the proposal/confirm table, not new backend architecture. The gating
risk is not the AI plumbing — it's that the underlying service layer has the tenancy and
transaction gaps catalogued elsewhere in this review, and an AI with write tools turns
each of those from "a member could trigger it" into "an assistant could trigger it at
scale." Sequence accordingly: **service-layer hardening → in-process tool registry (read)
→ proposal/confirm writes → optional MCP gateway for external clients.**

### Deep dive B — letting households switch local models + managing context

Two related asks: let a family swap which local model they run, and manage the context
that model works with — both in general and specifically across a model switch.

**Model switching — what's easy and what isn't.** The engine abstraction
(`LLMProvider`, `getVisionProvider`) already makes *provider* swapping a config change, and
Ollama makes *model* swapping a matter of `ollama pull <name>` + a settings value
(`OLLAMA_LLM_MODEL` / `OLLAMA_VLM_MODEL` already exist). So the mechanics are cheap. What's
missing for a real family-facing feature:
- **A model catalog with honest hardware guidance.** A settings UI listing a curated set
  (e.g. `qwen2.5:3b` / `:7b` / `:14b`, `llama3.2`, a vision model tier) with, for each: RAM/VRAM
  needed, rough speed on this box (reuse the existing `gpuAccelerated` probe + a one-time
  local benchmark), and what it's good at. Families should never type a model tag; they
  pick "Faster / Balanced / Smarter" and Basis maps that to a tag their hardware can run.
- **Guided pull with progress**, using the same installer/PTY machinery that already drives
  updates — download is the slow, failure-prone step and needs the same honest progress UX
  the scan flow already has.
- **Capability-aware feature gating.** Not every model does tool calling well; a 3B model
  is fine for "what's expiring" but not multi-step planning. The catalog entry should carry
  a `supportsTools` / `contextWindow` flag so Basis can disable or downgrade features
  (e.g. fall back to read-only Q&A) rather than letting a weak model silently produce
  garbage. This is the difference between "switchable" and "compelling."

**Context management in general.** A local 7B model with an 8K–32K context window cannot be
handed the whole household. Context has to be *retrieved and budgeted*, not dumped:
- **Tool-calling is itself the primary context strategy** — instead of stuffing the pantry
  into the prompt, the model calls `inventory.get(expiring_within: 7d)` and receives only
  what it asked for. This is why the tool registry (Deep dive A) matters more than any RAG
  index for structured household data: the data is relational and queryable, so let the
  model query it. Reserve embeddings/RAG for the genuinely unstructured corner (recipe free
  text, notes, photo captions).
- **A per-model context budget** in the model catalog entry (`contextWindow`), with the
  orchestration layer trimming tool results to fit (e.g. cap `get_events` to the asked
  range, paginate, summarize long lists) — and a hard rule that the system prompt +
  household "profile" (member names/roles, calendar names, tier) always fits with room to
  spare.
- **A small, explicit "household memory"** the family curates: dietary restrictions,
  recurring preferences ("we don't do Sunday-night big meals"), kid bedtimes. Stored as
  structured settings, injected into every prompt. This is cheap, high-signal context that
  doesn't depend on model size — and it's the thing that makes answers feel like *your*
  house rather than a generic assistant.

**Context management across a switch — the specific case you called out.** The important
design decision: **keep conversation/context state model-agnostic so a switch is lossless.**
- Persist chat history and any derived "household memory" as **plain structured data keyed
  to the household, never to the model** (no model-specific KV-cache or embedding vectors
  in the canonical store). Then switching from `qwen:7b` to `llama3.2` just re-feeds the
  same portable history to the new model.
- **Embeddings are the one thing that doesn't survive a switch cleanly** — vectors from one
  embedding model aren't comparable to another's. So (a) pin the *embedding* model
  separately from the *chat/vision* model (users switch the reasoning model far more often
  than they'd want to re-index), and (b) if the embedding model does change, treat it as a
  background re-index job (the BullMQ infra exists) with the old index serving reads until
  the new one is built. Surface it honestly: "re-indexing your recipes for the new model,
  search may be incomplete for a few minutes."
- **On switch, re-probe capabilities and re-gate features** (a smarter→simpler switch may
  need to disable multi-step planning; a simpler→smarter switch can re-enable it), and show
  the family what changed ("Balanced model: weekly planning and voice are on; scan is
  fast-mode only").
- **Truncate, don't translate, long histories** when moving to a smaller context window:
  summarize older turns into a compact recap (using the new model itself) rather than
  hard-dropping them, so a downgrade doesn't feel like amnesia.

**Net:** switchable models + portable, tool-retrieved context is very feasible and mostly
*product* work (catalog, guided pull, capability gating, a model-agnostic history/memory
store) on top of abstractions that already exist. The one genuine engineering subtlety is
embeddings-don't-transfer; handle it by pinning the embedding model separately and
re-indexing in the background. Design the context store to be model-agnostic from day one —
retrofitting that after you've coupled state to a specific model is the expensive mistake.

### Stage 4 — Ambient (later, evaluate after 1–3 land)
- Voice on the TV dashboard/kitchen device (local Whisper is now cheap; pairs with the
  chumtv-style dashboard use case).
- Photo semantic search via local CLIP embeddings ("find the picture of the kids at the
  lake") — heavy, separate opt-in.

### Hardware tiers to document honestly
| Tier | Hardware | What works |
|---|---|---|
| None | any | AI off (default) — everything else in Basis works |
| API | any + Anthropic key | All features, best quality; data leaves home with consent |
| Local-basic | ~8–16 GB RAM, CPU | Ask Basis (text), quick-add parsing; scan in fast mode only, slow |
| Local-full | GPU w/ 8 GB+ VRAM | Everything local incl. vision scan at usable speed |

### Trust rules (product commitments, not implementation details)
1. Off by default; enabling is a household-owner action with a data-disclosure screen.
2. The model sees only what the asking member can see (permission-scoped tools).
3. AI never writes without a human confirm (Stage 2 pattern).
4. External-API mode says exactly what leaves the house, and local mode never does.
5. An AI activity log in Settings: what was asked, what data tools were called.
(Add "audit log" as a Stage 1 deliverable — it's cheap when built alongside, painful after.)

---

## 5. Concrete next engineering steps (ordered)

1. Gate all AI surfaces on `ENABLE_AI_FEATURES` + household setting (dead flag → real flag).
2. `install.sh` + updater: optional Ollama/vlm-llm provisioning with model pull.
3. Settings → AI page: hardware detect, engine picker, consent copy, provider order.
4. `LLMProvider.completeWithTools()` + first 5 read tools + minimal chat UI behind the flag = Stage 1 MVP.
5. JSON repair wrapper + API budget caps.
6. `ai_proposals` table + review-card component (generalized from image-parse previews).
7. Weekly brief worker as the first proactive feature.
