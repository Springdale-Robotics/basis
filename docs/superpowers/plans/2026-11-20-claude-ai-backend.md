# Claude API AI Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One box-wide "Where AI runs" switch (This server / Claude API) so photo import, receipt structuring and recipe text parsing can run on the newest Claude Haiku with a key entered in Settings → AI Models.

**Architecture:** A small `modules/llm/claude/` package owns the setting, the encrypted key, model resolution and one `claudeComplete()` call helper whose errors carry user-facing messages. The three AI jobs each branch on `getAiBackend()`; the existing provider seams (`VisionProvider`, `LLMProvider`, `structureReceipt`) are kept. Admin routes under `/api/v1/llm` and a new top card on `AiModelsSettingsPage` drive it.

**Tech Stack:** Fastify, Drizzle (`system_settings`), Zod, `@anthropic-ai/sdk` 0.89 (already installed; sends `anthropic-version: 2023-06-01`), Vitest, React + TanStack Query + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-11-20-claude-ai-backend-design.md`

## Global Constraints

- Settings keys (box-level `system_settings`): `ai.backend` = `"local"` | `"claude"` (absent = legacy); `ai.claudeApiKey` = `{ ciphertext, hint }`; `ai.claudeModel` = `{ id, displayName, resolvedAt }`.
- Tri-state: **absent** = today's behaviour exactly; **local** = nothing leaves the box (no Anthropic, env key ignored, HandwritingOCR skipped even with `IMAGE_PARSE_PROVIDER=handwriting-ocr`); **claude** = Claude only, no local/sidecar/HandwritingOCR fallback.
- Never send `temperature`, `top_p`, `top_k`, `thinking`, an assistant prefill, or a forced `tool_choice` on any Claude call.
- Model = newest `claude-haiku-*` with image input from the Models API; cached 24 h; fallback constant `claude-haiku-5-5`.
- The key never appears in a response body, log line, thrown message or bug report. The browser only ever sees `hint` = `••••` + last 4 characters.
- Key is encrypted with `encrypt`/`decrypt` from `backend/src/lib/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`).
- All new routes: `preHandler: [authMiddleware, requireAdmin()]`.
- Tests never call the real API: mock the SDK client returned by `getClaudeClient()`.
- Frontend colours: theme tokens only (no raw Tailwind colour classes).

## Review Focus

1. **A key pasted with surrounding whitespace or a newline** should be trimmed and work, not fail verification as "rejected". → test in Task 1 (`saveClaudeKey` trims) and Task 6 (PUT route).
2. **A HEIC/PNG/huge phone photo** must reach Claude as a ≤1568 px JPEG (Claude accepts jpeg/png/gif/webp, ≤5 MB); an undecodable image must fail with a clear message, not a raw 400. → test in Task 3.
3. **Many jobs starting at once with a stale model cache** (bulk recipe capture) must cause one Models API call, not one per job. → single-flight test in Task 2.
4. **A long receipt** whose JSON is cut off at `max_tokens` must fail with the "cut off" message rather than a JSON parse error. → test in Task 4.
5. **A key revoked after it was saved** (state `set`, calls 401) must show the "key was rejected" message on photo import, receipts and recipe import. → tests in Tasks 3, 4, 5.

---

### Task 1: AI backend setting + encrypted key store + client

**Files:**
- Create: `backend/src/modules/llm/claude/ai-backend.ts`
- Test: `backend/test/llm/ai-backend.test.ts`

**Interfaces:**
- Produces:
  - `type AiBackend = 'local' | 'claude'`
  - `AI_BACKEND_KEY = 'ai.backend'`, `CLAUDE_API_KEY_KEY = 'ai.claudeApiKey'`
  - `getAiBackend(): Promise<AiBackend | null>` (null = absent/legacy; any other stored value → null)
  - `setAiBackend(backend: AiBackend): Promise<void>` — throws `Errors.validation('Add a Claude API key before choosing Claude.')` when `'claude'` and key state isn't `'set'`
  - `type ClaudeKeyState = 'none' | 'set' | 'unreadable'`
  - `getClaudeKeyStatus(): Promise<{ state: ClaudeKeyState; hint: string | null }>`
  - `getClaudeKey(): Promise<string | null>` (null for none and unreadable)
  - `saveClaudeKey(rawKey: string): Promise<void>` — trims, stores `{ ciphertext: encrypt(key), hint: '••••' + last4 }`
  - `clearClaudeKey(): Promise<void>` — deletes key row; if backend is `'claude'`, sets it to `'local'` (same transaction)
  - `createClaudeClient(apiKey: string): Anthropic` — the one place `new Anthropic({ apiKey, maxRetries: 2 })` is called (tests mock this; Task 6 uses it to verify a candidate key before saving)
  - `getClaudeClient(): Promise<Anthropic | null>` — cached by key via `createClaudeClient`; new instance when key changes
  - `__resetClaudeClientForTests(): void`

- [ ] **Step 1: Write failing tests** (`ai-backend.test.ts`; clear the three `ai.*` keys in `beforeAll`/`afterEach` like `llm-settings.test.ts` does)
  - `getAiBackend()` → `null` with nothing stored; `'local'`/`'claude'` after set; `null` when the row holds `'banana'`.
  - `setAiBackend('claude')` rejects with no key; succeeds after `saveClaudeKey('sk-ant-test-1234')`.
  - `saveClaudeKey('  sk-ant-test-1234\n')` → `getClaudeKey()` === `'sk-ant-test-1234'`; status `{ state: 'set', hint: '••••1234' }`.
  - Stored row's `value` JSON does not contain the substring `sk-ant-test-1234`.
  - Corrupt ciphertext row → status `{ state: 'unreadable', hint: '••••1234' }`, `getClaudeKey()` → null, and `getAiBackend()` still `'claude'` if it was.
  - `clearClaudeKey()` while `'claude'` → backend `'local'`, state `'none'`; while `'local'` → stays `'local'`; while absent → stays absent.
  - `getClaudeClient()` returns the same instance twice; a new instance after `saveClaudeKey` with a different key; `null` with no key.

- [ ] **Step 2: Run** `cd backend && npx vitest run test/llm/ai-backend.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `ai-backend.ts`.** Read/write `systemSettings` the same way `llm-settings.ts` does (insert … onConflictDoUpdate). `decrypt` failure (throws) → `'unreadable'`.

