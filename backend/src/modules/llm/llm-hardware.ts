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
  if (!cardPresent) return 'not-applicable';
  if (hasNvidiaSmi) return 'ok';
  const modules = await readFile('/proc/modules', 'utf8').catch(() => '');
  return /^nouveau /m.test(modules) ? 'nouveau' : 'missing';
}

let cached: { at: number; profile: HardwareProfile } | null = null;

export async function detectHardware(): Promise<HardwareProfile> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.profile;

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
    driverState: await detectDriverState(gpu !== null, fromPci !== null),
    ramTotalMb: Math.floor(totalmem() / 1024 / 1024),
    ramAvailableMb: parseMemAvailable(meminfo) || Math.floor(totalmem() / 1024 / 1024),
    cpuCores: cpus().length,
    hasAvx2: /\bavx2\b/.test(cpuinfo),
  };

  logger.debug({ profile }, 'Detected LLM hardware');
  cached = { at: Date.now(), profile };
  return profile;
}

/** Test seam — clears the cache so a test can vary the environment. */
export function resetHardwareCache(): void {
  cached = null;
}
