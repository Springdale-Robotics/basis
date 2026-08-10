# GUI-Driven LLM Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator see their hardware, understand which AI models suit it, and install and select one — from the settings UI instead of a shell.

**Architecture:** A new `llm` backend module owns hardware detection, a curated model catalog with computed fit verdicts, and Ollama model management. Work is split by privilege boundary: installing Ollama reuses the existing guided-install PTY (sudo, terminal in the browser), while model pulls go over Ollama's HTTP API with progress relayed on a socket.io namespace, because `ollama pull` needs no root. Model selections live in a new box-level settings table read per call, with the existing env vars as fallback defaults.

**Tech Stack:** Fastify + TypeScript, Drizzle ORM (PostgreSQL), socket.io, Ollama HTTP API, React + Vite, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-09-llm-setup-gui-design.md`

## Global Constraints

- **This branch is stacked on `receipt-ocr-import` (PR #64), not on `main`.** The text-model consumer `receipt-structurer.ts` only exists there. #64 must land first.
- All `/api/v1/llm/*` routes are **admin-only** (`requireAdmin()`), matching how `install` gates host internals.
- `system_settings` is **deliberately not household-scoped** — an installed model is a property of the machine. It needs no RLS policy, but it MUST be added to the intentionally-app-level-only list in `docs/product-review-2026-07/RLS-PLAN.md`.
- `drizzle-kit generate` is broken in this repo (ESM `.js` specifiers). Hand-author the migration, the `meta/_journal.json` entry, and the snapshot (copy `0011_snapshot.json`, update `id`/`prevId`, add the table).
- Backend imports use explicit `.js` extensions. Frontend imports do not. Both workspaces use `@/*` → `./src/*`.
- **Every shell-out is timeout-bounded.** The receipts feature learned this the hard way with `isOcrAvailable`.
- **Ollama is mocked in all tests.** No test pulls a multi-gigabyte model or invokes `nvidia-smi` for real.
- The **frontend workspace has no test infrastructure** (no vitest, no testing-library). Do not add any. Verification there is `npx tsc -b --force` and `npm run lint`, plus a Playwright walkthrough.
- Run backend tests in the **foreground**. Skip the full backend suite on small tasks; it runs at the branch level.
- Stage files explicitly rather than `git add -A` — plan amendments get committed between tasks.

## File Structure

**Backend — created:**

| File | Responsibility |
|---|---|
| `src/db/schema/system-settings.ts` | The `system_settings` table and its types |
| `drizzle/0012_system_settings.sql` | Migration (+ journal entry + snapshot) |
| `src/modules/llm/llm-hardware.ts` | Hardware detection and the parsers for each command's output |
| `src/modules/llm/llm-catalog.ts` | Catalog data and the pure fit calculation |
| `src/modules/llm/llm-settings.ts` | Settings accessor with env fallback |
| `src/modules/llm/ollama-client.ts` | Ollama HTTP: list tags, pull (streaming), delete |
| `src/modules/llm/llm.routes.ts` | The six HTTP routes |
| `src/modules/llm/llm.ws.ts` | `/llm` socket.io namespace for pull progress |

**Backend — modified:** `src/db/schema/index.ts`, `src/app.ts`, the websocket registration, `src/modules/install/installer-commands.ts`, `src/modules/receipts/receipt-structurer.ts`, `src/modules/image-parse/ai-providers/ollama-vision.ts`, `docs/product-review-2026-07/RLS-PLAN.md`.

**Scripts — modified:** `scripts/install.sh`.

**Frontend — created:** `src/api/llm.ts`, `src/pages/settings/AiModelsSettingsPage.tsx`, `src/components/settings/ModelRoleSection.tsx`.

**Frontend — modified:** `src/App.tsx`, the settings navigation.

## Phases

- **Phase 1 — Foundation (Tasks 1–3):** settings table + accessor, detection, catalog/fit. All pure or near-pure; heavily tested.
- **Phase 2 — Ollama integration (Tasks 4–6):** client, routes, pull progress.
- **Phase 3 — Wiring (Tasks 7–9):** consumers, installer entry, install.sh.
- **Phase 4 — Frontend (Tasks 10–12).**

Phases 1–3 are a working deliverable on their own: model selection would work via API with no UI.

---

### Task 1: `system_settings` table and the settings accessor

**Files:**
- Create: `backend/src/db/schema/system-settings.ts`
- Create: `backend/drizzle/0012_system_settings.sql`, `backend/drizzle/meta/0012_snapshot.json`
- Modify: `backend/drizzle/meta/_journal.json`, `backend/src/db/schema/index.ts`, `docs/product-review-2026-07/RLS-PLAN.md`
- Create: `backend/src/modules/llm/llm-settings.ts`
- Test: `backend/test/llm/llm-settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `systemSettings` table; `getTextModel(): Promise<string>`, `getVisionModel(): Promise<string>`, `setModel(role: 'text' | 'vision', tag: string): Promise<void>`, `TEXT_MODEL_KEY`, `VISION_MODEL_KEY`.

- [ ] **Step 1: Write the schema module**

Create `backend/src/db/schema/system-settings.ts`:

```ts
import { pgTable, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Box-level configuration — deliberately NOT household-scoped. An installed
 * model is a property of the machine: two households on one box cannot each
 * have their own copy of a 5GB model. Because it holds no tenant data it needs
 * no RLS policy; it is listed in RLS-PLAN.md as intentionally app-level-only.
 */
export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;
```

Export it from `backend/src/db/schema/index.ts` alongside the others.

- [ ] **Step 2: Write the migration**

Create `backend/drizzle/0012_system_settings.sql`:

```sql
-- Box-level settings. Not household-scoped and intentionally without an RLS
-- policy: an installed model is a property of the machine, not tenant data.
CREATE TABLE "system_settings" (
  "key" varchar(100) PRIMARY KEY NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
```

Append to `backend/drizzle/meta/_journal.json`'s `entries`:

```json
{
  "idx": 12,
  "version": "7",
  "when": 1786400000000,
  "tag": "0012_system_settings",
  "breakpoints": true
}
```

Copy `meta/0011_snapshot.json` to `meta/0012_snapshot.json`; set `id` to `0a1b2c3d-0012-4012-8012-000000000012`, `prevId` to `0011`'s id, and add the `public.system_settings` table entry matching the SQL above. Model its shape on a comparable simple table already in that file.

Add a line to `docs/product-review-2026-07/RLS-PLAN.md` in the intentionally-app-level-only list: `system_settings` — box-level configuration, no tenant data.

- [ ] **Step 3: Apply the migration**

Run: `cd backend && npm run db:migrate`
Expected: applies cleanly. Verify with a `\d system_settings` against the dev database (Postgres at localhost:5432, database/user `homemanager`, password `devpassword`).

- [ ] **Step 4: Write the failing test**

Create `backend/test/llm/llm-settings.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { config } from '../../src/config/index.js';
import {
  getTextModel,
  getVisionModel,
  setModel,
  TEXT_MODEL_KEY,
  VISION_MODEL_KEY,
} from '../../src/modules/llm/llm-settings.js';

afterEach(async () => {
  await db
    .delete(systemSettings)
    .where(inArray(systemSettings.key, [TEXT_MODEL_KEY, VISION_MODEL_KEY]));
});

describe('llm settings accessor', () => {
  it('falls back to the env default when unset', async () => {
    // This is what guarantees an untouched install behaves exactly as it does
    // today — the env vars keep working as defaults.
    expect(await getTextModel()).toBe(config.OLLAMA_LLM_MODEL);
    expect(await getVisionModel()).toBe(config.OLLAMA_VLM_MODEL);
  });

  it('prefers the stored value once set', async () => {
    await setModel('text', 'qwen2.5:3b');
    expect(await getTextModel()).toBe('qwen2.5:3b');
    // The other role is untouched.
    expect(await getVisionModel()).toBe(config.OLLAMA_VLM_MODEL);
  });

  it('overwrites rather than duplicating on a second set', async () => {
    await setModel('vision', 'llava:7b');
    await setModel('vision', 'qwen2.5vl:7b');

    expect(await getVisionModel()).toBe('qwen2.5vl:7b');
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, VISION_MODEL_KEY));
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/llm-settings.test.ts`
Expected: FAIL — cannot find module `llm-settings.js`.

- [ ] **Step 6: Implement the accessor**

Create `backend/src/modules/llm/llm-settings.ts`:

```ts
import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { config } from '../../config/index.js';
import { systemSettings } from '../../db/schema/index.js';

export const TEXT_MODEL_KEY = 'llm.textModel';
export const VISION_MODEL_KEY = 'llm.visionModel';

export type ModelRole = 'text' | 'vision';

const KEY_BY_ROLE: Record<ModelRole, string> = {
  text: TEXT_MODEL_KEY,
  vision: VISION_MODEL_KEY,
};

async function readSetting(key: string): Promise<string | null> {
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, key),
  });
  // jsonb round-trips a string as a string; anything else is a corrupted row
  // and is ignored in favour of the env default rather than crashing a scan.
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * The model used to structure OCR text into receipt lines. Falls back to the
 * env var so an install that never visits the settings page behaves exactly as
 * it did before this feature existed.
 */
export async function getTextModel(): Promise<string> {
  return (await readSetting(TEXT_MODEL_KEY)) ?? config.OLLAMA_LLM_MODEL;
}

/** The model used for image understanding. Same fallback rule. */
export async function getVisionModel(): Promise<string> {
  return (await readSetting(VISION_MODEL_KEY)) ?? config.OLLAMA_VLM_MODEL;
}

export async function setModel(role: ModelRole, tag: string): Promise<void> {
  const key = KEY_BY_ROLE[role];
  await db
    .insert(systemSettings)
    .values({ key, value: tag })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: tag, updatedAt: new Date() },
    });
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/llm-settings.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/db/schema/system-settings.ts backend/src/db/schema/index.ts \
  backend/drizzle/0012_system_settings.sql backend/drizzle/meta/ \
  backend/src/modules/llm/llm-settings.ts backend/test/llm/llm-settings.test.ts \
  docs/product-review-2026-07/RLS-PLAN.md
