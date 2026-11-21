# Claude API as a box-wide AI backend — design

Date: 2026-11-20 · Status: approved by owner 2026-11-20 (with the model change below)

Owner decisions: one box-wide switch (approach 1); "This server" is strictly
local, HandwritingOCR included; Claude failures on recipe import show a warning;
the model tracks the newest Claude Haiku rather than a pinned version.
All other choices are the author's calls, open to the owner's correction.

## Why

The production box (shelden) died in a power event on 2026-11-04 (burnt RAM, no
POST). Basis is likely moving to a host without a GPU (chumbucket: 56-thread
Xeon, 125 GB RAM, no GPU) or a small VPS. Every AI feature today needs local
Ollama on a GPU to be usable. A Claude API key lets those features work on any
host for well under $1/month (Claude Haiku 5.5: $0.10 / $0.50 per MTok; a recipe
photo costs under a tenth of a cent).

Basis is self-hosted and user-owned, so sending household content to a third
party must be an explicit, visible admin choice — never a silent fallback.

## Goals

- One box-wide switch on **Settings → AI Models**: "Where AI runs" —
  *This server (Ollama)* or *Claude API*.
- With Claude selected, all three AI jobs use the newest Claude Haiku
  (currently Haiku 5.5):
  1. photo import (image-parse sessions, incl. bulk recipe capture),
  2. receipt line structuring (after local Tesseract OCR),
  3. recipe text parsing (`services/llm-recipe-parser.ts`).
- API key entered in the UI, stored encrypted, never returned to the browser.
- Works on a box with no Ollama installed at all.

## Non-goals

- Per-feature provider choice (considered, rejected — see Approaches).
- A model picker. The model is always the newest Haiku (see Model resolution).
- Changing receipt OCR (Tesseract stays local; only structuring moves).
- Hosting/isolation of Basis on chumbucket — separate design, next.

## Anti-goals (failure even if it "works")

- Household data reaching Anthropic when the admin chose *This server*.
- Silent fallback in either direction: Claude chosen + Claude failing must
  surface an error, not quietly use Ollama; Ollama chosen + Ollama down must
  not quietly use Claude.
- The key appearing in API responses, logs, error messages, or bug reports.

## Approaches

1. **One switch for the whole box** — PICKED by the owner. One explicit privacy
   decision, simplest to explain and test.
2. Per-feature choice (photos / receipts / recipe text each local-or-Claude).
   More flexible; triples settings and test matrix. Rejected.
3. Claude only as an automatic fallback when Ollama is down. Rejected: data
   would leave the box without anyone choosing that at the time.

## Constraints and existing facts

- `system_settings` (box-level jsonb key/value, no RLS by design) already holds
  `llm.textModel` / `llm.visionModel`. AI-backend settings belong there too.
- `lib/crypto.ts` provides AES-256-GCM `encrypt`/`decrypt` keyed from
  `ENCRYPTION_KEY`. Use it for the key.
- LLM routes are gated `authMiddleware + requireAdmin()` (household admin).
  Household admins are already de-facto box admins (web terminal, installer,
  updates use the same gate), so this adds no new privilege boundary. Note it,
  don't change it.
- `@anthropic-ai/sdk` ^0.89 is already a dependency.
- Existing env behaviour: if `ANTHROPIC_API_KEY` is set, `getLLMProvider()`
  already prefers Anthropic for recipe text, model `LLM_RECIPE_MODEL`
  (default `claude-haiku-4-5-20251001`).
- `AnthropicProvider.complete()` sends `temperature`. Claude Haiku 5.5 rejects
  non-default sampling params (400), and API version 2026-10-21 rejects them on
  every model. Claude calls must not send `temperature`/`top_p`/`top_k`.
- Vision provider chain (`ai-providers/index.ts`, `auto`): HandwritingOCR →
  VLM-LLM sidecar → Ollama. The single caller passes `prompt=''`; providers
  supply their own prompt. A provider returning only `rawText` (no
  `structured`) flows into the existing heuristic + CRF path — the Ollama
  provider does exactly this.

