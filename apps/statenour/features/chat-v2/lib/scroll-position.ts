/**
 * features/chat-v2/lib/scroll-position.ts (2026-08-18).
 *
 * The one scroll predicate the chat island uses twice: the auto-follow
 * MutationObserver ("only chase new content when the operator is
 * already near the bottom") and the jump-to-latest button ("show me
 * only when the operator is NOT near the bottom"). One number, one
 * definition — the two behaviors can never disagree about where
 * "bottom" starts.
 *
 * Pure so it's testable: jsdom reports every scroll metric as 0, which
 * makes hook-level tests of scroll math meaningless — the arithmetic
 * lives here instead.
 */

/** Distance (px) from the bottom within which we count as "at bottom". */
export const NEAR_BOTTOM_PX = 150;

export function isNearBottom(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  threshold: number = NEAR_BOTTOM_PX,
): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}
