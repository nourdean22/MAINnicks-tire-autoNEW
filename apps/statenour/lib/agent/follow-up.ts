/**
 * lib/agent/follow-up.ts — agent-initiated follow-ups (2026-08-28 · WP3).
 *
 * THE COMPLAINT THIS ANSWERS, verbatim: "never follows up on its own
 * unless I send a message first." That is not a missing feature, it is a
 * missing SUBSTRATE — the system had turns, not jobs. A turn cannot
 * outlive its request, so nothing could ever happen later.
 *
 * NO NEW TABLE, AND THAT IS DELIBERATE. `PostTurnOutbox` already is a
 * durable queue with claim/retry/dead-letter, a status machine, and
 * `nextAttemptAt` — which is precisely a "run this later" primitive. The
 * standing rule is that a third queue beside PostTurnOutbox and WorkItem
 * is the failure mode, so a follow-up is a `kind` on the existing queue,
 * not a new one. (WorkItem is separately never to be merged into Task.)
 *
 * ═══ THIS IS THE MOST DANGEROUS CODE IN THE WAVE ═══
 * An agent that can wake itself up is an agent that can spam its owner or
 * bill him in a loop. Every guardrail below is load-bearing and each has
 * a canary that breaks it:
 *
 *   1. KILL SWITCH, DEFAULT OFF. Ships inert. Merging this cannot cause a
 *      single message; the operator opts in. Enabled via
 *      NICK_AGENT_FOLLOWUPS=1.
 *   2. FAILS CLOSED. Any error deciding whether it may run answers "no".
 *      This inverts getAiConfig's deliberate fail-OPEN (ai-config.ts:124)
 *      because the risks are asymmetric: chat degrading is harmless, an
 *      agent messaging you in a loop is not.
 *   3. DAILY CAP across all threads — bounds a runaway globally.
 *   4. PER-THREAD CAP — one conversation cannot monopolise the budget.
 *   5. DEDUPE KEY — a retry, or the model asking twice, collapses to one
 *      row. The queue's own attempts/backoff handles transport retries;
 *      this handles LOGICAL duplicates.
 *   6. NO SELF-SCHEDULING FROM UNTRUSTED TURNS — scraped web/email
 *      content must never be able to schedule the agent to act later.
 *      This is the prompt-injection boundary and it is not negotiable.
 *   7. MINIMUM DELAY — nothing can schedule itself to run immediately in
 *      a tight loop.
 *
 * What a follow-up may do is deliberately narrow: it writes an assistant
 * message into the thread it came from. It does NOT send SMS, email or
 * Telegram — those are customer-facing side effects that need their own
 * explicit operator instruction, every time.
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { OUTBOX_KIND } from "@/lib/services/chat/post-turn-outbox";

const log = rootLogger.withSurface("agent/follow-up");

/** Global ceiling across every thread, per rolling UTC day. */
export const FOLLOWUP_DAILY_CAP = numFromEnv("NICK_FOLLOWUP_DAILY_CAP", 8);
/** Ceiling for any single conversation, per rolling UTC day. */
export const FOLLOWUP_PER_THREAD_CAP = numFromEnv("NICK_FOLLOWUP_THREAD_CAP", 3);
/** Nothing may schedule itself to fire sooner than this. */
export const FOLLOWUP_MIN_DELAY_MS = numFromEnv("NICK_FOLLOWUP_MIN_DELAY_MS", 5 * 60_000);
/** Nothing may park work further out than this. */
export const FOLLOWUP_MAX_DELAY_MS = numFromEnv("NICK_FOLLOWUP_MAX_DELAY_MS", 7 * 24 * 60 * 60_000);
/** A row sitting in `processing` longer than this lost its worker. */
export const FOLLOWUP_PROCESSING_STALE_MS = numFromEnv(
  "NICK_FOLLOWUP_STALE_MS",
  15 * 60_000,
);