git commit -m "feat(llm): box-level settings table and model accessor"
```

---

### Task 2: Hardware detection

**Files:**
- Create: `backend/src/modules/llm/llm-hardware.ts`
- Create: `backend/test/llm/llm-hardware.test.ts`
- Create: `backend/test/llm/fixtures/` — captured command output

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `detectHardware(): Promise<HardwareProfile>` (cached ~60s)
  - `parseNvidiaSmi(stdout: string): GpuInfo | null`
  - `parseLspciVga(stdout: string): { name: string } | null`
  - `parseMemAvailable(procMeminfo: string): number` (MB)
  - types:
    ```ts
    interface GpuInfo { name: string; vramTotalMb: number; vramFreeMb: number }
    type DriverState = 'ok' | 'missing' | 'nouveau' | 'not-applicable';
    interface HardwareProfile {
      gpu: GpuInfo | null;        // populated only when the driver works
      gpuNameFromPci: string | null; // card seen even with no driver
      driverState: DriverState;
      ramTotalMb: number;
      ramAvailableMb: number;
      cpuCores: number;
      hasAvx2: boolean;
    }
    ```

The distinction between `gpu` and `gpuNameFromPci` is the whole point: it is how "no GPU" is told apart from "GPU, no driver", which are completely different user situations.

- [ ] **Step 1: Capture fixtures**

Create `backend/test/llm/fixtures/` with four files. Use real output — `nvidia-smi-rtx3050.txt` is the format `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits` produces:

`nvidia-smi-rtx3050.txt`:
```
NVIDIA GeForce RTX 3050, 8192, 7943
```

`lspci-rtx3050.txt`:
```
01:00.0 VGA compatible controller: NVIDIA Corporation GA107 [GeForce RTX 3050 8GB] (rev a1)
```

`lspci-no-gpu.txt`:
```
00:02.0 VGA compatible controller: Intel Corporation HD Graphics 630 (rev 04)
```

`meminfo-7gb.txt` (trimmed to the lines the parser reads):
```
MemTotal:        7464960 kB
MemFree:         1174528 kB
MemAvailable:    6269952 kB
```

- [ ] **Step 2: Write the failing test**

Create `backend/test/llm/llm-hardware.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  parseNvidiaSmi,
  parseLspciVga,
  parseMemAvailable,
} from '../../src/modules/llm/llm-hardware.js';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('parseNvidiaSmi', () => {
  it('reads name and VRAM from csv output', () => {
    expect(parseNvidiaSmi(fixture('nvidia-smi-rtx3050.txt'))).toEqual({
      name: 'NVIDIA GeForce RTX 3050',
      vramTotalMb: 8192,
      vramFreeMb: 7943,
    });
  });

  it('returns null for empty or error output', () => {
    expect(parseNvidiaSmi('')).toBeNull();
    expect(parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate')).toBeNull();
  });
});

describe('parseLspciVga', () => {
  it('finds an NVIDIA card', () => {
    expect(parseLspciVga(fixture('lspci-rtx3050.txt'))?.name).toContain('GeForce RTX 3050');
  });

  it('ignores non-NVIDIA display controllers', () => {
    // Intel integrated graphics is not something we can run inference on, and
    // reporting it as "a GPU" would produce a misleading recommendation.
    expect(parseLspciVga(fixture('lspci-no-gpu.txt'))).toBeNull();
  });
});

describe('parseMemAvailable', () => {
  it('reads MemAvailable in MB, not MemFree', () => {
    // MemAvailable accounts for reclaimable cache; MemFree would badly
    // understate what a model can actually use.
    expect(parseMemAvailable(fixture('meminfo-7gb.txt'))).toBe(6123);
  });

  it('returns 0 when the field is absent rather than NaN', () => {
    expect(parseMemAvailable('MemTotal: 100 kB')).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/llm-hardware.test.ts`
Expected: FAIL — cannot find module `llm-hardware.js`.

- [ ] **Step 4: Implement detection**

Create `backend/src/modules/llm/llm-hardware.ts`:

```ts
import { execFile } from 'child_process';
import { readFile } from 'fs/promises';
import { cpus, totalmem } from 'os';
import { promisify } from 'util';
import { logger } from '../../lib/logger.js';

const execFileAsync = promisify(execFile);

/** Every probe is bounded — a hung nvidia-smi must not hang the settings page. */
const PROBE_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60_000;

export interface GpuInfo {
  name: string;
  vramTotalMb: number;
  vramFreeMb: number;
}

export type DriverState = 'ok' | 'missing' | 'nouveau' | 'not-applicable';

export interface HardwareProfile {
  /** Populated only when a working driver reports it. */
  gpu: GpuInfo | null;
  /** The card as seen on the PCI bus — visible even with no driver at all. */
  gpuNameFromPci: string | null;
  driverState: DriverState;
  ramTotalMb: number;
  ramAvailableMb: number;
  cpuCores: number;
  hasAvx2: boolean;
}

export function parseNvidiaSmi(stdout: string): GpuInfo | null {
  const line = stdout.trim().split('\n')[0]?.trim();
  if (!line) return null;

  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 3) return null;

  const vramTotalMb = Number(parts[1]);
  const vramFreeMb = Number(parts[2]);
  if (!Number.isFinite(vramTotalMb) || !Number.isFinite(vramFreeMb)) return null;

  return { name: parts[0], vramTotalMb, vramFreeMb };
}

export function parseLspciVga(stdout: string): { name: string } | null {
  for (const line of stdout.split('\n')) {
    if (!/vga|3d controller|display controller/i.test(line)) continue;
    if (!/nvidia/i.test(line)) continue;
    // Prefer the bracketed marketing name when present, else the whole tail.
    const bracket = line.match(/\[([^\]]+)\]/);
    return { name: bracket ? bracket[1] : line.split(':').slice(2).join(':').trim() };
  }
  return null;
}

export function parseMemAvailable(procMeminfo: string): number {
  const match = procMeminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  if (!match) return 0;
  return Math.floor(Number(match[1]) / 1024);
}

async function probe(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: PROBE_TIMEOUT_MS });
    return stdout;
  } catch {
    return null;
  }
}

async function detectDriverState(hasNvidiaSmi: boolean, cardPresent: boolean): Promise<DriverState> {
  // A working nvidia-smi is proof of a card on its own. Checking cardPresent
  // first would report 'not-applicable' on any machine where lspci is absent
  // (minimal images often ship nvidia-smi without pciutils) — a profile that
  // contradicts its own populated `gpu` field.
  if (hasNvidiaSmi) return 'ok';
  if (!cardPresent) return 'not-applicable';
  const modules = await readFile('/proc/modules', 'utf8').catch(() => '');
  return /^nouveau /m.test(modules) ? 'nouveau' : 'missing';
}

