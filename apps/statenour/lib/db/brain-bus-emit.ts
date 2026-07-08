/**
 * Brain-bus producer wrappers · v10.0.63 · 2026-05-01.
 *
 * Closes the silent ghost-feeder pattern in the durable event spine:
 * pre-v10.0.63 the brain-bus had ONE producer (cron-manager publishing
 * `cron.failure`). The polling consumer + dispatch registry were
 * wired correctly, but the operator's hot paths (drift fires,
 * commitment transitions, task completions, score logs, autonomous
 * fires) wrote rows to Prisma without ever publishing the event.
 * Result: durable replay log was empty; learning loops downstream
 * had nothing to subscribe to.
 *
 * v10.0.63 adds typed wrappers around `publishDurable` for each
 * canonical event family. Each wrapper:
 *   · constructs a stable dedupeKey so retries don't double-record
 *   · catches errors so a publish failure never blocks the primary
 *     write at the call site
 *   · emits a structured-logger warn on failure so /system/errors
 *     surfaces persistent bus issues
 *
 * Handler side: see `brain-bus-handlers.ts` — each event type has a
 * registered handler that writes a long-term BrainMemory record. The
 * BrainBusEvent table is the WORK QUEUE (rows delete after retention);
 * BrainMemory is the LONG-TERM RECORD (chat search, brain pipeline
 * input, decision-pattern learning).
 *
 * Adding a new event family:
 *   1. Add `emitXxx(...)` wrapper here with its dedupeKey strategy.
 *   2. Add the handler in brain-bus-handlers.ts.
 *   3. Add a test in tests/db/brain-bus-emit.test.ts.
 *   4. Wire emit calls at every producer site.
 */

import { publishDurable } from "./brain-bus-durable";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain-bus/emit");

/**
 * Best-effort emit. Wraps publishDurable so producer failures don't
 * propagate up and block the primary Prisma write that triggered the
 * event. Returns the event id on success, null on failure.
 */