- [ ] **Step 4: Run the test** — Expected: PASS.

- [ ] **Step 5: Commit** `feat(llm): AI backend setting and encrypted Claude key store`

---

### Task 2: Newest-Haiku model resolution

**Files:**
- Create: `backend/src/modules/llm/claude/claude-model.ts`
- Test: `backend/test/llm/claude-model.test.ts`

**Interfaces:**
- Consumes: `getClaudeClient()` (Task 1)
- Produces:
  - `FALLBACK_CLAUDE_MODEL = { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5' }`
  - `CLAUDE_MODEL_KEY = 'ai.claudeModel'`
  - `interface ResolvedClaudeModel { id: string; displayName: string; resolvedAt: string | null }`
  - `pickNewestHaiku(models: Anthropic.ModelInfo[]): Anthropic.ModelInfo | null` — pure: `id.startsWith('claude-haiku-')`, and `capabilities?.image_input?.supported !== false` (null capabilities = eligible), max `created_at`
  - `getClaudeModel(opts?: { force?: boolean }): Promise<ResolvedClaudeModel>` — stored value if `resolvedAt` < 24 h old and not `force`; otherwise list (iterate the auto-paginating `client.models.list()`), pick, store, return. List failure → stored value, else fallback (`resolvedAt: null`). Concurrent callers share one in-flight promise.

- [ ] **Step 1: Write failing tests**
  - `pickNewestHaiku`: picks `claude-haiku-6` (created 2027) over `claude-haiku-5-5` (2026); ignores `claude-sonnet-5-5` even if newer; skips a haiku with `image_input.supported: false`; returns null for `[]`.
  - `getClaudeModel()` with a mocked client listing two haikus → returns the newer, and stores it.
  - Second call within 24 h does not call `models.list` again; with stored `resolvedAt` 25 h ago it does; `force: true` always does.
  - `models.list` rejects + stored value → stored value; rejects + nothing stored → `FALLBACK_CLAUDE_MODEL` with `resolvedAt: null`.
  - **Review Focus 3:** five concurrent `getClaudeModel()` calls with a stale cache → `models.list` called once.

- [ ] **Step 2: Run** `npx vitest run test/llm/claude-model.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `claude-model.ts`.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(llm): resolve the newest Claude Haiku from the Models API`

---

### Task 3: `claudeComplete()` helper, error mapping, and the Claude vision provider

