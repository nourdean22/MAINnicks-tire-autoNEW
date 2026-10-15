import type { UIMessage } from "ai";
import { isReplaySafeTool } from "@/lib/ai/capability-registry";
import { hasActionBlock } from "@/lib/ai/chat/action-block-text";
import { isResumedMessage } from "@/hooks/chat/use-chat-transport";

/**
 * A live tool part is a possible write unless the registry vouches that a replay
 * repeats nothing (reviewed read, or a tool that only computes, generates or
 * drafts). A tool the catalog does not know counts as a write.
 */
function livePartMayHaveWritten(part: { type?: unknown; toolName?: unknown }): boolean {
  const type = part.type;
  if (typeof type !== "string") return false;
  if (type === "dynamic-tool") return typeof part.toolName !== "string" || !isReplaySafeTool(part.toolName);
  if (!type.startsWith("tool-")) return false;
  return !isReplaySafeTool(type.slice("tool-".length));
}

/**
 * The reply text the agent layer parses for action blocks: the text parts, and the
 * reasoning parts too, because an empty visible reply is salvaged from reasoning
 * (salvage-event-text) and parseActions then runs a block found there.
 */
function textCarriesActionBlock(part: { type?: unknown; text?: unknown }): boolean {
  return (part.type === "text" || part.type === "reasoning") && typeof part.text === "string" && hasActionBlock(part.text);
}

/**
 * Judge a stored receipt by what it says AND by its tool name. The flags in a
 * stored receipt were true on the day it was written: rows from before the
 * default-deny say sideEffecting:false for setMit, runPython and the other
 * writers, so the name is looked up in the registry now. A receipt whose fields
 * are missing, null or not the expected type is unknown, which counts as a write.
 */
function receiptMayHaveWritten(receipt: unknown): boolean {
  const r = receipt as { toolName?: unknown; sideEffecting?: unknown; verifiable?: unknown } | null;
  if (r === null || typeof r !== "object") return true;
  if (typeof r.toolName !== "string" || typeof r.sideEffecting !== "boolean" || typeof r.verifiable !== "boolean") return true;
  return r.sideEffecting || !r.verifiable || !isReplaySafeTool(r.toolName);
}

/**
 * Did this assistant turn run (or may it have run) a side-effecting tool?
 * Regenerate replays the whole turn, tools included, so a yes means a replay
 * could send the SMS, quote or payment a second time. Anything the gate cannot
 * vouch for counts as yes.
 *
 * Signals, because no single one survives every path:
 *   - a live turn carries tool parts, judged by the registry (isReplaySafeTool);
 *   - a resumed bubble holds replayed text only, so it cannot show what ran
 *     and counts as yes (P2-B6);
 *   - a reply whose text or reasoning carries an action block: the agent layer
 *     runs it after the stream, with no tool part and no receipt, so even a
 *     recorded [] does not mean nothing ran;
 *   - a fast-path reply (brain dump, /save, a logged decision, an image) writes
 *     with no receipt. Its bubble carries metadata.receiptsUnavailable (from the
 *     stream's start chunk) and its row tokenUsage.receiptsUnavailable, which
 *     the errored-turn writer (stream-error-handler) also stores when it cannot
 *     vouch for what ran;
 *   - a persisted row (it has its own streamingState) is judged by
 *     tokenUsage.toolReceipts, loaded at the top level by use-conversations,
 *     receipt by receipt (receiptMayHaveWritten). A row with no receipts ARRAY
 *     is unknown: rows from before receipts were stored, fast-path and
 *     specialist rows, a malformed value. An empty array is the one honest
 *     "no SDK tool ran".
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
  if (Array.isArray(receipts) && receipts.some(receiptMayHaveWritten)) return true;
  if (typeof row.streamingState === "string" && !Array.isArray(receipts)) return true;
  return parts.some(livePartMayHaveWritten);
}
