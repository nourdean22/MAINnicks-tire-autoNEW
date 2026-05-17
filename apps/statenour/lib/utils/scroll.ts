/**
 * scroll utilities · v10.0.529.18
 *
 * Pure browser-side helpers for ID-driven scroll. Centralized here
 * because the same two-line shape (getElementById → scrollIntoView
 * after a tiny rAF / setTimeout to let React commit the mount) was
 * duplicated in 3 places on /tasks (handlePlanGoal · handleJumpToProject
 * · KommandoShell onJumpToTask).
 *
 * No React imports here — these are framework-agnostic DOM utils
 * safe to call from any event handler.
 */

/**
 * Smoothly scroll an element into view by ID. The 50ms delay gives
 * React time to commit a mount/expand triggered in the same handler
 * (typical for "expand card + scroll into view" flows) — without it
 * the element doesn't exist yet at scroll time.
 *
 * Inputs ·
 *   id          — the DOM element's id attribute.
 *   block       — vertical alignment · "center" by default (matches
 *                 the deep-link UX where the row should be visually
 *                 centered, not slammed to the top). Pass "start"
 *                 for first-line alignment.
 *   delayMs     — defer the lookup this many ms. 50 is the empirical
 *                 sweet-spot for React 19's commit cadence.
 *
 * Behavior ·
 *   · No-op on SSR (no document) and when the element is missing
 *     at lookup time (already-unmounted card, etc.).
 *   · Uses `scrollIntoView` with `behavior: "smooth"` so the user
 *     can track the motion.
 */
export function scrollToElement(
  id: string,
  block: ScrollLogicalPosition = "center",
  delayMs = 50,
): void {
  if (typeof document === "undefined") return;
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block });
  }, delayMs);
}
