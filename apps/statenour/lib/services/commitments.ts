/**
 * lib/services/commitments.ts · hooks-lib REST→tRPC slice (2026-05-22)
 *
 * Commitment-create service · extracted from the create branch of the
 * POST /api/commitments route handler so the legacy REST endpoint AND
 * the new `operator.createCommitment` tRPC procedure (the `/commit`
 * direct-action) both call this one function · drift between the two
 * consumers is structurally impossible.
 *
 * Scope · CREATE only. The route's other branches (update · bulk_update
 * · expire_stale) stay inline in the REST handler — no tRPC consumer in
 * this slice touches them.
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { logCreate } from "@/lib/db/entity-audit";
import { emitCommitmentTransition } from "@/lib/db/brain-bus-emit";

export interface CreateCommitmentArgs {
  description: string;
  toWhom?: string | null;
  deadline?: string | null;
  domain?: string | null;
}

/**
 * Normalize an extractor-supplied deadline. LLM extraction emits
 * "YYYY-MM-DD" without knowing the current date, so "tonight" has
 * landed as 2024-03-16 on a commitment made 2026-06-02 (prod rows
 * #271/#295/#302…). A deadline before today at creation time is
 * always an extraction error, never intent — drop it instead of
 * storing a lie that instantly reads as "N-hundred days overdue".
 * Non-YYYY-MM-DD shapes are dropped for the same reason.
 */
export function sanitizeDeadline(deadline: string | null | undefined): string | null {
  if (!deadline) return null;
  const trimmed = deadline.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed < today() ? null : trimmed;
}

/**
 * Create a commitment. `toWhom` defaults to "self". Writes the
 * entity-audit create event, exactly as the REST route did. Returns
 * `{ ok, id }` mirroring the legacy envelope.
 */
export async function createCommitment(
  args: CreateCommitmentArgs,
): Promise<{ ok: true; id: number }> {
  const created = await prisma.commitment.create({
    data: {
      dateMade: today(),
      toWhom: args.toWhom || "self",
      description: args.description,
      deadline: sanitizeDeadline(args.deadline),
      domain: args.domain || null,
    },
  });

  void logCreate(
    "commitment",
    String(created.id),
    created as unknown as Record<string, unknown>,
    { source: "api:commitments.POST.create" },
  );

  return { ok: true, id: created.id };
}

// ─── Lifecycle (WP-13 · 2026-07-28 blueprint batch) ────────────────────
// The blueprint's doctrine centers commitments as the loop object:
//   proposed → active → verified | abandoned  (blocked = parking state;
//   "accepted" reserved in contracts COMMITMENT_STATUSES for future
//   delegation flows). A PROPOSED commitment is machine-suggested (first
//   producer: journal nextAction, WP-16) and has NO standing until the
//   operator accepts it. Dismissal is remembered — the sourceRef
//   idempotency check spans ALL statuses, so a dismissed proposal never
//   re-proposes on the next enrichment sweep. Every transition is a
//   status-guarded updateMany (no P2025, no lost-race double-flip).

export interface ProposeCommitmentInput {
  statement: string;
  /** Provenance + idempotency key, e.g. "journal-take:<entryId>". */
  sourceRef: string;
  domain?: string | null;
  deadline?: string | null;
  successCondition?: string | null;
}

/**
 * Idempotently propose a commitment. Returns the existing row's id when
 * the sourceRef already exists (in ANY status). Null on failure —
 * proposers are best-effort and must never break their host pipeline.
 */
