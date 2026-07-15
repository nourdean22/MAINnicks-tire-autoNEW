/**
 * execute-actions · Wave AG · 2026-05-28.
 *
 * The executor. Called by the 9am `nick-action-execute` cron for
 * each AutonomousAction row where approval="approved" + executedAt
 * IS NULL. Dispatches by `actionType` and returns a structured
 * `ExecutionResult` so the cron can both update the row + compose
 * the Telegram digest in one pass.
 *
 * Safe by design ·
 *   · Every branch wraps the side-effect in try/catch — one failed
 *     row never blocks the rest of the batch.
 *   · Every write is small, scoped, and reversible (status changes,
 *     soft archive, BrainMemory writes — no destructive deletes).
 *   · The "outreach" branch deliberately does NOT send SMS in v1;
 *     it logs the draft to RELATIONSHIPS_OUTREACH so the operator
 *     owns the final tap. Surface gap routes to nickstire later.
 *
 * Per kaizen · the executor lives off the proposer's payload shape
 * (`lib/ai/propose-actions.ts`). Adding a new actionType is a single
 * `case` here + a single emitter there.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import type { NickActionType } from "@/lib/ai/propose-actions";

export interface ExecutionContext {
  /** The AutonomousAction row id · used in result logs. */
  actionRowId: string;
  /** The actionType (the proposer's enum). */
  actionType: NickActionType;
  /** Target row id (mission, task, person, brain_dump). */
  targetId: string;
  /** Whatever the proposer attached at queue-time. Executor-specific. */
  payload: Record<string, unknown>;
}

export interface ExecutionResult {
  ok: boolean;
  /** 1-line human-readable summary · lands in the Telegram digest. */
  summary: string;
  /** Optional metadata for the AutonomousAction.payload result log. */
  meta?: Record<string, unknown>;
  /** Error message if ok=false. */
  error?: string;
}

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Top-level dispatch. The cron route calls this in a loop, one row at
 * a time. Every branch is wrapped — a thrown error becomes
 * `{ok:false, error}` so the cron's per-row catch is defense-in-depth.
 */
