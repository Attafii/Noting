import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Trap Tab / Shift+Tab inside the dialog while `active`.
 * - Focuses the first focusable element on open.
 * - Returns focus to the opener on close.
 * - Esc handling stays in each dialog (ConflictDialog intentionally has none —
 *   autosave is paused until the user chooses).
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (!active) return;
    opener.current = document.activeElement;

    const node = ref.current;
    if (node) {
      // Focus after paint so AnimatePresence/motion has mounted the panel.
      const frame = requestAnimationFrame(() => {
        const first = focusables(node)[0];
        (first ?? node).focus({ preventScroll: true });
      });

      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        const items = focusables(node);
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      return () => {
        cancelAnimationFrame(frame);
        document.removeEventListener('keydown', onKey, true);
        (opener.current as HTMLElement | null)?.focus?.();
      };
    }
    return () => {
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [active]);

  return ref;
}
