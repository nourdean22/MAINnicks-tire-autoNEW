/**
 * PR #3090 review 4299648894: the disclosure summary names what a finished tool did. A successful
 * call that found nothing must not read as the tool's success label ("Memories found, 0 matches")
 * while the receipt counts beside it say "1 found nothing": both say "found nothing".
 */
import { describe, it, expect } from "vitest";
import { toolReceiptLabel } from "@/components/chat/tool-result-registry";
import { formatToolReceipts, summarizeToolReceipts } from "@/lib/ai/receipts/tool-receipt-summary";

describe("toolReceiptLabel on an empty successful output", () => {
  it("says found nothing, as the receipt counts do, never the success label", () => {
    const label = toolReceiptLabel("searchMemories", "output-available", { count: 0 });
    expect(label).toBe("Searching memories: found nothing");
    expect(label).not.toContain("Memories found");
    const receipt = formatToolReceipts(summarizeToolReceipts([{ type: "tool-searchMemories", state: "output-available", output: { count: 0 } }] as never));
    expect(receipt).toContain("found nothing");
  });

  it("CONTROL: a search with a match keeps the success label and its count", () => {
    expect(toolReceiptLabel("searchMemories", "output-available", { count: 1 })).toBe("Memories found, 1 match");
  });
});
