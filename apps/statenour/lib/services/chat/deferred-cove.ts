/**
 * B2 (job 2026-11-01-chat-humanizer-w6): Chain-of-Verification after the reply is stored and
 * announced, so the stream ends when the text does. Measured 2026-11-01: the tail after the last
 * token was p50 15.9 s / p90 43 s, CoVe inside it p50 9.9 s (docs/research/chat-upgrades-2026-11-01.md
 * section 2.2). A reply that claims an action never comes here: it keeps the blocking check.
 *
 * The open chat was told `verifying: true` on message.persisted and re-reads the row until
 * `tokenUsage.cove` says the check settled, so the mark is written whether or not the text changed.
 */
import { prisma } from "@/lib/prisma";
import { isVerifierRewritten } from "@/lib/ai/chat/fabrication-rewriter";
import { detectActionClaims } from "@/lib/ai/chat/action-claim-detector";
import { checkKnownTruth } from "@/lib/ai/known-truth-guard";
import { buildMessageParts } from "./message-parts";

/** The longest the deferred check may run; the chat re-reads for about 80 s. */
export const DEFERRED_COVE_TIMEOUT_MS = 45_000;

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
  warn(event: string, ctx?: Record<string, unknown>): void;
}

/** Runs CoVe on the stored draft, patches the row, and returns the text the rest of the turn should use. */
export async function verifyStoredReply(a: {
  messageId: string;
  /** The text CoVe was deferred on, before the stations that run ahead of the row write. */
  draft: string;
  cleanedText: string;
  reasoningText: string;
  userContent: string;
  convId: string | undefined;
  log: ChatLogger;
}): Promise<string> {
  // Before B2 a revision went through the stations that run ahead of the row write (known-truth and
  // action-receipt banners, the calibration notice, L2). Here it lands after them, so CoVe only runs on
  // text none of them touched, and a revision that adds a claim they would have caught is dropped.
  const skipped = isVerifierRewritten(a.cleanedText) ? "verifier_banner" : a.cleanedText !== a.draft ? "rewritten_before_store" : null;
  const { verifyAndRevise } = await import("@/lib/ai/chat/chain-of-verification");
  const cove = skipped ? null : await verifyAndRevise(a.cleanedText, a.userContent, { signal: AbortSignal.timeout(DEFERRED_COVE_TIMEOUT_MS) });
  const addsClaims =
    cove?.changed === true &&
    (detectActionClaims(cove.revised).claims.length > 0 || checkKnownTruth(cove.revised).length > checkKnownTruth(a.cleanedText).length);
  const changed = cove?.changed === true && !addsClaims;
  const text = changed ? cove.revised : a.cleanedText;
  if (changed) a.log.info("cove_revised", { conversationId: a.convId, questions: cove.questions.length, deferred: true });
  if (addsClaims) a.log.warn("cove_revision_dropped", { conversationId: a.convId, reason: "adds_unchecked_claim" });

  // tokenUsage holds the traceId and receipts: merge, never replace. Without the read there is no
  // safe merge, so the mark is skipped (the chat stops re-reading on its own) and only text is patched.
  let tokenUsage: Record<string, unknown> | undefined;
  try {
    const row = await prisma.chatMessage.findUnique({ where: { id: a.messageId }, select: { tokenUsage: true } });
    if (row) {
      const prior = row.tokenUsage && typeof row.tokenUsage === "object" ? (row.tokenUsage as Record<string, unknown>) : {};
      tokenUsage = {
        ...prior,
        cove: { status: "done", changed, ...(skipped ? { skipped } : {}), ...(addsClaims ? { dropped: "adds_unchecked_claim" } : {}) },
      };
    }
  } catch (err) {
    a.log.warn("cove_deferred_read_failed", { messageId: a.messageId, error: err instanceof Error ? err.message : String(err) });
  }
  if (!changed && !tokenUsage) return text;

  const textFields = changed ? await buildMessageParts(text, a.reasoningText, true) : null;
  await prisma.chatMessage
    .update({
      where: { id: a.messageId },
      data: {
        ...(textFields
          ? {
              content: text,
              parts: (textFields.partsArray ?? undefined) as Parameters<typeof prisma.chatMessage.update>[0]["data"]["parts"],
              searchableContent: textFields.searchableContent ?? undefined,
            }
          : {}),
        ...(tokenUsage ? { tokenUsage: tokenUsage as Parameters<typeof prisma.chatMessage.update>[0]["data"]["tokenUsage"] } : {}),
      },
    })
    .catch((err: unknown) => {
      a.log.warn("cove_deferred_patch_failed", { messageId: a.messageId, error: err instanceof Error ? err.message : String(err) });
    });
  return text;
}