let cached: { at: number; profile: HardwareProfile } | null = null;

export async function detectHardware(): Promise<HardwareProfile> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    const p = cached.profile;
    return { ...p, gpu: p.gpu ? { ...p.gpu } : null };
  }

  const [smiOut, lspciOut, meminfo, cpuinfo] = await Promise.all([
    probe('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.free',
      '--format=csv,noheader,nounits',
    ]),
    probe('lspci', []),
    readFile('/proc/meminfo', 'utf8').catch(() => ''),
    readFile('/proc/cpuinfo', 'utf8').catch(() => ''),
  ]);

  const gpu = smiOut ? parseNvidiaSmi(smiOut) : null;
  const fromPci = lspciOut ? parseLspciVga(lspciOut) : null;

  const profile: HardwareProfile = {
    gpu,
    gpuNameFromPci: fromPci?.name ?? null,
    driverState: await detectDriverState(gpu !== null, gpu !== null || fromPci !== null),
    ramTotalMb: Math.floor(totalmem() / 1024 / 1024),
    ramAvailableMb: parseMemAvailable(meminfo) || Math.floor(totalmem() / 1024 / 1024),
    cpuCores: cpus().length,
    hasAvx2: /\bavx2\b/.test(cpuinfo),
  };

  logger.debug({ profile }, 'Detected LLM hardware');
  cached = { at: Date.now(), profile };
  // Hand out a copy: the cached object lives for 60s, and a caller that mutated
  // it — annotating a recommendation, decrementing vramFreeMb — would corrupt
  // every other caller's view for the rest of the TTL.
  return { ...profile, gpu: profile.gpu ? { ...profile.gpu } : null };
}

