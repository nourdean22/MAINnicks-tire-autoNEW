/**
 * Tile provenance — the one word every admin number wears (Q-23, estate plan §14.4).
 *
 * The admin screens draw counts, modeled dollar figures and heuristics in the same
 * type size and colour. "$41,300" of declined work sits beside "$9,870" of paid
 * invoices, and nothing on the tile says that the first is a sum of estimates
 * nobody accepted while the second is money that arrived. METRICS-CONTRACT.md
 * already classifies every metric by evidence level; `shared/metricsContract.ts`
 * carries that as code. Until now no screen read it.
 *
 * Three labels, not four evidence levels, because the operator decides on three
 * questions: can I trust this as a count, is it a guess, or could we not read it.
 *
 *   MEASURED   · observed or verified: a stored row or a business-system record.
 *   ESTIMATE   · inferred or modeled, or a PARTIAL read of anything: a classifier,
 *                a heuristic, an assumption, or a count we know is incomplete.
 *   UNMEASURED · the read failed or nothing supplies it. Never drawn as zero.
 *
 * PURE: no clock, no DB, no React — same pattern as `shared/adminSignal.ts`.
 */

import {
  type EvidenceLevel,
  type MetricState,
  getCanonicalMetric,
} from "./metricsContract";

export type TileProvenance = "MEASURED" | "ESTIMATE" | "UNMEASURED";

/** One line for a tooltip or screen reader: what the label promises. */
export const PROVENANCE_MEANING: Readonly<Record<TileProvenance, string>> = Object.freeze({
  MEASURED: "Counted from stored records",
  ESTIMATE: "Inferred or modeled, not a count",
  UNMEASURED: "Could not be read",
});

/**
 * The fold. A failed read outranks everything: an `observed` metric we could not
 * read is UNMEASURED, not MEASURED. A partial read of an observed metric is a
 * lower bound, so it is an ESTIMATE, never MEASURED.
 */
export function provenanceOf(evidence: EvidenceLevel, state: MetricState = "ok"): TileProvenance {
  if (state === "unavailable") return "UNMEASURED";
  if (state === "partial") return "ESTIMATE";
  return evidence === "observed" || evidence === "verified" ? "MEASURED" : "ESTIMATE";
}

/**
 * Provenance for a tile that shows a canonical metric. Throws on an unknown name,
 * like `buildEnvelope`: a tile inventing a metric name is how "tool engagement"
 * became "conversions" (ROS-003), so the typo must fail the test run, not
 * silently label the tile.
 */
export function metricProvenance(canonicalName: string, state: MetricState = "ok"): TileProvenance {
  const metric = getCanonicalMetric(canonicalName);
  if (!metric) {
    throw new Error(`[tile-provenance] "${canonicalName}" is not in CANONICAL_METRICS`);
  }
  return provenanceOf(metric.evidence, state);
}
