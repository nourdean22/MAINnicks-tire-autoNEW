/**
 * Intelligence Outcome Ledger (S4, 2026-07-28) — the learning layer's
 * missing half. Records what the machine RECOMMENDED, where it was
 * shown, what the operator did, and whether it helped — the audit's
 * PR-9, scoped to surfaces that have NO outcome tracking of their own.
 * Surfaces with receipts (agenda, approvals, opportunity queue) are
 * read beside this ledger, never duplicated into it.
 *
 * The recall-eval corpus grows from here: rows where decision =
 * dismissed or outcomeUseful = false are correction candidates
 * (outcomesNeedingReview) that become eval cases with real provenance.
 *
 * Every write is fire-and-forget-safe: a ledger failure must never
 * break the surface that was recommending.
 *
 * ★ SEMANTIC CONTRACT (2026-10-02, full-circle wave 3). Two columns, two
 * questions, never derived from each other:
 *   · `decision`      — what the operator DID with the recommendation:
 *                       accepted (acted on it) · dismissed (chose otherwise)
 *                       · ignored (let it lapse). Written by the surface that
 *                       saw the act (a CTA click, a verdict, a "different move").
 *   · `outcomeUseful` — whether acting HELPED: a rating button, a completion
 *                       rating, a discovery verdict. A 👍 is not an "accepted";
 *                       a row can be useful-and-undecided (rated from a push the
 *                       operator never clicked through) or decided-and-unrated.
 * `outcomeStats` therefore reports `unlabelled` (both null) beside `undecided`
 * (decision null): the first is "nothing is known", the second only "no act
 * was recorded". Closure by `resultRef` (`task:<id>`) joins a recommendation to
 * the task it became when the summary is not the task title (Home lead,
 * Missions deck); closure by content joins when it is (Discover → investigate).
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

/**
 * Row kinds a writer may create. `decision_surface` rows exist historically
 * (chat's getTopDecisions wrote one per surfacing until 2026-10-02) but the
 * producer is gone — the decision happened in nickstire, so the row could never
 * be decided here. Readers still see the old rows as plain strings.
 */
export type OutcomeKind =
  | "daily_brief"
  | "proactive_push"
  | "suggestion"
  | "prediction";

/** What the operator did. `edited` was declared for a year and never written (census 2026-10-02); it is gone. */
export type OutcomeDecision = "accepted" | "dismissed" | "ignored";

/**
 * THE correction predicate — a recommendation the operator dismissed or rated
 * not useful. One owner (2026-10-02): the harvest cron, the odometer script,
 * the eval-dataset exporter and the recall-corpus builder each carried their
 * own copy, so "what counts as a correction" could drift four ways silently.
 * `tests/services/correction-where-single-owner.test.ts` pins that the literal
 * exists nowhere else.
 */
export const CORRECTION_WHERE: Prisma.IntelligenceOutcomeWhereInput = {
  OR: [{ decision: "dismissed" }, { outcomeUseful: false }],
};

