/**
 * useFocusTrap — accessible dialog focus management for hand-rolled modals/drawers.
 *
 * Consolidates the WCAG 2.4.3 / 2.1.2 keyboard contract that every modal needs:
 *   - Tab / Shift+Tab cycle stays inside the container (focus trap)
 *   - Escape closes (optional, via onEscape)
 *   - First focusable element (or an explicit target) is focused on open (autoFocus)
 *   - Focus returns to the previously-focused element on close (restoreFocus)
 *
 * Reference pattern: CallbackModal.tsx (wave-167) implemented Esc + autofocus +
 * restore by hand. This hook generalizes that so the behavior can't drift or be
 * forgotten the next time someone hand-rolls an overlay.
 *
 * Usage:
 *   const ref = useRef<HTMLDivElement>(null);
 *   useFocusTrap(ref, open, { onEscape: () => setOpen(false) });
 *   ...
 *   {open && <div ref={ref} role="dialog" aria-modal="true">...</div>}
 */
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

interface FocusTrapOptions {
  /** Called when Escape is pressed while the trap is active. */
  onEscape?: () => void;
  /** Focus the first focusable element (or `initialFocusRef`) when activated. Default true. */
  autoFocus?: boolean;
  /** Restore focus to the previously-focused element when deactivated. Default true. */
  restoreFocus?: boolean;
  /** Explicit element to focus on open instead of the first focusable. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { onEscape, autoFocus = true, restoreFocus = true, initialFocusRef } = options;
  // Keep the latest onEscape without re-binding the listener every render.
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const container = containerRef.current;
    if (!container) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const getFocusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the dialog so keyboard users start inside it.
    // Deferred so the element is mounted/painted before we focus it.
    let autoFocusTimer: ReturnType<typeof setTimeout> | undefined;
    if (autoFocus) {
      const target = initialFocusRef?.current ?? getFocusable()[0] ?? container;
      autoFocusTimer = setTimeout(() => target?.focus({ preventScroll: true }), 30);
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscapeRef.current) {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (typeof autoFocusTimer !== "undefined") clearTimeout(autoFocusTimer);
      if (restoreFocus && previouslyFocused.current) {
        // Only restore if focus is still inside the (now-closing) container or on body,
        // so we don't yank focus the user has deliberately moved elsewhere.
        const activeEl = document.activeElement;
        if (activeEl === document.body || container.contains(activeEl)) {
          previouslyFocused.current.focus({ preventScroll: true });
        }
      }
    };
    // initialFocusRef is a stable ref object; intentionally not in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, autoFocus, restoreFocus, containerRef]);
}

export default useFocusTrap;
