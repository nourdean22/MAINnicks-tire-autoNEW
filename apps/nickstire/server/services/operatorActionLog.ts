/**
 * A record of what the OPERATOR did, and whether it worked.
 *
 * WHY
 * The Action Center lets a human rebuild media, re-run paid QA, reconcile an
 * ambiguous publish, close a job, or spend generation budget. None of that was
 * recorded. Six months from now the answerable questions should include: who
 * clicked this, how often is recovery actually used, does re-assembly succeed,
 * how much did operator-initiated regeneration cost. Without a record, every one
 * of those is a guess.
 *
 * Reuses autonomy_audit_events — the same table the publish-attempt ledger writes
 * to. No new schema: the shape already fits (id, timestamp, action type, decision,
 * JSON context), and adding a table to carry six columns would be the kind of
 * sprawl this codebase already suffers from.
 *
 * NON-BLOCKING, BUT NOT FIRE-AND-FORGET. Unlike the publish-attempt ledger —
 * where the record IS the safety property and a failure must block the publish —
 * this is observability: a write failure logs loudly and the action still
 * succeeds. But the write is AWAITED rather than dispatched and forgotten,
 * because these actions spend money and mutate published state, and a process
 * exiting right after one must not lose the record of it. Cost is one row
 * insert; the alternative silently drops writes exactly when load is highest.
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("services:operator-action-log");

/** Fits autonomy_audit_events.decision varchar(24) — checked at module load. */
export const ACTION_OUTCOME = {
  ok: "OK",
  failed: "FAILED",
  refused: "REFUSED",
} as const;
export type ActionOutcome = (typeof ACTION_OUTCOME)[keyof typeof ACTION_OUTCOME];

for (const v of Object.values(ACTION_OUTCOME)) {
  if (v.length > 24) throw new Error(`action outcome "${v}" exceeds decision varchar(24)`);
}

export interface OperatorActionRecord {
  /** e.g. "reassemble", "rerun_qa", "reconcile", "discard", "regenerate". */
  action: string;
  outcome: ActionOutcome;
  operatorId?: number | string | null;
  jobId?: number | null;
  /** Wall-clock cost of the action, so slow recoveries are visible later. */
  durationMs?: number | null;
  /** Whether this action spent generation budget — the expensive question. */
  costsMoney?: boolean;
  /** Anything worth knowing later: bytes produced, clips used, new job id, error. */
  detail?: Record<string, unknown>;
}

export async function recordOperatorAction(rec: OperatorActionRecord): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return;
    const { autonomyAuditEvents } = await import("../../drizzle/schema");
    await d.insert(autonomyAuditEvents).values({
      id: `act_${randomUUID()}`,
      actionType: `operator_${rec.action}`.slice(0, 48),
      decision: rec.outcome,
      reasoningCodes: String(rec.operatorId ?? "unknown").slice(0, 1024),
      policyVersion: 0,
      contextJson: JSON.stringify({
        action: rec.action,
        outcome: rec.outcome,
        operatorId: rec.operatorId ?? null,
        jobId: rec.jobId ?? null,
        durationMs: rec.durationMs ?? null,
        costsMoney: rec.costsMoney ?? false,
        at: new Date().toISOString(),
        ...(rec.detail ?? {}),
      }).slice(0, 60_000),
    });
  } catch (err) {
    // Observability must never block recovery. Loud in logs, silent to the caller.
    log.warn("operator action not recorded", {
      action: rec.action,
      outcome: rec.outcome,
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
  }
}

/**
 * Wrap an operator action so timing and outcome are recorded whatever happens.
 * A throw is re-thrown after being logged — the caller still sees its error.
 */
export async function withOperatorAction<T>(
  meta: Omit<OperatorActionRecord, "outcome" | "durationMs">,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    // AWAITED, not fire-and-forget. These actions spend money and mutate
    // published state; a process exiting right after one must not lose the
    // record of it. recordOperatorAction never throws, so this cannot fail the
    // action — it only makes the write deterministic.
    await recordOperatorAction({
      ...meta,
      outcome: ACTION_OUTCOME.ok,
      durationMs: Date.now() - started,
      detail: { ...(meta.detail ?? {}), result: summarize(result) },
    });
    return result;
  } catch (err) {
    // A refusal (the action was not permitted) is not the same as a failure (it
    // was permitted and broke). Distinguishing them is the point of the log:
    // "operators keep being refused" and "this keeps breaking" need different fixes.
    const message = err instanceof Error ? err.message : String(err);
    const refused = /BAD_REQUEST|refus|not permitted|no longer in a reconcilable|cannot be closed/i.test(message);
    await recordOperatorAction({
      ...meta,
      outcome: refused ? ACTION_OUTCOME.refused : ACTION_OUTCOME.failed,
      durationMs: Date.now() - started,
      detail: { ...(meta.detail ?? {}), error: message.slice(0, 400) },
    });
    throw err;
  }
}

/** Keep only small, useful fields out of an arbitrary result object. */
function summarize(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of ["jobId", "newJobId", "supersededJobId", "mp4Url", "clipsUsed", "durationSec", "decision", "framesEvaluated", "mode"]) {
    if (v[k] !== undefined) out[k] = v[k];
  }
  return Object.keys(out).length ? out : null;
}