export async function proposeCommitment(
  input: ProposeCommitmentInput,
): Promise<{ id: number; created: boolean } | null> {
  try {
    const statement = input.statement.trim().slice(0, 500);
    if (!statement) return null;
    const existing = await prisma.commitment.findFirst({
      where: { sourceRef: input.sourceRef },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    const created = await prisma.commitment.create({
      data: {
        dateMade: today(),
        toWhom: "self",
        description: statement,
        domain: input.domain || null,
        deadline: sanitizeDeadline(input.deadline),
        status: "proposed",
        successCondition: input.successCondition ?? undefined,
        sourceRef: input.sourceRef,
        createdBy: "system:proposer",
      },
    });
    void logCreate(
      "commitment",
      String(created.id),
      created as unknown as Record<string, unknown>,
      { source: "service:commitments.propose" },
    );
    return { id: created.id, created: true };
  } catch (err) {
    const { logError } = await import("@/lib/utils/error-log");
    logError("commitments", err, { stage: "propose", sourceRef: input.sourceRef }, "warn");
    return null;
  }
}

/**
 * Publish `commitment.transition` for a status flip the caller just made,
 * through the same publisher the legacy /api/commitments route uses. Before
 * 2026-10-10 that route was the only producer and no client called it, so the
 * bus handler starved. A no-op when the status did not change. Never throws:
 * the flip it describes has already happened.
 */
export async function publishCommitmentTransition(
  id: number,
  oldStatus: string | null,
  newStatus: string,
): Promise<void> {
  if (oldStatus === newStatus) return;
  let row: { description: string; toWhom: string; domain: string | null } | null = null;
  try {
    row = await prisma.commitment.findUnique({
      where: { id },
      select: { description: true, toWhom: true, domain: true },
    });
  } catch {
    // The detail is decoration; the event still records the flip.
  }
  await emitCommitmentTransition({
    commitmentId: id,
    oldStatus,
    newStatus,
    description: row?.description ?? "",
    toWhom: row?.toWhom ?? null,
    domain: row?.domain ?? null,
    transitionedAt: new Date().toISOString(),
  });
}

/**
 * A proposal born from a journal take is the take's ledgered next action
 * (journal router recordShown); the operator's verdict here closes that row (06-X5).
 * A later promote still attaches its task:<id> (attachAcceptedResultRefByContent).
 */
async function ledgerJournalVerdict(id: number, decision: "accepted" | "dismissed"): Promise<void> {
  const row = await prisma.commitment.findUnique({ where: { id }, select: { description: true, sourceRef: true } });
  if (!row?.sourceRef?.startsWith("journal-take:")) return;
  const [{ recordDecisionByContent }, { journalNextActionSummary }] = await Promise.all([
    import("@/lib/services/outcome-ledger"),
    import("@/lib/services/journal-promote"),
  ]);
  await recordDecisionByContent(journalNextActionSummary(row.description), decision, null);
}

/** Operator accepts a proposal → it goes on the books as active. */
export async function acceptCommitment(id: number): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "proposed", deletedAt: null },
    data: { status: "active", updatedBy: "operator" },
  });
  if (res.count === 1) {
    await publishCommitmentTransition(id, "proposed", "active");
    void ledgerJournalVerdict(id, "accepted").catch(() => {});
  }
  return res.count === 1;
}

/** Operator dismisses a proposal — remembered, never re-proposed. */
export async function dismissProposed(id: number): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "proposed", deletedAt: null },
    data: { status: "abandoned", updatedBy: "operator" },
  });
  if (res.count === 1) {
    await publishCommitmentTransition(id, "proposed", "abandoned");
    void ledgerJournalVerdict(id, "dismissed").catch(() => {});
  }
  return res.count === 1;
}

/** A commitment's success condition was met — link the evidence. */
export async function verifyCommitment(
  id: number,
  outcomeRef?: string | null,
): Promise<boolean> {
  // Two prior statuses qualify, so read which one, then swap on exactly that
  // one: the event names the real old status and a racing flip loses.
  const before = await prisma.commitment.findFirst({
    where: { id, status: { in: ["active", "accepted"] }, deletedAt: null },
    select: { status: true },
  });
  if (!before) return false;
  const res = await prisma.commitment.updateMany({
    where: { id, status: before.status, deletedAt: null },
    data: {
      status: "verified",
      verifiedAt: new Date(),
      ...(outcomeRef ? { outcomeRef } : {}),
      updatedBy: "operator",
    },
  });
  if (res.count === 1) await publishCommitmentTransition(id, before.status, "verified");
  return res.count === 1;
}

