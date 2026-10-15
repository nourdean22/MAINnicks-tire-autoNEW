import { isReplaySafeTool } from "@/lib/ai/capability-registry";
import { toReceipt } from "@/lib/ai/receipts/action-receipt";
import { toolReceiptRows, type ToolReceiptRow } from "@/lib/ai/receipts/tool-receipt-rows";

/**
 * Which tools a streaming turn started, kept so the errored-turn row can record
 * them (onFinish, which builds the normal receipts, does not run on every error).
 *
 * A call counts the moment its tool-call chunk arrives. One that never returns
 * a result is ATTEMPTED, not finished: the stream can die between the side
 * effect and the result. Effect class comes from the receipt classifier, never
 * from whether a result showed up.
 *
 * `terminal` says the stream has ended, so the record is final. ai@6 does not
 * treat an error part as the end: a later tool-call plus finish(tool-calls)
 * still runs the tool. Until the record is terminal it can only list what
 * already counts as a possible write; "nothing ran" may be claimed only from a
 * terminal record.
 *
 * Anything this cannot vouch for makes the snapshot untrustworthy for good, and
 * the writer then records `receiptsUnavailable` instead of a list.
 */
export type ToolReceiptsSnapshot =
  | { trustworthy: true; terminal: boolean; receipts: ToolReceiptRow[] }
  | { trustworthy: false };

// Input is still streaming, so the tool has not run: ai@6.0.275 executes tools
// at the model stream's finish chunk (executeToolCallAfterFinish), not at tool-call.
const INPUT_ONLY_PARTS = new Set(["tool-input-start", "tool-input-delta", "tool-input-end"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function createInFlightToolCalls() {
  const calls = new Map<string, string>();
  const waiting: Array<() => Promise<void> | void> = [];
  let trustworthy = true;
  let terminal = false;

  function observeChunk(chunk: unknown): void {
    const part = chunk as { type?: unknown; toolCallId?: unknown; toolName?: unknown } | null | undefined;
    const type = part?.type;
    // A chunk with no readable type is an SDK shape this was not written for.
    if (typeof type !== "string") {
      trustworthy = false;
      return;
    }

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

  async function run(callback: () => Promise<void> | void): Promise<void> {
    try {
      await callback();
    } catch {
      // A failing settle must never reach the stream.
    }
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
      // These rows answer the Retry gate's question (would a replay repeat it?), not the
      // Done-guard's: a cataloged tool the registry does not vouch for counts as a write.
      const rows = toolReceiptRows(receipts).map((row) => ({
        ...row,
        sideEffecting: row.sideEffecting || (row.verifiable !== false && !isReplaySafeTool(row.toolName)),
      }));
      return { trustworthy: true, terminal, receipts: rows };
    },
    /** Run `callback` once the stream has ended (at once if it already has). */
    afterTerminal(callback: () => Promise<void> | void): void {
      if (terminal) void run(callback);
      else waiting.push(callback);
    },
    /** The stream has ended: the record is final. Runs the waiting callbacks. */
    async terminate(): Promise<void> {
      if (terminal) return;
      terminal = true;
      for (const callback of waiting.splice(0)) await run(callback);
    },
  };
}

export type InFlightToolCalls = ReturnType<typeof createInFlightToolCalls>;

/**
 * Mark the turn's tool record final once the stream is drained (the route passes
 * result.consumeStream()). No drain promise, or one that rejects, is not proof
 * the stream ended: the record stays non-terminal, the callbacks waiting on it do
 * not run, and an errored row keeps saying receiptsUnavailable.
 *
 * The returned promise never rejects. It resolves once the record is final AND the
 * callbacks waiting on it (the errored row's settle) have run; after a drain that
 * rejected, or with no drain at all, it resolves at once and the record stays open. The chat route holds its
 * per-message lease until then (turn-claim.ts), so a replay can never read an errored
 * row that still says "cannot vouch" for a turn that has in fact finished.
 */
export function terminateWhenDrained(toolCalls: InFlightToolCalls, drained: PromiseLike<unknown> | undefined): Promise<void> {
  if (!drained) return Promise.resolve();
  return Promise.resolve(drained).then(() => toolCalls.terminate(), () => {});
}
