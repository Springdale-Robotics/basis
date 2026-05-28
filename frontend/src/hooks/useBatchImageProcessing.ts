import { useCallback, useEffect, useRef, useState } from 'react';
import { imageParseApi } from '@/api/image-parse';
import { formatOcrForEditing } from '@/lib/recipe-utils';
import { generateId } from '@/lib/utils';

export interface BatchItem {
  id: string;
  label: string;
  // Image-mode tracking
  imageSessionId?: string;
  file?: File;
  // Mode-agnostic
  importSessionId?: string;
  ocrText?: string;
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';
  error?: string;
  excluded?: boolean;
}

interface UseBatchImageProcessingOptions {
  /** How many concurrent image uploads to allow. */
  concurrency?: number;
  /** Polling interval in ms. */
  pollIntervalMs?: number;
}

interface UseBatchImageProcessingResult {
  items: BatchItem[];
  setItems: React.Dispatch<React.SetStateAction<BatchItem[]>>;
  /** Add image File(s) to the queue (no upload yet). */
  addImageFiles: (files: FileList | File[] | null) => void;
  /** Add pre-parsed .recipe File(s); they enter as `ready` immediately. */
  addRecipeFiles: (files: FileList | File[] | null) => void;
  /** Upload all pending image items concurrently and start polling for status. */
  startImageProcessing: () => Promise<void>;
  /** Cancel polling and clear items. */
  reset: () => void;
}

/**
 * Encapsulates the bulk image-import lifecycle:
 *   - queue management (`items` + ref for stable polling reads)
 *   - concurrent upload pool (default 3 workers)
 *   - background polling of `imageParseApi.getBatchStatus` until every item
 *     reaches a terminal state ('ready' or 'failed')
 *
 * Pulled out of BulkImportRecipeDialog so the dialog can stay focused on
 * step orchestration + JSX, and so the lifecycle can be reused if another
 * surface ever needs the same batch flow.
 */
export function useBatchImageProcessing(
  options: UseBatchImageProcessingOptions = {},
): UseBatchImageProcessingResult {
  const { concurrency = 3, pollIntervalMs = 3000 } = options;
  const [items, setItems] = useState<BatchItem[]>([]);
  const itemsRef = useRef<BatchItem[]>([]);
  itemsRef.current = items;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-clear interval on unmount.
  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
  }, []);

  const addImageFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (arr.length === 0) return;
    const newItems: BatchItem[] = arr.map((f) => ({
      // crypto.randomUUID() instead of Date.now() so React StrictMode's
      // double-invoke of effects doesn't produce colliding keys.
      id: `img-${generateId()}`,
      label: f.name,
      status: 'pending',
      file: f,
    }));
    setItems(prev => {
      // Dedupe by File reference — protects against the same useEffect
      // firing twice (StrictMode) with the same initialFiles array.
      const existingFiles = new Set(prev.map(p => p.file).filter(Boolean));
      const fresh = newItems.filter(n => !existingFiles.has(n.file));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  const addRecipeFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.version && data.type === 'recipe' && data.recipe) {
            const payload = JSON.stringify(data);
            setItems(prev => {
              // Same StrictMode protection as addImageFiles — dedupe by the
              // serialised payload so the second invocation doesn't duplicate.
              if (prev.some(p => p.label === file.name && p.ocrText === payload)) return prev;
              return [...prev, {
                id: `file-${generateId()}`,
                label: file.name,
                status: 'ready',
                ocrText: payload,
              }];
            });
          }
        } catch {
          // Skip invalid files
        }
      };
      reader.readAsText(file);
    });
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    const poll = async () => {
      const currentItems = itemsRef.current;
      const processingItems = currentItems.filter(
        i => i.imageSessionId && (i.status === 'processing' || i.status === 'uploading'),
      );
      const sessionIds = processingItems.map(i => i.imageSessionId!).filter(Boolean);
      if (sessionIds.length === 0) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        return;
      }

      try {
        const result = await imageParseApi.getBatchStatus(sessionIds);
        setItems(prev => prev.map(item => {
          if (!item.imageSessionId) return item;
          const session = result.sessions.find(s => s.id === item.imageSessionId);
          if (!session) return item;
          if (session.status === 'review') {
            // The backend marks the session 'review' even when the AI returned
            // nothing (parseWarnings says so). Treat that as a failure here so
            // the user sees a clear "failed" pill instead of an empty success.
            const hasContent = !!session.rawText || !!session.parsedContent;
            if (!hasContent) {
              const warning = session.parseWarnings?.[0] ?? 'No text extracted from image';
              return { ...item, status: 'failed', error: warning };
            }
            return {
              ...item,
              status: 'ready',
              ocrText: formatOcrForEditing(session.rawText, session.parsedContent),
            };
          }
          if (session.status === 'failed') {
            const warning = session.parseWarnings?.[0] ?? 'Image processing failed';
            return { ...item, status: 'failed', error: warning };
          }
          return item;
        }));

        if (result.summary.allDone) {
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch {
        // Continue polling on transient errors.
      }
    };

    pollingRef.current = setInterval(poll, pollIntervalMs);
    poll(); // Run immediately
  }, [pollIntervalMs]);

  const startImageProcessing = useCallback(async () => {
    const pending = itemsRef.current.filter(i => i.status === 'pending' && i.file);
    if (pending.length === 0) {
      startPolling();
      return;
    }

    let index = 0;
    const uploadNext = async (): Promise<void> => {
      while (index < pending.length) {
        const item = pending[index++];
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'uploading' } : i));
        try {
          const { sessionId } = await imageParseApi.uploadImage(item.file!, 'recipe', undefined, 'accurate');
          setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, status: 'processing', imageSessionId: sessionId } : i
          ));
        } catch (e) {
          setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, status: 'failed', error: (e as Error).message } : i
          ));
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => uploadNext());
    await Promise.all(workers);
    startPolling();
  }, [concurrency, startPolling]);

  const reset = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setItems([]);
  }, []);

  return { items, setItems, addImageFiles, addRecipeFiles, startImageProcessing, reset };
}