/** Test seam — clears the cache so a test can vary the environment. */
export function resetHardwareCache(): void {
  cached = null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/llm-hardware.test.ts`
Expected: PASS, 6 tests.

If `parseMemAvailable` returns 6122 rather than 6123, adjust the *test* to the real floor-division result — the fixture is the source of truth, not the expectation I wrote.

**Also add a mocked-`execFile` test covering `detectHardware`'s four driver-state branches** — working driver, card with `nouveau`, card with nothing loaded, and no card — plus one asserting that mutating a returned profile does not affect the next call. Mock `child_process` and `fs/promises` rather than invoking the real commands; the constraint is that tests never shell out, not that `detectHardware` goes untested. These branches are the module's whole point, and the parser tests do not touch them.

- [ ] **Step 6: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/llm/llm-hardware.ts backend/test/llm/
git commit -m "feat(llm): detect GPU, driver state, RAM and CPU capability"
```

---

### Task 3: Catalog and fit calculation

**Files:**
- Create: `backend/src/modules/llm/llm-catalog.ts`
- Test: `backend/test/llm/llm-catalog.test.ts`

**Interfaces:**
- Consumes: `HardwareProfile` (Task 2).
- Produces:
  - `CATALOG: CatalogModel[]`
  - `computeFit(model: CatalogModel, hw: HardwareProfile): FitVerdict`
  - `catalogWithFit(hw: HardwareProfile): Array<CatalogModel & { fit: FitVerdict }>`
  - `combinedFootprint(tags: string[], hw: HardwareProfile): { totalVramMb: number; exceedsVram: boolean }`
  - types:
    ```ts
    interface CatalogModel {
      tag: string; role: 'text' | 'vision'; label: string;
      downloadBytes: number; vramMb: number; notes: string; default?: boolean;
    }
    type FitVerdict = 'recommended' | 'fits' | 'cpu-only' | 'too-large';
    ```

This is the logic users actually trust, so it is a pure function and gets table-driven tests.

- [ ] **Step 1: Write the failing test**

Create `backend/test/llm/llm-catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CATALOG,
  computeFit,
  combinedFootprint,
  type CatalogModel,
} from '../../src/modules/llm/llm-catalog.js';
import type { HardwareProfile } from '../../src/modules/llm/llm-hardware.js';

const model = (over: Partial<CatalogModel> = {}): CatalogModel => ({
  tag: 'test:7b',
  role: 'text',
  label: 'Test 7B',
  downloadBytes: 4_700_000_000,
  vramMb: 4700,
  notes: 'test',
  ...over,
});

const hw = (over: Partial<HardwareProfile> = {}): HardwareProfile => ({
  gpu: { name: 'RTX 3050', vramTotalMb: 8192, vramFreeMb: 8000 },
  gpuNameFromPci: 'GeForce RTX 3050 8GB',
  driverState: 'ok',
  ramTotalMb: 7289,
  ramAvailableMb: 6122,
  cpuCores: 12,
  hasAvx2: true,
  ...over,
});

describe('computeFit', () => {
  it('recommends the role default when it fits with headroom', () => {
    expect(computeFit(model({ default: true }), hw())).toBe('recommended');
  });

  it('says fits — not recommended — for a non-default that fits', () => {
    expect(computeFit(model(), hw())).toBe('fits');
  });

  it('requires headroom, not just bare capacity', () => {
    // 7800MB into 8000MB free is under the 15% reserve: it would fit on paper
    // and thrash in practice.
    expect(computeFit(model({ vramMb: 7800 }), hw())).not.toBe('fits');
  });

  it('falls back to CPU when the model exceeds VRAM but fits RAM', () => {
    expect(computeFit(model({ vramMb: 12000 }), hw())).toBe('cpu-only');
  });

  it('is too-large when it fits neither', () => {
    expect(computeFit(model({ vramMb: 40000 }), hw())).toBe('too-large');
  });

  it('ignores a GPU whose driver does not work', () => {
    // A card on nouveau cannot run inference; treating it as usable would
    // recommend a model that then silently runs on the CPU.
    expect(computeFit(model({ default: true }), hw({ gpu: null, driverState: 'nouveau' })))
      .toBe('cpu-only');
  });

  it('uses available RAM, not total, for the CPU budget', () => {
    // The value must sit between the two budgets or the test cannot fail:
    //   correct  = ramAvailableMb - RAM_RESERVE_MB = 6122 - 1500 = 4622
    //   if buggy = ramTotalMb     - RAM_RESERVE_MB = 7289 - 1500 = 5789
    // 5000 is too-large under the correct budget and cpu-only under the buggy
    // one. Anything above 5789 (99999, or even 6500) passes either way and
    // proves nothing — which is the difference between a working box and one
    // that OOMs the app it is serving going untested.
    expect(computeFit(model({ vramMb: 5000 }), hw({ gpu: null, driverState: 'missing' })))
      .toBe('too-large');
  });
});

describe('combinedFootprint', () => {
  it('flags two models that each fit alone but not together', () => {
    // The reason footprint is computed jointly rather than per-model.
    const result = combinedFootprint(['qwen2.5:7b', 'qwen2.5vl:7b'], hw());
    expect(result.exceedsVram).toBe(true);
    expect(result.totalVramMb).toBeGreaterThan(8192);
  });

  it('does not flag a pair that fits', () => {
    expect(combinedFootprint(['qwen2.5:1.5b'], hw()).exceedsVram).toBe(false);
  });

  it('ignores tags that are not in the catalog', () => {
    // The advanced escape hatch allows arbitrary tags; their size is unknown
    // and must not be guessed at.
    expect(combinedFootprint(['some/unknown:tag'], hw()).totalVramMb).toBe(0);
  });
});

describe('CATALOG', () => {
  it('has exactly one default per role', () => {
    for (const role of ['text', 'vision'] as const) {
      const defaults = CATALOG.filter((m) => m.role === role && m.default);
      expect(defaults).toHaveLength(1);
    }
  });

  it('has no duplicate tags', () => {
    const tags = CATALOG.map((m) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/llm-catalog.test.ts`
Expected: FAIL — cannot find module `llm-catalog.js`.

- [ ] **Step 3: Implement the catalog**

Create `backend/src/modules/llm/llm-catalog.ts`:

```ts
import type { HardwareProfile } from './llm-hardware.js';

export interface CatalogModel {
  /** Exact `ollama pull` tag. */
  tag: string;
  role: 'text' | 'vision';
  label: string;
  /** Approximate download size, used for the progress bar's ETA and the
   *  pre-pull disk check. */
  downloadBytes: number;
  /** Resident footprint at the tag's default quantisation. */
  vramMb: number;
  notes: string;
  /** The per-role pick when hardware allows it. Exactly one per role. */
  default?: boolean;
}

export type FitVerdict = 'recommended' | 'fits' | 'cpu-only' | 'too-large';

/** Leave the GPU room to breathe; a model at 98% of VRAM thrashes. */
const VRAM_HEADROOM = 0.15;
/** Keep this much RAM for Postgres, Redis and the app itself. */
const RAM_RESERVE_MB = 1500;

/**
 * Curated, and therefore a maintenance burden — it will drift as better models
 * ship. The advanced any-tag field in the UI is what keeps that drift from
 * making the catalog a cage between releases.
 */
export const CATALOG: CatalogModel[] = [
  {
    tag: 'qwen2.5:7b',
    role: 'text',
    label: 'Qwen 2.5 7B',
    downloadBytes: 4_700_000_000,
    vramMb: 4700,
    notes: 'Best accuracy for turning receipt text into line items. Needs a GPU to be quick.',
    default: true,
  },
  {
    tag: 'qwen2.5:3b',
    role: 'text',
    label: 'Qwen 2.5 3B',
    downloadBytes: 1_900_000_000,
    vramMb: 2000,
    notes: 'Noticeably faster, occasionally misses an unusual line. A good fit for smaller cards.',
  },
  {
    tag: 'qwen2.5:1.5b',
    role: 'text',
    label: 'Qwen 2.5 1.5B',
    downloadBytes: 1_000_000_000,
    vramMb: 1100,
    notes: 'Runs acceptably on CPU. Expect to correct more lines by hand.',
  },
  {
    tag: 'llama3.2:3b',
    role: 'text',
    label: 'Llama 3.2 3B',
    downloadBytes: 2_000_000_000,
    vramMb: 2100,
    notes: 'Alternative to Qwen 3B with similar requirements.',
  },
  {
    tag: 'qwen2.5vl:7b',
    role: 'vision',
    label: 'Qwen 2.5 VL 7B',
    downloadBytes: 6_000_000_000,
    vramMb: 6000,
    notes: 'Strong at reading text in photos — recipes, handwritten lists.',
    default: true,
  },
  {
    tag: 'qwen3-vl:8b',
    role: 'vision',
    label: 'Qwen 3 VL 8B',
    downloadBytes: 6_500_000_000,
    vramMb: 6500,
    notes: 'Newer, better again at text in images. Wants a card with room to spare.',
  },
  {
    tag: 'llava:7b',
    role: 'vision',
    label: 'LLaVA 7B',
    downloadBytes: 4_700_000_000,
    vramMb: 4800,
    notes: 'Older and weaker at reading text. Kept because existing installs use it.',
  },
  {
    tag: 'moondream',
    role: 'vision',
    label: 'Moondream',
    downloadBytes: 1_700_000_000,
    vramMb: 1800,
    notes: 'Small enough for a 4GB card. Basic image understanding only.',
  },
];

/** A GPU is only usable when a working driver reports it. */
function usableVramMb(hw: HardwareProfile): number {
  if (hw.driverState !== 'ok' || !hw.gpu) return 0;
  return hw.gpu.vramFreeMb;
}

export function computeFit(model: CatalogModel, hw: HardwareProfile): FitVerdict {
  const vram = usableVramMb(hw);
  if (vram > 0 && model.vramMb <= vram * (1 - VRAM_HEADROOM)) {
    return model.default ? 'recommended' : 'fits';
  }

  const ramBudget = hw.ramAvailableMb - RAM_RESERVE_MB;
  if (model.vramMb <= ramBudget) return 'cpu-only';

  return 'too-large';
}

export function catalogWithFit(
  hw: HardwareProfile
): Array<CatalogModel & { fit: FitVerdict }> {
  return CATALOG.map((m) => ({ ...m, fit: computeFit(m, hw) }));
}

/**
 * Two models that each fit alone may not fit together. Ollama unloads after its
 * keep-alive so they swap rather than failing, but that costs ~10s on first use
 * after idle — worth saying out loud rather than letting it be discovered as
 * mysterious latency. Unknown tags contribute 0: their size cannot be guessed.
 */
export function combinedFootprint(
  tags: string[],
  hw: HardwareProfile
): { totalVramMb: number; exceedsVram: boolean } {
  const totalVramMb = tags.reduce((sum, tag) => {
    const entry = CATALOG.find((m) => m.tag === tag);
    return sum + (entry?.vramMb ?? 0);
  }, 0);

  const vram = usableVramMb(hw);
  return { totalVramMb, exceedsVram: vram > 0 && totalVramMb > vram };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/llm-catalog.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/llm/llm-catalog.ts backend/test/llm/llm-catalog.test.ts
git commit -m "feat(llm): model catalog with hardware-aware fit verdicts"
```

---

### Task 4: Ollama client

**Files:**
- Create: `backend/src/modules/llm/ollama-client.ts`
- Test: `backend/test/llm/ollama-client.test.ts`

**Interfaces:**
- Consumes: `config.OLLAMA_HOST`.
- Produces: `isReachable(): Promise<boolean>`, `listInstalledTags(): Promise<string[]>`, `pullModel(tag, onProgress, signal?): Promise<void>`, `deleteModel(tag): Promise<void>`, `interface PullProgress { status: string; completed: number; total: number }`.

`fetch` is stubbed in every test. Nothing here contacts a real Ollama.

- [ ] **Step 1: Write the failing test**

Create `backend/test/llm/ollama-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isReachable, listInstalledTags, pullModel, type PullProgress,
} from '../../src/modules/llm/ollama-client.js';

afterEach(() => vi.unstubAllGlobals());

function ndjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('isReachable', () => {
  it('is true when the tags endpoint answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"models":[]}', { status: 200 })));
    expect(await isReachable()).toBe(true);
  });

  it('is false — never throws — when the connection is refused', async () => {
    // The settings page calls this on load; a throw would break the page
    // rather than showing the install action.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await isReachable()).toBe(false);
  });

  it('is false on a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    expect(await isReachable()).toBe(false);
  });
});

describe('listInstalledTags', () => {
  it('returns the model names', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'qwen2.5:7b' }, { name: 'llava:7b' }] }), { status: 200 })
    ));
    expect(await listInstalledTags()).toEqual(['qwen2.5:7b', 'llava:7b']);
  });

  it('returns an empty list when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect(await listInstalledTags()).toEqual([]);
  });
});

describe('pullModel', () => {
  it('reports progress from each NDJSON line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ndjsonResponse([
      JSON.stringify({ status: 'pulling manifest' }),
      JSON.stringify({ status: 'downloading', completed: 500, total: 1000 }),
      JSON.stringify({ status: 'success' }),
    ])));

    const seen: PullProgress[] = [];
    await pullModel('qwen2.5:7b', (p) => seen.push(p));

    expect(seen.map((p) => p.status)).toEqual(['pulling manifest', 'downloading', 'success']);
    expect(seen[1]).toMatchObject({ completed: 500, total: 1000 });
  });

  it('tolerates a partial line split across chunks', async () => {
    // NDJSON arrives in arbitrary chunks; a naive split on newline drops data.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"status":"downlo'));
        controller.enqueue(encoder.encode('ading","completed":1,"total":2}\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const seen: PullProgress[] = [];
    await pullModel('x:1b', (p) => seen.push(p));
    expect(seen).toEqual([{ status: 'downloading', completed: 1, total: 2 }]);
  });

  it('surfaces Ollama own error text', async () => {
    // Disk-full and network-refused need different user responses, so the
    // message must not be flattened into something generic.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      ndjsonResponse([JSON.stringify({ error: 'no space left on device' })])
    ));
    await expect(pullModel('x:1b', () => {})).rejects.toThrow(/no space left on device/);
  });

  it('throws when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad tag', { status: 404 })));
    await expect(pullModel('nope:1b', () => {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/ollama-client.test.ts`
Expected: FAIL — cannot find module `ollama-client.js`.

- [ ] **Step 3: Implement the client**

Create `backend/src/modules/llm/ollama-client.ts`:

```ts
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

export interface PullProgress {
  status: string;
  completed: number;
  total: number;
}

const REACHABILITY_TIMEOUT_MS = 5000;

/**
 * Never throws — the settings page calls this on load, and a rejection would
 * break the page rather than showing the "install Ollama" action.
 */
export async function isReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listInstalledTags(): Promise<string[]> {
  try {
    const res = await fetch(`${config.OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Streams Ollama NDJSON pull progress. Pulls are resumable — Ollama caches
 * blobs on disk — so a dropped stream costs only the progress display, and
 * re-issuing picks up where it left off.
 */
export async function pullModel(
  tag: string,
  onProgress: (p: PullProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${config.OLLAMA_HOST}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama refused the pull (${res.status}): ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: { status?: string; error?: string; completed?: number; total?: number };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      logger.debug({ line: trimmed }, 'Unparseable line in Ollama pull stream');
      return;
    }

    // Ollama reports failures in-band rather than via HTTP status.
    if (parsed.error) throw new Error(parsed.error);

    onProgress({
      status: parsed.status ?? 'working',
      completed: parsed.completed ?? 0,
      total: parsed.total ?? 0,
    });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    // A chunk boundary can land mid-line, so keep the remainder buffered.
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }

  if (buffer.trim()) handleLine(buffer);
}

export async function deleteModel(tag: string): Promise<void> {
  const res = await fetch(`${config.OLLAMA_HOST}/api/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }),
  });
  if (!res.ok) {
    throw new Error(`Ollama refused the delete (${res.status}): ${await res.text()}`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/ollama-client.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/llm/ollama-client.ts backend/test/llm/ollama-client.test.ts
git commit -m "feat(llm): ollama client with streaming pull progress"
```

---

### Task 5: Routes

**Files:**
- Create: `backend/src/modules/llm/llm.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/llm/llm.routes.test.ts`

**Interfaces:**
- Consumes: `detectHardware` (Task 2); `catalogWithFit`, `combinedFootprint`, `CATALOG` (Task 3); `isReachable`, `listInstalledTags`, `deleteModel` (Task 4); `getTextModel`, `getVisionModel`, `setModel` (Task 1).
- Produces: six routes under `/api/v1/llm`. `POST /models/pull` delegates to `startPull` from Task 6.

**Order resolved:** this task delivers **five** routes and omits `POST /models/pull`. That route needs `startPull` from `llm.ws.ts`, which Task 6 creates — so Task 6 adds the pull route alongside its registry. Splitting it this way keeps each task's files disjoint and every commit compiling, rather than stubbing a function in one task and replacing it in the next.

Accordingly: do not import from `./llm.ws.js` here, and do not write `assertDiskSpaceFor` — it moves to Task 6 with the route that uses it.

- [ ] **Step 1: Write the failing test**

Create `backend/test/llm/llm.routes.test.ts`. Read `backend/test/helpers/route-harness.ts` first — `createUser(householdId, role)` takes a role, and these routes require `admin`.

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { setupRouteTest, type RouteTestContext, type TestUser } from '../helpers/route-harness.js';

vi.mock('../../src/modules/llm/ollama-client.js', () => ({
  isReachable: vi.fn().mockResolvedValue(true),
  listInstalledTags: vi.fn().mockResolvedValue(['qwen2.5:7b']),
  pullModel: vi.fn().mockResolvedValue(undefined),
  deleteModel: vi.fn().mockResolvedValue(undefined),
}));

let ctx: RouteTestContext;
let admin: TestUser;
let member: TestUser;

beforeAll(async () => {
  ctx = await setupRouteTest();
  const householdId = await ctx.createHousehold();
  admin = await ctx.createUser(householdId, 'admin');
  member = await ctx.createUser(householdId, 'member');
});

afterAll(async () => {
  await db.delete(systemSettings).where(inArray(systemSettings.key, ['llm.textModel', 'llm.visionModel']));
  await ctx.close();
});

describe('admin gating', () => {
  it('refuses a non-admin on every read route', async () => {
    // These expose host internals — GPU, RAM, what is installed.
    for (const path of ['/api/v1/llm/hardware', '/api/v1/llm/catalog', '/api/v1/llm/status']) {
      expect((await member.fetch(path)).status).toBe(403);
    }
    expect((await admin.fetch('/api/v1/llm/hardware')).status).toBe(200);
  });

  it('refuses a non-admin on settings', async () => {
    const res = await member.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'qwen2.5:7b' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/llm/catalog', () => {
  it('returns every entry with a fit verdict', async () => {
    const body = await (await admin.fetch('/api/v1/llm/catalog')).json();
    expect(body.data.models.length).toBeGreaterThan(0);
    for (const m of body.data.models) {
      expect(['recommended', 'fits', 'cpu-only', 'too-large']).toContain(m.fit);
    }
  });
});

describe('GET /api/v1/llm/status', () => {
  it('reports reachability, installed tags and selections', async () => {
    const body = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(body.data.reachable).toBe(true);
    expect(body.data.installed).toContain('qwen2.5:7b');
    expect(body.data.selected.text).toBeTruthy();
  });

  it('flags a selection whose model is not installed', async () => {
    // Deleting the active model otherwise turns every scan into a failure
    // with no visible cause.
    const body = await (await admin.fetch('/api/v1/llm/status')).json();
    // The default vision model is not in the mocked installed list.
    expect(body.data.missing.vision).toBe(true);
    expect(body.data.missing.text).toBe(false);
  });
});

describe('PUT /api/v1/llm/settings', () => {
  it('accepts an installed tag and persists it', async () => {
    const res = await admin.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'qwen2.5:7b' }),
    });
    expect(res.status).toBe(200);

    const status = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(status.data.selected.text).toBe('qwen2.5:7b');
  });

  it('rejects a tag that is not installed, and does not persist it', async () => {
    const res = await admin.fetch('/api/v1/llm/settings', {
      method: 'PUT',
      body: JSON.stringify({ textModel: 'not-pulled:7b' }),
    });
    expect(res.status).toBe(400);

    const status = await (await admin.fetch('/api/v1/llm/status')).json();
    expect(status.data.selected.text).not.toBe('not-pulled:7b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/llm.routes.test.ts`
Expected: FAIL — every request 404s, the routes are not registered.

- [ ] **Step 3: Implement the routes**

Create `backend/src/modules/llm/llm.routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware, requireAdmin } from '../../middleware/auth.middleware.js';
import { Errors } from '../../lib/errors.js';
import { detectHardware } from './llm-hardware.js';
import { catalogWithFit, combinedFootprint } from './llm-catalog.js';
import { isReachable, listInstalledTags, deleteModel } from './ollama-client.js';
import { getTextModel, getVisionModel, setModel } from './llm-settings.js';

const updateSettingsSchema = z.object({
  textModel: z.string().min(1).max(200).optional(),
  visionModel: z.string().min(1).max(200).optional(),
});

export async function llmRoutes(app: FastifyInstance): Promise<void> {
  app.get('/hardware', { preHandler: [authMiddleware, requireAdmin()] }, async () => ({
    success: true,
    data: await detectHardware(),
  }));

  app.get('/catalog', { preHandler: [authMiddleware, requireAdmin()] }, async () => {
    const hw = await detectHardware();
    return { success: true, data: { models: catalogWithFit(hw) } };
  });

  app.get('/status', { preHandler: [authMiddleware, requireAdmin()] }, async () => {
    const [reachable, installed, hw, text, vision] = await Promise.all([
      isReachable(),
      listInstalledTags(),
      detectHardware(),
      getTextModel(),
      getVisionModel(),
    ]);

    return {
      success: true,
      data: {
        reachable,
        installed,
        selected: { text, vision },
        // A selection whose model is gone must be visible here — otherwise
        // deleting the active model turns every scan into a silent failure.
        missing: {
          text: reachable && !installed.includes(text),
          vision: reachable && !installed.includes(vision),
        },
        footprint: combinedFootprint([text, vision], hw),
      },
    };
  });

  app.put('/settings', { preHandler: [authMiddleware, requireAdmin()] }, async (request) => {
    const input = updateSettingsSchema.parse(request.body);
    const installed = await listInstalledTags();

    const requested = ([
      ['text', input.textModel],
      ['vision', input.visionModel],
    ] as const).filter((pair): pair is readonly ['text' | 'vision', string] => Boolean(pair[1]));

    // Validate every requested tag BEFORE writing any of them. Validating and
    // writing in the same loop pass would persist a valid text model and then
    // reject on an invalid vision model in the same request — the caller sees
    // a 400 while half their change silently took effect. The frontend submits
    // both fields together, so this is the normal path, not an edge case.
    for (const [, tag] of requested) {
      if (!installed.includes(tag)) {
        throw Errors.validation(`${tag} is not installed. Install it before selecting it.`);
      }
    }

    for (const [role, tag] of requested) {
      await setModel(role, tag);
    }

    return {
      success: true,
      data: { text: await getTextModel(), vision: await getVisionModel() },
    };
  });

  app.delete<{ Params: { tag: string } }>(
    '/models/:tag',
    { preHandler: [authMiddleware, requireAdmin()] },
    async (request) => {
      await deleteModel(decodeURIComponent(request.params.tag));
      return { success: true, data: { message: 'Model removed' } };
    }
  );

  // POST /models/pull is added in Task 6, together with llm.ws.ts's startPull
  // and the disk pre-check that guards it.
}
```

Register in `backend/src/app.ts` inside `apiScope`, beside the install registration:

```ts
    await apiScope.register(llmRoutes, { prefix: '/api/v1/llm' });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/llm.routes.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/llm/llm.routes.ts backend/src/app.ts backend/test/llm/llm.routes.test.ts
git commit -m "feat(llm): hardware, catalog, status, settings and model routes"
```

---

### Task 6: Pull registry and progress namespace

**Files:**
- Create: `backend/src/modules/llm/llm.ws.ts`
- Modify: `backend/src/websocket/index.ts` (beside `registerInstallNamespace(io)` at ~line 227)
- Test: `backend/test/llm/llm-pull.test.ts`

**Interfaces:**
- Consumes: `pullModel` (Task 4).
- Produces: `registerLlmNamespace(io: Server): void`, `startPull(tag: string): string`, `cancelPull(pullId: string): boolean`, `getPull(pullId: string): PullState | undefined`, `interface PullState { id, tag, state: 'running'|'done'|'failed'|'cancelled', status, completed, total, error? }`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/llm/llm-pull.test.ts`. This covers the registry; the socket transport itself is exercised by the Playwright walkthrough.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

const pullModel = vi.fn();
vi.mock('../../src/modules/llm/ollama-client.js', () => ({ pullModel }));

const { startPull, getPull, cancelPull } = await import('../../src/modules/llm/llm.ws.js');

afterEach(() => pullModel.mockReset());

describe('pull registry', () => {
  it('tracks progress reported by the client', async () => {
    pullModel.mockImplementation(async (_tag: string, onProgress: (p: unknown) => void) => {
      onProgress({ status: 'downloading', completed: 50, total: 100 });
    });

    const id = startPull('qwen2.5:7b');
    await vi.waitFor(() => expect(getPull(id)?.completed).toBe(50));
    expect(getPull(id)?.total).toBe(100);
  });

  it('marks a pull done on success', async () => {
    pullModel.mockResolvedValue(undefined);
    const id = startPull('qwen2.5:3b');
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('done'));
  });

  it('keeps the error text when a pull fails', async () => {
    // Disk-full and network-refused need different user responses, so the
    // message must survive rather than becoming "pull failed".
    pullModel.mockRejectedValue(new Error('no space left on device'));
    const id = startPull('qwen2.5:7b');
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('failed'));
    expect(getPull(id)?.error).toMatch(/no space left/);
  });

  it('cancelling aborts the underlying request', async () => {
    let seenSignal: AbortSignal | undefined;
    pullModel.mockImplementation(
      async (_t: string, _p: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          seenSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );

    const id = startPull('qwen2.5:7b');
    await vi.waitFor(() => expect(seenSignal).toBeDefined());
    expect(cancelPull(id)).toBe(true);
    await vi.waitFor(() => expect(getPull(id)?.state).toBe('cancelled'));
  });

  it('returns false when cancelling an unknown pull', () => {
    expect(cancelPull('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/llm-pull.test.ts`
Expected: FAIL — cannot find module `llm.ws.js`.

- [ ] **Step 3: Implement the registry and namespace**

Create `backend/src/modules/llm/llm.ws.ts`:

```ts
import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { logger } from '../../lib/logger.js';
import { pullModel } from './ollama-client.js';

export interface PullState {
  id: string;
  tag: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  status: string;
  completed: number;
  total: number;
  error?: string;
}

/**
 * In-memory, deliberately. A pull is box-local and singleton-ish, and Ollama
 * caches blobs on disk — so a lost pull costs only the progress display, and
 * re-issuing resumes from what was already fetched. A persistent queue would
 * buy nothing.
 */
const pulls = new Map<string, PullState>();
const controllers = new Map<string, AbortController>();

/** How long a finished pull stays readable before it is reaped. */
const TERMINAL_RETENTION_MS = 10 * 60 * 1000;

let io: Server | null = null;

function emit(state: PullState): void {
  io?.of('/llm').emit('pull:progress', state);
}

export function startPull(tag: string): string {
  const id = randomUUID();
  const controller = new AbortController();
  const state: PullState = {
    id, tag, state: 'running', status: 'starting', completed: 0, total: 0,
  };

  pulls.set(id, state);
  controllers.set(id, controller);

  void pullModel(
    tag,
    (progress) => {
      Object.assign(state, progress);
      emit(state);
    },
    controller.signal
  )
    .then(() => {
      state.state = 'done';
      state.status = 'done';
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      state.state = controller.signal.aborted ? 'cancelled' : 'failed';
      // Keep Ollama's own wording — the user needs to tell disk-full from
      // network-refused.
      if (state.state === 'failed') state.error = message;
      logger.warn({ tag, error: message }, 'Ollama pull ended abnormally');
    })
    .finally(() => {
      controllers.delete(id);
      emit(state);
      // Terminal states linger briefly so a client that reconnects right after
      // a pull finishes still sees the outcome, then are reaped. Without this
      // the map grows for the life of the process — slowly, since this is an
      // admin-only action, but without any bound.
      const reap = setTimeout(() => pulls.delete(id), TERMINAL_RETENTION_MS);
      // Do not hold the event loop open on a timer nobody is waiting for.
      reap.unref?.();
    });

  return id;
}

export function getPull(pullId: string): PullState | undefined {
  return pulls.get(pullId);
}

export function cancelPull(pullId: string): boolean {
  const controller = controllers.get(pullId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function registerLlmNamespace(server: Server): void {
  io = server;
  const ns = server.of('/llm');

  // COPY install.ws.ts's connection middleware verbatim here — it parses the
  // session cookie off the handshake and rejects unauthenticated sockets.
  // Pull state exposes what is installed on the host, so this namespace must
  // be admin-gated exactly as /install is. Do not ship it unauthenticated.

  ns.on('connection', (socket) => {
    // Replay live pulls so a client that reconnects mid-download catches up.
    for (const state of pulls.values()) {
      if (state.state === 'running') socket.emit('pull:progress', state);
    }
    socket.on('pull:cancel', (payload: { pullId: string }) => {
      cancelPull(payload?.pullId);
    });
  });
}
```

Register it in `backend/src/websocket/index.ts`:

```ts
  registerInstallNamespace(io);
  registerLlmNamespace(io);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/llm-pull.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/llm/llm.ws.ts backend/src/websocket/index.ts backend/test/llm/llm-pull.test.ts
git commit -m "feat(llm): pull registry and progress socket namespace"
```

---

### Task 7: Wire the consumers to the accessor

**Files:**
- Modify: `backend/src/modules/receipts/receipt-structurer.ts`
- Modify: `backend/src/modules/image-parse/ai-providers/ollama-vision.ts`
- Test: `backend/test/llm/consumer-wiring.test.ts`

**Interfaces:**
- Consumes: `getTextModel`, `getVisionModel` (Task 1).
- Produces: nothing new — both consumers now read the selected model instead of the env constant.

This is what makes "no restart" true. It is a small change with an outsized property: an install that never visits the settings page must behave exactly as it does today.

- [ ] **Step 1: Write the failing test**

Create `backend/test/llm/consumer-wiring.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../src/config/database.js';
import { systemSettings } from '../../src/db/schema/index.js';
import { config } from '../../src/config/index.js';
import { setModel, TEXT_MODEL_KEY, VISION_MODEL_KEY } from '../../src/modules/llm/llm-settings.js';
import { structureReceipt } from '../../src/modules/receipts/receipt-structurer.js';

afterEach(async () => {
  await db.delete(systemSettings).where(inArray(systemSettings.key, [TEXT_MODEL_KEY, VISION_MODEL_KEY]));
  vi.unstubAllGlobals();
});

/** Capture the model name the structurer asks Ollama for. */
function stubOllamaAndCaptureModel(): { seen: () => string | undefined } {
  let seen: string | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      seen = JSON.parse(String(init.body)).model;
      return new Response(JSON.stringify({ response: '{"lines":[{"raw_text":"MILK"}]}' }), {
        status: 200,
      });
    })
  );
  return { seen: () => seen };
}

describe('receipt structurer model selection', () => {
  it('uses the env default when nothing is selected', async () => {
    const cap = stubOllamaAndCaptureModel();
    await structureReceipt('MILK 3.50');
    expect(cap.seen()).toBe(config.OLLAMA_LLM_MODEL);
  });

  it('uses the selected model once one is set, with no restart', async () => {
    await setModel('text', 'qwen2.5:3b');
    const cap = stubOllamaAndCaptureModel();
    await structureReceipt('MILK 3.50');
    expect(cap.seen()).toBe('qwen2.5:3b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/consumer-wiring.test.ts`
Expected: FAIL — the second case still sends the env default, because `receipt-structurer.ts` reads `config.OLLAMA_LLM_MODEL` directly.

- [ ] **Step 3: Change both consumers**

In `backend/src/modules/receipts/receipt-structurer.ts`, replace the `model: config.OLLAMA_LLM_MODEL` in `structureReceipt`'s request body with an awaited call:

```ts
import { getTextModel } from '../llm/llm-settings.js';

// ...inside structureReceipt, before the fetch:
const model = await getTextModel();

// ...and in the body:
body: JSON.stringify({
  model,
  prompt: `${PROMPT}${rawText}`,
  stream: false,
  format: 'json',
  options: { temperature: 0 },
}),
```

`isStructurerAvailable` also references the configured model when matching `/api/tags`; point it at `await getTextModel()` too, so the capability probe checks the model that will actually be used.

Apply the same change in `backend/src/modules/image-parse/ai-providers/ollama-vision.ts`: replace its `this.model` initialisation from `config.OLLAMA_VLM_MODEL` with a `await getVisionModel()` at call time. Keep `getModel()` returning the last resolved value for the status reporting that already exists.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/consumer-wiring.test.ts test/receipts/receipt-structurer.test.ts`
Expected: PASS. The pre-existing structurer tests must stay green — they assert parsing, not model naming.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/receipts/receipt-structurer.ts   backend/src/modules/image-parse/ai-providers/ollama-vision.ts   backend/test/llm/consumer-wiring.test.ts
git commit -m "feat(llm): consumers read the selected model, not the env constant"
```

---

### Task 8: `ollama` guided-install entry

**Files:**
- Modify: `backend/src/modules/install/installer-commands.ts`
- Test: `backend/test/llm/installer-entry.test.ts`

**Interfaces:**
- Consumes: `InstallerCommand` (existing), `isReachable` (Task 4).
- Produces: an `ollama` id in `listAvailableInstallers()` with a working `postCheck`.

This is the retrofit path — a first-run script cannot help a box that is already running, which is exactly the production situation.

- [ ] **Step 1: Write the failing test**

Create `backend/test/llm/installer-entry.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/llm/ollama-client.js', () => ({
  isReachable: vi.fn().mockResolvedValue(true),
}));

const { listAvailableInstallers, buildArgv, runPostCheck } = await import(
  '../../src/modules/install/installer-commands.js'
);

describe('ollama installer entry', () => {
  it('is offered in the installer list', () => {
    expect(listAvailableInstallers().map((i) => i.id)).toContain('ollama');
  });

  it('resolves to a shell command', async () => {
    const argv = await buildArgv('ollama');
    // The websocket transport refuses unknown ids, so the entry must be
    // registered rather than constructed ad hoc.
    expect(argv[0]).toBe('bash');
    expect(argv.join(' ')).toContain('ollama.com/install.sh');
  });

  it('post-check reports success when Ollama answers', async () => {
    expect(await runPostCheck('ollama')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/llm/installer-entry.test.ts`
Expected: FAIL — `ollama` is not a known installer id.

- [ ] **Step 3: Add the entry**

In `backend/src/modules/install/installer-commands.ts`, add to the `COMMANDS` array, following the shape of the existing entries:

```ts
  {
    id: 'ollama',
    description: 'Install Ollama (local AI model runtime)',
    // `bash -lc` so the curl|sh install works as it does for the other
    // shell-piped installers here.
    argv: ['bash', '-lc', 'curl -fsSL https://ollama.com/install.sh | sh'],
    postCheck: async () => {
      const { isReachable } = await import('../llm/ollama-client.js');
      return isReachable();
    },
  },
```

The dynamic import keeps `installer-commands.ts` free of a static dependency on the `llm` module, matching how the file already defers work into its post-checks.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run test/llm/installer-entry.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd backend && npm run typecheck && npm run lint
git add backend/src/modules/install/installer-commands.ts backend/test/llm/installer-entry.test.ts
git commit -m "feat(llm): guided-install entry for Ollama"
```

---

### Task 9: GPU step in `scripts/install.sh`

**Files:**
- Modify: `scripts/install.sh`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a GPU/Ollama step in the one-shot installer.

No unit test. This installs kernel drivers and asks for reboots; a meaningful test needs a disposable VM with a real GPU, a CI capability this repo does not have and should not grow for this. Verification is `shellcheck` plus a `--dry-run` read-through.

- [ ] **Step 1: Add the step**

Follow the file's existing idiom — a `step_*` function called from `main()`, using its `C_*` colour helpers and `DRY_RUN` guard. Insert after the permissions step:

```bash
# ─── GPU + Ollama ─────────────────────────────────────────────────────────
#
# Auto-installs when a supported GPU is present. Rationale for doing this at
# install time rather than from the web UI: the driver swap needs a reboot of
# the very box that serves the UI, and during a first install a reboot is
# expected and cheap. Opt out with --no-gpu.
step_gpu() {
  if [[ $ENABLE_GPU -eq 0 ]]; then
    info "Skipping GPU setup (--no-gpu)."
    return
  fi

  # lspci sees the card even with no driver installed — that is how we tell
  # "no GPU" apart from "GPU, no driver".
  local card
  card="$(lspci 2>/dev/null | grep -iE 'vga|3d controller' | grep -i nvidia || true)"
  if [[ -z "$card" ]]; then
    info "No NVIDIA GPU detected — AI features will run on CPU."
    return
  fi

  ok "NVIDIA GPU detected: ${card#*: }"

  if command -v nvidia-smi >/dev/null 2>&1; then
    ok "Proprietary driver already active."
  elif ! command -v ubuntu-drivers >/dev/null 2>&1; then
    warn "A GPU is present but this is not an Ubuntu system."
    warn "Install the NVIDIA driver with your distribution's tooling, then re-run."
    return
  else
    warn "GPU is present but has no working driver (likely nouveau)."
    warn "Installing the recommended NVIDIA driver — this downloads ~600MB."
    if [[ $DRY_RUN -eq 0 ]]; then
      ubuntu-drivers install || {
        warn "Driver install failed. AI features will run on CPU until it is resolved."
        return
      }
    fi
    NEEDS_REBOOT=1
  fi

  if command -v ollama >/dev/null 2>&1; then
    ok "Ollama already installed."
  else
    info "Installing Ollama..."
    if [[ $DRY_RUN -eq 0 ]]; then
      curl -fsSL https://ollama.com/install.sh | sh || {
        warn "Ollama install failed. Install it later from Settings → AI models."
        return
      }
    fi
  fi

  ok "Pick your models in the app under Settings → AI models."
}
```

Add `ENABLE_GPU=1` and `NEEDS_REBOOT=0` to the configuration block, parse `--no-gpu` alongside the existing `--systemd` flag, call `step_gpu` from `main()`, and at the very end of `main()`:

```bash
  if [[ $NEEDS_REBOOT -eq 1 ]]; then
    warn "A reboot is required for the GPU driver to take effect."
    warn "Run: sudo reboot"
  fi
```

**It must not reboot on your behalf.** A script that reboots the machine it is being run on, over SSH, without asking is a bad neighbour — and this file's whole design is one sudo session, then get out of the way.

- [ ] **Step 2: Verify**

Run: `shellcheck scripts/install.sh` (install it if absent, or skip with a note in your report if unavailable)
Run: `sudo bash scripts/install.sh --dry-run` and confirm the GPU step reports what it found without acting.
Run: `sudo bash scripts/install.sh --dry-run --no-gpu` and confirm the step is skipped.

- [ ] **Step 3: Verify the Ollama-before-driver question**

The spec flags this as unresolved: Ollama's installer probes for CUDA at install time to decide which libraries to fetch. If it runs pre-reboot, it may configure itself CPU-only.

Determine what actually happens — read Ollama's install script, or test on the box after its driver install — and record the answer in your report. If the ordering matters, either install Ollama after the reboot or note in the summary output that `sudo systemctl restart ollama` is needed post-reboot.

- [ ] **Step 4: Commit**

```bash
git add scripts/install.sh
git commit -m "feat(install): detect GPU, install driver and Ollama at setup time"
```

---

### Task 10: Frontend API client and page shell

**Files:**
- Create: `frontend/src/api/llm.ts`
- Create: `frontend/src/pages/settings/AiModelsSettingsPage.tsx`
- Modify: `frontend/src/App.tsx`, the settings navigation

**Interfaces:**
- Consumes: the Task 5 routes.
- Produces: `llmApi` with `getHardware`, `getCatalog`, `getStatus`, `setModels`, `pullModel`, `deleteModel`; the page at `/settings/ai-models`.

**No test infrastructure in this workspace.** Verify with `cd frontend && npx tsc -b --force && npm run lint`. Do not add a test runner.

- [ ] **Step 1: Write the API client**

Create `frontend/src/api/llm.ts` following `frontend/src/api/receipts.ts` for shape and idiom. Types mirror the backend exactly:

```ts
export type FitVerdict = 'recommended' | 'fits' | 'cpu-only' | 'too-large';
export type DriverState = 'ok' | 'missing' | 'nouveau' | 'not-applicable';
export type ModelRole = 'text' | 'vision';

export interface HardwareProfile {
  gpu: { name: string; vramTotalMb: number; vramFreeMb: number } | null;
  gpuNameFromPci: string | null;
  driverState: DriverState;
  ramTotalMb: number;
  ramAvailableMb: number;
  cpuCores: number;
  hasAvx2: boolean;
}

export interface CatalogEntry {
  tag: string;
  role: ModelRole;
  label: string;
  downloadBytes: number;
  vramMb: number;
  notes: string;
  default?: boolean;
  fit: FitVerdict;
}

export interface LlmStatus {
  reachable: boolean;
  installed: string[];
  selected: { text: string; vision: string };
  missing: { text: boolean; vision: boolean };
  footprint: { totalVramMb: number; exceedsVram: boolean };
}
```

Methods map one-to-one onto the six routes, using the shared `apiGet`/`apiPost`/`apiPut`/`apiDelete` helpers with paths beginning `/llm/...`.

- [ ] **Step 2: Build the page shell**

Create `AiModelsSettingsPage.tsx` with the hardware summary and the blocker states only — role sections come in Task 11. Read `RemoteAccessSettingsPage.tsx` first: it already embeds the guided-install terminal, and that component is what the "Install Ollama" action reuses.

The page reads as a diagnosis, then a decision:

1. **Hardware summary** — a plain sentence: *"NVIDIA RTX 3050, 8 GB VRAM · 7.1 GB system RAM · 12 cores."* When `driverState` is `nouveau` or `missing` and a card is present, say so rather than reporting no GPU.
2. **Driver blocker**, when `driverState !== 'ok'` and `gpuNameFromPci` is set — a callout naming the situation and showing the commands (`sudo ubuntu-drivers install`, `sudo reboot`), with the warning that a reboot is required. **Advisory only — no button runs this.**
3. **Ollama blocker**, when `!reachable` — an Install button opening the guided-install terminal with id `ollama`.

Neither blocker hides the rest of the page. A user should be able to see what they would get once it is sorted.

- [ ] **Step 3: Register the route and nav entry**

Add the route in `App.tsx` following the `lazyPage` pattern the other settings pages use, and add a "AI models" entry to the settings navigation beside the other admin-only entries.

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc -b --force && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/llm.ts frontend/src/pages/settings/AiModelsSettingsPage.tsx frontend/src/App.tsx
git commit -m "feat(llm): AI models settings page with hardware and blocker states"
```

---

### Task 11: Role sections, fit badges, and combined footprint

**Files:**
- Create: `frontend/src/components/settings/ModelRoleSection.tsx`
- Modify: `frontend/src/pages/settings/AiModelsSettingsPage.tsx`

**Interfaces:**
- Consumes: `llmApi`, `CatalogEntry`, `LlmStatus` (Task 10).
- Produces: `ModelRoleSection` — props `{ role, title, description, models, status, onSelect, onInstall, onRemove, disabled }`.

- [ ] **Step 1: Build the role section component**

One section per role, each listing that role's catalog entries. Per model: label, size, the `notes` line, and a fit badge:

| Verdict | Badge | Copy |
|---|---|---|
| `recommended` | default variant | "Recommended" |
| `fits` | secondary | "Works on your GPU" |
| `cpu-only` | outline | "CPU only — expect minutes per scan, not seconds" |
| `too-large` | destructive outline | "Too large for this machine" |

The action depends on state: **Install** when not in `status.installed`; **Select** when installed but not selected; **Selected** (disabled) when current; **Remove** as a secondary action on installed, non-selected models.

Selecting an uninstalled model installs it first, then selects — one click, two operations.

Use `ConfirmDialog` for Remove, matching how destructive actions work elsewhere in this codebase.

- [ ] **Step 2: Wire both sections into the page**

Titles: "Receipt & text understanding" and "Image understanding". Filter `catalog.models` by role.

Below both, render the **combined footprint** when `status.footprint.exceedsVram`:

> Your two selections need 10.7 GB of VRAM together; your card has 8 GB. They'll work — Ollama swaps between them — but expect about 10 seconds extra on the first use after idle.

Compute the phrasing from `footprint.totalVramMb` and `hardware.gpu.vramTotalMb`. This sentence is the entire reason footprint is computed jointly rather than per-model; do not drop it.

Also surface `status.missing` — when a selected model is no longer installed, show it inline on that role with a re-pull action. Without this, deleting the active model turns every scan into a failure with no visible cause.

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc -b --force && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/settings/ModelRoleSection.tsx frontend/src/pages/settings/AiModelsSettingsPage.tsx
git commit -m "feat(llm): per-role model sections with fit badges and footprint warning"
```

---

### Task 12: Pull progress and the advanced field

**Files:**
- Modify: `frontend/src/pages/settings/AiModelsSettingsPage.tsx`
- Modify: `frontend/src/api/llm.ts` (socket subscription helper)

**Interfaces:**
- Consumes: the `/llm` socket namespace (Task 6), `llmApi.pullModel` (Task 10).
- Produces: live pull progress in the UI.

- [ ] **Step 1: Subscribe to pull progress**

Connect to the `/llm` namespace and listen for `pull:progress`, following how the app already creates socket connections elsewhere (grep for the existing socket client setup rather than inventing one). Keep progress keyed by `pullId`.

On mount the server replays any running pull, so a page refresh mid-download picks the progress back up rather than looking idle — that is the behaviour to verify, not just the code path.

- [ ] **Step 2: Render progress**

While a pull is running, replace that model's action button with a progress bar showing `completed / total` as bytes and a **Cancel** control emitting `pull:cancel`.

On `state: 'failed'`, show `error` verbatim — disk-full and network-refused need different responses from the user, and a generic "pull failed" tells them nothing.

On `state: 'done'`, refetch status so the model moves from Install to Select without a manual reload.

- [ ] **Step 3: Add the advanced field**

A collapsed "Advanced" section with a text input accepting any Ollama tag and a Pull button. Include a plain warning: fit cannot be predicted for models outside the catalog, and an oversized model will simply fail to load.

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc -b --force && npm run lint`
Expected: clean.

- [ ] **Step 5: Walk it in a browser**

Start the stack with `./dev.sh start`. With Playwright, open `/settings/ai-models` and confirm: the hardware summary matches reality on the dev machine; with Ollama absent, the install blocker appears and the rest of the page still renders; fit badges are present on every model. If Ollama is available locally, pull a small model (`qwen2.5:1.5b`) and confirm the progress bar advances, survives a page refresh, and that the model becomes selectable when done.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/settings/AiModelsSettingsPage.tsx frontend/src/api/llm.ts
git commit -m "feat(llm): live pull progress and advanced tag field"
```

---

## Deferred / out of scope

From the spec's out-of-scope list, named here so they are not mistaken for gaps:

- Installing the GPU driver from the GUI on a running box — advisory only, by design
- Non-NVIDIA acceleration (ROCm, Intel) — detection reports no usable GPU and falls back to RAM-based fit
- Remote Ollama instances — `OLLAMA_HOST` stays env-configured
- Per-household model selection — the model is a property of the machine
- Fine-tuning, quantisation selection, per-model parameter tuning