async function tryEmit(
  topic: string,
  eventType: string,
  payload: unknown,
  dedupeKey: string,
): Promise<string | null> {
  try {
    const { id } = await publishDurable(topic, eventType, payload, { dedupeKey });
    return id;
  } catch (err) {
    log.warn("emit_failed", {
      topic,
      eventType,
      dedupeKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── drift.fired ───────────────────────────────────────────────────

export interface DriftFiredPayload {
  alertId: string;
  ruleId: string;
  ruleName: string;
  severity: string;
  message: string;
  date: string; // YYYY-MM-DD
}

/**
 * Emit when a DriftAlert row is freshly created. Same-rule + same-day
 * dedupes — the rule firing again the same day shouldn't double-record
 * (the BrainMemory write in the handler is also keyed by rule+date).
 */
export async function emitDriftFired(payload: DriftFiredPayload): Promise<string | null> {
  const dedupeKey = `drift_${payload.ruleId}_${payload.date}`;
  // v-truth · real-time lane (NICK_EVENT_TRIGGERS) · fan the drift alert to
  // the event-driven proposer so it reacts in seconds (the consumer self-
  // gates on the flag + writes a PENDING proposal, never sends). Best-effort:
  // a send failure must not block the durable bus write below.
  try {
    const { getInngest } = await import("@/lib/inngest/client");
    await getInngest().send({
      name: "nick/urgent.signal",
      data: {
        signalId: payload.ruleId,
        signal: "drift",
        trigger: `Drift · ${payload.ruleName} · ${payload.severity}`,
        rationale: payload.message.slice(0, 140),
      },
    });
  } catch {
    /* swallow · the durable bus row is still written below */
  }
  return tryEmit("drift.fired", "drift.alert_created", payload, dedupeKey);
}

// ── commitment.transition ─────────────────────────────────────────

export type CommitmentStatus = "active" | "in_progress" | "completed" | "broken" | "abandoned";

export interface CommitmentTransitionPayload {
  commitmentId: number;
  oldStatus: CommitmentStatus | string | null;
  newStatus: CommitmentStatus | string;
  description: string;
  toWhom: string | null;
  domain: string | null;
  /** ISO datetime when the transition happened. */
  transitionedAt: string;
}

/**
 * Emit when a Commitment changes status. Includes the prior status so
 * the decision-pattern engine can see the transition arc (active →
 * broken vs active → completed). Dedupes per (id, newStatus) within
 * a 60-second bucket so a noisy re-save doesn't double-record while
 * a legitimate transition still records.
 */
export async function emitCommitmentTransition(
  payload: CommitmentTransitionPayload,
): Promise<string | null> {
  const minuteBucket = Math.floor(new Date(payload.transitionedAt).getTime() / 60_000);
  const dedupeKey = `commit_${payload.commitmentId}_${payload.newStatus}_${minuteBucket}`;
  return tryEmit("commitment.transition", "commitment.status_changed", payload, dedupeKey);
}

// ── task.completed ────────────────────────────────────────────────

export interface TaskCompletedPayload {
  taskId: string;
  title: string;
  missionId: string | null;
  domain: string | null;
  loopKind: string;
  completedAt: string;
}

/**
 * Emit when a Task transitions to status=DONE. Same-task same-day
 * dedupe so a re-mark doesn't double-record. Handler writes a
 * `task_completion` BrainMemory row keyed by task+date so chat
 * queries like "what did I get done today" hit semantic search.
 */
export async function emitTaskCompleted(payload: TaskCompletedPayload): Promise<string | null> {
  const dateKey = payload.completedAt.slice(0, 10); // YYYY-MM-DD
  const dedupeKey = `task_done_${payload.taskId}_${dateKey}`;
  return tryEmit("task.completed", "task.done", payload, dedupeKey);
}

// ── score.logged ──────────────────────────────────────────────────

export interface ScoreLoggedPayload {
  date: string; // YYYY-MM-DD
  /** Score JSON content (whatever the writer persisted). */
  snapshot: unknown;
  /** Source of the write — "manual" / "cron:refresh-identity" / etc. */
  source: string;
}

/**
 * Emit when an identity_snapshot BrainMemory row is upserted. One
 * event per day per source so the morning cron refresh + manual
 * mastery engagement both surface, but a 5x-per-second hot loop
 * doesn't double-record.
 */
export async function emitScoreLogged(payload: ScoreLoggedPayload): Promise<string | null> {
  const dedupeKey = `score_${payload.date}_${payload.source}`;
  return tryEmit("score.logged", "score.snapshot_updated", payload, dedupeKey);
}

// ── autonomous.fired ──────────────────────────────────────────────

export interface AutonomousFiredPayload {
  ruleName: string;
  actionType: string;
  targetType: string;
  targetId: string | null;
  result: "success" | "failed" | "skipped";
  /** Optional error if result=failed. */
  error?: string;
  /** Idempotency key from the autonomous-engine claim. */
  idempotencyKey: string;
}

/**
 * Emit when the autonomous engine fires a rule. Dedupes on the
 * idempotency key the engine already minted (rule + targetType +
 * targetId + 1h bucket) so a retry of the same fire is a no-op.
 */
export async function emitAutonomousFired(
  payload: AutonomousFiredPayload,
): Promise<string | null> {
  return tryEmit(
    "autonomous.fired",
    "autonomous.rule_executed",
    payload,
    payload.idempotencyKey,
  );
}

// ── goal.transition ──────────────────────────────────────────────

export type LifeGoalStatus = "active" | "paused" | "completed" | "abandoned" | string;

export interface GoalTransitionPayload {
  goalId: string;
  oldStatus: LifeGoalStatus | null;
  newStatus: LifeGoalStatus;
  title: string;
  domain: string | null;
  horizon: string | null;
  /** ISO datetime when the transition happened. */
  transitionedAt: string;
}

/**
 * v10.0.78 · Emit when a LifeGoal changes status. Same shape as
 * commitment.transition — dedupes per (id, newStatus, minute-bucket)
 * so a noisy re-save doesn't double-record but a legit transition
 * still does. Downstream: brain-bus-handlers writes a `goal_event`
 * BrainMemory row keyed by (goalId, newStatus, date).
 */
export async function emitGoalTransition(
  payload: GoalTransitionPayload,
): Promise<string | null> {
  const minuteBucket = Math.floor(new Date(payload.transitionedAt).getTime() / 60_000);
  const dedupeKey = `goal_${payload.goalId}_${payload.newStatus}_${minuteBucket}`;
  return tryEmit("goal.transition", "goal.status_changed", payload, dedupeKey);
}

// ── reflection.created ────────────────────────────────────────────

export interface ReflectionCreatedPayload {
  reflectionId: string;
  date: string; // YYYY-MM-DD
  scope: string;
  category: string;
  insight: string;
  actionable: boolean;
}

/**
 * v10.0.78 · Emit when a Reflection row is created. Dedupes per
 * reflectionId so a retry of the same create is a no-op (Reflection.id
 * is the primary identity). Downstream: handlers can feed the brain
 * pipeline (learning-journal, wisdom-distiller) without polling for
 * new rows.
 */
export async function emitReflectionCreated(
  payload: ReflectionCreatedPayload,
): Promise<string | null> {
  const dedupeKey = `reflection_${payload.reflectionId}`;
  return tryEmit("reflection.created", "reflection.row_created", payload, dedupeKey);
}

// ── brain_dump.finalized ──────────────────────────────────────────

export interface BrainDumpFinalizedPayload {
  brainDumpId: string;
  date: string; // YYYY-MM-DD
  mode: "manual" | "fireflies" | "voice" | "journal-cron" | string;
  /** True once classifyJournalEntry has run + extractedItems is set. */
  extracted: boolean;
  /** Length of rawThoughts (sanity / observability). */
  rawChars: number;
}

/**
 * v10.0.78 · Emit when a BrainDump is finalized — meaning the row is
 * written AND its extracted items pipeline has completed (or skipped
 * for manual brain dumps that don't need extraction). Dedupes per
 * brainDumpId so a re-finalize of the same row is a no-op.
 */
export async function emitBrainDumpFinalized(
  payload: BrainDumpFinalizedPayload,
): Promise<string | null> {
  const dedupeKey = `brain_dump_${payload.brainDumpId}`;
  return tryEmit("brain_dump.finalized", "brain_dump.row_finalized", payload, dedupeKey);
}
