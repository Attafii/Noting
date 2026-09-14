import { useSyncExternalStore } from 'react';

export type ThemeMode = 'dark' | 'light';
export type AccentName = 'gold' | 'emerald' | 'cobalt';
export type DensityName = 'comfortable' | 'compact';

export interface ThemeState {
  mode: ThemeMode;
  accent: AccentName;
  density: DensityName;
}

const STORAGE_KEY = 'noting-theme';

const DEFAULTS: ThemeState = { mode: 'dark', accent: 'gold', density: 'comfortable' };

function read(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ThemeState>;
    return {
      mode: parsed.mode === 'light' ? 'light' : 'dark',
      accent: parsed.accent === 'emerald' || parsed.accent === 'cobalt' ? parsed.accent : 'gold',
      density: parsed.density === 'compact' ? 'compact' : 'comfortable',
    };
  } catch {
    return DEFAULTS;
  }
}

let current: ThemeState = typeof localStorage === 'undefined' ? DEFAULTS : read();
const listeners = new Set<() => void>();

export function applyTheme(state: ThemeState = current): void {
  current = state;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.theme = state.mode;
    root.dataset.accent = state.accent;
    root.dataset.density = state.density;
    root.style.colorScheme = state.mode;
  }
  for (const notify of listeners) notify();
}

export function getTheme(): ThemeState {
  return current;
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function useTheme(): ThemeState {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULTS,
  );
}

/** Call once at startup (before first paint where possible). */
export function initTheme(): void {
  applyTheme(read());
}