## Decided design

### Settings (system_settings)

| key | value | meaning |
|---|---|---|
| `ai.backend` | `"local"` \| `"claude"` (absent = legacy) | the switch |
| `ai.claudeApiKey` | encrypted string from `crypto.encrypt` | the key |

Tri-state matters: **absent** keeps today's behaviour exactly (env
`ANTHROPIC_API_KEY` still used for recipe text, HandwritingOCR still used when
`HANDWRITING_OCR_API_KEY` is set, so no existing box changes on upgrade).
**`local`** means strictly local — nothing leaves the box (owner decision,
2026-11-20): the env Anthropic key is ignored, and the HandwritingOCR provider
(an upload to handwritingocr.com) is skipped too, including when
`IMAGE_PARSE_PROVIDER=handwriting-ocr`. Only the VLM-LLM sidecar and Ollama are
eligible. **`claude`** means Claude for all three jobs using the UI key, and
nothing else (no HandwritingOCR, no local fallback).

`ai.backend = "claude"` may only be set while a key is stored. Removing the key
while `claude` is active sets `ai.backend = "local"` in the same operation.

### Backend

- New `modules/llm/ai-backend.ts`: `getAiBackend()`, `getClaudeKey()` (decrypts;
  null if absent/undecryptable), `setClaudeKey()`, `clearClaudeKey()`,
  `getClaudeClient()` (cached per key; rebuilt when the key changes), and
  `getClaudeModel()` (see Model resolution).
- **Vision:** new `ai-providers/claude-vision.ts` implementing
  `VisionProvider`. Downscales like the Ollama provider (reuse/export
  `downscaleForInference`, parameterised edge — ~1568 px is Claude's useful
  maximum), sends one image block + the transcription prompt, returns
  `rawText` only. `getVisionProvider()`: when backend is `claude`, return the
  Claude provider and nothing else (null if no key); when `local` or absent,
  never consider Claude. `getVisionProviderStatus()` / `getAllProvidersStatus()`
  get a Claude branch.
- **Receipts:** `structureReceipt()` / `isStructurerAvailable()` branch on the
  backend. The Claude path sends the same `PROMPT` + transcription and reuses
  `parseStructuredResponse()` (which already tolerates fences/prose).
- **Recipe text:** `getLLMProvider()` follows the tri-state above. The Claude
  path uses the UI key + `getClaudeModel()` and sends no sampling params. The
  legacy env path keeps working; drop `temperature` from it too.
- **Recipe-import failures are visible (owner decision, 2026-11-20).** Today
  `parseRecipeWithLLM()` swallows every error and returns `null`, and the two
  fallback callers in `recipe-import.service.ts` (~lines 878, 972) silently
  keep the heuristic result. With Claude active, a failure must instead let the
  import finish with the heuristic result **plus a visible warning** carrying
  the mapped message (e.g. "Claude couldn't help with this recipe — the API key
  was rejected. Used basic parsing."). The explicit
  `POST /import/:sessionId/reparse-llm` path shows the mapped message instead
  of its generic one. This changes the parser's return contract (a typed
  error result rather than bare `null`) and all three call sites. Photo
  import and receipts already surface provider errors on the session; they
  get the mapped messages too.
- **Undecryptable key (my call):** if `ai.claudeApiKey` exists but won't
  decrypt (e.g. `ENCRYPTION_KEY` not carried to a new host), `GET /backend`
  reports `keyState: 'unreadable'` and the page says "Saved key can't be read —
  please re-enter it"; AI jobs fail with that same message. The backend stays
  `claude` — no silent switch to local.
