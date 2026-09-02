/**
 * Shop revenue for the Command Surface — "unknown" is not "$0".
 *
 * WHY THIS EXISTS (2026-09-02): nickstire's every-15-minutes push
 * (`statenourSync.ts`, PR #2063) now sends the `revenue` slice as
 * `{ available: false, reason, pacing: "unknown" }` with NO numbers when its
 * own revenue read failed. Before this helper, `app/api/command/data` read
 * `revenue.todayEstimate ?? … ?? 0`, so a failed read rendered as a $0 day on
 * the owner's Command Surface — the exact "$0 crossed the boundary" defect
 * nickstire's audit (artifact 4 §7, M-1) traced to this consumer.
 *
 * ONE derivation, shared by the route and its tests:
 *   1. the LIVE bridge snapshot wins when it actually carries a reading;
 *   2. otherwise the last pushed payload — unless it says `available:false`;
 *   3. otherwise unknown, with the reason nickstire gave (or ours).
 * A genuine counted zero (`{ todayEstimate: 0 }`) is a reading and stays $0.
 * Only the ABSENCE of a reading becomes `null`.
 */
import { readNickRevenue } from "./revenue";

export interface ShopRevenueState {
  /** Whole dollars, or null when no source carried a reading. */
  todayRevenue: number | null;
  /** Whole dollars, or null when no source carried a week figure. */
  weekRevenue: number | null;
  /** `todayRevenue !== null`, spelled out for consumers that render text. */
  revenueAvailable: boolean;
  /** Why it is unknown (null when available). */
  revenueReason: string | null;
  /** Which source supplied today's figure. */
  source: "bridge" | "sync" | "none";
}

const WEEK_KEYS = ["weekDollars", "weekRevenue", "weekEstimate", "week", "weekCents"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function hasWeekReading(obj: unknown): boolean {
  if (!isRecord(obj)) return false;
  return WEEK_KEYS.some((k) => {
    const v = obj[k];
    return (typeof v === "number" && Number.isFinite(v)) ||
      (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
  });
}

/** A revenue object that explicitly declares itself unavailable (nickstire PR #2063 shape). */
function declaredUnavailable(obj: unknown): string | null {
  if (!isRecord(obj) || obj.available !== false) return null;
  const reason = typeof obj.reason === "string" && obj.reason.trim() ? obj.reason.trim() : "revenue read failed";
  return reason;
}

/**
 * @param liveRevenue  the LIVE bridge snapshot's `revenue` object (or null/undefined)
 * @param syncPayload  the last pushed `business_metrics_sync` payload (whole payload, or null)
 */
export function deriveShopRevenue(liveRevenue: unknown, syncPayload: unknown): ShopRevenueState {
  let today: number | null = null;
  let week: number | null = null;
  let source: ShopRevenueState["source"] = "none";
  let reason: string | null = null;

  // 1 · live bridge — a reading only if it is not declared unavailable AND carries a number.
  if (isRecord(liveRevenue) && declaredUnavailable(liveRevenue) === null) {
    const r = readNickRevenue(liveRevenue);
    if (r.hasToday) { today = r.todayDollars; source = "bridge"; }
    if (hasWeekReading(liveRevenue)) week = r.weekDollars;
  }

  // 2 · pushed payload — `payload.revenue` first (canonical), then legacy top-level keys.
  if (isRecord(syncPayload)) {
    const pushedRevenue = syncPayload.revenue;
    const unavailable = declaredUnavailable(pushedRevenue);
    if (unavailable !== null) {
      if (today === null) reason = unavailable;
    } else {
      for (const candidate of [pushedRevenue, syncPayload]) {
        if (!isRecord(candidate)) continue;
        const r = readNickRevenue(candidate);
        if (today === null && r.hasToday) { today = r.todayDollars; source = "sync"; }
        if (week === null && hasWeekReading(candidate)) week = r.weekDollars;
        if (today !== null && week !== null) break;
      }
    }
  }

  const revenueAvailable = today !== null;
  return {
    todayRevenue: today,
    weekRevenue: week,
    revenueAvailable,
    revenueReason: revenueAvailable ? null : (reason ?? "no revenue reading from the bridge or the last sync"),
    source: revenueAvailable ? source : "none",
  };
}
