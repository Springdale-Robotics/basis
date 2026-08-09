# GUI-Driven LLM Setup

**Date:** 2026-08-09
**Status:** Design approved, not implemented
**Branch:** `llm-setup-gui`, stacked on `receipt-ocr-import` (PR #64)

## Problem

Two features depend on a local LLM and neither works on a fresh box without a
shell. Receipt import needs a text model to structure OCR output into line items;
image-parse needs a vision model. Both read a hardcoded model name from an
environment variable, and getting a model onto the machine is entirely manual:
install a GPU driver, install Ollama, pull a model, edit `.env`, restart.

The production box demonstrates every failure this causes. It has an RTX 3050
8 GB that arrived after the install, still bound to `nouveau`. No proprietary
driver, no CUDA, no Ollama. Both AI features are inert, and nothing in the product
says why.

The goal is that an administrator can see what hardware they have, understand
which models will work well on it, and install and select one — from the UI.

## Prior art in the repo

- **`scripts/install.sh`** — 173 lines, describes itself as "the ONE elevated step
  for a Basis deployment", idempotent, with a `--systemd` opt-in flag. It
  deliberately does not install base dependencies today.
- **`installer-commands.ts` + `install.ws.ts`** — a registry of privileged
  installers (cloudflared, frpc, tailscale) executed in a real PTY streamed to the
  browser over a socket.io namespace, with the user typing their sudo password in.
  `RemoteAccessSettingsPage.tsx` embeds that terminal.
- **`GET /install/host-info`** — admin-only platform/arch/distro reporting.
- **`frontend/src/pages/settings/`** — one page per concern.

The privileged-operation-from-the-GUI problem is already solved here. This feature
reuses that rather than inventing a second path.

## Decisions

| Decision | Choice |
|---|---|
| Install scope | GUI installs Ollama and models; detects and advises on the GPU driver |
| `scripts/install.sh` | Auto-installs driver + Ollama when a supported GPU is detected |
| Model slots | Per-purpose: one text model, one vision model |
| Persistence | Box-level settings table, read per call, env var as fallback default |
| Catalog | Curated in-repo, plus an any-tag escape hatch |
| Orchestration | Split by privilege: PTY for sudo work, HTTP + websocket for model pulls |

### Why split by privilege

`ollama pull` needs no root — Ollama's HTTP API streams pull progress as JSON.
Only installing Ollama itself needs sudo. These are different operations: one is a
privileged one-time system change where a terminal is the honest interface; the
other is a multi-gigabyte download that wants a progress bar, a cancel, and a
retry. Forcing the pull through a PTY means screen-scraping terminal output for
progress, and the download dies with the socket.

### Why the driver is advisory in the GUI

Installing a GPU driver requires swapping out `nouveau` and rebooting — the very
box serving the UI. On a headless machine reached through a tunnel, a failed
driver install is the hardest kind of failure to recover from, and the UI cannot
report what happened because it went down with the box. During *initial* install a
reboot is expected and cheap, which is why `install.sh` does it and the GUI does
not.

## Architecture

New module `backend/src/modules/llm/`, owning detection, catalog, and model
management. It reuses `install`'s PTY for the one privileged step rather than
absorbing it, so `install` keeps its single responsibility.

### Hardware detection — `llm-hardware.ts`

| Signal | Source | Why |
|---|---|---|
| GPU present + name | `nvidia-smi`, falling back to `lspci` | `lspci` sees the card with no driver — that is how "no GPU" is distinguished from "GPU, no driver", which are completely different user situations |
| VRAM total/free | `nvidia-smi --query-gpu=memory.total,memory.free` | The number that decides which models fit |
| Driver state | `nvidia-smi` present? which kernel module is bound? | `nouveau` bound means the card is useless for inference |
| System RAM | `os.totalmem()` / `MemAvailable` | The fallback budget when there is no usable GPU |
| CPU cores + AVX2 | `os.cpus()`, `/proc/cpuinfo` | Only affects CPU inference speed estimates |

Results are cached ~60s; the settings page polls, and every signal shells out.
Every shell-out is bounded by a timeout.

### Box-level settings

New table `system_settings`: `key` (PK), `value` jsonb, `updatedAt`. Verified no
such table exists today. **No `householdId`** — an installed model is a property
of the machine, not of a tenant. This is deliberately outside the tenancy model
and therefore needs no RLS policy; it does need a note in
`docs/product-review-2026-07/RLS-PLAN.md`'s list of intentionally app-level-only
tables, alongside the existing cloud/ops entries. Keys: `llm.textModel`,
`llm.visionModel`.

Migration `0012_system_settings.sql`, hand-authored with journal entry and
snapshot — `drizzle-kit generate` is broken in this repo on ESM specifiers.

Reads go through an accessor that falls back to `config.OLLAMA_LLM_MODEL` /
`config.OLLAMA_VLM_MODEL` when unset, so an untouched install behaves exactly as
it does today and the env vars keep working as defaults.

`receipt-structurer.ts` currently reads `config.OLLAMA_LLM_MODEL` directly; it
changes to the accessor. That adds one database read per scan, negligible against
a multi-second inference, and it is what makes "no restart" true.

### Catalog and fit — `llm-catalog.ts`

```ts
interface CatalogModel {
  tag: string;            // exact ollama pull tag
  role: 'text' | 'vision';
  label: string;
  downloadBytes: number;  // for the progress bar's ETA
  vramMb: number;         // resident at the tag's default quant
  notes: string;          // what it is actually good at
  default?: boolean;      // per-role pick when hardware allows
}
```

Starting entries — **text**: `qwen2.5:7b` (default), `qwen2.5:3b`,
`qwen2.5:1.5b`, `llama3.2:3b`. **Vision**: `qwen2.5vl:7b`, `qwen3-vl:8b`,
`llava:7b` (today's default, kept for continuity), `moondream` for sub-4 GB cards.

Fit is computed, never stored. Four verdicts:

- **Recommended** — fits VRAM with ~15% headroom and is the role default
- **Fits** — runs on the GPU
- **CPU only** — will not fit VRAM but fits available RAM; shown with a blunt
  speed warning, since a 7B model on CPU is minutes per receipt, not seconds
- **Too large** — exceeds both

The RAM budget uses `MemAvailable` minus a reserve for Postgres, Redis and the
app — not total RAM. On a 7 GB box that is the difference between "plenty free"
and a model that OOMs the application it serves.

**Combined footprint is computed jointly.** On an 8 GB card, `qwen2.5:7b`
(~4.7 GB) and `qwen2.5vl:7b` (~6 GB) each fit alone but not together. Ollama
unloads after its keep-alive, so they swap — correct, but it costs roughly ten
seconds on first use after idle. The UI states this rather than letting it be
discovered as mysterious latency.

**Accepted cost:** the catalog is a maintenance burden and will drift. `llava:7b`
being the current default while `qwen3-vl` is now stronger at OCR is that drift
already happening. The escape-hatch field is what keeps it from being a cage
between releases.

### API

All routes admin-only, matching `install`'s gating of host internals.

```
GET    /api/v1/llm/hardware      detected GPU/VRAM/RAM/driver state
GET    /api/v1/llm/catalog       catalog + computed fit verdict per entry
GET    /api/v1/llm/status        Ollama reachable? installed tags? current selections
POST   /api/v1/llm/models/pull   { tag } → starts a pull
DELETE /api/v1/llm/models/:tag   remove a model, reclaim disk
PUT    /api/v1/llm/settings      { textModel?, visionModel? }
```

`POST /api/pull` on Ollama returns NDJSON — `{status, digest, total, completed}`.
The backend consumes that and relays progress over a `/llm` socket.io namespace,
mirroring `/install`. No BullMQ: a pull is box-local and singleton-ish, and gains
nothing from a persistent queue.

Refresh survival comes from a property of Ollama rather than our bookkeeping:
**pulls are resumable because Ollama caches blobs on disk.** If the stream is
lost, re-issuing the pull resumes from what was already fetched. The client
re-subscribes on reconnect and, worst case, re-issues.

Two guards, both preventing silent failures:

- **`PUT /llm/settings` validates the tag is installed** by checking `/api/tags`
  first. Otherwise a selection can name a model that is not on disk, and the
  failure surfaces much later as every scan failing, far from its cause.
- **Disk is checked before a pull**, against the catalog's `downloadBytes`. A 5 GB
  pull that dies at 90% on a full disk is a miserable way to learn this.

### `scripts/install.sh`

Gains a GPU step, keeping the file's contract: idempotent, loud, one elevated
session.

1. Detect an NVIDIA card with `lspci` — works with no driver present.
2. If a card is found and `nvidia-smi` is missing or `nouveau` is bound, install
   the distro-recommended driver via `ubuntu-drivers`. On non-Ubuntu, report and
   skip rather than guessing package names.
3. Install Ollama, enable the service.
4. Print a summary: card, driver state, whether a reboot is needed, next step.

Two behaviours held to, given this now runs by default:

- **`--no-gpu` opts out entirely.** Someone installing on a machine they do not
  want a 600 MB driver on needs an exit.
- **It never reboots.** It reports that a reboot is required and stops. A script
  that reboots the machine it is running on, over SSH, without asking is a bad
  neighbour, and this script's design is "one sudo session, then get out of the
  way."

**To verify during implementation, not assumed here:** Ollama's installer probes
for CUDA at install time to decide which libraries to fetch. If it runs before the
driver is active — pre-reboot — it may configure itself CPU-only. Ollama does
detect GPUs at runtime when the server starts, so a post-reboot service restart
likely resolves it, but this must be confirmed rather than assumed.

### The retrofit path

A first-run script cannot help a box that is already running — which is exactly
the production case, where the GPU arrived after installation. So the GUI keeps
its own route:

- **Driver missing** → the settings page detects "card present, no usable driver"
  and shows the exact commands plus the reboot warning. Advisory only.
- **Ollama missing** → a new `ollama` entry in the guided-install registry, run
  through the existing PTY. No new privileged machinery.

`install.sh` handles greenfield; the GUI handles retrofit.

## Frontend

New `AiModelsSettingsPage.tsx` at `/settings/ai-models` — "AI models", not "LLM",
because this is a household app.

It reads as a diagnosis, then a decision:

1. **Hardware** — a plain summary of what was detected. This is what makes the
   rest of the page trustworthy; if the numbers are wrong, the user knows not to
   believe the recommendations.
2. **Blockers, when present**, resolved in order because they nest: driver missing
   (callout with exact commands and reboot warning, advisory), then Ollama not
   reachable (Install button opening the PTY terminal, reusing Remote Access's
   component). Neither blocker hides the rest of the page — you can still see what
   you would get once it is sorted.
3. **Two role sections** — "Receipt & text understanding" and "Image
   understanding". Each lists catalog models with a fit badge, the one-line note,
   size, and an action: Install, Select, or Remove. Selecting an uninstalled model
   installs it first.
4. **Combined footprint** below both sections, stating the swap consequence in
   plain words.
5. **Advanced**, collapsed — a text field accepting any Ollama tag, with a plain
   warning that fit cannot be predicted outside the catalog.

Pull progress is a progress bar with bytes and a cancel, driven by the `/llm`
socket namespace — not a terminal, since none of it needs root.

## Error handling

| Situation | Behaviour |
|---|---|
| `nvidia-smi` absent but `lspci` shows a card | Not an error — the "driver missing" state, reported as such |
| No GPU at all | Catalog computes against RAM; small models are CPU-only with a speed warning, large ones Too large. The page still works |
| Ollama unreachable | `GET /llm/status` returns `reachable: false` with the reason; the page shows the install action rather than spinning |
| Pull fails mid-download | Ollama's error text surfaced verbatim — disk-full and network-refused need different responses. Partial blobs remain, so retry resumes |
| Pull cancelled | Abort the stream; partial blobs remain and count toward a later retry |
| Selected model deleted from disk | `GET /llm/status` flags the selection as missing and offers to re-pull or choose another. Without this, deleting the active model turns every scan into a failure with no visible cause |
| Detection command hangs | Every shell-out is timeout-bounded — the receipts feature learned this with `isOcrAvailable` |

## Testing

Backend gets real coverage. The frontend workspace has no test infrastructure, so
verification there is typecheck, lint, and a Playwright walkthrough, as with every
other page in this repo.

- **Fit calculation is the unit-test core** — a pure function, hardware profile in,
  verdict out. Table-driven: GPU with room, GPU too small, no driver, no GPU,
  RAM-constrained, and combined-footprint-exceeds-VRAM. This is the logic users
  trust, and it is cheap to test properly.
- **Detection parsers** get fixture-based tests using real `nvidia-smi`, `lspci`
  and `/proc/meminfo` output captured from a GPU box and a no-GPU machine. Tests
  never invoke the real commands.
- **Routes**: admin-only enforcement on all six; `PUT /settings` rejecting an
  uninstalled tag; the disk pre-check refusing a pull that will not fit.
- **The settings accessor**: falls back to env when unset, prefers the stored value
  when set. Two tests, and they are what guarantee an untouched install behaves
  exactly as it does today.
- **Ollama is mocked throughout.** No test pulls a multi-gigabyte model.

**Deliberately not tested:** the `install.sh` GPU step, beyond a shellcheck pass.
It installs kernel drivers and reboots machines; a meaningful test needs a
disposable VM with a real GPU, a CI capability this repo does not have and should
not grow for this. Better to state that than to write a test that only proves the
script parses.

## Out of scope

- Installing the GPU driver from the GUI on a running box (advisory only, by
  design)
- Non-NVIDIA acceleration (ROCm, Intel) — detection reports "no usable GPU" and
  falls back to RAM-based fit
- Remote Ollama instances — `OLLAMA_HOST` remains env-configured, and pointing it
  off-box stays a manual choice
- Per-household model selection — the model is a property of the machine
- Fine-tuning, quantisation selection, or per-model parameter tuning
