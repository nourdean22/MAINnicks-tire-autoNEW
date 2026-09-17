/**
 * Guards for the nightly hard-delete sweeps (2026-09-01).
 *
 * THE INCIDENT THIS EXISTS FOR — with its receipt.
 * `AuditEvent eventType="cron:data_cleanup_completed"`, 2026-08-28T07:01:07Z:
 *   "Pruned 55944 rows across 29 tables", deletedByTable.brain_memories_gc = 54107.
 * Every neighbouring night: 187 · 449 · 505 · 322 · 281. One run hard-deleted
 * 54,107 brain_memories rows and reported `status: "success"` with
 * `cron_job_logs.resultCount = NULL` — the destructive job recorded nothing
 * about its own volume anywhere a monitor would look.
 *
 * The predicate that did it (app/api/cron/data-cleanup/route.ts) selected on
 * `expiresAt < now()` with NO category filter and NO `deletedAt` filter, so it
 * hard-deletes LIVE rows in any category that happens to carry a TTL. In that
 * run the population was `memory_gateway_shadow` — telemetry that is excluded
 * from embedding (lib/brain/embedding-policy.ts TELEMETRY_CATEGORIES) and from
 * recall (lib/brain/categories.ts RECALL_EXCLUDE_CATEGORIES) — but NOTHING IN
 * THE PREDICATE MADE THAT TRUE. The same sweep would take an operator-authored
 * row that had picked up an `expiresAt`, and the 08-22 wave already documented
 * exactly that failure mode for `blind_spot` (memory `remember()` stamps a 24h
 * probation expiry on the create arm).
 *
 * Two independent guards, because one is a single point of failure:
 *   1. NEVER_HARD_DELETE_CATEGORIES — durable/operator-facing categories are
 *      never eligible, whatever their expiry says.
 *   2. judgeSweep() — a circuit breaker. A sweep larger than the cap does not
 *      run at all; it reports itself as a failure so the run goes red instead
 *      of deleting 54,107 rows behind a green "success".
 *
 * The cap is deliberately NOT "the biggest number we have seen". It is set
 * above normal nightly volume (measured: 187-505/night across 2026-08-26..09-01)
 * and far below the incident (54,107), so the breaker is silent in normal
 * operation and loud on anything shaped like the incident.
 */
import { DURABLE_PERSONAL_CATEGORIES } from "@/lib/brain/memory-recall";

export const NEVER_HARD_DELETE_CATEGORIES: readonly string[] = [
  // The operator's own layer — identity, health, relationships, events, …
  ...DURABLE_PERSONAL_CATEGORIES,
  // The compounding layer. config/retention.ts already says these must never
  // get a TTL row ("NEVER in this list (compounds forever)"); that comment
  // documented an intent no code enforced. This enforces it.
  "identity_snapshot",
  "belief",
  "contradiction",
  "decision_pattern",
  "anti_pattern",
  "wisdom",
  "insight",
  "pattern",
  "blind_spot",
  "principle",
  "reflection",
  "decision_log",
  "task_lesson",
  "weekly_review",
  "mission_retro",
  "qualitative_identity",
  "strategic_plan",
  "counter_intuitive",
  "hidden_correlation",
  "teaching_moment",

  // ── 2026-09-17 · the operator's OWN record, added after a dry run ──
  //
  // Measured before adding: a sweep would have hard-deleted 274 rows across
  // these six — 53 wins, 86 concerns, 59 emotional_state, 52 prediction_lesson,
  // 17 learning_journal, 7 business_event — while the rest of each category
  // (158, 373, 438, 240, 98, 47 respectively) stayed. That split is the tell.
  //
  // ★★★ THE TTLs ARE DECENTRALISED AND UNAUDITED. Every one of those rows was
  // in range via a deliberately-set `expiresAt` (2,911 of 2,912 candidates came
  // from the TTL arm; exactly ONE came from the low-confidence heuristic), and
  // `config/retention.ts` — the one place that is supposed to decide what
  // expires — covers only five categories, NONE of them these. So the expiry
  // was chosen by whatever happened to write each row, and nobody ever decided
  // that a `win` should die.
  //
  // ⚠ These are not instrumentation. `memory_gateway_shadow` (2,140 of the same
  // sweep) is; a win, a concern, a lesson learned from a prediction is the
  // operator's own record of their life and business. Hard-delete is
  // irreversible, so the asymmetry decides it: keeping a stale `win` costs a
  // row, losing a real one cannot be undone.
  //
  // Operator decision 2026-09-17: protect these, then re-enable the sweeper
  // that had been switched off since 2026-09-08 precisely to avoid this.
  "win",
  "concern",
  "emotional_state",
  "prediction_lesson",
  "learning_journal",
  "business_event",
];

/**
 * Ceiling for ONE hard-delete sweep. Measured basis in the header: normal
 * nightly brain_memories_gc volume is 187-505; the incident was 54,107.
 */
export const MAX_HARD_DELETE_PER_SWEEP = 5_000;

export interface SweepVerdict {
  allowed: boolean;
  count: number;
  cap: number;
  reason?: string;
}

/**
 * Decide whether a sweep of `count` rows may proceed.
 *
 * Fails CLOSED on a nonsense count: a negative or non-finite number means the
 * pre-count itself is broken, and a broken counter must never authorise a
 * delete. (A broken reader is indistinguishable from an empty store — the trap
 * this whole incident is an instance of.)
 */
export function judgeSweep(count: number, cap: number = MAX_HARD_DELETE_PER_SWEEP): SweepVerdict {
  if (!Number.isFinite(count) || count < 0) {
    return { allowed: false, count, cap, reason: `refusing to sweep on an invalid pre-count (${count})` };
  }
  if (count > cap) {
    return {
      allowed: false,
      count,
      cap,
      reason:
        `BLOCKED: sweep would hard-delete ${count} rows, over the ${cap} cap. ` +
        `Nothing was deleted. Inspect before raising the cap — on 2026-08-28 a sweep of this ` +
        `shape removed 54,107 rows behind a green "success".`,
    };
  }
  return { allowed: true, count, cap };
}