/** Stable 16-hex hash of the normalized summary — exported for tests. */
export function outcomeContentHash(summary: string): string {
  return createHash("sha256")
    .update(summary.replace(/\s+/g, " ").trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export interface RecordShownInput {
  kind: OutcomeKind;
  sourceEngine: string;
  summary: string;
  shownSurface: string;
  evidenceRefs?: Record<string, unknown> | null;
  confidence?: number | null;
  conversationId?: string | null;
  traceId?: string | null;
}

/**
 * Record a recommendation the operator was SHOWN. Dedup: an identical
 * summary re-shown within 24h reuses the existing row (re-surfacing is
 * not a new recommendation — counting it as one would be the
 * refresh-as-production defect all over again).
 */
export async function recordShown(input: RecordShownInput): Promise<string | null> {
  try {
    const contentHash = outcomeContentHash(input.summary);
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Fast path, no lock: a re-show inside the dedup window (the 60 s polls of
    // Home, the deck and the chips) is one indexed read.
    const existing = await prisma.intelligenceOutcome.findFirst({
      where: { contentHash, shownAt: { gte: dayAgo } },
      select: { id: true },
    });
    if (existing) return existing.id;
    // Miss: check-then-create under a transaction-scoped advisory lock keyed
    // on the content hash (2026-10-02). Without it, two tabs or devices
    // polling the same surface both missed and both created a row; the
    // operator's decision then landed on one and the twin stayed undecided
    // forever. The lock serialises only writers of the SAME text, is released
    // at commit, and needs no schema change.
    // $executeRaw, never $queryRaw: pg_advisory_xact_lock returns void, which
    // $queryRaw cannot deserialize, so every miss threw and the ledger wrote
    // no row from 2026-10-02 16:03Z (this lock's deploy) to the fix
    // (tests/repo/void-function-query-raw.test.ts).
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`intelligence_outcome:${contentHash}`}))`;
      const again = await tx.intelligenceOutcome.findFirst({
        where: { contentHash, shownAt: { gte: dayAgo } },
        select: { id: true },
      });
      if (again) return again.id;
      const row = await tx.intelligenceOutcome.create({
        data: {
          kind: input.kind,
          sourceEngine: input.sourceEngine,
          contentHash,
          summary: input.summary.slice(0, 2000),
          shownSurface: input.shownSurface,
          evidenceRefs: (input.evidenceRefs ?? undefined) as never,
          confidence: input.confidence ?? undefined,
          conversationId: input.conversationId ?? undefined,
          traceId: input.traceId ?? undefined,
        },
        select: { id: true },
      });
      return row.id;
    });
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-shown", kind: input.kind }, "warn");
    return null;
  }
}

/**
 * Correct a row's delivery surface after the fact.
 *
 * WHY THIS EXISTS (2026-09-18). `recordShown` dedups on content hash within
 * 24h and RETURNS THE EXISTING ID — it does not update. That is right for
 * retries, but it means the FIRST caller's `shownSurface` wins permanently.
 *
 * The daily brief now has to ledger BEFORE it sends (the notification's rating
 * button must carry a row id that exists), and at that moment nobody knows yet
 * whether web push reached a device. Without this, the pre-send guess would
 * freeze and the "did it actually deliver" signal recordBriefShown used to
 * record would be silently lost — a field quietly becoming less true, which is
 * the defect shape this ledger exists to avoid.
 */
export async function setShownSurface(id: string, shownSurface: string): Promise<boolean> {
  try {
    const res = await prisma.intelligenceOutcome.updateMany({
      where: { id },
      data: { shownSurface },
    });
    return res.count === 1;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "set-shown-surface", id }, "warn");
    return false;
  }
}

/**
 * `recordShown` under a time bound, for READ paths that ledger what they are
 * about to render (the Home brief, the Missions deck). The ledger must never
 * hold a page: past `ms` the surface renders without an id and simply cannot
 * record a decision this time. The write itself still completes in the
 * background and dedups on the next render.
 */
export async function recordShownBounded(input: RecordShownInput, ms = 400): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    return await Promise.race([recordShown(input), bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The operator acted on (or dismissed) a recommendation. */
export async function recordDecision(params: {
  id: string;
  decision: OutcomeDecision;
  resultRef?: string | null;
}): Promise<boolean> {
  try {
    const res = await prisma.intelligenceOutcome.updateMany({
      where: { id: params.id, decision: null },
      data: {
        decision: params.decision,
        decidedAt: new Date(),
        resultRef: params.resultRef ?? undefined,
      },
    });
    return res.count === 1;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-decision", id: params.id }, "warn");
    return false;
  }
}

/**
 * Decide a row by id and, when its evidence names the task it is about
 * (`evidenceRefs.taskId`), carry that as `resultRef task:<id>` so the task's
 * completion rating can close it (recordOutcomeByResultRef). Used where the
 * decider only holds the row id — a chat chip tap — and the producer, not the
 * client, knows which task the recommendation was about.
 */
export async function recordDecisionFromEvidence(
  id: string,
  decision: OutcomeDecision,
): Promise<boolean> {
  let resultRef: string | null = null;
  // Only an ACCEPTED recommendation becomes the task it names. A dismissed row
  // carrying task:<id> was closed by that task's completion rating as
  // "useful" (bug-hunt 2026-10-02).
  if (decision !== "accepted") return recordDecision({ id, decision, resultRef: null });
  try {
    const row = await prisma.intelligenceOutcome.findUnique({
      where: { id },
      select: { evidenceRefs: true },
    });
    const taskId = (row?.evidenceRefs as { taskId?: unknown } | null)?.taskId;
    if (typeof taskId === "string" && taskId.length > 0) resultRef = `task:${taskId}`;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-decision-from-evidence", id }, "warn");
  }
  return recordDecision({ id, decision, resultRef });
}

/**
 * Record a decision when the caller has the surfaced TEXT but not the ledger
 * id (2026-08-16).
 *
 * Why this exists: recordDecision() needs a cuid, but not one of the five
 * recordShown() producers persists the id anywhere a dismiss handler can
 * reach — briefs go to BriefingLog (no metadata column), pushes go to
 * Telegram, the chat tool discards it. That is the whole reason `decision`
 * and `outcomeUseful` were NULL on every row in the table: not low volume,
 * a missing join. `contentHash` is indexed (schema.prisma @@index), and
 * outcomeContentHash() is deterministic over the normalized summary — so the
 * text the operator dismissed is enough to find the row it was shown from,
 * with no id plumbing and no migration.
 *
 * Scoped to a 30-day window so an old identical summary can't absorb a fresh
 * decision, and ordered newest-first so the most recent surfacing wins.
 * Returns false (never throws) when there is no matching row — a surface can
 * call this unconditionally without knowing whether it was ledgered.
 */
export async function recordDecisionByContent(
  summary: string,
  decision: OutcomeDecision,
  resultRef?: string | null,
): Promise<boolean> {
  try {
    const trimmed = summary.trim();
    if (!trimmed) return false;
    const contentHash = outcomeContentHash(trimmed);
    const since = new Date(Date.now() - 30 * 86_400_000);
    // The NEWEST row for this text, decided or not (bug-hunt 2026-10-02). With
    // `decision: null` in the filter, a second act on today's already-decided
    // row silently decided YESTERDAY's — e.g. accept-then-dismiss on a nudge
    // planted a false correction on a row the operator never dismissed.
    // recordDecision's CAS then refuses an already-decided row.
    const row = await prisma.intelligenceOutcome.findFirst({
      where: { contentHash, shownAt: { gte: since } },
      orderBy: { shownAt: "desc" },
      select: { id: true },
    });
    if (!row) return false;
    return await recordDecision({ id: row.id, decision, resultRef });
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-decision-by-content" }, "warn");
    return false;
  }
}

/**
 * Record an outcome when the caller has the surfaced TEXT but not the
 * ledger id (2026-08-19 · outcome-loop wave) — the recordDecisionByContent
 * pattern applied to the usefulness half, which had ZERO callers for the
 * same reason decisions once did: no producer persists the ledger id
 * anywhere a later outcome moment can reach.
 *
 * Same contract as its sibling: contentHash join over the normalized
 * summary, 30-day window, newest-first. Only fills rows whose outcome is
 * still unset — a later automatic signal must never overwrite an earlier
 * judgment. Returns false (never throws) when nothing matches, so a
 * surface can call this unconditionally without knowing whether the text
 * was ever ledgered — that property is what lets task completion close
 * the loop for ANY suggestion that became a task, with zero id plumbing.
 */
export async function recordOutcomeByContent(
  summary: string,
  useful: boolean,
  resultRef?: string | null,
): Promise<boolean> {
  try {
    const trimmed = summary.trim();
    if (!trimmed) return false;
    const contentHash = outcomeContentHash(trimmed);
    const since = new Date(Date.now() - 30 * 86_400_000);
    // Newest row for this text, rated or not — same reason as
    // recordDecisionByContent: never walk back onto an older surfacing.
    const row = await prisma.intelligenceOutcome.findFirst({
      where: { contentHash, shownAt: { gte: since } },
      orderBy: { shownAt: "desc" },
      select: { id: true },
    });
    if (!row) return false;
    return await recordOutcome({ id: row.id, useful, resultRef });
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-outcome-by-content" }, "warn");
    return false;
  }
}

/**
 * The real-world outcome landed (or the operator judged usefulness).
 *
 * First-write-wins, enforced ATOMICALLY: the `outcomeAt: null` scope on the
 * update itself (recordDecision's CAS pattern) — not just on a caller's
 * earlier SELECT, which would leave a TOCTOU window. Concrete poisoning this
 * prevents: two stale tabs rate the same discovery "known" then "noise" —
 * without the guard the second call lands outcomeUseful:false on a claim the
 * operator confirmed TRUE, and the recall-eval harvest trains against it.
 */
export async function recordOutcome(params: {
  id: string;
  useful: boolean;
  resultRef?: string | null;
}): Promise<boolean> {
  try {
    const res = await prisma.intelligenceOutcome.updateMany({
      where: { id: params.id, outcomeAt: null },
      data: {
        outcomeUseful: params.useful,
        outcomeAt: new Date(),
        ...(params.resultRef ? { resultRef: params.resultRef } : {}),
      },
    });
    return res.count === 1;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-outcome", id: params.id }, "warn");
    return false;
  }
}

/**
 * Close a recommendation by the thing it BECAME. Used from the task completion
 * path: a Home lead or deck pick that was accepted carries `resultRef =
 * task:<id>`, and the task's completion rating is that recommendation's
 * outcome. Same first-write-wins rule as `recordOutcome`.
 */
export async function recordOutcomeByResultRef(resultRef: string, useful: boolean): Promise<number> {
  const trimmed = resultRef.trim();
  if (!trimmed) return 0;
  try {
    const res = await prisma.intelligenceOutcome.updateMany({
      // Accepted rows only: a resultRef on a dismissed/ignored row must never be
      // closed by the task's rating (bug-hunt 2026-10-02).
      where: { resultRef: trimmed, outcomeAt: null, decision: "accepted" },
      data: { outcomeUseful: useful, outcomeAt: new Date() },
    });
    return res.count;
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "record-outcome-by-result-ref", resultRef: trimmed }, "warn");
    return 0;
  }
}

/** Raw counts, no invented rates — nulls stay visible as undecided/unmeasured. */
export async function outcomeStats(windowDays = 30): Promise<{
  shown: number;
  decided: number;
  accepted: number;
  dismissed: number;
  usefulTrue: number;
  usefulFalse: number;
  /** decision null — no act was recorded (the row may still be rated). */
  undecided: number;
  /** decision null AND outcomeUseful null — nothing is known about the row. */
  unlabelled: number;
} | null> {
  try {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const rows = await prisma.intelligenceOutcome.findMany({
      where: { shownAt: { gte: since } },
      select: { decision: true, outcomeUseful: true },
    });
    return {
      shown: rows.length,
      decided: rows.filter((r) => r.decision != null).length,
      accepted: rows.filter((r) => r.decision === "accepted").length,
      dismissed: rows.filter((r) => r.decision === "dismissed").length,
      usefulTrue: rows.filter((r) => r.outcomeUseful === true).length,
      usefulFalse: rows.filter((r) => r.outcomeUseful === false).length,
      undecided: rows.filter((r) => r.decision == null).length,
      unlabelled: rows.filter((r) => r.decision == null && r.outcomeUseful == null).length,
    };
  } catch (err) {
    logError("intel.outcome-ledger", err, { stage: "stats" }, "warn");
    return null;
  }
}

/** Correction candidates → future recall-eval corpus cases. */
export async function outcomesNeedingReview(limit = 20) {
  return prisma.intelligenceOutcome.findMany({
    where: CORRECTION_WHERE,
    orderBy: { shownAt: "desc" },
    take: limit,
    select: { id: true, kind: true, sourceEngine: true, summary: true, decision: true, outcomeUseful: true, shownAt: true },
  });
}
