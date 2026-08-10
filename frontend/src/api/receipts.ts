import { apiGet, apiPost, apiPatch, apiDelete, apiUpload } from './client';

export type ReceiptScanStatus = 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ReceiptLineResolution = 'unresolved' | 'link' | 'ignore';
export type ReceiptProcessingStage = 'queued' | 'ocr' | 'structuring' | 'matching' | 'done';

export interface ReceiptLineSuggestion {
  itemId: string;
  name: string;
  confidence: number;
  matchReason: 'exact' | 'synonym' | 'contains' | 'fuzzy';
}

export interface ReceiptScanLine {
  id: string;
  lineIndex: number;
  rawText: string;
  merchantCode: string | null;
  count: string;
  price: string | null;
  ocrConfidence: string | null;
  resolution: ReceiptLineResolution;
  itemId: string | null;
  unitsPerCount: string | null;
  targetAreaId: string | null;
  suggestions: ReceiptLineSuggestion[];
}

export interface ReceiptScan {
  id: string;
  merchant: string | null;
  purchasedAt: string | null;
  status: ReceiptScanStatus;
  processingStage: ReceiptProcessingStage | null;
  parseWarnings: string[];
  errorMessage: string | null;
  defaultAreaId: string | null;
  rawOcrText: string | null;
  createdAt: string;
  confirmedAt: string | null;
  lines: ReceiptScanLine[];
}

export interface ReceiptLineLink {
  id: string;
  merchant: string;
  lineKey: string;
  keyKind: 'code' | 'text';
  itemId: string;
  itemName: string;
  itemUnit: string | null;
  unitsPerCount: string;
  useCount: number;
  lastUsedAt: string | null;
  lastRawText: string | null;
}

export interface ConfirmResult {
  stockCreated: number;
  linksSaved: number;
  ignoredCount: number;
}

export interface UpdateLineRequest {
  resolution?: ReceiptLineResolution;
  itemId?: string | null;
  unitsPerCount?: number | null;
  targetAreaId?: string | null;
  count?: number;
  price?: number | null;
  rawText?: string;
}

export interface CreateItemForLineRequest {
  name: string;
  category?: string;
  defaultUnit?: string;
  defaultAreaId?: string;
  unitsPerCount: number;
}

export const receiptsApi = {
  getStatus: () =>
    apiGet<{ available: boolean; ocrAvailable: boolean; structurerAvailable: boolean }>(
      '/receipts/status'
    ),

  uploadScan: (file: File, onProgress?: (progress: number) => void) =>
    apiUpload<{ id: string; status: ReceiptScanStatus }>('/receipts/scans', file, { onProgress }),

  listScans: (status?: ReceiptScanStatus) =>
    apiGet<{ scans: Omit<ReceiptScan, 'lines'>[] }>('/receipts/scans', {
      params: status ? { status } : undefined,
    }),

  getScan: (id: string) => apiGet<{ scan: ReceiptScan }>(`/receipts/scans/${id}`),

  // Cheap poll while parsing — does not recompute per-line suggestions.
  getScanStatus: (id: string) =>
    apiGet<{
      status: ReceiptScanStatus;
      processingStage: ReceiptProcessingStage | null;
      errorMessage: string | null;
    }>(`/receipts/scans/${id}/status`),

  updateScan: (
    id: string,
    data: { merchant?: string; purchasedAt?: string | null; defaultAreaId?: string | null }
  ) => apiPatch<{ scan: ReceiptScan }>(`/receipts/scans/${id}`, data),

  updateLine: (scanId: string, lineId: string, data: UpdateLineRequest) =>
    apiPatch<{ scan: ReceiptScan }>(`/receipts/scans/${scanId}/lines/${lineId}`, data),

  createItemForLine: (scanId: string, lineId: string, data: CreateItemForLineRequest) =>
    apiPost<{ item: { id: string; name: string }; scan: ReceiptScan }>(
      `/receipts/scans/${scanId}/lines/${lineId}/create-item`,
      data
    ),

  reprocessScan: (id: string) =>
    apiPost<{ id: string; status: ReceiptScanStatus }>(`/receipts/scans/${id}/reprocess`, {}),

  confirmScan: (id: string) => apiPost<ConfirmResult>(`/receipts/scans/${id}/confirm`, {}),

  deleteScan: (id: string) => apiDelete<{ message: string }>(`/receipts/scans/${id}`),

  // The <img> element fetches this directly; cookies ride along on same-origin.
  getImageUrl: (id: string) => `/api/v1/receipts/scans/${id}/image`,

  listLinks: (params?: { merchant?: string; search?: string }) =>
    apiGet<{ links: ReceiptLineLink[] }>('/receipts/links', { params }),

  updateLink: (id: string, data: { itemId?: string; unitsPerCount?: number }) =>
    apiPatch<{ message: string }>(`/receipts/links/${id}`, data),

  deleteLink: (id: string) => apiDelete<{ message: string }>(`/receipts/links/${id}`),
};
