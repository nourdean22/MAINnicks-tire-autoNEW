/**
 * lib/services/chat/turn-guard.ts - what a chat POST decides BEFORE it does any work
 * (2026-10-15 · chat turn idempotency).
 *
 * The client cannot always tell whether the server is still running an attempt whose
 * response it lost, and POST /api/ai/chat keeps a turn running after the client
 * disconnects. So the server answers the question itself, from the one durable key
 * both attempts share: the user message's id.
 *
 *   1. claim the message (turn-claim.ts). A live lease means another run owns it:
 *      refuse, whatever the trigger. Claiming first, then reading, closes the race with
 *      a run that finishes between our read and our claim.
 *   2. otherwise read what is SAVED for the message (chat_messages is the truth; the
 *      lease is only a lock):
 *        no user row yet              run (a first send, or a replay of one that never landed)
 *        user row, no reply           run (the earlier run died; the message is unanswered)
 *        reply, submit-message        refuse: a re-send is never a new run
 *        reply, regenerate-message    run, unless a reply may have run an action
 *
 * `regenerate-message` is the one deliberate way to ask for a fresh run (the SDK sends it
 * for Regenerate and for Retry alike), so it is allowed once nothing is running and
 * nothing saved says a replay would repeat an action. That last test is the client's own
 * Retry rule (messageMayHaveWritten), asked here so the server no longer depends on the
 * client having asked it.
 *
 * Refusals are 409s that still carry X-Trace-Id and X-Conversation-Id: the transport
 * reads those headers off any response, so the client learns which run it collided with
 * and a first-send replay learns the thread it never saw. The JSON body renders through
 * chatErrorText as two plain sentences.
 *
 * Fail-open where there is no evidence of a prior attempt (the claim store or the user
 * row unreadable on a plain send: a chat outage is worse than the duplicate). Fail-closed
 * where there is (a user row exists but its replies cannot be read or parsed, or a
 * regenerate, which is itself proof an attempt exists, could not read the user row):
 * unknown is not "nothing ran".
 */
