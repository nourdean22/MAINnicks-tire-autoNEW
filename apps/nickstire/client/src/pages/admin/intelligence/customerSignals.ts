/**
 * customerSignals — pure derivation for the Customer Intelligence card
 * (Admin > Intelligence HQ).
 *
 * Q-23 phase 6 · UNKNOWN IS NOT ZERO, and a count must read the field its
 * engine actually returns.
 *   - "Due For Maintenance" read `repeatPrediction.recommendations.length`.
 *     predictRepeatVisits (server/services/engines/customer.ts) has never
 *     returned `recommendations`; it returns `dueSoon`. The tile was 0 on every
 *     render, whatever the customers table said.
 *   - "High Churn Risk" read `churnRisk.highRisk.length || 0`, so a failed
 *     engine (the report carries `null`) and a failed engine read (empty lists,
 *     now marked `unavailable: true`) both painted "0", a clean bill of health.
 *   - Both engines cap their lists (highRisk at 25, dueSoon at 30), so a full
 *     list is a floor, shown as "25+" / "30+", not a total.
 *
 * Both numbers are ESTIMATE when read: churn risk is a days-since-visit score
 * and "due" is a predicted date from the average visit gap. Neither is a count
 * of something that happened.
 */
import { provenanceOf, type TileProvenance } from "@shared/tileProvenance";

/** List caps in the engines: predictChurn slices highRisk to 25, predictRepeatVisits dueSoon to 30. */
const CHURN_HIGH_RISK_CAP = 25;
const REPEAT_DUE_SOON_CAP = 30;

export interface CustomerSignalCount {
  /** false when the engine failed or its read failed. */
  read: boolean;
  /** Rows in the list; 0 when unread. */
  count: number;
  /** What the tile shows: "unknown", "N", or "N+" at the engine's cap. */
  display: string;
  provenance: TileProvenance;
}

function listOf(result: unknown, field: string): unknown[] | null {
  if (!result || typeof result !== "object") return null;
  const r = result as Record<string, unknown>;
  if (r.unavailable === true) return null;
  const list = r[field];
  return Array.isArray(list) ? list : null;
}

function countOf(result: unknown, field: string, cap: number): CustomerSignalCount {
  const list = listOf(result, field);
  if (list === null) {
    return { read: false, count: 0, display: "unknown", provenance: provenanceOf("inferred", "unavailable") };
  }
  const count = list.length;
  return {
    read: true,
    count,
    display: count >= cap ? `${cap}+` : String(count),
    provenance: provenanceOf("inferred"),
  };
}

export function deriveCustomerSignals(customers: unknown): {
  churnHighRisk: CustomerSignalCount;
  dueSoon: CustomerSignalCount;
} {
  const c = (customers && typeof customers === "object" ? customers : {}) as Record<string, unknown>;
  return {
    churnHighRisk: countOf(c.churnRisk, "highRisk", CHURN_HIGH_RISK_CAP),
    dueSoon: countOf(c.repeatPrediction, "dueSoon", REPEAT_DUE_SOON_CAP),
  };
}
