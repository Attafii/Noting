import { useEffect } from 'react';
import type { ShortcutBinding, ShortcutId } from './shortcuts-core';

/**
 * Global keyboard shortcuts, dispatched as window CustomEvents so unrelated
 * components can react without prop drilling. Bindings are customizable in
 * Settings (persisted to localStorage) — defaults below.
 *
 * The pure binding/label data lives in `shortcuts-core.ts` so the server-side
 * assistant guide can reuse it without importing React.
 */
export {
  DEFAULT_BINDINGS,
  SHORTCUT_LABELS,
  formatBinding,
  type ShortcutBinding,
  type ShortcutId,
} from './shortcuts-core';
import { DEFAULT_BINDINGS } from './shortcuts-core';

export const SHORTCUT_EVENTS = {
  saveNow: 'noting:save-now',
  togglePreview: 'noting:toggle-preview',
  toggleHistory: 'noting:toggle-history',
  focusSearch: 'noting:focus-search',
  previewDocument: 'noting:preview-document',
  openPalette: 'noting:open-palette',
  sideTab: 'noting:side-tab',
  filterTag: 'noting:filter-tag',
  openHomeTab: 'noting:open-home-tab',
} as const;

/** Home dashboard tabs: overview, calendar, or kanban board. */
export type HomeTab = 'overview' | 'calendar' | 'board';

/** Side panel tabs: files, ask, or the wikilink graph. */
export type SideTab = 'files' | 'ask' | 'links';

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