import type { UIMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { messageMayHaveWritten } from "@/lib/ai/chat/message-side-effect";
import { extractClientMessageId } from "@/lib/ai/chat/message-fields";
import { logError } from "@/lib/utils/error-log";
import { withTimeout } from "@/lib/utils/with-timeout";
import { claimTurn, type ClaimOutcome, type TurnClaim } from "./turn-claim";
import { findUserTurnRow, type UserTurnRow } from "./user-turn-identity";

/** Each database step of the guard is bounded: a stalled store is an outage (fail open or closed per the rules above), not a wait in front of the model. */
export const GUARD_STEP_TIMEOUT_MS = 3_000;

/** routerReason of the message an agent posts on its own initiative (lib/agent/run-follow-up.ts FOLLOWUP_MARKER, pinned by a test). It is not an answer to a user message. */
export const FOLLOW_UP_ROUTER_REASON = "follow-up";

const bounded = <T>(promise: Promise<T>): Promise<T> => withTimeout(promise, GUARD_STEP_TIMEOUT_MS, "turn-guard");

export type TurnGuardResult =
  | {
      kind: "run";
      claim: TurnClaim | null;
      /** The thread an earlier attempt at this message already created, if any. A replay that never learned it re-sends with none and must not open a second thread. */
      conversationId: string | null;
    }
  | { kind: "refuse"; response: Response };

const REFUSALS = {
  turn_in_flight: { status: 409, error: "Nick is still working on that message.", reason: "Give it a moment, then tap Retry, or reload the conversation." },
  turn_answered: { status: 409, error: "Nick already answered that message.", reason: "Reload the conversation to see the reply." },
  turn_ran: { status: 409, error: "That reply may have run an action, so it can't be replayed.", reason: "Send a new message instead." },
  turn_unreadable: { status: 503, error: "Nick can't confirm how that message ended.", reason: "Try again in a moment, or send a new message." },
} as const;

function refuse(code: keyof typeof REFUSALS, ids: { traceId?: string | null; conversationId?: string | null }): TurnGuardResult {
  const { status, error, reason } = REFUSALS[code];
  const headers = new Headers({ "Cache-Control": "no-store", "X-Turn-Refusal": code });
  if (ids.traceId) headers.set("X-Trace-Id", ids.traceId);
  if (ids.conversationId) headers.set("X-Conversation-Id", ids.conversationId);
  const response = Response.json({ error, reason, code, traceId: ids.traceId ?? null, conversationId: ids.conversationId ?? null }, { status, headers });
  return { kind: "refuse", response };
}

interface SavedReply {
  id: string;
  content: string | null;
  parts: unknown;
  streamingState: string | null;
  tokenUsage: unknown;
  routerReason: string | null;
}

/**
 * The assistant rows of ONE turn: the reply parented on this user row, plus the parentless rows
 * written inside its window (the errored-turn stub has no parent). The window ends at the next user
 * message, and a reply that finished AFTER that message (two overlapping turns) is still found by parent.
 */
async function readReplies(user: UserTurnRow): Promise<SavedReply[]> {
  const next = await prisma.chatMessage.findFirst({
    where: { conversationId: user.conversationId, role: "user", createdAt: { gt: user.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const rows: SavedReply[] = await prisma.chatMessage.findMany({
    where: {
      conversationId: user.conversationId,
      role: "assistant",
      OR: [
        { parentMessageId: user.id },
        { parentMessageId: null, createdAt: { gte: user.createdAt, ...(next ? { lt: next.createdAt } : {}) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, content: true, parts: true, streamingState: true, tokenUsage: true, routerReason: true },
  });
  // An agent follow-up (scheduled by the agent, not asked for) is not the answer to this message.
  return rows.filter((row) => row.routerReason !== FOLLOW_UP_ROUTER_REASON);
}

function mayHaveWritten(row: SavedReply): boolean {
  const parts = Array.isArray(row.parts) && row.parts.length > 0 ? row.parts : [{ type: "text", text: row.content ?? "" }];
  return messageMayHaveWritten({ id: row.id, role: "assistant", parts, streamingState: row.streamingState, tokenUsage: row.tokenUsage } as unknown as UIMessage);
}

function latestTrace(replies: readonly SavedReply[]): string | null {
  for (const row of [...replies].reverse()) {
    const trace = (row.tokenUsage as { traceId?: unknown } | null | undefined)?.traceId;
    if (typeof trace === "string" && trace.length > 0) return trace;
  }
  return null;
}

function unreadable(stage: string, error: unknown): null {
  logError("chat.turn-guard", error, { stage }, "warn");
  return null;
}

export async function guardTurn(input: {
  lastMessage: Record<string, unknown> | undefined;
  /** The thread the client named; undefined on the first message of a new one. */
  conversationId: string | undefined;
  /** body.trigger from the AI SDK transport. */
  trigger: unknown;
  /** The trace this attempt would run under. */
  traceId: string;
  /**
   * Private Lab or ephemeral: the transcript is not kept, so there is no saved message to read. Not guarded.
   * Be exact about what that leaves open: Private Lab strips write tools, but an ephemeral turn (Home /task,
   * /capture) keeps tools and memory writes ON, and the lease could cover it. No client re-posts an ephemeral
   * id today (the command line mints a fresh one per submit), so this is a known gap, not a live exposure.
   */
  transcriptOff: boolean;
}): Promise<TurnGuardResult> {
  const messageId = input.lastMessage?.role === "user" ? extractClientMessageId(input.lastMessage) : undefined;
  if (input.transcriptOff || !messageId) return { kind: "run", claim: null, conversationId: null };

  const regenerate = input.trigger === "regenerate-message";
  // Whether the LATEST user-row read failed: an earlier failure that a later read cleared is not one.
  let lookupFailed = false;
  const findUser = async () => {
    try {
      const row = await bounded(findUserTurnRow({ conversationId: input.conversationId, messageId }));
      lookupFailed = false;
      return row;
    } catch (e) {
      lookupFailed = true;
      return unreadable("find-user-row", e);
    }
  };
  const lease = async (clientMessageId: string, conversationId: string | null): Promise<ClaimOutcome> => {
    const pending = claimTurn({ clientMessageId, traceId: input.traceId, conversationId });
    try {
      return await bounded(pending);
    } catch (e) {
      unreadable("claim", e);
      // A lease that lands after we gave up has no owner: let it go instead of letting it heartbeat.
      void pending.then((late) => (late.kind === "claimed" ? late.claim.finish() : undefined), () => undefined);
      return { kind: "unavailable" };
    }
  };
  const inFlight = (o: { traceId: string | null; conversationId: string | null }, row: UserTurnRow | null) =>
    refuse("turn_in_flight", { traceId: o.traceId, conversationId: o.conversationId ?? row?.conversationId ?? null });

  // The claim is keyed by the ORIGINAL minted id, so a hydrated thread (database id) and the live one collide.
  const known = await findUser();
  let key = known?.clientMessageId ?? messageId;
  let outcome = await lease(key, known?.conversationId ?? input.conversationId ?? null);
  if (outcome.kind === "in_flight") return inFlight(outcome, known);
  let claim = outcome.kind === "claimed" ? outcome.claim : null;

  // Read AFTER claiming: a run that finished while we were claiming has saved its rows by now.
  const user = known ?? (await findUser());

  // The identity can resolve late (the first read failed, this one found the row): if the real key is not
  // the one just taken, the live run holds its lease under the real one. Take that one instead.
  const realKey = user?.clientMessageId ?? messageId;
  if (user && realKey !== key) {
    claim?.finish();
    key = realKey;
    outcome = await lease(key, user.conversationId);
    if (outcome.kind === "in_flight") return inFlight(outcome, user);
    claim = outcome.kind === "claimed" ? outcome.claim : null;
  }

  if (!user) {
    // No row. A plain send has no evidence of a prior attempt and runs; a regenerate cannot exist without one.
    if (regenerate && lookupFailed) {
      claim?.finish();
      return refuse("turn_unreadable", {});
    }
    return { kind: "run", claim, conversationId: null };
  }

  let ids: { traceId: string | null; conversationId: string };
  let verdict: "run" | "ran" | "answered";
  try {
    const replies = await bounded(readReplies(user));
    ids = { traceId: latestTrace(replies), conversationId: user.conversationId };
    verdict = regenerate ? (replies.some(mayHaveWritten) ? "ran" : "run") : replies.length > 0 ? "answered" : "run";
  } catch (error) {
    // The replies could not be read, or a saved row could not even be judged (malformed parts): unknown.
    // Nothing after the claim may throw, or the lease is stranded until it lapses.
    unreadable("judge-replies", error);
    claim?.finish();
    return refuse("turn_unreadable", { conversationId: user.conversationId });
  }

  if (verdict === "ran" || verdict === "answered") {
    claim?.finish();
    return refuse(verdict === "ran" ? "turn_ran" : "turn_answered", ids);
  }
  return { kind: "run", claim, conversationId: user.conversationId };
}
