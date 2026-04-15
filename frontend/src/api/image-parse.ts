import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import { API_BASE_URL } from '@/lib/constants';
import type { ApiResponse } from '@/types/api';

// Types matching backend schemas
export type ParsedContentType = 'list' | 'recipe' | 'calendar_event' | 'mixed' | 'unknown';
export type ImageParseStatus = 'uploading' | 'processing' | 'review' | 'confirmed' | 'cancelled' | 'failed';
export type ProcessingStage = 'queued' | 'vlm_started' | 'vlm_done' | 'llm_started' | 'llm_done' | 'counsel_vlm' | 'counsel_interpretations' | 'counsel_discussion' | 'counsel_voting' | 'counsel_finalizing' | null;
export type ExtractionMode = 'accurate' | 'thorough' | 'counsel';

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
  extractionMode: ExtractionMode;
  detectedType: ParsedContentType | null;
  selectedType: ParsedContentType | null;
  confidence: string | null;
  rawText: string | null;  // Raw text extracted by VLM
  parsedContent: ParsedContent | null;
  parseWarnings: string[];
  hasImage: boolean;
  createdAt: string;
  expiresAt: string;
  counselDiscussion?: CounselDiscussionData;
}

// Counsel mode types
export interface CounselPersonaInterpretation {
  personaId: string;
  personaName: string;
  title: string;
  ingredientCount: number;
  notes: string[];
  concerns: string[];
  confidence: number;
}

export interface CounselDiscussionMessage {
  speakerId: string;
  speakerName: string;
  message: string;
  topic: string;
  messageType: 'statement' | 'rebuttal' | 'agreement' | 'vote';
}

export interface CounselVoteResult {
  topic: string;
  winner: string;
  tally: Record<string, number>;
  reasoning: string;
}

export interface CounselDiscussionData {
  interpretations: CounselPersonaInterpretation[];
  disagreements: Array<{
    topic: string;
    description: string;
    positions: Record<string, string>;
  }>;
  discussion: CounselDiscussionMessage[];
  votes: CounselVoteResult[];
}

// SSE event types for counsel mode
export type CounselEventType =
  | 'vlm_complete'
  | 'stage'
  | 'persona_thinking'
  | 'persona_interpretation'
  | 'disagreement'
  | 'consensus'
  | 'discussion_topic'
  | 'discussion'
  | 'vote'
  | 'final_result'
  | 'error';

export interface CounselSSECallbacks {
  onVlmComplete?: (data: { passes: number; text_length: number }) => void;
  onStage?: (data: { stage: string; message: string }) => void;
  onPersonaThinking?: (data: { persona_id: string; persona_name: string }) => void;
  onPersonaInterpretation?: (data: CounselPersonaInterpretation) => void;
  onDisagreement?: (data: { topic: string; description: string; positions: Record<string, string> }) => void;
  onConsensus?: (data: { message: string }) => void;
  onDiscussionTopic?: (data: { topic: string }) => void;
  onDiscussion?: (data: CounselDiscussionMessage) => void;
  onVote?: (data: CounselVoteResult) => void;
  onFinalResult?: (data: unknown) => void;
  onError?: (data: { message: string }) => void;
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
    onProgress?: (progress: number) => void,
    extractionMode: ExtractionMode = 'accurate'
  ): Promise<{ sessionId: string; status: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (targetType) {
      formData.append('targetType', targetType);
    }
    formData.append('extractionMode', extractionMode);

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

  /**
   * Subscribe to counsel mode SSE stream
   * Returns an EventSource that can be closed when done
   */
  subscribeCounselStream: (
    sessionId: string,
    callbacks: CounselSSECallbacks
  ): EventSource => {
    const url = `${API_BASE_URL}/image-parse/${sessionId}/counsel/stream`;
    const es = new EventSource(url, { withCredentials: true });

    // Map event types to callbacks
    es.addEventListener('vlm_complete', (e) => {
      callbacks.onVlmComplete?.(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener('stage', (e) => {
      callbacks.onStage?.(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener('persona_thinking', (e) => {
      callbacks.onPersonaThinking?.(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener('persona_interpretation', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      callbacks.onPersonaInterpretation?.({
        personaId: data.persona_id,
        personaName: data.persona_name,
        title: data.title,
        ingredientCount: data.ingredient_count,
        notes: data.notes || [],
        concerns: data.concerns || [],
        confidence: data.confidence,
      });
    });

    es.addEventListener('disagreement', (e) => {
      callbacks.onDisagreement?.(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener('consensus', (e) => {
      callbacks.onConsensus?.(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener('discussion_topic', (e) => {
      callbacks.onDiscussionTopic?.(JSON.parse((e as MessageEvent).data));
    });

    es.addEventListener('discussion', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      callbacks.onDiscussion?.({
        speakerId: data.speaker_id,
        speakerName: data.speaker_name,
        message: data.message,
        topic: data.topic,
        messageType: data.message_type,
      });
    });

    es.addEventListener('vote', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      callbacks.onVote?.({
        topic: data.topic,
        winner: data.winner,
        tally: data.tally,
        reasoning: data.reasoning,
      });
    });

    es.addEventListener('final_result', (e) => {
      callbacks.onFinalResult?.(JSON.parse((e as MessageEvent).data));
      es.close(); // Close when done
    });

    es.addEventListener('error', (e) => {
      if ((e as MessageEvent).data) {
        callbacks.onError?.(JSON.parse((e as MessageEvent).data));
      }
      es.close();
    });

    // Handle connection errors
    es.onerror = () => {
      callbacks.onError?.({ message: 'Connection lost' });
    };

    return es;
  },
};
