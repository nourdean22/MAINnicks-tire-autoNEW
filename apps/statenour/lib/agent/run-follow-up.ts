/**
 * lib/agent/run-follow-up.ts — execute one claimed follow-up (2026-08-28).
 *
 * The consumer half of lib/agent/follow-up.ts. Without this the scheduler
 * would be a queue nothing drains — a dead control, which is this repo's
 * signature defect and the exact thing the follow-up lane must not become.
 *
 * WHAT A FOLLOW-UP IS ALLOWED TO DO, and nothing more: generate one
 * assistant message and write it into the thread it was scheduled from.
 *
 * It deliberately does NOT:
 *   · send SMS / email / Telegram — customer-facing side effects need an
 *     explicit operator instruction every time, and "the agent decided
 *     to" is not one. The message lands in the thread; the operator sees
 *     it when they look, exactly like any other reply.
 *   · call tools or mutate anything. A follow-up is a NOTE, not an
 *     actor. Giving an unattended loop write access is a different
 *     decision with a different risk profile and it has not been made.
 *   · re-schedule itself. Chaining is how a bounded feature becomes an
 *     unbounded one; a new follow-up must come from a real operator turn.
 *
 * The generated message is explicitly LABELLED as agent-initiated. An
 * unprompted message that looks identical to a reply is indistinguishable
 * from the system talking to itself, and the operator must always be able
 * to tell which of his messages he actually sent.
 */

import { prisma } from "@/lib/prisma";
import { aiChat, isAiSentinel } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";
import { FOLLOWUP_PROCESSING_STALE_MS, type FollowUpPayload } from "./follow-up";
import { beginAttempt, settleAttempt } from "@/lib/services/action-attempts";

const log = rootLogger.withSurface("agent/run-follow-up");

/** Prefix every agent-initiated message carries, in content AND provenance. */
export const FOLLOWUP_MARKER = "follow-up";

export interface RunFollowUpResult {
  ok: boolean;
  messageId?: string;
  reason: string;
  /** True when the failure is transient (provider outage) and the follow-up
   *  should run again later. Absent on deliberate drops (archived thread). */
  retryable?: boolean;
}

/** A replay inside this window finds the first attempt and does not deliver again (08-X2). */
const FOLLOWUP_REPLAY_WINDOW_MS = 24 * 60 * 60_000;

/**
 * An EXECUTING attempt older than the outbox reclaim window lost its worker (R3-17 #8):
 * it would otherwise block delivery for its whole 24h hold and the row would be marked done.
 * Take it over with a compare-and-set on what was read, so exactly one reclaimer proceeds
 * (to the receipt check, then the send). False when the attempt is young (its worker may be
 * alive) or another reclaimer won.
 */
async function takeOverAbandoned(attemptId: string): Promise<boolean> {
  const row = await prisma.actionAttempt.findUnique({
    where: { id: attemptId },
    select: { state: true, attemptNo: true, startedAt: true, holdUntil: true },
  });
  if (!row || row.state !== "EXECUTING" || !(row.startedAt instanceof Date)) return false;
  if (Date.now() - row.startedAt.getTime() < FOLLOWUP_PROCESSING_STALE_MS) return false;
  const now = new Date();
  const took = await prisma.actionAttempt.updateMany({
    where: { id: attemptId, attemptNo: row.attemptNo, state: "EXECUTING", holdUntil: row.holdUntil, startedAt: row.startedAt },
    data: { attemptNo: row.attemptNo + 1, startedAt: now, holdUntil: new Date(now.getTime() + FOLLOWUP_REPLAY_WINDOW_MS) },
  });
  return took.count === 1;
}

