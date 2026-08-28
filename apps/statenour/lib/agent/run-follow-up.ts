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
import { aiChat } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";
import type { FollowUpPayload } from "./follow-up";

const log = rootLogger.withSurface("agent/run-follow-up");

/** Prefix every agent-initiated message carries, in content AND provenance. */
export const FOLLOWUP_MARKER = "follow-up";

export interface RunFollowUpResult {
  ok: boolean;
  messageId?: string;
  reason: string;
}

export async function runFollowUp(payload: FollowUpPayload): Promise<RunFollowUpResult> {
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
  );

  // aiChat NEVER throws on total provider failure — it returns a
  // SENTINEL (app AGENTS.md, common gotchas). Persisting that sentinel
  // as a cheerful assistant message is exactly the fabrication class this
  // codebase defends against, so check the provider before trusting text.
  if (result.provider === "emergency" || result.provider === "none") {
    return { ok: false, reason: `provider sentinel (${result.provider}) — not persisting` };
  }
  const text = (result.content ?? "").trim();
  if (!text) {
    return { ok: false, reason: "empty completion — not persisting" };
  }

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
      latencyMs: 0,
    },
    select: { id: true },
  });

  log.info("followup_delivered", { conversationId, messageId: row.id, provider: result.provider });
  return { ok: true, messageId: row.id, reason: "delivered" };
}