// ─── Active-commitment resolution (2026-08-12) ──────────────────────────
// The Pulse ticker surfaces overdue ACTIVE commitments every day (personal-
// pulse.ts) but until now the only way to close one out was chat — asking
// Nick to notice a completion-report turn and call the completeCommitment
// tool, or waiting up to 90 days for the auto-expiry floor. These give the
// ticker itself a direct, idempotent resolve path. Status-guarded
// updateMany (0 or 1 rows) matches the pattern above — a second tap or a
// race with the chat tool is a no-op, never a P2025 throw.

/** Operator did it — completes an ACTIVE commitment from the pulse ticker.
 *  Reuses the same "completed" status the completeCommitment chat tool
 *  writes (not "verified") so a single vocabulary continues to describe
 *  every UI-driven completion — see identity-snapshot.ts computePromiseIntegrity. */
export async function completeActiveCommitment(
  id: number,
  notes = "Completed (pulse ticker)",
  updatedBy = "operator",
): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: { status: "completed", notes, updatedBy },
  });
  // BDN-208 · stamp the conditions this completion happened under
  // (sleep/energy/stress/day-state). Fire-and-forget — never blocks.
  if (res.count === 1) {
    const { captureCommitmentConditions } = await import("./commitment-conditions");
    void captureCommitmentConditions(id, "completed");
    await publishCommitmentTransition(id, "active", "completed");
  }
  return res.count === 1;
}

/** Operator no longer intends to — drops an ACTIVE commitment without
 *  claiming it was kept. Distinct from "completed": this is an honest
 *  "I'm not doing this" signal, deliberately excluded from BOTH the
 *  kept and broken buckets in computePromiseIntegrity (an abandoned
 *  intention isn't a broken promise any more than a declined machine
 *  suggestion is). */
export async function abandonActiveCommitment(
  id: number,
  notes = "Dropped (pulse ticker)",
  updatedBy = "operator",
): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: { status: "abandoned", notes, updatedBy },
  });
  // BDN-208 · abandons carry conditions too — the contrast class is what
  // makes per-condition completion rates readable.
  if (res.count === 1) {
    const { captureCommitmentConditions } = await import("./commitment-conditions");
    void captureCommitmentConditions(id, "abandoned");
    await publishCommitmentTransition(id, "active", "abandoned");
  }
  return res.count === 1;
}

// ─── Promises on /missions (R3 · 2026-11-03) ───────────────────────────
// The one place Nour lists, edits and closes commitments by hand. Every write here stamps
// updatedBy PROMISE_ACTOR so the kill read (rows closed or tasked through the section) can
// count them apart from the pulse ticker and chat, which write "operator".

export const PROMISE_ACTOR = "nour";
const TASK_REF = "task:";
const PENDING_REF = "task:pending:";
/** A claim older than this is a crashed create, not a live one: the next tap may retake it. */
const PENDING_STALE_MS = 60_000;

