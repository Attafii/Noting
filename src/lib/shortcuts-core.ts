/**
 * Pure shortcut data (no React, no localStorage) — shared by the keyboard
 * hook in `shortcuts.ts` (client) and the assistant's help guide (server).
 * Keep this module dependency-free so it can be imported anywhere.
 */

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
  focusSearch: 'Focus note search',
};

export function formatBinding(binding: ShortcutBinding): string {
  const key = binding.key === ' ' ? 'Space' : binding.key.toUpperCase();
  return binding.mod ? `Ctrl/⌘ ${key}` : key === '/' ? '/' : key;
}
