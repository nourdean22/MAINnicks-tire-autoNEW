/**
 * Calibration review items resolve themselves under a per-kind allowlist
 * (job 2026-10-31-self-learning-statenour, W1).
 *
 * Runs on the calibration-generator cron tick. Every pending item is checked
 * against ALLOWLIST; the decision and its reason are recorded on the item in
 * `calibrationImpact.autoResolve`. The resolution is APPLIED only when the
 * settings flag `calibration.auto_resolve_armed` is boolean true (default off,
 * Nour arms it). Until then this is shadow mode: decisions are logged next to
 * his own taps so they can be compared before anything acts.
 *
 * Who acts is decided by a compare-and-swap on (id, status, updatedAt), inside
 * the same transaction as the source write, so two runners resolve an item once
 * and a failed source write leaves the item pending.
 */
import type { CalibrationReviewItem, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { getSetting } from "@/lib/services/settings";
import { applyLowRiskOutcome, writeCalibrationLesson } from "@/lib/services/system-calibration";

const log = rootLogger.withSurface("calibration-auto-resolve");

export const AUTO_RESOLVE_ARMED_KEY = "calibration.auto_resolve_armed";
/** reviewedBy on an auto-resolved item; the undo lane (W2) keys on it. */
export const AUTO_RESOLVER = "auto:calibration-allowlist";
/** Writes per tick, not reads: held items stay pending, so a read cap would starve newer items behind them. */
const MAX_WRITES_PER_TICK = 100;

export type Decision =
  | { verdict: "resolve"; kind: string; reason: string }
  | { verdict: "hold"; kind: null; reason: string };

type Kind = { kind: string; reason: string; fits: (item: CalibrationReviewItem) => boolean };

/**
 * The same two rules as the "approve low risk" bulk tap
 * (system-calibration.ts bulkResolveCalibrationReviews), tightened to valid
 * values, so shadow decisions can be compared with Nour's own taps.
 */
const ALLOWLIST: Kind[] = [
  {
    kind: "task_roi_close_match",
    reason: "proposed outcome score within 5 points of the estimated ROI",
    fits: (item) => {
      const proposed = item.proposedActualOutcome as { outcomeScore?: unknown } | null;
      const predicted = item.predictedOutcome as { roiScore?: unknown } | null;
      const score = proposed?.outcomeScore;
      const roi = predicted?.roiScore;
      return (
        item.type === "task_roi" &&
        item.sourceType === "Task" &&
        typeof score === "number" &&
        Number.isInteger(score) &&
        score >= 1 &&
        score <= 100 &&
        typeof roi === "number" &&
        Math.abs(score - roi) <= 5
      );
    },
  },
  {
    kind: "prediction_graded",
    reason: "prediction graded confirmed or disproven from evidence",
    fits: (item) => {
      const status = (item.proposedActualOutcome as { status?: unknown } | null)?.status;
      return (
        item.type === "prediction" &&
        item.sourceType === "Prediction" &&
        (status === "confirmed" || status === "disproven") &&
        Number.isFinite(item.confidence) &&
        item.confidence >= 0 &&
        item.confidence <= 1
      );
    },
  },
];

/**
 * Safety, personal-data and spend subjects never resolve without Nour, whatever their numbers.
 * `s?` catches plurals ("payments", "credentials"); a false hold only leaves the item for his tap.
 */
const EXCLUDED =
  /\b(safety|security|password|credential|personal data|pii|privacy|medical|health|spend|spending|purchase|budget|refund|payment|payroll|cost|billing|invoice|subscription|pricing|price)s?\b/i;

export function evaluateCalibrationItem(item: CalibrationReviewItem): Decision {
  const subject = JSON.stringify(item.predictedOutcome ?? {});
  const hit = subject.match(EXCLUDED);
  if (hit) return { verdict: "hold", kind: null, reason: `excluded: ${hit[1].toLowerCase()}` };
  const match = ALLOWLIST.find((k) => k.fits(item));
  if (!match) return { verdict: "hold", kind: null, reason: "out of scope" };
  return { verdict: "resolve", kind: match.kind, reason: match.reason };
}

export interface AutoResolveSummary {
  armed: boolean;
  scanned: number;
  /** applied (armed only) */
  resolved: number;
  /** in scope, recorded, not applied (disarmed) */
  shadowed: number;
  /** out of scope or excluded, recorded */
  held: number;
  /** same decision already recorded, nothing written */
  unchanged: number;
  /** the row changed after it was read; the compare-and-swap matched nothing */
  lost: number;
  /** a write was due but this tick's write budget was spent; next tick picks it up */
  deferred: number;
  errors: number;
}

interface AutoResolveRecord {
  decision: Decision["verdict"];
  kind: string | null;
  reason: string;
  previousStatus: string;
  decidedAt: string;
  armed: boolean;
  applied: boolean;
  previousSource?: Record<string, unknown> | null;
}

/** Fail closed: only a stored boolean true arms; a failed read is disarmed, and said so. */
async function readArmed(): Promise<boolean> {
  try {
    return (await getSetting<unknown>(AUTO_RESOLVE_ARMED_KEY, false)) === true;
  } catch (err) {
    log.error("armed_flag_read_failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function priorRecord(item: CalibrationReviewItem): AutoResolveRecord | null {
  const impact = item.calibrationImpact as { autoResolve?: AutoResolveRecord } | null;
  return impact && typeof impact === "object" ? (impact.autoResolve ?? null) : null;
}

function withRecord(item: CalibrationReviewItem, record: AutoResolveRecord): Prisma.InputJsonValue {
  const impact = item.calibrationImpact;
  const base = impact && typeof impact === "object" && !Array.isArray(impact) ? impact : {};
  return { ...base, autoResolve: record } as unknown as Prisma.InputJsonValue;
}

/** What W2's undo needs to put the source row back. */
async function previousSource(tx: Prisma.TransactionClient, item: CalibrationReviewItem) {
  if (item.sourceType === "Task") {
    const t = await tx.task.findUnique({ where: { id: item.sourceId }, select: { outcomeScore: true } });
    return t ? { outcomeScore: t.outcomeScore } : null;
  }
  const p = await tx.prediction.findUnique({
    where: { id: item.sourceId },
    select: { status: true, outcome: true, brierScore: true },
  });
  return p ? { status: p.status, outcome: p.outcome, brierScore: p.brierScore } : null;
}

export async function runCalibrationAutoResolve(now = new Date()): Promise<AutoResolveSummary> {
  const armed = await readArmed();
  const pending = await prisma.calibrationReviewItem.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });
  const s: AutoResolveSummary = {
    armed,
    scanned: pending.length,
    resolved: 0,
    shadowed: 0,
    held: 0,
    unchanged: 0,
    lost: 0,
    deferred: 0,
    errors: 0,
  };
  let writes = 0;

  for (const item of pending) {
    let decision: Decision;
    try {
      decision = evaluateCalibrationItem(item);
    } catch (err) {
      s.errors++;
      log.error("evaluate_failed", { itemId: item.id, error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    const record: AutoResolveRecord = {
      decision: decision.verdict,
      kind: decision.kind,
      reason: decision.reason,
      previousStatus: item.status,
      decidedAt: now.toISOString(),
      armed,
      applied: false,
    };
    // The swap pins every field the decision read: status, and updatedAt for the outcome JSON it judged.
    const unchangedSinceRead = { id: item.id, status: "pending", updatedAt: item.updatedAt };
    const applies = armed && decision.verdict === "resolve";

    if (!applies) {
      const prior = priorRecord(item);
      if (prior && prior.decision === record.decision && prior.kind === record.kind && prior.reason === record.reason) {
        s.unchanged++;
        continue;
      }
    }
    if (writes >= MAX_WRITES_PER_TICK) {
      s.deferred++;
      continue;
    }
    writes++;

    try {
      if (!applies) {
        const r = await prisma.calibrationReviewItem.updateMany({
          where: unchangedSinceRead,
          data: { calibrationImpact: withRecord(item, record) },
        });
        if (r.count !== 1) s.lost++;
        else if (decision.verdict === "hold") s.held++;
        else s.shadowed++;
        continue;
      }

      const kind = decision.kind;
      const lesson = await prisma.$transaction(async (tx) => {
        const claim = await tx.calibrationReviewItem.updateMany({
          where: unchangedSinceRead,
          data: {
            status: "approved",
            approvedActualOutcome: item.proposedActualOutcome as Prisma.InputJsonValue,
            reviewedAt: now,
            reviewedBy: AUTO_RESOLVER,
            correctionNote: `Auto-resolved under allowlist kind ${kind}`,
          },
        });
        if (claim.count !== 1) return null;
        const prev = await previousSource(tx, item);
        const applied = await applyLowRiskOutcome(tx, item, `Auto-resolved (${kind})`);
        await tx.calibrationReviewItem.update({
          where: { id: item.id },
          data: {
            accuracyScore: applied.accuracyScore,
            calibrationImpact: withRecord(item, { ...record, applied: true, previousSource: prev }),
          },
        });
        return applied.lesson;
      });
      if (!lesson) {
        s.lost++;
        continue;
      }
      await writeCalibrationLesson(lesson);
      s.resolved++;
    } catch (err) {
      s.errors++;
      log.error("apply_failed", { itemId: item.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  log.info("auto_resolve_tick", { ...s });
  return s;
}