function numFromEnv(key: string, fallback: number): number {
  const raw = Number((process.env[key] ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * Master switch. DEFAULT OFF — this ships observable-but-inert, per the
 * repo's canary-before-wiring rule, so the merge itself is incapable of
 * producing a message.
 */
export function areFollowUpsEnabled(): boolean {
  return (process.env.NICK_AGENT_FOLLOWUPS ?? "").trim() === "1";
}

export interface FollowUpPayload {
  conversationId: string;
  /** What the agent should do when it wakes. Plain instruction text. */
  instruction: string;
  /** Collapses logical duplicates. Same key + same thread = one row. */
  dedupeKey: string;
  /** Why this was scheduled — shown to the operator, never invented. */
  reason: string;
  scheduledAt: string;
}

export type FollowUpRefusal =
  | "disabled"
  | "untrusted-origin"
  | "daily-cap"
  | "thread-cap"
  | "duplicate"
  | "delay-out-of-range"
  | "missing-conversation"
  | "error";

export interface ScheduleResult {
  scheduled: boolean;
  id?: string;
  refusedBecause?: FollowUpRefusal;
  reason: string;
}

export interface ScheduleInput {
  conversationId: string;
  instruction: string;
  dedupeKey: string;
  reason: string;
  runAfterMs: number;
  /** True when THIS turn contained web/Drive/email content. */
  untrustedOrigin?: boolean;
  /** Private turns leave no trace and may not schedule. */
  privateMode?: boolean;
}

/**
 * Schedule one follow-up. Refuses far more often than it accepts, by
 * design — every refusal names itself so a silent no-op is impossible.
 */
export async function scheduleFollowUp(input: ScheduleInput): Promise<ScheduleResult> {
  const refuse = (refusedBecause: FollowUpRefusal, reason: string): ScheduleResult => {
    log.info("followup_refused", { refusedBecause, reason, conversationId: input.conversationId });
    return { scheduled: false, refusedBecause, reason };
  };

  try {
    if (!areFollowUpsEnabled()) {
      return refuse("disabled", "agent follow-ups are switched off (NICK_AGENT_FOLLOWUPS)");
    }
    // The injection boundary. Content that came from the open web must
    // never be able to make the agent act later, on its own, unattended.
    if (input.untrustedOrigin) {
      return refuse(
        "untrusted-origin",
        "turn contained untrusted external content — cannot schedule autonomous work",
      );
    }
    if (input.privateMode) {
      return refuse("disabled", "private turns do not persist and cannot schedule follow-ups");
    }
    if (
      !Number.isFinite(input.runAfterMs) ||
      input.runAfterMs < FOLLOWUP_MIN_DELAY_MS ||
      input.runAfterMs > FOLLOWUP_MAX_DELAY_MS
    ) {
      return refuse(
        "delay-out-of-range",
        `delay must be between ${FOLLOWUP_MIN_DELAY_MS}ms and ${FOLLOWUP_MAX_DELAY_MS}ms`,
      );
    }

    const conversation = await prisma.chatConversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true },
    });
    if (!conversation) {
      return refuse("missing-conversation", "conversation does not exist");
    }

    const since = startOfUtcDay();
    const [dailyCount, threadCount, duplicate] = await Promise.all([
      prisma.postTurnOutbox.count({
        where: { kind: OUTBOX_KIND.agentFollowUp, createdAt: { gte: since } },
      }),
      prisma.postTurnOutbox.count({
        where: {
          kind: OUTBOX_KIND.agentFollowUp,
          createdAt: { gte: since },
          payload: { path: ["conversationId"], equals: input.conversationId },
        },
      }),
      // 2026-08-28 (review P2) · scoped to the CONVERSATION. The contract
      // says a dedupe key is unique per thread; filtering on the key alone
      // meant a pending "check-in" in one conversation silently blocked a
      // legitimate "check-in" in every other one — a guardrail refusing
      // work it was never meant to refuse.
      prisma.postTurnOutbox.findFirst({
        where: {
          kind: OUTBOX_KIND.agentFollowUp,
          status: { in: ["pending", "processing"] },
          AND: [
            { payload: { path: ["dedupeKey"], equals: input.dedupeKey } },
            { payload: { path: ["conversationId"], equals: input.conversationId } },
          ],
        },
        select: { id: true },
      }),
    ]);

    if (duplicate) {
      return refuse("duplicate", "a follow-up with this dedupe key is already queued for this conversation");
    }
    if (dailyCount >= FOLLOWUP_DAILY_CAP) {
      return refuse("daily-cap", `daily follow-up cap reached (${dailyCount}/${FOLLOWUP_DAILY_CAP})`);
    }
    if (threadCount >= FOLLOWUP_PER_THREAD_CAP) {
      return refuse(
        "thread-cap",
        `this thread's daily follow-up cap reached (${threadCount}/${FOLLOWUP_PER_THREAD_CAP})`,
      );
    }

    const payload: FollowUpPayload = {
      conversationId: input.conversationId,
      instruction: input.instruction.slice(0, 2000),
      dedupeKey: input.dedupeKey,
      reason: input.reason.slice(0, 500),
      scheduledAt: new Date().toISOString(),
    };
    const row = await prisma.postTurnOutbox.create({
      data: {
        kind: OUTBOX_KIND.agentFollowUp,
        payload: payload as unknown as object,
        status: "pending",
        nextAttemptAt: new Date(Date.now() + input.runAfterMs),
      },
      select: { id: true },
    });
    log.info("followup_scheduled", {
      id: row.id,
      conversationId: input.conversationId,
      runAfterMs: input.runAfterMs,
    });
    return { scheduled: true, id: row.id, reason: input.reason };
  } catch (err) {
    // FAIL CLOSED. If we cannot prove it is safe to schedule, we do not.
    log.error("followup_schedule_failed", {
      error: err instanceof Error ? err.message.slice(0, 300) : String(err),
    });
    return refuse("error", "could not verify follow-up limits — refusing (fail closed)");
  }
}