**Files:**
- Create: `backend/src/modules/llm/claude/claude-call.ts`
- Create: `backend/src/modules/image-parse/ai-providers/claude-vision.ts`
- Modify: `backend/src/modules/image-parse/ai-providers/ollama-vision.ts` (export `downscaleForInference(buf, maxEdgePx = 1024, { alwaysReencode = false })`, `DEFAULT_TRANSCRIPTION_PROMPT`)
- Modify: `backend/src/modules/image-parse/ai-providers/index.ts` (factory gating + status branches)
- Test: `backend/test/llm/claude-call.test.ts`, `backend/test/image-parse/ai-providers/claude-vision.test.ts`, extend `backend/test/image-parse/ai-providers/factory.test.ts` and `provider-status.test.ts`

**Interfaces:**
- Consumes: `getClaudeClient`, `getClaudeKeyStatus` (Task 1); `getClaudeModel` (Task 2)
- Produces:
  - `type ClaudeErrorKind = 'no_key' | 'key_unreadable' | 'auth' | 'rate_limit' | 'network' | 'refusal' | 'truncated' | 'api'`
  - `class ClaudeError extends Error { kind: ClaudeErrorKind }` — `message` IS the user-facing text (both services already surface `error.message`)
  - `CLAUDE_ERROR_MESSAGES: Record<ClaudeErrorKind, string>` (exact copy below; `api` is a prefix)
  - `claudeComplete(input: { system?: string; content: string | Anthropic.ContentBlockParam[]; maxTokens: number }): Promise<string>`
  - `class ClaudeVisionProvider implements VisionProvider` with `name = 'claude'`

Exact copy:
```ts
no_key:         'No Claude API key is saved. Add one in Settings → AI Models.',
key_unreadable: "The saved Claude API key can't be read — please re-enter it in Settings → AI Models.",
auth:           'The Claude API key was rejected — replace it in Settings → AI Models.',
rate_limit:     'Claude is busy right now. Try again in a minute.',
network:        "Can't reach Anthropic right now. Check this server's internet connection and try again.",
refusal:        'Claude declined to read this.',
truncated:      "Claude's answer was cut off because the input was too long.",
api:            'Claude returned an error', // + ` (HTTP ${status}).`
```

`claudeComplete` behaviour: key state `none`/`unreadable` → throw `no_key`/`key_unreadable`. Request = `{ model: (await getClaudeModel()).id, max_tokens, system?, messages: [{ role: 'user', content }] }` — nothing else. `AuthenticationError`/`PermissionDeniedError` → `auth`; `RateLimitError` → `rate_limit`; `APIConnectionError` → `network`; `NotFoundError` whose message mentions the model id → `getClaudeModel({ force: true })` and retry once, then `api`; other `APIError` → `api` with status. `stop_reason === 'refusal'` → `refusal`; `'max_tokens'` → `truncated`. Return the joined `text` blocks. Never put the key or raw SDK error text containing headers into the message; log `{ kind, status }` only.

