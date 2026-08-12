/**
 * Judgment quality — BDN-105 (wisdom-gate SPC) + BDN-106 (take
 * calibration). Both read-only; both answer "is the machine's judgment
 * any good?", which is why they share a module and a surface.
 *
 * BDN-105 · manufacturing QC ↔ software delivery. As of 2026-08-12
 * `memory_promotion` runs UNATTENDED (policy seeded `auto`), curating
 * permanent wisdom at ≤3/night against a 501-candidate pool. Manufacturing
 * doesn't inspect every unit — it trends the process. A shifting
 * accept/reject/dupe mix is drift detection for long-term memory, and
 * wisdom pollution is the one failure here that compounds silently into
 * every future recall.
 *
 * BDN-106 · intelligence tradecraft ↔ market intelligence. Stated
 * confidence that is never scored drifts into theater (the reason
 * ICD-203-class calibration exists). Journal takes now carry HIGH/MED/LOW
 * on the nextAction and their commitments resolve to real outcomes — so
 * the claim becomes gradeable. This was ranked TOO EARLY with a
 * 2026-10-15 revisit precisely because the data does not exist yet; the
 * read model ships now so the parked item REPORTS ITSELF (n=0, honestly)
 * instead of being silently forgotten — the ledger's own rule 4.
 */

import { prisma } from "@/lib/prisma";

// ─── BDN-105 · wisdom-gate process control ──────────────────────────

export interface GateWeek {
  weekStart: string;
  promoted: number;
  gateRejected: number;
  dupeSkipped: number;
  failed: number;
  /**
   * Attempts that never reached the gate at all — parked awaiting
   * approval by the fail-closed engine. Caught by the 2026-08-12 prod
   * probe: every memory_promotion row in the window was in this state
   * (the deferred-action deadlock), and an earlier version of this
   * summarizer silently dropped them, so the panel would have read
   * "0 promoted · 0 rejected" and NOT under-sampled — implying the gate
   * ran and produced nothing when it had never run at all.
   */
  parked: number;
  total: number;
}

export interface WisdomGateSpc {
  weeks: GateWeek[];
  totals: Omit<GateWeek, "weekStart">;
  /** Runs that actually reached the gate (excludes `parked`). */
  decided: number;
  /** True until enough DECIDED runs exist for a trend to mean anything. */
  underSampled: boolean;
  computedAt: string;
}

/** Monday-anchored ISO date for a run's week bucket. */
function weekStartOf(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (copy.getUTCDay() + 6) % 7; // Monday = 0
  copy.setUTCDate(copy.getUTCDate() - dow);
  return copy.toISOString().slice(0, 10);
}

/**
 * PURE — fold promotion attempts into weekly buckets. Exported for the
 * pin. `reason` comes from the action payload the gate already writes
 * (`wisdom_dupe` for the dupe-guard, `gate_<reason>` for a quality-gate
 * rejection); anything else with result="skipped" counts as a gate
 * rejection so a new skip reason can never vanish from the totals.
 */
