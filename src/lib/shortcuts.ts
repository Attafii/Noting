import { useEffect } from 'react';

/**
 * Global keyboard shortcuts, dispatched as window CustomEvents so unrelated
 * components can react without prop drilling. Bindings are customizable in
 * Settings (persisted to localStorage) — defaults below.
 */
export const SHORTCUT_EVENTS = {
  saveNow: 'noting:save-now',
  togglePreview: 'noting:toggle-preview',
  toggleHistory: 'noting:toggle-history',
  focusSearch: 'noting:focus-search',
  previewDocument: 'noting:preview-document',
  openPalette: 'noting:open-palette',
  sideTab: 'noting:side-tab',
  filterTag: 'noting:filter-tag',
} as const;

export interface ShortcutBinding {
  /** Require Ctrl/Cmd. */
  mod: boolean;
  /** Lowercase key (e.g. 's', 'p', '/'). */
  key: string;
}

export type ShortcutId =
  'saveNow' | 'togglePreview' | 'toggleHistory' | 'openPalette' | 'focusSearch';

export const DEFAULT_BINDINGS: Record<ShortcutId, ShortcutBinding> = {
  saveNow: { mod: true, key: 's' },
  togglePreview: { mod: true, key: 'p' },
  toggleHistory: { mod: true, key: 'h' },
  openPalette: { mod: true, key: 'k' },
  focusSearch: { mod: false, key: '/' },
};

export const SHORTCUT_LABELS: Record<ShortcutId, string> = {
  saveNow: 'Save note now',
  togglePreview: 'Toggle Write / Preview',
  toggleHistory: 'Toggle version history',
  openPalette: 'Command palette',
  focusSearch: 'Focus file search',
};

const OVERRIDES_KEY = 'shortcut-overrides';

export function getBindings(): Record<ShortcutId, ShortcutBinding> {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return DEFAULT_BINDINGS;
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutId, ShortcutBinding>>;
    const merged = { ...DEFAULT_BINDINGS };
    for (const id of Object.keys(DEFAULT_BINDINGS) as ShortcutId[]) {
      const b = parsed[id];
      if (b && typeof b.key === 'string' && b.key.length > 0 && typeof b.mod === 'boolean') {
        merged[id] = { mod: b.mod, key: b.key.toLowerCase() };
      }
    }
    return merged;
  } catch {
    return DEFAULT_BINDINGS;
  }
}

export function setBinding(id: ShortcutId, binding: ShortcutBinding): void {
  try {
    const current = getBindings();
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ ...current, [id]: binding }));
  } catch {
    /* ignore */
  }
}

export function resetBindings(): void {
  try {
    localStorage.removeItem(OVERRIDES_KEY);
  } catch {
    /* ignore */
  }
}

export function formatBinding(binding: ShortcutBinding): string {
  const key = binding.key === ' ' ? 'Space' : binding.key.toUpperCase();
  return binding.mod ? `Ctrl/⌘ ${key}` : key === '/' ? '/' : key;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useGlobalShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const bindings = getBindings();

      const fire = (id: ShortcutId, needsFreeFocus: boolean) => {
        const b = bindings[id];
        if (b.mod !== mod || b.key !== key) return false;
        if (needsFreeFocus && isTypingTarget(event.target)) return false;
        event.preventDefault();
        const evt =
          id === 'saveNow'
            ? SHORTCUT_EVENTS.saveNow
            : id === 'togglePreview'
              ? SHORTCUT_EVENTS.togglePreview
              : id === 'toggleHistory'
                ? SHORTCUT_EVENTS.toggleHistory
                : id === 'openPalette'
                  ? SHORTCUT_EVENTS.openPalette
                  : SHORTCUT_EVENTS.focusSearch;
        window.dispatchEvent(new CustomEvent(evt));
        return true;
      };

      if (fire('saveNow', false)) return;
      if (fire('togglePreview', false)) return;
      if (fire('toggleHistory', false)) return;
      if (fire('openPalette', false)) return;
      if (fire('focusSearch', true)) return;
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
