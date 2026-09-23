#!/usr/bin/env node
/**
 * Shared branch classification core (Session Authority · 2026-09-23) — one
 * implementation of "is this branch's work safe to consider done," reused by
 * repo-status.mjs (PR-state column), repo-rescue.mjs (zombie/salvage decision),
 * and branch-sweep.mjs (the ledger), not reinvented three times.
 *
 * Pure function: callers gather `evidence` via github-client.mjs and pass it in
 * (matching lease.mjs's injectable-store pattern) — this file makes no network
 * calls itself, so it is fixture-testable with zero mocking.
 *
 * ONLY `LANDED` is auto-assigned. Everything else defaults to `QUARANTINE`: the
 * automation does not assert intent (abandoned vs. still-relevant) it cannot prove
 * from git/GitHub state alone. `SALVAGE`, `OBSOLETE`, and `NEEDS_SPECIAL_HANDLING`
 * exist as classification VALUES but are never computed here — they are human
 * `--classify-override` values, applied by applyOverride(), layered onto this
 * function's output.
 *
 * TWO DIFFERENT "LANDED" SIGNALS, and a real bug this file's own live tests caught
 * on its first draft: a merged PR against a branch is NOT proof the branch's
 * CURRENT tip is landed — the branch can keep moving after its own PR merges.
 * nickstire/reel-generate-schedule is exactly this: PR #2184 genuinely merged an
 * earlier state of this branch, but 3 more commits landed on it afterward that
 * were never themselves part of any PR into main, and the first draft of this
 * function called the whole branch LANDED anyway because SOME PR against it showed
 * merged:true. So:
 *   - branch ref GONE (existsOnOrigin:false, e.g. deleted post-merge): a merged PR
 *     is authoritative — nothing could have moved past it since the ref no longer
 *     exists. Always from the per-PR `merged` field, never the list endpoint's
 *     summary field (this session's audit caught that field wrong at least once).
 *   - branch ref STILL EXISTS: the only safe LANDED signal is the branch's CURRENT
 *     tip being fully contained in main (`aheadOfMain === 0`) — a merged PR alone
 *     is not enough while the branch could have moved since.
 */

const CLASSIFICATIONS = Object.freeze({
  LANDED: "LANDED",
  QUARANTINE: "QUARANTINE",
  SALVAGE: "SALVAGE",
  OBSOLETE: "OBSOLETE",
  NEEDS_SPECIAL_HANDLING: "NEEDS_SPECIAL_HANDLING",
});
export { CLASSIFICATIONS };

/**
 * @param {object} evidence
 * @param {string} evidence.branch
 * @param {boolean} evidence.existsOnOrigin
 * @param {Array<{number: number, merged: boolean, mergedAt?: string}>} evidence.prs
 *   One entry per candidate PR with this branch as head, `merged` from the
 *   AUTHORITATIVE per-PR read (never a list endpoint's summary field).
 * @param {number} [evidence.aheadOfMain] commits ahead of main via the compare
 *   endpoint, if the branch exists (undefined, never a false 0, if unknown)
 * @param {number} [evidence.behindOfMain] commits behind main, if known
 * @returns {{classification: string, reason: string, signals: object}}
 */
export function classifyBranch(evidence) {
  const merged = evidence.prs?.find((pr) => pr.merged === true);

  if (!evidence.existsOnOrigin) {
    if (merged) {
      return {
        classification: CLASSIFICATIONS.LANDED,
        reason: `PR #${merged.number} merged${merged.mergedAt ? ` ${merged.mergedAt}` : ""} (per-PR read, not the list summary); branch ref no longer exists, so nothing could have moved past this merge`,
        signals: {},
      };
    }
    return {
      classification: CLASSIFICATIONS.QUARANTINE,
      reason: "no branch ref and no PR record on GitHub — automation has nothing provable to act on",
      signals: {},
    };
  }

  if (evidence.aheadOfMain === 0) {
    return {
      classification: CLASSIFICATIONS.LANDED,
      reason: "branch's current tip is fully contained in main (0 ahead) — safe regardless of PR history",
      signals: {},
    };
  }

  const hasMergedPrButStillAhead = Boolean(merged) && (evidence.aheadOfMain ?? 0) > 0;
  return {
    classification: CLASSIFICATIONS.QUARANTINE,
    reason: hasMergedPrButStillAhead
      ? `PR #${merged.number} merged an EARLIER state of this branch, but it is still ${evidence.aheadOfMain} commit(s) ahead of main now — work was added after that merge and was never itself landed. Needs a human look; override to NEEDS_SPECIAL_HANDLING once reviewed, never auto-treated as ordinary SALVAGE.`
      : `branch exists (${evidence.aheadOfMain ?? "?"} ahead / ${evidence.behindOfMain ?? "?"} behind main), no merged PR found — needs a human decision`,
    signals: { hasMergedPrButStillAhead },
  };
}

/** Layer a human override on top of the automatic result. `override` must be one of
 * SALVAGE/OBSOLETE/NEEDS_SPECIAL_HANDLING/QUARANTINE — never LANDED (that is only
 * ever computed, never asserted, so a human cannot declare a branch landed without
 * the PR evidence that proves it). */
export function applyOverride(autoResult, override, { reason, by } = {}) {
  if (override === CLASSIFICATIONS.LANDED) {
    throw new Error("LANDED cannot be set by override — it must come from classifyBranch's own merged-PR evidence");
  }
  if (!Object.values(CLASSIFICATIONS).includes(override)) {
    throw new Error(`unknown classification override: ${override}`);
  }
  return {
    ...autoResult,
    classification: override,
    reason: reason ?? autoResult.reason,
    override: { by: by ?? "unknown", at: new Date().toISOString(), previousClassification: autoResult.classification },
  };
}