export function summarizeGateRuns(
  rows: Array<{ createdAt: Date; result: string | null; reason: string | null }>,
): WisdomGateSpc {
  const byWeek = new Map<string, GateWeek>();
  const blank = (weekStart: string): GateWeek => ({
    weekStart,
    promoted: 0,
    gateRejected: 0,
    dupeSkipped: 0,
    failed: 0,
    parked: 0,
    total: 0,
  });

  for (const row of rows) {
    const key = weekStartOf(row.createdAt);
    const week = byWeek.get(key) ?? blank(key);
    week.total += 1;
    if (row.result === "success") week.promoted += 1;
    else if (row.result === "skipped") {
      if (row.reason === "wisdom_dupe") week.dupeSkipped += 1;
      else week.gateRejected += 1;
    } else if (row.result === "failed") week.failed += 1;
    // Anything else (pending / pending_approval / null) never reached
    // the gate. Counted, never dropped.
    else week.parked += 1;
    byWeek.set(key, week);
  }

  const weeks = [...byWeek.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const totals = weeks.reduce(
    (acc, w) => ({
      promoted: acc.promoted + w.promoted,
      gateRejected: acc.gateRejected + w.gateRejected,
      dupeSkipped: acc.dupeSkipped + w.dupeSkipped,
      failed: acc.failed + w.failed,
      parked: acc.parked + w.parked,
      total: acc.total + w.total,
    }),
    { promoted: 0, gateRejected: 0, dupeSkipped: 0, failed: 0, parked: 0, total: 0 },
  );

  // Only DECIDED runs are process data. A window full of parked rows is
  // an un-run process, not a low-yield one — sampling on raw total would
  // report a dead gate as adequately sampled.
  const decided = totals.promoted + totals.gateRejected + totals.dupeSkipped + totals.failed;

  return {
    weeks: weeks.slice(0, 8),
    totals,
    decided,
    // At ≤3 promotions/night, process statistics need weeks of runs
    // before a shifting mix means anything. Say so rather than draw a
    // trend line through noise.
    underSampled: decided < 20,
    computedAt: new Date().toISOString(),
  };
}

export async function buildWisdomGateSpc(): Promise<WisdomGateSpc> {
  const since = new Date(Date.now() - 56 * 86_400_000); // 8 weeks
  const rows = await prisma.autonomousAction.findMany({
    where: { ruleName: "memory_promotion", createdAt: { gte: since } },
    select: { createdAt: true, result: true, payload: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return summarizeGateRuns(
    rows.map((r) => {
      const payload = (r.payload ?? {}) as { reason?: unknown };
      return {
        createdAt: r.createdAt,
        result: r.result,
        reason: typeof payload.reason === "string" ? payload.reason : null,
      };
    }),
  );
}

// ─── BDN-106 · stated-confidence calibration ────────────────────────

export type ConfidenceBand = "HIGH" | "MED" | "LOW";

export interface CalibrationBand {
  band: ConfidenceBand;
  resolved: number;
  kept: number;
  /** kept / resolved — null until at least one resolution exists. */
  hitRate: number | null;
  unresolved: number;
}

export interface CalibrationReport {
  bands: CalibrationBand[];
  totalResolved: number;
  /** Honest gate: below this, a hit rate is noise, not calibration. */
  underSampled: boolean;
  /** Set when the answer is "not yet" — rendered instead of a fake number. */
  note: string | null;
  computedAt: string;
}

const MIN_RESOLVED_FOR_CALIBRATION = 10;

/**
 * PURE — grade stated confidence against real outcomes. Exported for the
 * pin.
 *
 * kept  = completed | verified   (the operator finished it)
 * miss  = abandoned | expired    (it died)
 * open  = anything else (proposed/active/accepted/blocked) — NOT counted
 *         either way. An unresolved commitment is not evidence.
 */
export function summarizeCalibration(
  rows: Array<{ band: ConfidenceBand; status: string }>,
): CalibrationReport {
  const KEPT = new Set(["completed", "verified"]);
  const MISSED = new Set(["abandoned", "expired"]);
  const bands: CalibrationBand[] = (["HIGH", "MED", "LOW"] as const).map((band) => {
    const mine = rows.filter((r) => r.band === band);
    const kept = mine.filter((r) => KEPT.has(r.status)).length;
    const missed = mine.filter((r) => MISSED.has(r.status)).length;
    const resolved = kept + missed;
    return {
      band,
      resolved,
      kept,
      hitRate: resolved > 0 ? kept / resolved : null,
      unresolved: mine.length - resolved,
    };
  });
  const totalResolved = bands.reduce((n, b) => n + b.resolved, 0);
  const underSampled = totalResolved < MIN_RESOLVED_FOR_CALIBRATION;
  return {
    bands,
    totalResolved,
    underSampled,
    note: underSampled
      ? totalResolved === 0
        ? "No confidence-stamped proposal has resolved yet — stamping began 2026-08-12. Nothing to grade; this is the honest answer, not an empty state."
        : `Only ${totalResolved} resolved — below the ${MIN_RESOLVED_FOR_CALIBRATION}-outcome floor. Rates shown would be noise.`
      : null,
    computedAt: new Date().toISOString(),
  };
}

export async function buildCalibrationReport(): Promise<CalibrationReport> {
  // Takes carry the confidence; commitments carry the outcome. Join on
  // the sourceRef the journal proposer already writes.
  const takes = await prisma.brainMemory.findMany({
    where: { category: "journal_brain_take", deletedAt: null },
    select: { key: true, content: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const bandByRef = new Map<string, ConfidenceBand>();
  for (const t of takes) {
    try {
      const parsed = JSON.parse(t.content) as { confidence?: unknown };
      if (
        typeof parsed.confidence === "string" &&
        ["HIGH", "MED", "LOW"].includes(parsed.confidence)
      ) {
        bandByRef.set(t.key, parsed.confidence as ConfidenceBand);
      }
    } catch {
      // Unparseable take — no band, no grade. Never throws.
    }
  }
  if (bandByRef.size === 0) return summarizeCalibration([]);

  const commitments = await prisma.commitment.findMany({
    where: { sourceRef: { in: [...bandByRef.keys()] }, deletedAt: null },
    select: { sourceRef: true, status: true },
  });

  return summarizeCalibration(
    commitments
      .map((c) => {
        const band = c.sourceRef ? bandByRef.get(c.sourceRef) : undefined;
        return band ? { band, status: c.status } : null;
      })
      .filter((r): r is { band: ConfidenceBand; status: string } => r !== null),
  );
}
