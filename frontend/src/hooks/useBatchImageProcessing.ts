import { useCallback, useEffect, useRef, useState } from 'react';
import { imageParseApi } from '@/api/image-parse';
import { formatOcrForEditing } from '@/lib/recipe-utils';

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
    const newItems: BatchItem[] = arr.map((f, i) => ({
      id: `img-${Date.now()}-${i}`,
      label: f.name,
      status: 'pending',
      file: f,
    }));
    setItems(prev => [...prev, ...newItems]);
  }, []);

  const addRecipeFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    Array.from(files).forEach((file, i) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.version && data.type === 'recipe' && data.recipe) {
            setItems(prev => [...prev, {
              id: `file-${Date.now()}-${i}`,
              label: file.name,
              status: 'ready',
              ocrText: JSON.stringify(data),
            }]);
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
            return {
              ...item,
              status: 'ready',
              ocrText: formatOcrForEditing(session.rawText, session.parsedContent),
            };
          }
          if (session.status === 'failed') {
            return { ...item, status: 'failed', error: 'Image processing failed' };
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
