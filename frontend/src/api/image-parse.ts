import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import { API_BASE_URL } from '@/lib/constants';
import type { ApiResponse } from '@/types/api';

// Types matching backend schemas
export type ParsedContentType = 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
export type ImageParseStatus = 'uploading' | 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ProcessingStage = 'queued' | 'vlm_started' | 'vlm_done' | 'llm_started' | 'llm_done' | null;

export interface ParsedListItem {
  content: string;
  isChecked?: boolean;
  dueDate?: string;
  confidence: number;
}

export interface ParsedListContent {
  title?: string;
  items: ParsedListItem[];
  suggestedListType: 'checklist' | 'reminder' | 'notes';
}

export interface ParsedRecipeIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  notes?: string;
  confidence: number;
}

export interface ParsedRecipeContent {
  title: string;
  description?: string;
  instructions: string[];
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  servings?: number;
  imageUrl?: string;
  ingredients: ParsedRecipeIngredient[];
}

export interface ParsedCalendarEvent {
  title: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  allDay?: boolean;
  recurrenceHint?: string;
  confidence: number;
}

export interface ParsedCalendarContent {
  events: ParsedCalendarEvent[];
}

export type ParsedContent =
  | { type: 'list'; data: ParsedListContent }
  | { type: 'recipe'; data: ParsedRecipeContent }
  | { type: 'calendar_event'; data: ParsedCalendarContent }
  | { type: 'mixed'; data: unknown }
  | { type: 'unknown'; data: { rawText: string } };

export interface ImageParseSession {
  id: string;
  householdId: string;
  userId: string;
  status: ImageParseStatus;
  processingStage: ProcessingStage;
  detectedType: ParsedContentType | null;
  selectedType: ParsedContentType | null;
  confidence: string | null;
  parsedContent: ParsedContent | null;
  parseWarnings: string[];
  hasImage: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface AIStatus {
  available: boolean;
  name: string;
  model?: string;
  gpuAccelerated?: boolean;
  expectedProcessingMs?: number;
  error?: string;
}

// API functions
export const imageParseApi = {
  /**
   * Get AI service status
   */
  getStatus: () =>
    apiGet<AIStatus>('/image-parse/status'),

  /**
   * Upload an image and start a parsing session
   */
  uploadImage: async (
    file: File,
    targetType?: ParsedContentType,
    onProgress?: (progress: number) => void
  ): Promise<{ sessionId: string; status: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (targetType) {
      formData.append('targetType', targetType);
    }

    const url = `${API_BASE_URL}/image-parse/upload`;

    if (onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const data = JSON.parse(xhr.responseText) as ApiResponse<{ sessionId: string; status: string }>;
            if (data.success && data.data) {
              resolve(data.data);
            } else {
              reject(new Error('Upload failed'));
            }
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Upload failed'));
        });

        xhr.open('POST', url);
        xhr.withCredentials = true;
        xhr.send(formData);
      });
    }

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error?.message || 'Upload failed');
    }

    return data.data;
  },

  /**
   * Get session status and parsed content
   */
  getSession: (sessionId: string) =>
    apiGet<{ session: ImageParseSession }>(`/image-parse/${sessionId}`),

  /**
   * Reprocess session with AI
   */
  reprocess: (sessionId: string) =>
    apiPost<{ status: string }>(`/image-parse/${sessionId}/reprocess`),

  /**
   * Update the selected content type
   */
  updateType: (sessionId: string, type: ParsedContentType) =>
    apiPatch<{ session: ImageParseSession }>(`/image-parse/${sessionId}/type`, { type }),

  /**
   * Update parsed content (list)
   */
  updateListContent: (
    sessionId: string,
    content: {
      title?: string;
      items: Array<{ content: string; isChecked?: boolean; dueDate?: string }>;
      listType?: 'checklist' | 'reminder' | 'notes';
    }
  ) => apiPatch<{ session: ImageParseSession }>(`/image-parse/${sessionId}/content`, content),

  /**
   * Update parsed content (recipe)
   */
  updateRecipeContent: (
    sessionId: string,
    content: {
      title?: string;
      description?: string;
      instructions?: string[];
      prepTimeMinutes?: number | null;
      cookTimeMinutes?: number | null;
      servings?: number | null;
      ingredients?: Array<{
        name: string;
        quantity?: number | null;
        unit?: string | null;
        notes?: string | null;
      }>;
    }
  ) => apiPatch<{ session: ImageParseSession }>(`/image-parse/${sessionId}/content`, content),

  /**
   * Update parsed content (calendar)
   */
  updateCalendarContent: (
    sessionId: string,
    content: {
      events: Array<{
        title: string;
        description?: string | null;
        location?: string | null;
        startTime?: string | null;
        endTime?: string | null;
        allDay?: boolean;
      }>;
    }
  ) => apiPatch<{ session: ImageParseSession }>(`/image-parse/${sessionId}/content`, content),

  /**
   * Confirm session and create entities
   */
  confirm: (
    sessionId: string,
    options?: {
      listId?: string;
      listName?: string;
      listType?: 'checklist' | 'reminder' | 'notes';
      recipeOverrides?: {
        title?: string;
        description?: string;
        prepTimeMinutes?: number | null;
        cookTimeMinutes?: number | null;
        servings?: number | null;
      };
      calendarId?: string;
    }
  ) => apiPost<{ type: string; createdIds: string[] }>(`/image-parse/${sessionId}/confirm`, options),

  /**
   * Cancel session
   */
  cancel: (sessionId: string) =>
    apiDelete<{ message: string }>(`/image-parse/${sessionId}`),
};
