'use client';

/**
 * Expenses recorded without a signal, waiting to be sent.
 *
 * Each one carries the `clientRef` the server uses as its idempotency key, so
 * sending it twice — a retry after a timeout that actually got through — files
 * it once. The queue lives in IndexedDB so it survives a closed tab; where
 * IndexedDB is unavailable (a private window, storage blocked) it falls back
 * to memory and says so through `persistent`.
 */

const DB = 'cifra-trips';
const STORE = 'pending-expenses';

export interface QueuedExpense {
  readonly clientRef: string;
  readonly tripId: string;
  readonly payload: Record<string, unknown>;
  readonly queuedAt: string;
}

let memory: QueuedExpense[] = [];

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE, { keyPath: 'clientRef' });
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function enqueue(item: QueuedExpense): Promise<boolean> {
  const stored = await withStore('readwrite', (store) => store.put(item));
  if (stored === null) {
    memory = [...memory.filter((m) => m.clientRef !== item.clientRef), item];
    return false;
  }
  return true;
}

export async function pending(tripId: string): Promise<QueuedExpense[]> {
  const all = (await withStore<QueuedExpense[]>('readonly', (store) => store.getAll() as IDBRequest<QueuedExpense[]>)) ?? memory;
  return all.filter((item) => item.tripId === tripId);
}

export async function remove(clientRef: string): Promise<void> {
  memory = memory.filter((m) => m.clientRef !== clientRef);
  await withStore('readwrite', (store) => store.delete(clientRef));
}
