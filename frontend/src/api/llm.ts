import { io, type Socket } from 'socket.io-client';
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

/** Mirrors the backend's PullState (backend/src/modules/llm/llm.ws.ts) — the
 *  shape of every `pull:progress` event on the /llm socket namespace. */
export interface PullState {
  id: string;
  tag: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  status: string;
  completed: number;
  total: number;
  error?: string;
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

/**
 * Opens the /llm socket.io namespace used for live model-pull progress.
 * Follows the same connection pattern as the /install namespace (see
 * PtyTerminal / GuidedInstallDialog): the session cookie carries auth, so no
 * token plumbing is needed. On connect the server replays any pull that is
 * still running, so a caller that mounts mid-download catches up rather than
 * starting from an idle-looking state.
 *
 * Callers own the socket's lifetime — disconnect it on unmount.
 */
export function connectLlmSocket(): Socket {
  return io('/llm', { withCredentials: true });
}

/** Requests cancellation of an in-flight pull. The server confirms via the
 *  next `pull:progress` event (state: 'cancelled'), not a direct reply. */
export function cancelPull(socket: Socket, pullId: string): void {
  socket.emit('pull:cancel', { pullId });
}
