import type { UIMessage } from "ai";
import { sideEffectingTools } from "@/lib/ai/tools/catalog";
import { isResumedMessage } from "@/hooks/chat/use-chat-transport";

/**
 * Did this assistant turn run (or may it have run) a side-effecting tool?
 * Regenerate replays the whole turn, tools included, so a yes means a replay
 * could send the SMS, quote or payment a second time.
 *
 * Three signals, because no single one survives every path:
 *   - a live turn carries tool parts (catalog-driven: a tool newly flagged
 *     sideEffecting is covered without touching this file);
 *   - a resumed bubble holds replayed text only, so it cannot show what ran
 *     and counts as yes (P2-B6);
 *   - a reloaded turn has no tool parts at all; the persisted
 *     tokenUsage.toolReceipts (loaded at the top level by use-conversations)
 *     is the only record of what ran. A turn that did not finish and has no
 *     receipts array counts as yes: the errored-turn writer
 *     (stream-error-handler) stores no tokenUsage at all.
 */
export function turnHasSideEffect(message: UIMessage): boolean {
  if (isResumedMessage(message)) return true;
  const row = message as { streamingState?: unknown; tokenUsage?: { toolReceipts?: unknown } | null };
  const receipts = row.tokenUsage?.toolReceipts;
  if (Array.isArray(receipts) && receipts.some((r) => (r as { sideEffecting?: unknown })?.sideEffecting === true)) {
    return true;
  }
  const unfinished = typeof row.streamingState === "string" && row.streamingState !== "complete" && row.streamingState !== "refused";
  if (unfinished && !Array.isArray(receipts)) return true;
  const names = new Set(sideEffectingTools());
  return (message.parts ?? []).some(
    (part) => typeof part.type === "string" && part.type.startsWith("tool-") && names.has(part.type.replace("tool-", "")),
  );
}
