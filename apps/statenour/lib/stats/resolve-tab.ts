/**
 * lib/stats/resolve-tab.ts · 2026-09-02
 *
 * Canonical /stats tab contract + resolver. A retired deep link
 * (/business?tab=money → /stats?tab=money — Next appends the incoming query to
 * every redirect destination, a `has` capture does not strip it) or a typo used
 * to render an EMPTY page body, because StatsContent only rendered known ids.
 *
 * Keep the tab metadata here so the page, NAV, command palette, redirects, and
 * tests cannot each invent their own list.
 */
export const STATS_TABS = [
  { id: "mastery", label: "Mastery" },
  { id: "goals", label: "Goals" },
  { id: "body", label: "Body" },
  { id: "learning", label: "Learning" },
  { id: "calibration", label: "Calibration" },
] as const;

export type StatsTabId = (typeof STATS_TABS)[number]["id"];

export function resolveStatsTab(
  requested: string | null | undefined,
  tabs: ReadonlyArray<{ id: string }> = STATS_TABS,
): string {
  const first = tabs[0]?.id ?? "mastery";
  if (!requested) return first;
  return tabs.some((t) => t.id === requested) ? requested : first;
}
