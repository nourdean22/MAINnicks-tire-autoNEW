/**
 * How tall the chat island should be, given the visual viewport.
 *
 * WHY THIS IS NOT JUST `h-full`. On iOS the soft keyboard does not shrink the
 * layout viewport, so a `position: fixed` shell keeps its full height and the
 * composer ends up behind the keyboard. window.visualViewport DOES shrink, so
 * chat-island watches it and sizes the island to match.
 *
 * WHAT THAT BROKE. The handler assigned `visualViewport.height` outright,
 * which ignores the bottom-chrome reservation the shell owns as padding-bottom
 * (--bottom-chrome-h, measured by BottomTabBar's ResizeObserver). An inline
 * height beats the `h-full` class, so the island rendered exactly
 * bottom-chrome-h too tall on EVERY page load, keyboard or not, and the
 * composer sat that far below where it belonged — under the tab bar.
 * Measured live at 602.4px shell / 53px chrome: island 602.4 where the content
 * box is 549.4, composer bottom 602.4 vs tab-bar top 549.4, 53px of overlap.
 *
 * THE RULE. The parent's content box is already correct — it is the shell's
 * border box minus the measured reservation, which is exactly what `h-full`
 * resolves against. So only take over when something (the keyboard) is
 * genuinely covering more than that; otherwise hand the height back to CSS so
 * the reservation stays authoritative and keeps tracking the ResizeObserver.
 *
 * Returns a pixel height to pin, or null meaning "remove the inline height and
 * let `h-full` own it".
 */
export interface IslandHeightInput {
  /** window.visualViewport.height — shrinks when the soft keyboard opens. */
  viewportHeight: number;
  /** The shell's border-box height (getBoundingClientRect().height). */
  parentHeight: number;
  /** The shell's computed padding-top (safe-area inset). */
  parentPaddingTop: number;
  /** The shell's computed padding-bottom (the --bottom-chrome-h reservation). */
  parentPaddingBottom: number;
  /**
   * window.visualViewport.scale — 1 unless the user is pinch-zoomed.
   *
   * The keyboard and pinch-zoom BOTH shrink viewportHeight, and height alone
   * cannot tell them apart. Scale can: the keyboard never changes it, zoom
   * always does. Without this the island collapses whenever the operator
   * zooms in to read — and app/layout.tsx deliberately omits maximumScale so
   * pinch-zoom stays available (WCAG 1.4.4), with a 16px input floor in
   * base.css paying for it, so zooming is a supported action on this surface.
   */
  viewportScale?: number;
}

/**
 * Sub-pixel slack. Viewport and layout heights are fractional (602.364px live)
 * and the two are measured by different subsystems, so an exact comparison
 * flickers between pinned and unpinned on scroll. A pixel of tolerance means
 * only a real keyboard-sized change takes over.
 */
const SLACK_PX = 1;

export function resolveIslandHeight({
  viewportHeight,
  parentHeight,
  parentPaddingTop,
  parentPaddingBottom,
  viewportScale = 1,
}: IslandHeightInput): number | null {
  // Zoom wins over the keyboard, deliberately. A pinch-zoomed viewport is
  // shorter for a reason that is NOT something covering the island, so pinning
  // would shrink the island out from under the area the operator zoomed into
  // (and, because the message list is the flex-1 scroller, scroll the newest
  // message out of the visible slice). If a zoomed user then focuses the
  // composer they pan to it, which is the normal zoomed interaction anyway.
  if (Number.isFinite(viewportScale) && viewportScale > 1) return null;

  const contentBox = parentHeight - parentPaddingTop - parentPaddingBottom;

  // Degenerate parent (not laid out yet, display:none, SSR). Defer to CSS
  // rather than pinning a nonsense height the user would see as a collapsed
  // or overflowing island.
  if (!Number.isFinite(contentBox) || contentBox <= 0) return null;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;

  // Space between the top of the island and the top of whatever the visual
  // viewport ends at (the keyboard, usually).
  const available = viewportHeight - parentPaddingTop;

  // Nothing is covering more than the reservation already accounts for —
  // let `h-full` own it so --bottom-chrome-h stays the single source of truth.
  if (available >= contentBox - SLACK_PX) return null;

  // The keyboard is up. Never return a negative height.
  return Math.max(0, available);
}
