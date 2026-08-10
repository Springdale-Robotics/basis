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
    // Corrected fixture: with the default hw()'s GPU headroom threshold
    // (8000 * 0.85 = 6800MB) already higher than the max possible RAM budget
    // (6122 available - 1500 reserve = 4622MB), no vramMb value can exceed GPU
    // capacity while still fitting the RAM budget on that hardware — a 12000MB
    // model (as originally written here) is too-large for both, not cpu-only.
    // Shrinking the GPU opens room between the two thresholds so this test can
    // actually exercise the CPU-fallback path it's named for.
    expect(
      computeFit(
        model({ vramMb: 4000 }),
        hw({ gpu: { name: 'RTX 3050', vramTotalMb: 8192, vramFreeMb: 4000 } })
      )
    ).toBe('cpu-only');
  });

  it('is too-large when it fits neither', () => {
    expect(computeFit(model({ vramMb: 40000 }), hw())).toBe('too-large');
  });

  it('ignores a GPU whose driver does not work', () => {
    // A card on nouveau cannot run inference; treating it as usable would
    // recommend a model that then silently runs on the CPU.
    // Corrected fixture: the default hw()'s RAM budget (6122 available - 1500
    // reserve = 4622MB) is 78MB short of the default model's 4700MB footprint,
    // so as originally written this test's model didn't fit RAM either — a
    // coincidental miss, not a deliberate one. Nudging available RAM up keeps
    // this a genuine "small enough for CPU" case so it actually demonstrates
    // the nouveau fallback rather than accidentally landing on too-large.
    expect(
      computeFit(
        model({ default: true }),
        hw({ gpu: null, driverState: 'nouveau', ramAvailableMb: 6300 })
      )
    ).toBe('cpu-only');
  });

  it('uses available RAM, not total, for the CPU budget', () => {
    // 6500MB fits in 7289MB total but not in 6122MB available — the difference
    // between a working box and one that OOMs the app it is serving.
    expect(computeFit(model({ vramMb: 99999 }), hw({ gpu: null, driverState: 'missing' })))
      .toBe('too-large');
    expect(
      computeFit(
        model({ vramMb: 99999, downloadBytes: 1 }),
        hw({ gpu: null, driverState: 'missing', ramAvailableMb: 200 })
      )
    ).toBe('too-large');
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
