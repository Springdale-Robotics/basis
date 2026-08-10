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