Vision provider: `isAvailable()` = key state `'set'`; `getModel()` = last resolved id (fallback id before first call); `isLightweightModel()` = false; `parseImage(buf, _mime, prompt)` → `downscaleForInference(buf, 1568, { alwaysReencode: true })` (always JPEG so HEIC/PNG/huge files are safe; if sharp can't decode, throw `new Error("This photo couldn't be read. Try a JPEG or PNG.")` rather than sending the original), then `claudeComplete({ maxTokens: 4096, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }, { type: 'text', text: prompt.trim() || DEFAULT_TRANSCRIPTION_PROMPT }] })` → `{ rawText, processingTimeMs }` (no `structured`).

Factory (`getVisionProvider`): read `getAiBackend()` first. `'claude'` → `ClaudeVisionProvider` if key state is `set`, else **still return it** so the job fails with the mapped no-key/unreadable message rather than "AI service unavailable". `'local'` → skip the HandwritingOCR block entirely (also when `IMAGE_PARSE_PROVIDER === 'handwriting-ocr'`, which then returns null), then sidecar/Ollama as today. `null` → unchanged. `getVisionProviderStatus()`: Claude branch `{ available: keyState === 'set', name: 'claude', model, expectedProcessingMs: 15000, error: keyState === 'set' ? undefined : <mapped message> }`. `getAllProvidersStatus()`: when backend is `'claude'`, primary = that status, fallback = null, activeProvider = `'claude'` or null; when `'local'`, omit HandwritingOCR.

- [ ] **Step 1: Write failing tests**
  - `claude-call.test.ts` (mock `getClaudeClient` to return `{ messages: { create }, models: { list } }`):
    - request body keys are exactly `model, max_tokens, messages` (+ `system` when given) — asserts no `temperature`/`top_p`/`top_k`/`thinking`.
    - each SDK error class maps to its kind and exact message; message never contains the key string.
    - `NotFoundError` mentioning the model → second `create` uses the re-resolved id; second failure → `api`.
    - `stop_reason: 'refusal'` → `refusal`; `'max_tokens'` → `truncated`.
    - key state `none` → `no_key`, `unreadable` → `key_unreadable`, and `create` not called.
  - `claude-vision.test.ts`:
    - a 4000×3000 PNG fixture reaches `create` as `media_type: 'image/jpeg'` with long edge ≤ 1568 (decode the sent base64 with sharp).
    - **Review Focus 2:** an undecodable buffer → rejects with `"This photo couldn't be read. Try a JPEG or PNG."`, `create` not called.
    - empty prompt → text block equals `DEFAULT_TRANSCRIPTION_PROMPT`.
    - **Review Focus 5:** `create` throws `AuthenticationError` → rejects with the `auth` message.
  - `factory.test.ts` matrix (stub `fetch` for Ollama/sidecar/HandwritingOCR and record every URL hit):
    - backend `local` + `HANDWRITING_OCR_API_KEY` set → no request to the HandwritingOCR host; returns Ollama provider when reachable.
    - backend `local` + `IMAGE_PARSE_PROVIDER='handwriting-ocr'` → null.
    - backend `claude` (key set) → `ClaudeVisionProvider`, and zero `fetch` calls to Ollama/sidecar/HandwritingOCR.
    - backend `claude` (no key) → `ClaudeVisionProvider` whose `parseImage` rejects with `no_key` message.
    - backend absent → existing behaviour unchanged (existing tests still pass).
  - `provider-status.test.ts`: claude branch fields as above; `local` omits handwriting-ocr.

- [ ] **Step 2: Run** `npx vitest run test/llm/claude-call.test.ts test/image-parse/ai-providers` — Expected: FAIL.
- [ ] **Step 3: Implement** `claude-call.ts`, `claude-vision.ts`, the `ollama-vision.ts` exports, and the `index.ts` gating.
- [ ] **Step 4: Run** the same command plus `npx vitest run test/image-parse test/llm` — Expected: PASS (including pre-existing tests, e.g. `ollama-downscale.test.ts`).
- [ ] **Step 5: Commit** `feat(image-parse): Claude vision provider behind the AI backend switch`

---

### Task 4: Receipt structuring on Claude

**Files:**
- Modify: `backend/src/modules/receipts/receipt-structurer.ts`
- Test: `backend/test/receipts/receipt-structurer.test.ts`

**Interfaces:**
- Consumes: `getAiBackend`, `getClaudeKeyStatus` (Task 1); `claudeComplete`, `ClaudeError` (Task 3)
- Produces: unchanged exports `structureReceipt(rawText)`, `isStructurerAvailable()`

Behaviour: `isStructurerAvailable()` → backend `'claude'`: key state `'set'`; otherwise the existing Ollama check. `structureReceipt()` → backend `'claude'`: `parseStructuredResponse(await claudeComplete({ content: PROMPT + rawText, maxTokens: 8192 }))`; otherwise unchanged. The existing `receipts.service.ts` catch already passes `error.message` to `safeFailScan`.

- [ ] **Step 1: Write failing tests**
  - backend `claude`: `structureReceipt('MILK 3.50')` sends one `create` whose user text starts with the existing `PROMPT` and ends with `MILK 3.50`; returns parsed lines from a mocked `{"lines":[{"raw_text":"MILK"}]}` reply; no `fetch` to Ollama.
  - backend `claude`, key none → `isStructurerAvailable()` false; key set → true without touching `fetch`.
  - **Review Focus 4:** `stop_reason: 'max_tokens'` → rejects with the `truncated` message (not a JSON error).
  - **Review Focus 5:** `AuthenticationError` → rejects with the `auth` message.
  - backend `local`/absent: existing tests unchanged.
- [ ] **Step 2: Run** `npx vitest run test/receipts/receipt-structurer.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the branch.
- [ ] **Step 4: Run** `npx vitest run test/receipts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(receipts): structure receipt lines with Claude when selected`

---

### Task 5: Recipe text parsing — tri-state provider and visible failures

**Files:**
- Modify: `backend/src/services/llm-provider.ts`
- Modify: `backend/src/services/llm-recipe-parser.ts`
- Modify: `backend/src/modules/recipes/recipe-import.service.ts` (~878, ~972)
- Modify: `backend/src/modules/recipes/recipes.routes.ts` (~1327 status, ~1608 reparse-llm)
- Test: `backend/test/recipes/llm-fallback.test.ts` (new), plus any existing test calling `getLLMProvider`/`parseRecipeWithLLM`

**Interfaces:**
- Consumes: `getAiBackend` (Task 1); `claudeComplete`, `ClaudeError` (Task 3)
- Produces:
  - `getLLMProvider(): Promise<LLMProvider | null>` (now async). `'claude'` → `ClaudeTextProvider` (always returned, so missing-key errors surface); `'local'` → Ollama if configured else null (env Anthropic key ignored); `null` → existing order (env `AnthropicProvider` then Ollama).
  - `ClaudeTextProvider { name = 'claude'; isAvailable(): boolean /* true */; complete(prompt, { systemPrompt, maxTokens }) }` via `claudeComplete`.
  - `LLMOptions` loses `temperature`; `AnthropicProvider` stops sending it (Ollama keeps its own `options.temperature`).
  - `type LLMParseOutcome = { ok: true; recipe: LLMParsedRecipe } | { ok: false; reason: 'unavailable' | 'unparseable' } | { ok: false; reason: 'provider_error'; userMessage: string }`
  - `parseRecipeWithLLM(text): Promise<LLMParseOutcome>` — `provider_error` only when the thrown error is a `ClaudeError`; anything else stays `unparseable` (today's silent behaviour for Ollama).
  - `llmFailureWarning(userMessage: string): string` → `` `Claude couldn't help with this recipe: ${userMessage} Used basic parsing instead.` ``

Call sites: both fallbacks append `llmFailureWarning(outcome.userMessage)` to `warnings` on `provider_error` and keep the heuristic result; reparse-llm throws `Errors.validation(outcome.userMessage)` on `provider_error`, keeps its current message otherwise; the status route awaits `getLLMProvider()`.

- [ ] **Step 1: Write failing tests** (`llm-fallback.test.ts`)
  - backend `claude` + mocked `create` → AuthenticationError: a low-confidence text import completes with the heuristic recipe and a warning equal to `llmFailureWarning(CLAUDE_ERROR_MESSAGES.auth)` (**Review Focus 5**). Same for the URL path with `pageText`.
  - backend `claude` + reparse-llm route with a 429 → 400 whose message is the `rate_limit` text.
  - backend `local` + env `ANTHROPIC_API_KEY` set → `getLLMProvider()` is the Ollama provider (or null), never Anthropic.
  - backend absent + env key → `AnthropicProvider` (legacy), and its `create` call has no `temperature`.
  - backend `claude` → `ClaudeTextProvider`; its request has no sampling params.
- [ ] **Step 2: Run** `npx vitest run test/recipes/llm-fallback.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the provider, parser contract and the three call sites; update the status route.
- [ ] **Step 4: Run** `npx vitest run test/recipes && npm run typecheck` — Expected: PASS, no type errors (every caller of the now-async `getLLMProvider` updated).
- [ ] **Step 5: Commit** `feat(recipes): Claude text parsing with visible failure warnings`

---

### Task 6: Admin API routes + log redaction

**Files:**
- Modify: `backend/src/modules/llm/llm.routes.ts`
- Modify: `backend/src/lib/logger.ts` (redact paths)
- Test: `backend/test/llm/llm.routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3
- Produces (all `authMiddleware + requireAdmin()`; response envelope `{ success: true, data }` like the existing routes):
  - `type BackendState = { backend: AiBackend | null; keyState: ClaudeKeyState; keyHint: string | null; model: { id: string; displayName: string } | null }` — `model` null unless key state is `'set'`
  - `GET /backend` → `BackendState`
  - `PUT /backend` body `{ backend: 'local' | 'claude' }` → `BackendState`; 400 when claude without a usable key
  - `PUT /claude-key` body `{ key: string }` (Zod: trimmed, 20–300 chars) → verify with `createClaudeClient(candidate).models.list()` (first page is enough; the key is not saved yet); on failure 400 with the mapped `ClaudeError` message; on success `saveClaudeKey`, `getClaudeModel({ force: true })`, return `BackendState`
  - `DELETE /claude-key` → `clearClaudeKey()`; return `BackendState`
  - `GET /status` adds `backend: AiBackend | null`
  - Logger redact adds `'key'`, `'*.key'`, `'apiKey'`, `'*.apiKey'`, `'req.body.key'`

- [ ] **Step 1: Write failing tests**
  - member (non-admin) → 403 on all four new routes.
  - `PUT /claude-key` with `'  sk-ant-valid-1234 \n'` and a mocked successful list → 200, `keyState: 'set'`, `keyHint: '••••1234'` (**Review Focus 1**); response JSON string does not contain `sk-ant-valid-1234`.
  - `PUT /claude-key` with a mocked AuthenticationError → 400 with the `auth` message; nothing stored.
  - `PUT /backend { backend: 'claude' }` with no key → 400; after a key → 200 `backend: 'claude'`.
  - `DELETE /claude-key` while claude → `backend: 'local'`, `keyState: 'none'`.
  - `GET /backend` with an unreadable stored key → `keyState: 'unreadable'`, `model: null`.
  - Logging a `{ key: 'sk-ant-x' }` object through `logger` → output lacks `sk-ant-x` (capture with a pino destination stream).
- [ ] **Step 2: Run** `npx vitest run test/llm/llm.routes.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** routes + redact paths.
- [ ] **Step 4: Run** `npx vitest run test/llm` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(llm): admin routes for the AI backend switch and Claude key`

---

### Task 7: "Where AI runs" card on the AI Models page

**Files:**
- Modify: `frontend/src/api/llm.ts` (types + `getBackend`, `setBackend`, `saveClaudeKey`, `removeClaudeKey`; `LlmStatus.backend`)
- Create: `frontend/src/pages/settings/AiBackendCard.tsx`
- Modify: `frontend/src/pages/settings/AiModelsSettingsPage.tsx`

**Interfaces:**
- Consumes: Task 6 routes and `BackendState`
- Produces: `<AiBackendCard />` (self-contained: own queries/mutations, invalidates `['llm']` query keys on change)

Copy and layout (exact):
```
Where AI runs
( ) This server (Ollama) — nothing leaves this box
( ) Claude API (Anthropic) — photos, receipt text and recipe text are sent to Anthropic to be read
    API key  [ ••••abcd ]  [Replace] [Remove]
    Uses {model.displayName} (newest Haiku). Typical cost: under $1/month.
```
- Neither radio checked when `backend` is null; helper text under the group: "Not chosen yet — Basis is using its default setup."
- Choosing Claude with `keyState !== 'set'` reveals a password input + **Save key** button; the radio only commits after `PUT /claude-key` succeeds, then `PUT /backend`. Errors show inline (the API message verbatim).
- `keyState === 'unreadable'` → inline notice "The saved key can't be read — please re-enter it." with the input open.
- Remove → `ConfirmDialog` from `frontend/src/components/shared/ConfirmDialog.tsx` ("Remove the Claude API key? AI features will switch to This server.").
- In `AiModelsSettingsPage`: render the card first. When `status.backend === 'claude'`, render the existing model cards with a muted "Not in use while Claude is selected" line, and do not render `DriverBlockerCard` / `OllamaBlockerCard`.

- [ ] **Step 1: Implement** API client additions and `AiBackendCard.tsx`; wire into the page.
- [ ] **Step 2: Run** `cd frontend && npm run lint && npx tsc --noEmit` — Expected: no errors.
- [ ] **Step 3: Verify in the running app** (`./dev.sh start`, Playwright against http://localhost:5173 as an admin, backend's `getClaudeClient` pointed at nothing real): page shows the card with neither radio checked; choosing Claude opens the key field; a fake key shows the inline "rejected" message; switching back to This server works; non-admin can't see the page. Screenshot each state.
- [ ] **Step 4: Commit** `feat(settings): Where AI runs card with Claude API key`

---

### Task 8: Full verification

- [ ] **Step 1:** `cd backend && npm run lint && npm run typecheck && npx vitest run` — Expected: all pass. (Known flake: receipts reprocess test on a stale dev Redis — re-run once before investigating.)
- [ ] **Step 2:** `cd frontend && npm run lint && npx tsc --noEmit` — Expected: pass.
- [ ] **Step 3:** `grep -rn "temperature" backend/src/modules/llm/claude backend/src/modules/image-parse/ai-providers/claude-vision.ts` — Expected: no matches.
- [ ] **Step 4:** Commit any fixes; leave the branch unpushed for owner review.
