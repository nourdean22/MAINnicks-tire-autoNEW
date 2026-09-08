/**
 * lib/ui/focus-clearance.ts · 2026-09-08 (program section 5.8, WCAG 2.4.11 Focus Not Obscured)
 *
 * The bottom chrome (tab bar + pulse ticker) is position:fixed. A control the
 * person scrolled under it is, to the browser, fully inside the viewport — so
 * focusing it (Tab, or a script) scrolls NOTHING, and `scroll-padding-bottom`
 * never enters the calculation. CI measured exactly that on /journal at 390px
 * before this existed: a parked button stayed entirely hidden after focus.
 *
 * `focusClearanceDelta` says how far the nearest scroll container must move so
 * the control's bottom edge clears the chrome's top edge (plus a small gap).
 * Zero means nothing to do: already clear, or entirely below the viewport (the
 * browser scrolls that case itself).
 */
export interface FocusRect {
  top: number;
  bottom: number;
}

export function focusClearanceDelta(rect: FocusRect, chromeTop: number, viewportHeight: number, gap = 12): number {
  if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return 0;
  if (rect.top >= viewportHeight) return 0; // entirely below the viewport: the browser brings it in
  if (rect.bottom <= chromeTop) return 0; // already clear of the chrome
  return Math.ceil(rect.bottom - chromeTop + gap);
}

/** Scroll the nearest scrollable ancestor (else the window) by `delta` px, instantly. */
export function scrollClear(el: HTMLElement, delta: number): void {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1) {
      node.scrollBy({ top: delta, behavior: "auto" });
      return;
    }
    node = node.parentElement;
  }
  window.scrollBy({ top: delta, behavior: "auto" });
}
