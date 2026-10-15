import type { UIMessage } from "ai";
import { classifyToolEffect } from "@/lib/ai/receipts/action-receipt";
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

/**
 * Did this assistant turn run (or may it have run) a side-effecting tool?
 * Regenerate replays the whole turn, tools included, so a yes means a replay
 * could send the SMS, quote or payment a second time.
 *
 * Three signals, because no single one survives every path:
 *   - a live turn carries tool parts, judged by the same classifier the
 *     persisted receipts use (write, or a tool it cannot place, counts);
 *   - a resumed bubble holds replayed text only, so it cannot show what ran
 *     and counts as yes (P2-B6);
 *   - a reloaded turn has no tool parts at all; the persisted
 *     tokenUsage.toolReceipts (loaded at the top level by use-conversations)
 *     is the only record of what ran. A receipt that mutates, or that the
 *     classifier could not place (verifiable false), counts as yes. So does
 *     tokenUsage.receiptsUnavailable, which the errored-turn writer
 *     (stream-error-handler) stores when it cannot vouch for what ran, and a
 *     turn that did not finish with no receipts array at all.
 */
export function turnHasSideEffect(message: UIMessage): boolean {
  if (isResumedMessage(message)) return true;
  const row = message as {
    streamingState?: unknown;
    tokenUsage?: { toolReceipts?: unknown; receiptsUnavailable?: unknown } | null;
  };
  if (row.tokenUsage?.receiptsUnavailable === true) return true;
  const receipts = row.tokenUsage?.toolReceipts;
  if (
    Array.isArray(receipts) &&
    receipts.some((r) => {
      const receipt = r as { sideEffecting?: unknown; verifiable?: unknown } | null;
      return receipt?.sideEffecting === true || receipt?.verifiable === false;
    })
  ) {
    return true;
  }
  const unfinished = typeof row.streamingState === "string" && row.streamingState !== "complete" && row.streamingState !== "refused";
  if (unfinished && !Array.isArray(receipts)) return true;
  return (message.parts ?? []).some((part) => livePartMayHaveWritten(part as { type?: unknown; toolName?: unknown }));
}
