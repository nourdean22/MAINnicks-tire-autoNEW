/**
 * Does `config/crons.ts` describe the cron system that is actually running?
 *
 * The manifest is the DECLARED truth. Production has two other truths that can
 * disagree with it and with each other:
 *   · `cron_job_log`  — what was OBSERVED to run
 *   · `cron_control`  — kill switches (BrainMemory rows; absence = enabled)
 *
 * Every function here is pure so `tests/scripts/cron-truth.test.ts` can break it
 * with fixtures. The probe that feeds it live data is
 * `scripts/probe-cron-truth.mjs`.
 *
 * ── WHAT THIS EXISTS TO CATCH (all measured on production 2026-09-17) ──
 *
 * ★★★ A cron declared `active` while a KILL SWITCH has it disabled.
 *   `data-cleanup` was `mode: "active"` in the manifest and switched OFF in
 *   production since 2026-09-08, with an empty note and no expiry. It is the
 *   sweeper that hard-deletes expired brain memories. Nothing reconciled the
 *   two, and `pnpm check:crons` validates the manifest without ever reading the
 *   switches, so the contradiction could stand indefinitely.
 *
 * ★★★ "NOT OBSERVED" IS NOT "NOT RUNNING", and conflating them is the trap this
 *   module exists to prevent. Only 5 of 27 Inngest function files write to
 *   `cron_job_log`, so ~17 genuinely-running Inngest crons have zero rows.
 *   `intelligence-daily-brief` is the proof: no log rows in 14 days, yet its
 *   Langfuse traces land at 10:15-10:17 daily, exactly matching its
 *   `15 10 * * *` schedule. A first draft of this audit listed all 17 as
 *   "declared ACTIVE, NOT observed" — which reads as "dead" and would have sent
 *   someone hunting 17 non-existent outages.
 */

/** Statuses that are NOT failures. `partial` is a real, healthy outcome. */
export const NON_FAILURE_STATUSES = ["success", "partial"];

/**
 * ⚠⚠ `partial` IS LIVE (2,535 rows measured 2026-08-22) and the schema says so
 * explicitly: filter with `not: "failed"`, never `equals: "success"`, or every
 * partial run is silently reclassified as broken. An earlier pass of this audit
 * used `!== "success"` and only escaped the bug because the window happened to
 * contain zero partials — right answer, wrong reason.
 */
export function isFailureStatus(status) {
  return !NON_FAILURE_STATUSES.includes(String(status));
}

/**
 * Classify one declared cron against what production shows.
 *
 * @param {{name: string, mode: string, inngest?: boolean, schedule?: string|null}} decl
 * @param {{ observed?: {total: number, last: Date|string|null}, disabled?: boolean, logsItsRuns?: boolean }} live
 * @returns {{ verdict: string, severity: "ok"|"info"|"warn"|"alert", detail: string }}
 */
export function classifyCron(decl, live = {}) {
  const observed = live.observed ?? null;
  const ran = Boolean(observed && observed.total > 0);

  // A kill switch beats every other signal: the manifest is asserting something
  // production has explicitly overridden.
  if (live.disabled) {
    return decl.mode === "active"
      ? {
          verdict: "declared-active-but-disabled",
          severity: "alert",
          detail: "manifest says active; a kill switch has it OFF. Nothing reconciles these.",
        }
      : {
          verdict: "disabled-and-not-active",
          severity: "info",
          detail: `mode=${decl.mode} and switched off — consistent.`,
        };
  }

  // ★ The distinction that matters. An Inngest cron that never logs CANNOT be
  // judged by the log, so silence is UNKNOWN, never "dead".
  if (decl.mode === "active" && !ran && live.logsItsRuns === false) {
    return {
      verdict: "unobservable",
      severity: "warn",
      detail: "active and probably running, but it writes no cron_job_log rows — absence proves nothing.",
    };
  }

  if (decl.mode === "active" && !ran) {
    return {
      verdict: "active-but-silent",
      severity: "alert",
      detail: "active, logs its runs, and produced none in the window — a genuinely dead schedule.",
    };
  }

  // `folded` means "no standalone schedule, runs inside another cron", so a
  // folded cron that runs is CORRECT. An early draft flagged all 19 as ghosts.
  if (decl.mode === "folded") {
    return ran
      ? { verdict: "folded-running", severity: "ok", detail: "runs inside its parent cron, as declared." }
      : { verdict: "folded-idle", severity: "info", detail: "folded and not seen in the window." };
  }

  if (decl.mode === "dormant" && ran) {
    return {
      verdict: "dormant-but-ran",
      severity: "info",
      detail: "dormant means not SCHEDULED, not unreachable — a manual trigger produces exactly this.",
    };
  }

  if (decl.mode === "retired" && ran) {
    return { verdict: "retired-but-ran", severity: "alert", detail: "declared retired yet still executing." };
  }

  return ran
    ? { verdict: "healthy", severity: "ok", detail: "declared and observed." }
    : { verdict: "idle", severity: "info", detail: "not active, not observed — consistent." };
}

/**
 * A kill switch with no note is an undocumented production decision. The
 * `data-cleanup` switch had an empty note and no expiry, so nothing recorded
 * WHY the sweeper was turned off or when to revisit it.
 */
export function auditKillSwitch(row) {
  const problems = [];
  if (row.enabled === false && !row.note) problems.push("disabled with NO note — the reason is unrecorded");
  if (row.enabled === false && !row.expiresAt) problems.push("disabled with NO expiry — nothing will prompt a review");
  return problems;
}

/** Rank so alerts cannot be buried under healthy rows. */
export const SEVERITY_ORDER = { alert: 0, warn: 1, info: 2, ok: 3 };
export function bySeverity(a, b) {
  return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
}
