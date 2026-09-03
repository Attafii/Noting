import { useEffect } from 'react';

/**
 * Global keyboard shortcuts, dispatched as window CustomEvents so unrelated
 * components can react without prop drilling:
 * - `Ctrl/Cmd+S` → save the note immediately
 * - `Ctrl/Cmd+P` → toggle Write/Preview
 * - `Ctrl/Cmd+H` → toggle version history
 * - `/` → focus the document search (only when not typing somewhere)
 */
export const SHORTCUT_EVENTS = {
  saveNow: 'noting:save-now',
  togglePreview: 'noting:toggle-preview',
  toggleHistory: 'noting:toggle-history',
  focusSearch: 'noting:focus-search',
} as const;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

export function useGlobalShortcuts() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.saveNow));
        return;
      }
      if (mod && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.togglePreview));
        return;
      }
      if (mod && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.toggleHistory));
        return;
      }
      if (event.key === '/' && !mod && !isTypingTarget(event.target)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.focusSearch));
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
