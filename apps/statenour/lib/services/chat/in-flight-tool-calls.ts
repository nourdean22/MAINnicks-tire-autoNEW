import { toReceipt } from "@/lib/ai/receipts/action-receipt";
import { toolReceiptRows, type ToolReceiptRow } from "@/lib/ai/receipts/tool-receipt-rows";

/**
 * Which tools a streaming turn started, kept so the errored-turn row can record
 * them (onFinish, which builds the normal receipts, does not run on every error).
 *
 * A call counts the moment its tool-call chunk arrives, before the tool runs.
 * One that never returns a result is ATTEMPTED, not finished: the stream can
 * die between the side effect and the result. Effect class comes from the
 * receipt classifier, never from whether a result showed up.
 *
 * Anything this cannot vouch for makes the snapshot untrustworthy for good,
 * and the writer then records `receiptsUnavailable` instead of a list.
 */
export type ToolReceiptsSnapshot = { trustworthy: true; receipts: ToolReceiptRow[] } | { trustworthy: false };

// Input is still streaming: the tool has not run (execute starts at tool-call).
const INPUT_ONLY_PARTS = new Set(["tool-input-start", "tool-input-delta", "tool-input-end"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function createInFlightToolCalls() {
  const calls = new Map<string, string>();
  let trustworthy = true;

  function observeChunk(chunk: unknown): void {
    const part = chunk as { type?: unknown; toolCallId?: unknown; toolName?: unknown } | null | undefined;
    const type = part?.type;
    if (typeof type !== "string") return;

    if (type === "tool-call") {
      if (!isNonEmptyString(part?.toolCallId) || !isNonEmptyString(part?.toolName)) {
        trustworthy = false;
        return;
      }
      const known = calls.get(part.toolCallId);
      if (known === undefined) calls.set(part.toolCallId, part.toolName);
      else if (known !== part.toolName) trustworthy = false;
      return;
    }

    if (type === "tool-result" || type === "tool-error") {
      if (!isNonEmptyString(part?.toolCallId) || !calls.has(part.toolCallId)) trustworthy = false;
      return;
    }

    if (type.startsWith("tool-") && !INPUT_ONLY_PARTS.has(type)) trustworthy = false;
  }

  return {
    /** Feed every chunk onChunk receives. Never throws: a failure here must not touch the stream. */
    observe(chunk: unknown): void {
      try {
        observeChunk(chunk);
      } catch {
        trustworthy = false;
      }
    },
    snapshot(): ToolReceiptsSnapshot {
      if (!trustworthy) return { trustworthy: false };
      const receipts = [...calls.values()].map((toolName) => toReceipt({ toolName, partial: true }));
      return { trustworthy: true, receipts: toolReceiptRows(receipts) };
    },
  };
}
