/**
 * Which pins are actually injected into the system prompt.
 *
 * The pins API returns rows in injection order (the "default · injection
 * order" sort) and reports the authoritative count in `stats.injectedCount`.
 * The "injected" badge must reflect THAT set — not the operator's chosen
 * display sort. The previous implementation used the post-sort array index
 * (`idx < 5`), so sorting by e.g. "stalest" mislabelled the 5 oldest pins
 * as injected when they were not.
 *
 * Pass pin ids in SERVER (injection) order; returns the set of ids that
 * inject, independent of how the caller later re-sorts the list.
 */
export function selectInjectedPinIds(
  idsInServerOrder: string[],
  injectedCount?: number | null,
): Set<string> {
  // Top-5 inject (the system-prompt rule). Cap by the server-reported
  // count when present (fewer than 5 pins exist, or the server injected
  // fewer). Never exceed 5 even if the count over-reports.
  const cap = injectedCount == null ? 5 : Math.min(injectedCount, 5);
  const n = Math.max(0, Math.min(cap, idsInServerOrder.length));
  return new Set(idsInServerOrder.slice(0, n));
}