export async function executeNickAction(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  try {
    switch (ctx.actionType) {
      case "archive_mission":
        return await execArchiveMission(ctx);
      case "nudge_task":
        return await execNudgeTask(ctx);
      case "commit_journal":
        return await execCommitJournal(ctx);
      case "send_sms_outreach":
        return await execSendSmsOutreach(ctx);
      case "reassign_task":
        return await execReassignTask(ctx);
      case "confirm_spend":
        return await execConfirmSpend(ctx);
      default: {
        const unknown: never = ctx.actionType;
        return {
          ok: false,
          summary: `unknown actionType ${String(unknown)}`,
          error: "unknown_action_type",
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      summary: `executor threw · ${ctx.actionType}`,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

// ── archive_mission ────────────────────────────────────────────────
//
// Mission state machine: ACTIVE → COMPLETE. Soft, reversible · the
// operator can flip back via /missions if they decide otherwise.

async function execArchiveMission(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const m = await prisma.mission.findUnique({
    where: { id: ctx.targetId },
    select: { id: true, title: true, status: true, deletedAt: true },
  });
  if (!m) {
    return {
      ok: false,
      summary: `mission ${ctx.targetId.slice(0, 8)} gone`,
      error: "mission_not_found",
    };
  }
  if (m.deletedAt) {
    return {
      ok: true,
      summary: `${m.title.slice(0, 40)} already soft-deleted`,
      meta: { idempotent: true },
    };
  }
  if (m.status === "COMPLETE") {
    return {
      ok: true,
      summary: `${m.title.slice(0, 40)} already COMPLETE`,
      meta: { idempotent: true },
    };
  }
  await prisma.mission.update({
    where: { id: m.id },
    data: { status: "COMPLETE", updatedBy: "nick" },
  });
  return {
    ok: true,
    summary: `archived mission · ${m.title.slice(0, 50)}`,
    meta: { previousStatus: m.status },
  };
}

// ── nudge_task ─────────────────────────────────────────────────────
//
// Bumps a DOING task to READY so it re-enters the operator's daily
// queue, AND writes a brain_memory note so the next /chat turn has
// the context. The operator gets the row surfaced AND a hint.

async function execNudgeTask(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const t = await prisma.task.findUnique({
    where: { id: ctx.targetId },
    select: { id: true, title: true, status: true, deletedAt: true },
  });
  if (!t || t.deletedAt) {
    return {
      ok: false,
      summary: `task ${ctx.targetId.slice(0, 8)} gone`,
      error: "task_not_found",
    };
  }
  if (t.status !== "DOING") {
    return {
      ok: true,
      summary: `${t.title.slice(0, 40)} no longer DOING (${t.status}) · skipped`,
      meta: { idempotent: true, currentStatus: t.status },
    };
  }
  await prisma.task.update({
    where: { id: t.id },
    data: { status: "READY", updatedBy: "nick" },
  });
  // The next-chat hint — a 1-line nudge captured in the brain.
  await prisma.brainMemory
    .create({
      data: {
        category: "task_nudge",
        key: `${t.id}:${new Date().toISOString().slice(0, 10)}`,
        content: `Nick bumped "${t.title.slice(0, 120)}" from DOING→READY · was overdue`,
        confidence: 0.95,
        source: "executor:nick-action-execute",
      },
    })
    .catch(() => undefined);
  return {
    ok: true,
    summary: `nudged · ${t.title.slice(0, 50)} → READY`,
    meta: { previousStatus: t.status },
  };
}

// ── commit_journal ─────────────────────────────────────────────────
//
// Runs the existing journal-ingest pipeline on the brain_dump's raw
// text. That extracts tasks + commitments + insights + tags · all
// the synthesis the operator skipped in the original dump.

async function execCommitJournal(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const dump = await prisma.brainDump.findUnique({
    where: { id: ctx.targetId },
    select: { id: true, rawThoughts: true, summary: true },
  });
  if (!dump) {
    return {
      ok: false,
      summary: `brain dump ${ctx.targetId.slice(0, 8)} gone`,
      error: "brain_dump_not_found",
    };
  }
  if (dump.summary) {
    return {
      ok: true,
      summary: `dump ${dump.id.slice(0, 8)} already committed`,
      meta: { idempotent: true },
    };
  }
  try {
    const { ingestJournal } = await import("@/lib/brain/journal-ingest");
    // Audit 2026-07-15 · two fixes in one call:
    //  · reuseDumpId — pre-fix this re-INGESTED the raw text, which
    //    CREATED a fresh brain_dump row per run while the idempotency
    //    guard above watched the ORIGINAL row's summary (which never
    //    got written) — so every commit_journal action duplicated the
    //    entry (the /journal triplicate rows). Now the pipeline
    //    updates the existing row in place, which also makes the
    //    summary guard actually idempotent.
    //  · source "chat" — omitting it defaulted to "telegram" and
    //    could fire Telegram goal-link pings for chat-approved actions.
    const result = (await ingestJournal(dump.rawThoughts, "chat", {
      reuseDumpId: dump.id,
    })) as {
      tasksCreated?: number;
      insightsStored?: number;
      commitmentsFound?: number;
      summary?: string;
    };
    return {
      ok: true,
      summary:
        `committed dump · ${result.tasksCreated ?? 0}t · ${result.insightsStored ?? 0}i · ${result.commitmentsFound ?? 0}c`,
      meta: {
        tasksCreated: result.tasksCreated ?? 0,
        insightsStored: result.insightsStored ?? 0,
        commitmentsFound: result.commitmentsFound ?? 0,
      },
    };
  } catch (err) {
    return {
      ok: false,
      summary: `ingest failed · dump ${dump.id.slice(0, 8)}`,
      error: err instanceof Error ? err.message.slice(0, 200) : String(err),
    };
  }
}

// ── send_sms_outreach ──────────────────────────────────────────────
//
// v1 boundary · the executor drafts + logs to the RelationshipLedger-
// mirror BrainMemory category, but does NOT call out to nickstire's
// SMS bridge. The operator's "send" is the final tap inside the
// /relationships ledger or whatever channel they prefer. This keeps
// the killer-feature shippable today and isolates the outbound
// network call to a later wave.

async function execSendSmsOutreach(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const person = await prisma.personProfile.findUnique({
    where: { id: ctx.targetId },
    select: { id: true, name: true, role: true, status: true, deletedAt: true },
  });
  if (!person || person.deletedAt) {
    return {
      ok: false,
      summary: `person ${ctx.targetId.slice(0, 8)} gone`,
      error: "person_not_found",
    };
  }
  const rationale =
    (ctx.payload.rationale as string | undefined) ??
    "Today's pick · no rationale captured";
  const draftBody = composeOutreachDraft(person.name, person.role, rationale);

  // Log to the ledger-mirror category so /relationships surfaces the
  // draft and the operator can promote it to a real send.
  await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.RELATIONSHIPS_OUTREACH,
      key: `${person.id}:${Date.now()}`,
      content: `[nick-action-draft] ${draftBody}`,
      confidence: 0.85,
      source: "executor:nick-action-execute",
      metadata: {
        personId: person.id,
        personName: person.name,
        role: person.role,
        rationale,
        draftBody,
        sent: false,
        actionRowId: ctx.actionRowId,
      } as never,
    },
  });

  return {
    ok: true,
    summary: `draft logged · ${person.name} · open /relationships to send`,
    meta: { draftBody, personId: person.id },
  };
}

/**
 * Deterministic draft composer for v1. No AI roundtrip on the cron's
 * hot path. The operator can rewrite freely before sending — this is
 * a starting line not a finished message.
 */
function composeOutreachDraft(
  name: string,
  role: string | null | undefined,
  rationale: string,
): string {
  const firstName = (name || "").trim().split(/\s+/)[0] || name;
  const opener =
    role === "family" || role === "close_friend"
      ? `Hey ${firstName} —`
      : `${firstName} —`;
  const cleanRationale = rationale
    .replace(/\s+/g, " ")
    .replace(/^[•·\-\s]+/, "")
    .trim()
    .slice(0, 160);
  return `${opener} thinking of you. ${cleanRationale} Free to chat this week?`;
}

// ── reassign_task ──────────────────────────────────────────────────
//
// Stale INBOX → WAITING + snoozedUntil = +7d. The task disappears
// from the operator's active surface for a week, then auto-resurfaces
// (the WAITING→READY auto-bump cron is already wired).

async function execReassignTask(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const t = await prisma.task.findUnique({
    where: { id: ctx.targetId },
    select: { id: true, title: true, status: true, deletedAt: true },
  });
  if (!t || t.deletedAt) {
    return {
      ok: false,
      summary: `task ${ctx.targetId.slice(0, 8)} gone`,
      error: "task_not_found",
    };
  }
  if (t.status !== "INBOX") {
    return {
      ok: true,
      summary: `${t.title.slice(0, 40)} no longer INBOX (${t.status}) · skipped`,
      meta: { idempotent: true, currentStatus: t.status },
    };
  }
  const sevenDays = new Date(Date.now() + 7 * DAY_MS);
  await prisma.task.update({
    where: { id: t.id },
    data: {
      status: "WAITING",
      snoozedUntil: sevenDays,
      updatedBy: "nick",
    },
  });
  return {
    ok: true,
    summary: `snoozed 7d · ${t.title.slice(0, 50)}`,
    meta: { snoozedUntil: sevenDays.toISOString() },
  };
}

// ── confirm_spend ──────────────────────────────────────────────────
//
// Operator-acknowledged AI cost breach. v1 no-op log · keeps the
// approval-class slot reserved so when the spend-gate cron starts
// writing these the executor doesn't need a new branch.

async function execConfirmSpend(
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  await prisma.brainMemory
    .create({
      data: {
        category: "ai_spend_acknowledged",
        key: new Date().toISOString().slice(0, 10),
        content: `Operator acknowledged AI spend signal · payload=${JSON.stringify(
          ctx.payload,
        ).slice(0, 240)}`,
        confidence: 1,
        source: "executor:nick-action-execute",
      },
    })
    .catch(() => undefined);
  return {
    ok: true,
    summary: `spend acknowledgement logged`,
    meta: { actionRowId: ctx.actionRowId },
  };
}