/** Whole ET calendar days from a to b, both YYYY-MM-DD. */
function dayDiff(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

export interface PromiseRow {
  id: number;
  description: string;
  toWhom: string;
  deadline: string | null;
  /** ET days since it was made. */
  ageDays: number;
  /** ET days until the deadline; negative is past due; null when undated. */
  deadlineDays: number | null;
  /** The task made from it (executionRef task:<id>), when that task still exists. */
  task: { id: string; status: string } | null;
}

const PROMISE_SELECT = {
  id: true,
  description: true,
  toWhom: true,
  deadline: true,
  dateMade: true,
  executionRef: true,
} as const;

/** Active promises (all) and the newest proposed ones, with the real totals of each. Throws on a failed read. */
export async function listPromises(proposedLimit = 20): Promise<{
  active: PromiseRow[];
  proposed: PromiseRow[];
  activeCount: number;
  proposedCount: number;
}> {
  const [activeRows, proposedRows, activeCount, proposedCount] = await Promise.all([
    prisma.commitment.findMany({
      where: { status: "active", deletedAt: null },
      orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 200,
      select: PROMISE_SELECT,
    }),
    prisma.commitment.findMany({
      where: { status: "proposed", deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: proposedLimit,
      select: PROMISE_SELECT,
    }),
    prisma.commitment.count({ where: { status: "active", deletedAt: null } }),
    prisma.commitment.count({ where: { status: "proposed", deletedAt: null } }),
  ]);

  const taskIds = activeRows
    .map((r) => r.executionRef)
    .filter((ref): ref is string => !!ref?.startsWith(TASK_REF) && !ref.startsWith(PENDING_REF))
    .map((ref) => ref.slice(TASK_REF.length));
  const tasks = taskIds.length
    ? await prisma.task.findMany({ where: { id: { in: taskIds }, deletedAt: null }, select: { id: true, status: true } })
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, { id: t.id, status: String(t.status) }]));

  const now = today();
  const shape = (r: (typeof activeRows)[number]): PromiseRow => ({
    id: r.id,
    description: r.description,
    toWhom: r.toWhom,
    deadline: r.deadline,
    ageDays: Math.max(0, dayDiff(r.dateMade, now)),
    deadlineDays: r.deadline && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) ? dayDiff(now, r.deadline) : null,
    task: r.executionRef?.startsWith(TASK_REF) ? (taskById.get(r.executionRef.slice(TASK_REF.length)) ?? null) : null,
  });
  return { active: activeRows.map(shape), proposed: proposedRows.map(shape), activeCount, proposedCount };
}

/** Edit an active promise's text, who it is to, or its deadline (null clears it). */
export async function editPromise(
  id: number,
  patch: { description?: string; toWhom?: string; deadline?: string | null },
): Promise<boolean> {
  const res = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null },
    data: {
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.toWhom !== undefined ? { toWhom: patch.toWhom.trim() || "self" } : {}),
      ...(patch.deadline !== undefined ? { deadline: patch.deadline || null } : {}),
      updatedBy: PROMISE_ACTOR,
    },
  });
  return res.count === 1;
}

/** Done = kept (completed), Drop = abandoned. The same writers the pulse ticker uses, stamped nour. */
export async function resolvePromise(id: number, action: "done" | "drop"): Promise<boolean> {
  return action === "done"
    ? completeActiveCommitment(id, "Done (Promises on /missions)", PROMISE_ACTOR)
    : abandonActiveCommitment(id, "Dropped (Promises on /missions)", PROMISE_ACTOR);
}

export type PromiseToTaskResult =
  | { taskId: string; created: boolean }
  | { taskId: null; reason: "not_active" | "in_flight" };

/**
 * Make it a task: creates one task (Inbox, or the chosen mission) and links it through
 * executionRef task:<id>. The promise stays active; Done closes it. Idempotent: the ref is
 * claimed by compare-and-swap BEFORE the create, so a second tap returns the same task and a
 * racing tap creates nothing.
 */
