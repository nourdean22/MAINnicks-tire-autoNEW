/**
 * lib/brain/recall-corpus-tiers.ts — the sealed evaluation boundary (2026-09-18).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ════════════════════════════════════════════════════════════════════════════
 * StateNour's recall corpus had NO holdout of any kind: `runRecallEval` scored
 * EVERY case on EVERY run, so any weight, prompt or ranking change could be
 * tuned against the same 121 cases used to report the result. A number measured
 * on the data it was fitted to is not a measurement.
 *
 * ⚠ `HOLDOUT_EPISODES_B64` is NOT this. That is nickstire's Playwright episode
 * holdout — a different corpus, a different runner, a different product. It has
 * been mistaken for a StateNour holdout more than once; it is not one.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE TIERS
 * ════════════════════════════════════════════════════════════════════════════
 *   DEVELOPMENT  tune freely against it. Expect it to be overfitted.
 *   REGRESSION   visible, but must not get worse. A drop here is a bug.
 *   SEALED       the optimizer must never see it. Reported as AGGREGATE ONLY.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HOW "SEALED" IS ACTUALLY ENFORCED — AND WHAT IT CANNOT DO
 * ════════════════════════════════════════════════════════════════════════════
 * Assignment is a deterministic hash of the case id, so the tier is STABLE:
 * adding cases never reshuffles existing ones, and two machines agree without
 * coordinating. That gives reproducibility.
 *
 * ⚠ IT DOES NOT, BY ITSELF, GIVE SECRECY. A deterministic rule is computable by
 * anyone holding the corpus — including an agent that can simply re-harvest it
 * from the database. Stating otherwise would be the exact overclaim this file
 * exists to prevent.
 *
 * Secrecy comes from LOCATION, which is why this mirrors the one mechanism in
 * this repo already proven to work (apps/nickstire/scripts/proof/): the sealed
 * cases live OUTSIDE every checkout, and only counts ever come back. See
 * `sealedCorpusPath()`. Absent that file the sealed tier reports UNMEASURED —
 * never "passed", because a hidden evaluator's silence is the one failure
 * nobody notices.
 */
import { createHash } from "node:crypto";

export type CorpusTier = "development" | "regression" | "sealed";

/**
 * Share of cases per tier. Sealed is 25%: on the 2026-09-18 corpus (121 cases,
 * 76 scored) that is ~30 cases / ~19 scored positives.
 *
 * ⚠ THAT IS THIN, AND SAYING SO IS PART OF THE CONTRACT. ~19 positives moves
 * roughly 5 points per case, so only LARGE sealed movements are real signal.
 * The cure is more harvested cases, not a bigger slice of the same ones —
 * taking a bigger slice would starve the development tier to manufacture a
 * more confident-looking number from identical evidence.
 */
export const TIER_SHARES: Readonly<Record<CorpusTier, number>> = {
  development: 0.5,
  regression: 0.25,
  sealed: 0.25,
};

/**
 * Deterministic tier for a case id.
 *
 * Hash-based rather than index-based ON PURPOSE: an index split reshuffles every
 * assignment the moment a case is added or removed, which silently moves cases
 * between "tuned against" and "sealed" and destroys comparability across runs.
 * Hashing the id keeps a case in its tier for life.
 *
 * Pure. Exported for tests.
 */
export function tierForCaseId(caseId: string): CorpusTier {
  const h = createHash("sha256").update(caseId).digest();
  // First 4 bytes as an unsigned int, mapped onto [0,1).
  const bucket = h.readUInt32BE(0) / 0x1_0000_0000;
  if (bucket < TIER_SHARES.development) return "development";
  if (bucket < TIER_SHARES.development + TIER_SHARES.regression) return "regression";
  return "sealed";
}

export interface TieredCase {
  id: string;
}

export interface TierSplit<T extends TieredCase> {
  development: T[];
  regression: T[];
  sealed: T[];
}

/** Partition a corpus by tier. Pure. */
export function splitByTier<T extends TieredCase>(cases: readonly T[]): TierSplit<T> {
  const out: TierSplit<T> = { development: [], regression: [], sealed: [] };
  for (const c of cases) out[tierForCaseId(c.id)].push(c);
  return out;
}

/**
 * Where the sealed cases live: OUTSIDE every checkout, so an agent working in
 * the repo cannot read them by accident and a `git grep` cannot surface them.
 *
 * Mirrors apps/nickstire's `~/.nourcity-holdout/holdout-episodes.json`, which is
 * the only holdout mechanism in this repo with a production track record.
 * Overridable for CI via RECALL_HOLDOUT_PATH.
 */
export function sealedCorpusPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.RECALL_HOLDOUT_PATH ?? "").trim();
  if (override) return override;
  const home = env.HOME ?? env.USERPROFILE ?? ".";
  return `${home}/.nourcity-holdout/recall-sealed.json`;
}

export type SealedStatus = "measured" | "unmeasured";

export interface SealedReport {
  status: SealedStatus;
  /** Case count. NEVER case content — only counts leave the sealed set. */
  cases: number;
  precisionAtK: number | null;
  /** Why it is unmeasured, when it is. */
  reason?: string;
}

/**
 * Render the sealed tier's result for a human, refusing to let absence read as
 * success.
 *
 * ⚠ THE `unmeasured` BRANCH IS THE WHOLE POINT. A sealed evaluator that is
 * missing, unreadable or empty must say so loudly every single run. If it
 * silently scored 0 cases and printed a cheerful line, the boundary would
 * appear to be working while enforcing nothing — and a hidden evaluator is
 * precisely the instrument whose silence nobody would ever notice.
 *
 * Pure. Exported for tests.
 */
export function describeSealed(report: SealedReport): string {
  if (report.status === "unmeasured") {
    return (
      `sealed   UNMEASURED — ${report.reason ?? "no sealed corpus found"}. ` +
      "This is NOT a pass. Any improvement claim from this run is unvalidated."
    );
  }
  if (report.cases === 0) {
    return "sealed   UNMEASURED — the sealed corpus is present but EMPTY. This is NOT a pass.";
  }
  const p = report.precisionAtK;
  return (
    `sealed   precision@5=${p === null ? "n/a" : p.toFixed(4)}  (n=${report.cases}, aggregate only)` +
    (report.cases < 25 ? "  ⚠ thin: only large movements are signal" : "")
  );
}

/**
 * True when a result is safe to cite as evidence that a change HELPED.
 *
 * Development-tier movement is never evidence: that tier is tuned against, so
 * improvement there is expected even from a change that makes the system worse.
 * This is the predicate that stops "it went up on dev" from becoming a claim.
 *
 * Pure. Exported for tests.
 */
export function improvementIsCitable(opts: {
  sealed: SealedReport;
  regressionDelta: number | null;
}): { citable: boolean; reason: string } {
  if (opts.sealed.status === "unmeasured") {
    return { citable: false, reason: "sealed tier UNMEASURED — nothing is validated" };
  }
  if (opts.sealed.cases === 0) {
    return { citable: false, reason: "sealed tier is empty — nothing is validated" };
  }
  if (opts.regressionDelta !== null && opts.regressionDelta < 0) {
    return {
      citable: false,
      reason: `regression tier DROPPED by ${Math.abs(opts.regressionDelta).toFixed(4)} — a win that breaks the regression set is not a win`,
    };
  }
  return { citable: true, reason: "sealed tier measured and regression tier did not drop" };
}
