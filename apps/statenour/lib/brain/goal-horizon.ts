/**
 * Goal Horizon — auto-classify + grouping for the PLAN tab.
 *
 * Apr 27 · GH2. The schema has a `horizon` field (DAY | WEEK | MONTH |
 * QUARTER | YEAR | LIFE) but most goals were created with horizon=null
 * (the original tab UX was abandoned because of this). Rather than ask
 * the user to backfill, derive an effective horizon from the deadline:
 *
 *   · WEEK   — deadline within 7 days
 *   · MONTH  — deadline within 30 days
 *   · YEAR   — deadline within 365 days
 *   · LIFE   — no deadline OR deadline > 365 days out
 *
 * Explicit `horizon` always wins. Lifetime goals can omit deadline.
 *
 * Pure — no DB.
 */

export type GoalHorizon = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "LIFE";

export type HorizonFilter = "ALL" | GoalHorizon;

interface HorizonInput {
  horizon: string | null | undefined;
  deadline: string | null | undefined;
}

const DAY_MS = 86_400_000;

export function effectiveHorizon({ horizon, deadline }: HorizonInput): GoalHorizon {
  // Explicit horizon wins
  if (horizon === "DAY" || horizon === "WEEK" || horizon === "MONTH" ||
      horizon === "QUARTER" || horizon === "YEAR" || horizon === "LIFE") {
    return horizon;
  }
  if (!deadline) return "LIFE";
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return "LIFE";
  if (ms <= 0) return "WEEK"; // overdue → treat as urgent
  const days = ms / DAY_MS;
  if (days <= 7) return "WEEK";
  if (days <= 30) return "MONTH";
  if (days <= 90) return "QUARTER";
  if (days <= 365) return "YEAR";
  return "LIFE";
}

/**
 * Tab order — left to right. Skipping DAY (rolls into WEEK) and
 * QUARTER (rolls into YEAR) for the v1 tab bar; Nour's flow doesn't
 * really think in quarters, and DAY is already on the NOW page.
 */
export const HORIZON_TAB_ORDER: HorizonFilter[] = [
  "ALL",
  "WEEK",
  "MONTH",
  "YEAR",
  "LIFE",
];

export const HORIZON_TAB_LABEL: Record<HorizonFilter, string> = {
  ALL: "All",
  DAY: "Today",
  WEEK: "Week",
  MONTH: "Month",
  QUARTER: "Quarter",
  YEAR: "Year",
  LIFE: "Life",
};

/** Color stripe accent for goal cards — same palette as the legacy badges. */
export const HORIZON_STRIPE: Record<GoalHorizon, string> = {
  DAY: "bg-amber-500/40",
  WEEK: "bg-blue-500/40",
  MONTH: "bg-emerald-500/40",
  QUARTER: "bg-cyan-500/40",
  YEAR: "bg-violet-500/40",
  LIFE: "bg-pink-500/40",
};

/**
 * Bucket goals by effective horizon for tab counts. Returns a map
 * keyed by HorizonFilter (including ALL = total count).
 */
export function bucketByHorizon<G extends HorizonInput>(
  goals: G[],
): Record<HorizonFilter, G[]> {
  const buckets: Record<HorizonFilter, G[]> = {
    ALL: [],
    DAY: [],
    WEEK: [],
    MONTH: [],
    QUARTER: [],
    YEAR: [],
    LIFE: [],
  };
  for (const g of goals) {
    const h = effectiveHorizon(g);
    buckets[h].push(g);
    // QUARTER rolls into YEAR for tab purposes (we don't render
    // a QUARTER tab in v1 — Nour doesn't think in quarters).
    if (h === "QUARTER") buckets.YEAR.push(g);
    // DAY rolls into WEEK for the same reason — daily-horizon goals
    // are really just this-week goals.
    if (h === "DAY") buckets.WEEK.push(g);
    buckets.ALL.push(g);
  }
  return buckets;
}
