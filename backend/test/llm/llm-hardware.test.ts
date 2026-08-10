import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseNvidiaSmi,
  parseLspciVga,
  parseMemAvailable,
  detectHardware,
  resetHardwareCache,
} from '../../src/modules/llm/llm-hardware.js';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

// detectHardware shells out via execFile and reads /proc files. Tests never
// invoke the real commands — instead we replace child_process/fs.promises
// with controllable doubles. execFile is promisified via
// util.promisify.custom (Node's special-cased async form), so the double has
// to implement that symbol directly rather than the callback-style export.
const { execFileImpl, readFileImpl } = vi.hoisted(() => ({
  execFileImpl: vi.fn(),
  readFileImpl: vi.fn(),
}));

vi.mock('child_process', async () => {
  const nodeUtil = await import('util');
  const execFile: unknown = () => {
    throw new Error('execFile called without promisify — test double misused');
  };
  (execFile as Record<PropertyKey, unknown>)[nodeUtil.promisify.custom] = (
    ...args: unknown[]
  ) => execFileImpl(...args);
  return { execFile };
});

vi.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => readFileImpl(...args),
}));

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

describe('detectHardware', () => {
  const NVIDIA_SMI_ARGS = [
    '--query-gpu=name,memory.total,memory.free',
    '--format=csv,noheader,nounits',
  ];
  const CPUINFO_NO_AVX2 = 'flags\t\t: fpu vme de pse tsc msr\n';
  const MEMINFO = fixture('meminfo-7gb.txt');

  const nvidiaSmiFixture = fixture('nvidia-smi-rtx3050.txt');
  const lspciNvidiaFixture = fixture('lspci-rtx3050.txt');
  const lspciNoGpuFixture = fixture('lspci-no-gpu.txt');

  const ENOENT = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });

  /** Wires the execFile double to answer nvidia-smi and lspci independently. */
  function mockProbes(opts: {
    nvidiaSmi: string | 'fail';
    lspci: string | 'fail';
  }) {
    execFileImpl.mockImplementation((cmd: string) => {
      if (cmd === 'nvidia-smi') {
        return opts.nvidiaSmi === 'fail'
          ? Promise.reject(ENOENT)
          : Promise.resolve({ stdout: opts.nvidiaSmi, stderr: '' });
      }
      if (cmd === 'lspci') {
        return opts.lspci === 'fail'
          ? Promise.reject(ENOENT)
          : Promise.resolve({ stdout: opts.lspci, stderr: '' });
      }
      return Promise.reject(new Error(`unexpected execFile call: ${cmd}`));
    });
  }

  /** Wires the readFile double for /proc/meminfo, /proc/cpuinfo, /proc/modules. */
  function mockProcFiles(opts: { modules?: string | 'fail' }) {
    readFileImpl.mockImplementation((path: string) => {
      if (path === '/proc/meminfo') return Promise.resolve(MEMINFO);
      if (path === '/proc/cpuinfo') return Promise.resolve(CPUINFO_NO_AVX2);
      if (path === '/proc/modules') {
        return opts.modules === undefined || opts.modules === 'fail'
          ? Promise.reject(ENOENT)
          : Promise.resolve(opts.modules);
      }
      return Promise.reject(ENOENT);
    });
  }

  beforeEach(() => {
    resetHardwareCache();
    execFileImpl.mockReset();
    readFileImpl.mockReset();
  });

  afterEach(() => {
    resetHardwareCache();
  });

  it("reports driverState 'ok' when nvidia-smi works and lspci also sees the card", async () => {
    mockProbes({ nvidiaSmi: nvidiaSmiFixture, lspci: lspciNvidiaFixture });
    mockProcFiles({});

    const profile = await detectHardware();

    expect(profile.driverState).toBe('ok');
    expect(profile.gpu).toEqual({
      name: 'NVIDIA GeForce RTX 3050',
      vramTotalMb: 8192,
      vramFreeMb: 7943,
    });
    expect(profile.gpuNameFromPci).toContain('GeForce RTX 3050');
  });

  it("reports driverState 'ok' when nvidia-smi works but lspci is unavailable", async () => {
    // Regression: minimal/containerized images often ship nvidia-smi without
    // pciutils. A working nvidia-smi is proof of a card on its own — the
    // profile must not contradict its own populated `gpu` field by also
    // claiming 'not-applicable'.
    mockProbes({ nvidiaSmi: nvidiaSmiFixture, lspci: 'fail' });
    mockProcFiles({});

    const profile = await detectHardware();

    expect(profile.driverState).toBe('ok');
    expect(profile.gpu).not.toBeNull();
    expect(profile.gpuNameFromPci).toBeNull();
  });

  it("reports driverState 'nouveau' when the card is present but only the open-source driver is loaded", async () => {
    mockProbes({ nvidiaSmi: 'fail', lspci: lspciNvidiaFixture });
    mockProcFiles({ modules: 'nouveau 2097152 1 - Live 0x0000000000000000\n' });

    const profile = await detectHardware();

    expect(profile.driverState).toBe('nouveau');
    expect(profile.gpu).toBeNull();
    expect(profile.gpuNameFromPci).toContain('GeForce RTX 3050');
  });

  it("reports driverState 'missing' when the card is present but no driver at all is loaded", async () => {
    mockProbes({ nvidiaSmi: 'fail', lspci: lspciNvidiaFixture });
    mockProcFiles({ modules: 'ext4 819200 1 - Live 0x0000000000000000\n' });

    const profile = await detectHardware();

    expect(profile.driverState).toBe('missing');
    expect(profile.gpu).toBeNull();
    expect(profile.gpuNameFromPci).toContain('GeForce RTX 3050');
  });

  it("reports driverState 'not-applicable' when there is no card at all", async () => {
    mockProbes({ nvidiaSmi: 'fail', lspci: lspciNoGpuFixture });
    mockProcFiles({});

    const profile = await detectHardware();

    expect(profile.driverState).toBe('not-applicable');
    expect(profile.gpu).toBeNull();
    expect(profile.gpuNameFromPci).toBeNull();
  });

  it('does not let a caller mutating a returned profile corrupt the cached copy', async () => {
    mockProbes({ nvidiaSmi: nvidiaSmiFixture, lspci: lspciNvidiaFixture });
    mockProcFiles({});

    const first = await detectHardware();
    // Simulate a careless caller mutating the profile it was handed —
    // e.g. a later task annotating a recommendation onto it.
    first.gpu!.vramFreeMb = 0;
    (first as { driverState: string }).driverState = 'missing';

    const second = await detectHardware();

    expect(second.gpu!.vramFreeMb).toBe(7943);
    expect(second.driverState).toBe('ok');
    expect(second.gpu).not.toBe(first.gpu);
  });
});