/**
 * Claim follow-ups whose time has come.
 *
 * Separate from claimOrphans because the timing semantics are opposite:
 * an orphan is work that SHOULD already have run and is overdue by a
 * grace window, while a follow-up is work deliberately parked until
 * `nextAttemptAt`. Reusing the orphan claim would fire every follow-up a
 * grace window after creation, ignoring its schedule entirely.
 */
export async function claimDueFollowUps(limit = 5): Promise<
  Array<{ id: string; payload: FollowUpPayload; attempts: number }>
> {
  if (!areFollowUpsEnabled()) return [];
  const now = new Date();
  // 2026-08-28 (review P2) · a crash between claim and finish left the row
  // at status "processing" forever, because this selector only looked at
  // "pending" — the follow-up was permanently lost despite the queue's
  // retry/dead-letter design. Mirrors claimOrphans' stale-processing lease:
  // a row whose worker has not touched it for the window is reclaimable,
  // while a LIVE worker's row (just updated) stays safe.
  const staleProcessing = new Date(now.getTime() - FOLLOWUP_PROCESSING_STALE_MS);
  const candidates = await prisma.postTurnOutbox.findMany({
    where: {
      kind: OUTBOX_KIND.agentFollowUp,
      attempts: { lt: 3 },
      OR: [
        { status: "pending", nextAttemptAt: { lte: now } },
        { status: "processing", updatedAt: { lt: staleProcessing } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true, status: true },
  });

  const claimed: Array<{ id: string; payload: FollowUpPayload; attempts: number }> = [];
  for (const c of candidates) {
    // Status-guarded flip is the lock — first claimant wins, so two
    // concurrent drains cannot both run the same follow-up.
    // The status-guarded flip is the lock. For a reclaimed row the
    // updatedAt guard is part of the predicate, so a worker that is still
    // alive (and therefore touching the row) cannot have it stolen.
    const res = await prisma.postTurnOutbox.updateMany({
      where:
        c.status === "pending"
          ? { id: c.id, kind: OUTBOX_KIND.agentFollowUp, status: "pending" }
          : {
              id: c.id,
              kind: OUTBOX_KIND.agentFollowUp,
              status: "processing",
              updatedAt: { lt: staleProcessing },
            },
      data: { status: "processing", attempts: { increment: 1 } },
    });
    if (res.count !== 1) continue;
    const row = await prisma.postTurnOutbox.findUnique({
      where: { id: c.id },
      select: { id: true, payload: true, attempts: true },
    });
    if (row) {
      claimed.push({
        id: row.id,
        payload: row.payload as unknown as FollowUpPayload,
        attempts: row.attempts,
      });
    }
  }
  return claimed;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
