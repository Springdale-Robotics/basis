import { listsApi } from '@/api/lists';
import { offlineDb, type QueuedMutation } from './db';

type DrainListener = (status: { remaining: number; lastError?: string }) => void;
const listeners = new Set<DrainListener>();

export function onDrain(cb: DrainListener) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(remaining: number, lastError?: string) {
  for (const cb of listeners) cb({ remaining, lastError });
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
 * server rejects so we don't get stuck in a loop).
 */
export async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    let remaining = (await offlineDb.queue.all()).length;
    notify(remaining);
    while (true) {
      const queue = await offlineDb.queue.all();
      if (queue.length === 0) break;
      const head = queue[0];
      let ok = false;
      try {
        ok = await replay(head);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Permanent — drop it.
        await offlineDb.queue.pop(head.id);
        notify(remaining - 1, msg);
        remaining -= 1;
        continue;
      }
      if (!ok) {
        // Transient — stop draining, try again on next reconnect.
        notify(remaining);
        break;
      }
      await offlineDb.queue.pop(head.id);
      remaining -= 1;
      notify(remaining);
    }
  } finally {
    draining = false;
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
