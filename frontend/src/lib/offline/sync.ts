import { listsApi } from '@/api/lists';
import { queryClient } from '@/providers/QueryProvider';
import { offlineDb, type QueuedMutation } from './db';

export interface SyncStatus {
  /** Queued mutations still waiting to be replayed. */
  remaining: number;
  /**
   * Cumulative count of mutations discarded during the current drain run
   * because the server permanently rejected them (4xx). Resets to 0 at the
   * start of each run.
   */
  discarded: number;
  /** Message from the most recent permanent failure, if any. */
  lastError?: string;
}

type SyncListener = (status: SyncStatus) => void;
const listeners = new Set<SyncListener>();

export function onDrain(cb: SyncListener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(status: SyncStatus) {
  for (const cb of listeners) cb(status);
}

/**
 * Re-count the queue and notify listeners. Called when a mutation is enqueued
 * (so the OfflineIndicator can show a pending count while offline) and by the
 * indicator on mount to pick up a queue persisted across reloads.
 */
export async function announceQueueSize(): Promise<void> {
  const remaining = (await offlineDb.queue.all()).length;
  notify({ remaining, discarded: 0 });
}

/**
 * Apply a single queued mutation against the live API. Returns true if the
 * server accepted it (we can pop). Returns false if it's a transient error
 * (network down — try again later). Throws on permanent errors so the caller
 * can decide whether to discard.
 */
async function replay(mut: QueuedMutation): Promise<boolean> {
  try {
    switch (mut.kind) {
      case 'addItem':
        await listsApi.createItem(
          mut.payload.listId as string,
          mut.payload.data as Parameters<typeof listsApi.createItem>[1],
        );
        return true;
      case 'bulkAdd':
        await listsApi.bulkCreateItems(
          mut.payload.listId as string,
          mut.payload.items as Parameters<typeof listsApi.bulkCreateItems>[1],
        );
        return true;
      case 'updateItem':
        await listsApi.updateItem(
          mut.payload.listId as string,
          mut.payload.itemId as string,
          mut.payload.data as Parameters<typeof listsApi.updateItem>[2],
        );
        return true;
      case 'deleteItem':
        await listsApi.deleteItem(
          mut.payload.listId as string,
          mut.payload.itemId as string,
        );
        return true;
      case 'toggleItem':
        await listsApi.toggleItem(
          mut.payload.listId as string,
          mut.payload.itemId as string,
        );
        return true;
      case 'claimItem':
        await listsApi.claimItem(
          mut.payload.listId as string,
          mut.payload.itemId as string,
        );
        return true;
      case 'reorder':
        await listsApi.reorderItems(mut.payload.listId as string, {
          order: mut.payload.order as Array<{ id: string; sortOrder: number }>,
        });
        return true;
      case 'clearChecked':
        await listsApi.clearCheckedItems(mut.payload.listId as string);
        return true;
      case 'createList':
        await listsApi.create(
          mut.payload.data as Parameters<typeof listsApi.create>[0],
        );
        return true;
      case 'updateList':
        await listsApi.update(
          mut.payload.id as string,
          mut.payload.data as Parameters<typeof listsApi.update>[1],
        );
        return true;
      case 'deleteList':
        await listsApi.delete(mut.payload.id as string);
        return true;
    }
  } catch (err) {
    // Surface error to caller — they'll decide retry vs discard.
    const msg = err instanceof Error ? err.message : String(err);
    // 4xx is permanent (auth/validation); 5xx and network errors are transient.
    if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
      return false;
    }
    throw err;
  }
  return true;
}

let draining = false;

/**
 * Drain the queue oldest-first. Stops on first transient failure. Pops on
 * success or permanent failure (we deliberately discard mutations that the
 * server rejects so we don't get stuck in a loop). Discards are surfaced to
 * listeners via `discarded`/`lastError` so the UI can tell the user.
 *
 * After a run that touched the server (replayed or discarded anything), the
 * lists queries are invalidated so ghost offline items get reconciled with
 * server truth.
 */
export async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  let discarded = 0;
  let replayed = 0;
  try {
    let remaining = (await offlineDb.queue.all()).length;
    notify({ remaining, discarded });
    while (true) {
      const queue = await offlineDb.queue.all();
      if (queue.length === 0) break;
      const head = queue[0];
      let ok = false;
      try {
        ok = await replay(head);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Permanent — drop it, and tell listeners so the user finds out.
        await offlineDb.queue.pop(head.id);
        remaining -= 1;
        discarded += 1;
        notify({ remaining, discarded, lastError: msg });
        continue;
      }
      if (!ok) {
        // Transient — stop draining, try again on next reconnect.
        notify({ remaining, discarded });
        break;
      }
      await offlineDb.queue.pop(head.id);
      remaining -= 1;
      replayed += 1;
      notify({ remaining, discarded });
    }
  } finally {
    draining = false;
    if (replayed > 0 || discarded > 0) {
      // Replace ghost/offline cache entries with server truth.
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
    }
  }
}

export function installOnlineListener() {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void drainQueue();
  });
  // Initial attempt in case we restarted with a non-empty queue.
  if (navigator.onLine) {
    void drainQueue();
  }
}
