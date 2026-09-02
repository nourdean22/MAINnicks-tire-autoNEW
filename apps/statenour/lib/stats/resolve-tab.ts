/**
 * lib/stats/resolve-tab.ts · 2026-09-02
 *
 * Which /stats tab to render for a `?tab=` value. A retired deep link
 * (/business?tab=money → /stats?tab=money — Next appends the incoming query to
 * every redirect destination, a `has` capture does not strip it) or a typo used
 * to render an EMPTY page body, because StatsContent only rendered known ids.
 * Pure, so tests/repo/retired-routes-gate.test.ts can pin it.
 */
export function resolveStatsTab(requested: string | null | undefined, tabs: ReadonlyArray<{ id: string }>): string {
  const first = tabs[0]?.id ?? "mastery";
  if (!requested) return first;
  return tabs.some((t) => t.id === requested) ? requested : first;
}
