import { useSyncExternalStore } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveSnapshot {
  state: SaveState;
  updatedAt: string | null;
}

let snapshot: SaveSnapshot = { state: 'idle', updatedAt: null };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function setSaveState(state: SaveState, updatedAt?: string | null) {
  snapshot = {
    state,
    updatedAt: updatedAt ?? (state === 'saved' ? new Date().toISOString() : snapshot.updatedAt),
  };
  notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): SaveSnapshot {
  return snapshot;
}

/** Shared editor save status, readable from the top bar without prop drilling. */
export function useSaveStatus(): SaveSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
