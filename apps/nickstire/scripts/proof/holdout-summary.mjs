/**
 * Hidden holdout — the summary the evidence ledger receives (2026-09-15).
 *
 * The holdout run's report never leaves the runner (it names the episodes'
 * oracles); only what is here does: ids and counts. Pure functions, unit-tested
 * from shared/proofHoldout.test.ts, consumed by post-run-evidence.mjs.
 *
 * An absent holdout is reported as UNMEASURED, on purpose and every run: the
 * loop must never read "no holdout secret" as "the holdout passed" — that is
 * the silent-instrument shape, and a hidden evaluator is the one instrument
 * whose silence nobody would notice.
 */

/** Ids the holdout runner is allowed to name. Mirrors tests/episodes/schema.ts isHoldoutId. */
export const HOLDOUT_ID = /^HO-\d{3,}$/;

/**
 * Reduce a Playwright JSON report to ids + statuses. "unexpected" is a test that
 * failed after every retry; "flaky" (failed then passed) is not a failure.
 */
export function summarizeHoldout(report) {
  const stats = report?.stats ?? {};
  const ids = new Set();
  const failedIds = new Set();
  const walk = (suite) => {
    for (const s of suite?.suites ?? []) walk(s);
    for (const spec of suite?.specs ?? []) {
      const id = /^(HO-\d+)\b/.exec(spec.title ?? "")?.[1];
      if (!id) continue;
      ids.add(id);
      if ((spec.tests ?? []).some((t) => t.status === "unexpected")) failedIds.add(id);
    }
  };
  walk(report);
  return {
    measured: true,
    expected: Number(stats.expected ?? 0),
    unexpected: Number(stats.unexpected ?? 0),
    flaky: Number(stats.flaky ?? 0),
    skipped: Number(stats.skipped ?? 0),
    total: ids.size,
    failedIds: [...failedIds].sort(),
  };
}

/**
 * The `proof.holdout` RealityEvent. `summary` is null when the holdout did not
 * run (no secret, or the unpack produced nothing) — then the event says so.
 */
export function holdoutEvent({ summary, outcome, reason, liveCommit, wantCommit, runUrl, now }) {
  const commitObjects = liveCommit ? [{ type: "commit", id: liveCommit, role: "judged" }] : [];
  const base = {
    eventType: "proof.holdout",
    observedAt: now,
    objects: [{ type: "site", id: "nickstire.org" }, { type: "holdout", id: "nickstire-episodes" }, ...commitObjects],
    source: { system: "github-actions", uri: runUrl ?? undefined },
    quality: "observed",
    privacy: "internal",
  };
  if (!summary) {
    return { ...base, payload: { outcome: "unmeasured", measured: false, reason: reason ?? "no holdout", liveCommit, wantCommit } };
  }
  const verdict = summary.unexpected > 0 ? "failure" : outcome === "failure" ? "failure" : "success";
  return {
    ...base,
    payload: {
      outcome: verdict,
      measured: true,
      expected: summary.expected,
      unexpected: summary.unexpected,
      flaky: summary.flaky,
      skipped: summary.skipped,
      total: summary.total,
      failedIds: summary.failedIds.filter((id) => HOLDOUT_ID.test(id)),
      liveCommit,
      wantCommit,
      judgedRequestedCommit: liveCommit && wantCommit ? liveCommit === wantCommit : null,
    },
  };
}
