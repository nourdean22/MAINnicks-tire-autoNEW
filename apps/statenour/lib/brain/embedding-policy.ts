/**
 * What belongs in the semantic index, and why.
 *
 * `brain_memories` is used for two different jobs: durable KNOWLEDGE (things
 * worth recalling) and EVENT TELEMETRY (things worth auditing). Both are
 * legitimate uses of the table. Only the first belongs in a vector index —
 * embedding a log line puts it in the same space as reasoning, where it competes
 * for a finite number of recall slots on every query.
 *
 * Shared by the embed-backfill cron and the one-shot drain script so the two
 * cannot disagree about what the index is for.
 */

/**
 * High-volume event-log categories, measured on prod 2026-08-16 (~3,879 rows).
 *
 * DENYLIST, not an allowlist, deliberately: a new KNOWLEDGE category must be
 * indexed by default. The bug this policy exists to correct made 83.5% of the
 * brain silently unreachable, and an allowlist is a machine for reproducing it —
 * every category someone forgets to add stays invisible with no error anywhere.
 *
 * The long tail of one-row categories is intentionally NOT listed. A single row
 * costs nothing to index, and enumerating them would create maintenance the
 * denylist is supposed to avoid.
 */
export const TELEMETRY_CATEGORIES = [
  "mastery_xp_event",
  "memory_gateway_shadow",
  "persona_drift",
  "nick_quality",
  "data_source_probe",
  "objection_injection_log",
  "goal_lift",
  "score_event",
  "friction",
  "reply_quality",
  "brain_dump_event",
  "task_completion",
] as const;

/** Mutable copy — Prisma's `= ANY($1)` binding rejects a readonly tuple. */
export const TELEMETRY_CATEGORY_LIST: string[] = [...TELEMETRY_CATEGORIES];
