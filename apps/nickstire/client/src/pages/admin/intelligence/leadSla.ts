/**
 * leadSla — pure derivation for the Lead SLA Monitor (Admin > Intelligence HQ).
 *
 * Q-23 phase 5 · UNKNOWN IS NOT ZERO. The card read
 * `masterReport.marketing.leadResponse` through `|| 0`, so three different
 * states all painted an emerald "Avg: 0m", a perfect response time:
 *   - the engine failed (the report carries `null`);
 *   - the engine's own read failed (it returns zeros with `unavailable: true`);
 *   - no lead was contacted in the 90-day window (an average of nothing).
 * A bucket with no leads also showed "0% conversion rate", a rate of nothing.
 *
 * `sampleSize` is the sum of the bucket counts: every contacted lead in the
 * window lands in exactly one bucket (server/services/engines/marketing.ts).
 */
import { provenanceOf, type TileProvenance } from "@shared/tileProvenance";

export type LeadSlaState = "unread" | "empty" | "ok";

export interface LeadSlaBucket {
  /** Leads in this bucket. */
  leads: number;
  /** Booked-or-completed share, or null when the bucket is empty. */
  rate: number | null;
}

export interface LeadSlaView {
  state: LeadSlaState;
  /** Contacted leads in the window; 0 when unread. */
  sampleSize: number;
  /** Average minutes to first contact, or null when there is no average. */
  avgMinutes: number | null;
  under5: LeadSlaBucket;
  over1h: LeadSlaBucket;
  provenance: TileProvenance;
}

interface RawBucket {
  bucket?: unknown;
  leads?: unknown;
  rate?: unknown;
}

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function bucketOf(buckets: RawBucket[], name: string): LeadSlaBucket {
  const b = buckets.find((x) => x?.bucket === name);
  const leads = finite(b?.leads) ?? 0;
  return { leads, rate: leads > 0 ? finite(b?.rate) : null };
}

export function deriveLeadSla(leadResponse: unknown): LeadSlaView {
  const r = (leadResponse && typeof leadResponse === "object" ? leadResponse : null) as Record<string, unknown> | null;
  const avg = r ? finite(r.avgMinutes) : null;

  if (!r || r.unavailable === true || avg === null) {
    return {
      state: "unread",
      sampleSize: 0,
      avgMinutes: null,
      under5: { leads: 0, rate: null },
      over1h: { leads: 0, rate: null },
      provenance: provenanceOf("observed", "unavailable"),
    };
  }

  const buckets = Array.isArray(r.conversionBySpeed) ? (r.conversionBySpeed as RawBucket[]) : [];
  const sampleSize = buckets.reduce((sum, b) => sum + (finite(b?.leads) ?? 0), 0);
  const under5 = bucketOf(buckets, "Under 5 min");
  const over1h = bucketOf(buckets, "Over 1 hour");

  return {
    state: sampleSize > 0 ? "ok" : "empty",
    sampleSize,
    avgMinutes: sampleSize > 0 ? avg : null,
    under5,
    over1h,
    provenance: provenanceOf("observed"),
  };
}
