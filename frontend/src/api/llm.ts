import { apiGet, apiPost, apiPut, apiDelete } from './client';

export type FitVerdict = 'recommended' | 'fits' | 'cpu-only' | 'too-large';
export type DriverState = 'ok' | 'missing' | 'nouveau' | 'not-applicable';
export type ModelRole = 'text' | 'vision';

export interface HardwareProfile {
  /** Populated only when a working driver reports it. */
  gpu: { name: string; vramTotalMb: number; vramFreeMb: number } | null;
  /** The card as seen on the PCI bus — visible even with no driver at all. */
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

export interface UpdateLlmSettingsRequest {
  textModel?: string;
  visionModel?: string;
}

export const llmApi = {
  getHardware: () => apiGet<HardwareProfile>('/llm/hardware'),

  getCatalog: () => apiGet<{ models: CatalogEntry[] }>('/llm/catalog'),

  getStatus: () => apiGet<LlmStatus>('/llm/status'),

  setModels: (data: UpdateLlmSettingsRequest) =>
    apiPut<{ text: string; vision: string }>('/llm/settings', data),

  pullModel: (tag: string) => apiPost<{ pullId: string }>('/llm/models/pull', { tag }),

  deleteModel: (tag: string) =>
    apiDelete<{ message: string }>(`/llm/models/${encodeURIComponent(tag)}`),
};
