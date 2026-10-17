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
 *
 * UI v3 W4 (2026-10-17): five tabs became three. Learning moved under "Body and learning" and
 * Calibration (with the forecast duel) under Goals. Their old keys are live deep links
 * (lib/mastery/level-up-directive.ts links ?tab=learning, /system/calibration links
 * ?tab=calibration), so they stay valid as ALIASES that land on the tab now holding the section;
 * the page scrolls to the section of the same id.
 */
export const STATS_TABS = [
  { id: "mastery", label: "Mastery" },
  { id: "goals", label: "Goals" },
  { id: "body", label: "Body and learning" },
] as const;

export type StatsTabId = (typeof STATS_TABS)[number]["id"];

/** Retired tab keys -> the tab that now holds their section (the section keeps the old key as its id). */
export const STATS_TAB_ALIASES: Readonly<Record<string, StatsTabId>> = {
  learning: "body",
  calibration: "goals",
};

export function resolveStatsTab(
  requested: string | null | undefined,
  tabs: ReadonlyArray<{ id: string }> = STATS_TABS,
): string {
  const first = tabs[0]?.id ?? "mastery";
  if (!requested) return first;
  if (tabs.some((t) => t.id === requested)) return requested;
  const alias = STATS_TAB_ALIASES[requested];
  return alias && tabs.some((t) => t.id === alias) ? alias : first;
}
