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

/**
 * Ollama reports a versionless tag back as `name:latest` — `/api/tags` lists
 * `moondream` as `moondream:latest`. Strict string comparison between what an
 * admin selected (or what the catalog holds) and what Ollama reports would
 * therefore miss on exactly those tags, which reads to the user as "the pull
 * never finished" or "the selected model isn't installed" on a box where it
 * plainly is. Normalise both sides of every such comparison.
 *
 * Mirrored in `frontend/src/api/llm.ts` — keep the two in step.
 */
export function normalizeTag(tag: string): string {
  return tag.includes(':') ? tag : `${tag}:latest`;
}

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
    // Explicitly `:latest` — every other entry is versioned, and Ollama
    // reports a versionless tag back as `:latest` anyway.
    tag: 'moondream:latest',
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
    // Both sides normalised: a stored `moondream:latest` selection has to
    // resolve against the catalog whichever shape either one is written in,
    // or the footprint silently under-reports by that model's whole size.
    const wanted = normalizeTag(tag);
    const entry = CATALOG.find((m) => normalizeTag(m.tag) === wanted);
    return sum + (entry?.vramMb ?? 0);
  }, 0);

  const vram = usableVramMb(hw);
  return { totalVramMb, exceedsVram: vram > 0 && totalVramMb > vram };
}