export async function runFollowUp(
  payload: FollowUpPayload,
  opts: { outboxId: string },
): Promise<RunFollowUpResult> {
  const { conversationId, instruction, reason } = payload;

  // Re-verify the thread between scheduling and firing. ARCHIVED counts
  // as gone: archiving is the operator saying "I am done with this", and
  // an unprompted message would drag it back into view uninvited.
  // (ChatConversation has archivedAt, not deletedAt — checked against the
  // schema rather than assumed.)
  const conversation = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, archivedAt: true },
  });
  if (!conversation || conversation.archivedAt) {
    return { ok: false, reason: "conversation is gone or archived — dropping follow-up" };
  }

  // Recent thread context so the follow-up reads as continuous rather
  // than arriving out of nowhere. Bounded: this runs unattended and must
  // not be able to pull an unbounded transcript into a prompt.
  const recent = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { role: true, content: true },
  });
  const history = recent
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content ?? "").slice(0, 2000) }));

  // Claim the delivery BEFORE generating (claim-before-act, 08-X2): a worker that died after
  // writing the message but before the outbox row went `done` is replayed by the stale reclaim.
  // One key names the delivery: the attempt's operationKey AND the message's clientMessageId
  // (unique per conversation), so the message itself is the receipt and a second write is refused.
  const receiptKey = `agent-followup:${opts.outboxId}`;
  let attemptId: string;
  try {
    const claim = await beginAttempt({
      operationKey: receiptKey,
      tool: "agent.followup",
      argumentsHash: opts.outboxId,
      effectClass: "write",
      windowMs: FOLLOWUP_REPLAY_WINDOW_MS,
    });
    if (claim.kind === "duplicate") {
      const done = claim.state === "SUCCEEDED_UNVERIFIED" || claim.state === "VERIFIED";
      if (done) return { ok: true, reason: "already delivered" };
      if (claim.state !== "EXECUTING" || !(await takeOverAbandoned(claim.attemptId))) {
        return { ok: false, reason: `a prior attempt is ${claim.state}; not delivering again` };
      }
    }
    attemptId = claim.attemptId;
    // The message is the receipt: a prior worker (dead, or a FAILED settle after its write
    // landed) may already have delivered. Found -> settle success and do not generate.
    // shortcut: a message written before R3-17 carries no clientMessageId and is not found; only rows in flight at that deploy are exposed.
    const receipt = await prisma.chatMessage.findFirst({
      where: { conversationId, clientMessageId: receiptKey },
      select: { id: true },
    });
    if (receipt) {
      await settleAttempt(attemptId, { disposition: "success", reason: "reconciled: follow-up message found", receiptId: receipt.id }).catch((err) =>
        log.warn("followup_reconcile_settle_failed", { attemptId, message: err instanceof Error ? err.message : String(err) }),
      );
      return { ok: true, messageId: receipt.id, reason: "already delivered (reconciled)" };
    }
  } catch (err) {
    return {
      ok: false,
      retryable: true,
      reason: `follow-up claim store unavailable (${err instanceof Error ? err.message.slice(0, 200) : String(err)})`,
    };
  }
  const settle = (disposition: "success" | "known_failure", why: string, receiptId?: string) =>
    settleAttempt(attemptId, { disposition, reason: why, receiptId }).catch((err) =>
      log.warn("followup_attempt_settle_failed", { attemptId, disposition, message: err instanceof Error ? err.message : String(err) }),
    );
  // A throw from aiChat or the write means nothing was written: FAILED, so the retry may re-claim.
  const failed = async (err: unknown): Promise<never> => {
    await settle("known_failure", err instanceof Error ? err.message : String(err));
    throw err;
  };

  const result = await aiChat(
    [
      {
        role: "system",
        content:
          "You are Nick, following up on your own initiative in an existing thread. " +
          "The operator did NOT just message you — you scheduled this earlier. " +
          "Open by saying what you are following up on and why, in one short sentence. " +
          "Be brief and concrete. You have NO tools on this turn: never claim to have " +
          "done, checked, sent or run anything — you can only reason about what is in " +
          "this thread. If the follow-up is no longer useful, say exactly that and stop.",
      },
      ...history,
      { role: "user", content: `[scheduled follow-up] ${instruction}\n\n(reason: ${reason})` },
    ],
    "reason",
  ).catch(failed);

  // aiChat NEVER throws on total provider failure — it returns a
  // SENTINEL (app AGENTS.md, common gotchas). Persisting that sentinel
  // as a cheerful assistant message is exactly the fabrication class this
  // codebase defends against, so check the provider before trusting text.
  // An outage is TRANSIENT: `retryable` tells the cron to re-queue the row
  // with a backoff instead of marking it done (which dropped it forever).
  if (isAiSentinel(result)) {
    await settle("known_failure", `provider unavailable (${result.provider})`); // FAILED: the retry may re-claim
    return {
      ok: false,
      retryable: true,
      reason: `provider unavailable (${result.provider}) - not persisting, will retry`,
    };
  }
  const text = result.content.trim();

  const body = `**${"↻"} Following up** — ${text}`;
  const row = await prisma.chatMessage.create({
    data: {
      conversationId,
      role: "assistant",
      content: body,
      model: result.model ?? "unknown",
      parts: [{ type: "text", text: body }] as unknown as Parameters<
        typeof prisma.chatMessage.create
      >[0]["data"]["parts"],
      searchableContent: text,
      streamingState: "complete",
      provider: result.provider,
      // Provenance: this is how a reader (and /system) tells an
      // agent-initiated message from one the operator prompted.
      routerReason: FOLLOWUP_MARKER,
      clientMessageId: receiptKey,
      latencyMs: 0,
    },
    select: { id: true },
  }).catch(failed);

  await settle("success", "follow-up message written", row.id);
  log.info("followup_delivered", { conversationId, messageId: row.id, provider: result.provider });
  return { ok: true, messageId: row.id, reason: "delivered" };
}