- **Errors:** map SDK errors to user-facing messages (401 → "The Claude API key
  was rejected — replace it in Settings → AI Models"; 429 → try again; network →
  can't reach Anthropic). Check `stop_reason` before reading content;
  `refusal` → a clear "Claude declined to read this" message.
- **Key hygiene:** add the key's paths to the Pino `redact` list; never include
  it in thrown messages; the SDK client is constructed with it explicitly
  (don't set `process.env.ANTHROPIC_API_KEY`).

### Model resolution (owner decision, 2026-11-20)

The owner wants the newest Haiku, not a pinned version that will eventually be
retired.

- `getClaudeModel()` asks the Models API (`client.models.list()`) for models
  whose id starts with `claude-haiku-`, and picks the one with the latest
  `created_at`. Where the Models API reports `capabilities`, only models that
  take image input are eligible (photo import needs vision). Check the field
  shape against the SDK/docs; don't guess it.
- Store the result in `system_settings` as `ai.claudeModel`
  (`{ id, displayName, resolvedAt }`). Re-resolve when a key is saved and when
  the stored choice is more than 24 h old. If listing fails, keep using the
  stored choice; if nothing was ever resolved, use the fallback constant
  `claude-haiku-5-5`.
- If a call fails because the model no longer exists (404 `not_found_error`
  naming the model), re-resolve right away and retry that call once.
- Calls stay minimal so a new Haiku is unlikely to break them: no `thinking`
  config, no sampling params, no prefill, no forced `tool_choice`. Check
  `stop_reason` (`refusal`, `max_tokens`) on every response.
- The page shows the resolved `displayName`. Pricing in the UI copy is a
  rough figure ("under $1/month"), not tied to a specific model.

### API (all admin-only, under `/api/v1/llm`)

- `GET /backend` → `{ backend: 'local'|'claude'|null, keyState: 'none'|'set'|'unreadable', keyHint: '••••abcd' | null, model: { id, displayName } | null }`.
- `PUT /backend` `{ backend: 'local'|'claude' }` → 400 if `claude` without a key.
- `PUT /claude-key` `{ key }` → verifies the key with a minimal real call
  before saving; 400 with the Anthropic reason if it fails. Returns the
  `GET /backend` shape.
- `DELETE /claude-key` → removes key; flips `claude` → `local`.
- Existing `/status` adds `backend` so the page can render one state.

### Frontend (AiModelsSettingsPage)

A new top card, **Where AI runs**:

```
Where AI runs
( ) This server (Ollama)   — nothing leaves this box
(•) Claude API (Anthropic) — photos, receipt text and recipe text are sent
                             to Anthropic to be read
    API key  [ ••••abcd ]  [Replace] [Remove]
    Uses Claude Haiku 5.5 (newest Haiku). Typical cost: under $1/month.
```

- Selecting Claude with no key opens the key field; the switch saves only
  after a key validates.
- While Claude is active, the Ollama model cards stay visible but are marked
  "Not in use while Claude is selected" (so switching back is easy).
- A box with no Ollama and no GPU should not show the driver/Ollama blocker
  cards as errors while Claude is active.

### Tests

- Backend selection matrix: absent/local/claude × UI key present/absent/unreadable
  × env Anthropic key present/absent × HandwritingOCR key present/absent, for
  all three jobs — asserting the anti-goals: with `local`, no outbound
  third-party call at all (no Anthropic, no HandwritingOCR); with `claude`, no
  Ollama/sidecar/HandwritingOCR call; with absent, today's behaviour.
- Recipe import with Claude failing (401, 429, network, refusal) completes with
  the heuristic result and the mapped warning; reparse-llm returns the mapped
  message.
- `GET /backend` never returns the key; logger redaction covers it.
- Key encrypt/decrypt round-trip; undecryptable stored value → treated as no key.
- Claude calls carry no `temperature`/`top_p`/`top_k`.
- Model resolution: picks the newest Haiku from a mocked model list; ignores
  non-Haiku models; uses the cached choice when listing fails; falls back to the
  constant when nothing was ever resolved; a 404 for the model forces a
  re-resolve and one retry.
- Claude SDK mocked in tests; no real API calls in CI.

## Left to the builder

- Exact file split inside `modules/llm/`, and whether the Claude text call is a
  new `LLMProvider` class or the existing `AnthropicProvider` parameterised.
- Key verification call shape (a 1-token Messages request or Models API).
- Exact UI copy beyond the sketch, following existing tokens-only styling.
