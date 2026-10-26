/** Editor preferences shared between the editor and the Settings page. */

export type DefaultViewMode = 'write' | 'preview' | 'split';

const AUTOSAVE_KEY = 'editor-autosave-ms';
const MODE_KEY = 'editor-default-mode';
const SPELL_KEY = 'editor-spellcheck';
const AMBIENT_KEY = 'ambient-motion';

export function getAutosaveMs(): number {
  try {
    const raw = parseInt(localStorage.getItem(AUTOSAVE_KEY) ?? '', 10);
    if ([500, 1000, 2000].includes(raw)) return raw;
  } catch {
    /* ignore */
  }
  return 500;
}

export function setAutosaveMs(ms: number): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

export function getDefaultViewMode(): DefaultViewMode {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw === 'preview' || raw === 'split') return raw;
  } catch {
    /* ignore */
  }
  return 'write';
}

export function setDefaultViewMode(mode: DefaultViewMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function getSpellcheck(): boolean {
  try {
    return localStorage.getItem(SPELL_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSpellcheck(on: boolean): void {
  try {
    localStorage.setItem(SPELL_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Ambient shader motion on the landing/unlock/invite pages. Defaults ON —
 * users who prefer less motion get a static frame instead via
 * `prefers-reduced-motion` regardless of this switch.
 */
export function getAmbientMotion(): boolean {
  try {
    return localStorage.getItem(AMBIENT_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setAmbientMotion(on: boolean): void {
  try {
    localStorage.setItem(AMBIENT_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
  // Let a live InkField repaint/restart without remounting the page.
  try {
    window.dispatchEvent(new Event('noting:ambient-motion'));
  } catch {
    /* ignore — SSR/tests without a window */
  }
}