export async function promiseToTask(id: number, missionId: string | null): Promise<PromiseToTaskResult> {
  const row = await prisma.commitment.findFirst({
    where: { id, status: "active", deletedAt: null },
    select: { description: true, executionRef: true },
  });
  if (!row) return { taskId: null, reason: "not_active" };
  const ref = row.executionRef;

  if (ref?.startsWith(PENDING_REF)) {
    if (Date.now() - Number(ref.slice(PENDING_REF.length)) < PENDING_STALE_MS) return { taskId: null, reason: "in_flight" };
  } else if (ref?.startsWith(TASK_REF)) {
    const taskId = ref.slice(TASK_REF.length);
    const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { id: true } });
    if (task) return { taskId, created: false };
    // The linked task was deleted: make a new one.
  }

  const claim = `${PENDING_REF}${Date.now()}`;
  const won = await prisma.commitment.updateMany({
    where: { id, status: "active", deletedAt: null, executionRef: ref },
    data: { executionRef: claim, updatedBy: PROMISE_ACTOR },
  });
  if (won.count !== 1) {
    const winner = await prisma.commitment.findUnique({ where: { id }, select: { executionRef: true } });
    const winnerRef = winner?.executionRef ?? null;
    return winnerRef?.startsWith(TASK_REF) && !winnerRef.startsWith(PENDING_REF)
      ? { taskId: winnerRef.slice(TASK_REF.length), created: false }
      : { taskId: null, reason: "in_flight" };
  }

  let task: { id: string };
  try {
    const { createTaskFromAPI } = await import("@/lib/services/task-actions");
    task = (await createTaskFromAPI({
      title: row.description.slice(0, 300),
      ...(missionId ? { missionId, status: "READY" } : { status: "INBOX" }),
    })) as { id: string };
  } catch (err) {
    await prisma.commitment.updateMany({ where: { id, executionRef: claim }, data: { executionRef: ref } });
    throw err;
  }
  await prisma.commitment.updateMany({
    where: { id, executionRef: claim },
    data: { executionRef: `${TASK_REF}${task.id}`, updatedBy: PROMISE_ACTOR },
  });
  return { taskId: task.id, created: true };
}

/**
 * Evidence-tier + confidence off a journal take's stored JSON —
 * PURE and exported for the test (2026-08-12 WP). Machine takes carry
 * `evidenceTier: "INFERRED"` + `confidence: HIGH|MED|LOW` (stamped by
 * generateJournalTake on the same funded extraction call). Anything
 * unparseable or pre-dating the field degrades to nulls — the chip
 * simply doesn't render; nothing ever blocks on this.
 */
export function parseTakeEpistemics(content: string | null | undefined): {
  evidenceTier: string | null;
  confidence: string | null;
} {
  if (!content) return { evidenceTier: null, confidence: null };
  try {
    const parsed = JSON.parse(content) as { evidenceTier?: unknown; confidence?: unknown };
    const tier =
      typeof parsed.evidenceTier === "string" &&
      ["OBSERVED", "INFERRED", "SPECULATIVE"].includes(parsed.evidenceTier)
        ? parsed.evidenceTier
        : null;
    const conf =
      typeof parsed.confidence === "string" && ["HIGH", "MED", "LOW"].includes(parsed.confidence)
        ? parsed.confidence
        : null;
    return { evidenceTier: tier, confidence: conf };
  } catch {
    return { evidenceTier: null, confidence: null };
  }
}

/** Proposed commitments awaiting the operator's verdict, oldest first. */
export async function listProposed(limit = 10) {
  const rows = await prisma.commitment.findMany({
    where: { status: "proposed", deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      description: true,
      domain: true,
      sourceRef: true,
      successCondition: true,
      createdAt: true,
    },
  });

  // Evidence-tier join (2026-08-12 WP): journal-sourced proposals carry
  // their take's epistemics so the verdict card can say WHY to trust the
  // proposal, not just where it came from. One indexed query; proposals
  // from other sources (or pre-field takes) get nulls.
  const takeKeys = rows.map((r) => r.sourceRef).filter((s): s is string => !!s?.startsWith("journal-take:"));
  const takesByKey = new Map<string, { evidenceTier: string | null; confidence: string | null }>();
  if (takeKeys.length > 0) {
    const takes = await prisma.brainMemory.findMany({
      where: { category: "journal_brain_take", key: { in: takeKeys }, deletedAt: null },
      select: { key: true, content: true },
    });
    for (const t of takes) takesByKey.set(t.key, parseTakeEpistemics(t.content));
  }

  return rows.map((r) => ({
    ...r,
    evidenceTier: (r.sourceRef && takesByKey.get(r.sourceRef)?.evidenceTier) ?? null,
    evidenceConfidence: (r.sourceRef && takesByKey.get(r.sourceRef)?.confidence) ?? null,
  }));
}
