import type { UIMessage } from "ai";
import { classifyToolEffect } from "@/lib/ai/receipts/action-receipt";
import { hasActionBlock } from "@/lib/ai/chat/action-block-text";
import { isResumedMessage } from "@/hooks/chat/use-chat-transport";

/**
 * A live tool part is a possible write unless the receipt classifier knows the
 * tool is a pure read. Unclassifiable counts as a write: the catalog's
 * `sideEffecting` flag alone missed createTask, completeTask and triggerBrief.
 */
function livePartMayHaveWritten(part: { type?: unknown; toolName?: unknown }): boolean {
  const type = part.type;
  if (typeof type !== "string") return false;
  if (type === "dynamic-tool") return typeof part.toolName !== "string" || classifyToolEffect(part.toolName) !== "read";
  if (!type.startsWith("tool-")) return false;
  return classifyToolEffect(type.slice("tool-".length)) !== "read";
}

function textCarriesActionBlock(part: { type?: unknown; text?: unknown }): boolean {
  return part.type === "text" && typeof part.text === "string" && hasActionBlock(part.text);
}

/**
 * Did this assistant turn run (or may it have run) a side-effecting tool?
 * Regenerate replays the whole turn, tools included, so a yes means a replay
 * could send the SMS, quote or payment a second time. Anything the gate cannot
 * vouch for counts as yes.
 *
 * Signals, because no single one survives every path:
 *   - a live turn carries tool parts, judged by the same classifier the
 *     persisted receipts use (write, or a tool it cannot place, counts);
 *   - a resumed bubble holds replayed text only, so it cannot show what ran
 *     and counts as yes (P2-B6);
 *   - a reply whose text carries an action block: the agent layer runs it after
 *     the stream, with no tool part and no receipt, so even a recorded []
 *     does not mean nothing ran;
 *   - a fast-path reply (brain dump, /save, a logged decision, an image) writes
 *     with no receipt. Its bubble carries metadata.receiptsUnavailable (from the
 *     stream's start chunk) and its row tokenUsage.receiptsUnavailable, which
 *     the errored-turn writer (stream-error-handler) also stores when it cannot
 *     vouch for what ran;
 *   - a persisted row (it has its own streamingState) is judged by
 *     tokenUsage.toolReceipts, loaded at the top level by use-conversations. A
 *     receipt that mutates, or that the classifier could not place (verifiable
 *     false), counts as yes. A row with no receipts ARRAY is unknown: rows from
 *     before receipts were stored, fast-path and specialist rows, a malformed
 *     value. An empty array is the one honest "no SDK tool ran".
 */
export function turnHasSideEffect(message: UIMessage): boolean {
  if (isResumedMessage(message)) return true;
  const row = message as {
    streamingState?: unknown;
    tokenUsage?: { toolReceipts?: unknown; receiptsUnavailable?: unknown } | null;
    metadata?: { receiptsUnavailable?: unknown } | null;
  };
  if (row.metadata?.receiptsUnavailable === true) return true;
  if (row.tokenUsage?.receiptsUnavailable === true) return true;
  const parts = (message.parts ?? []) as Array<{ type?: unknown; toolName?: unknown; text?: unknown }>;
  if (parts.some(textCarriesActionBlock)) return true;
  const receipts = row.tokenUsage?.toolReceipts;
  if (receipts != null && !Array.isArray(receipts)) return true;
  if (
    Array.isArray(receipts) &&
    receipts.some((r) => {
      const receipt = r as { sideEffecting?: unknown; verifiable?: unknown } | null;
      return receipt?.sideEffecting === true || receipt?.verifiable === false;
    })
  ) {
    return true;
  }
  if (typeof row.streamingState === "string" && !Array.isArray(receipts)) return true;
  return parts.some(livePartMayHaveWritten);
}
