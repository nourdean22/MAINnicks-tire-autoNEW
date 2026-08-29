/**
 * The tool-receipt chip must not call an empty search "verified".
 *
 * Measured 2026-08-29: the chip rendered `Tool receipts: 3 verified` with a
 * green shield directly above five "REFLECTIONS FOUND · 0 matches" cards.
 * Its count was `parts.filter(p => p.state === "output-available").length`,
 * which means "the call did not throw" -- not "the call found something".
 *
 * The regression these pin is a SEMANTIC one, so they assert on the real
 * production payload shapes, taken from the tools themselves:
 *   · searchReflections -> { count, reflectionCount, brainDumpCount, ... }
 *   · searchMemories    -> { count, memories }
 *   · searchSkills      -> { count: 0, matches: [], hint }
 */
import { describe, it, expect } from "vitest";
import {
  isEmptyToolOutput,
  summarizeToolReceipts,
  formatToolReceipts,
  collapseRepeatedToolParts,
} from "@/lib/ai/receipts/tool-receipt-summary";

describe("isEmptyToolOutput", () => {
  it("treats the house `count` convention as authoritative", () => {
    expect(isEmptyToolOutput({ count: 0, memories: [] })).toBe(true);
    expect(isEmptyToolOutput({ count: 3, memories: [1, 2, 3] })).toBe(false);
  });

  it("handles per-source counts when there is no total", () => {
    // The exact shape searchReflections returned before it gained `count`.
    expect(isEmptyToolOutput({ reflectionCount: 0, brainDumpCount: 0 })).toBe(true);
    expect(isEmptyToolOutput({ reflectionCount: 0, brainDumpCount: 1 })).toBe(false);
  });

  it("falls back to array emptiness", () => {
    expect(isEmptyToolOutput({ results: [], matches: [] })).toBe(true);
    expect(isEmptyToolOutput({ results: [], matches: [{ a: 1 }] })).toBe(false);
    expect(isEmptyToolOutput([])).toBe(true);
  });

  it("counts null / undefined as empty", () => {
    expect(isEmptyToolOutput(null)).toBe(true);
    expect(isEmptyToolOutput(undefined)).toBe(true);
  });

  it("does NOT malign an unrecognised payload as empty", () => {
    // Over-claiming emptiness would be the mirror-image dishonesty.
    expect(isEmptyToolOutput({ ok: true, id: "task_1" })).toBe(false);
    expect(isEmptyToolOutput("done")).toBe(false);
  });
});

describe("summarizeToolReceipts", () => {
  it("separates found-nothing from returned-data — the whole point", () => {
    const counts = summarizeToolReceipts([
      { state: "output-available", output: { count: 0, reflections: [] } },
      { state: "output-available", output: { count: 0, reflections: [] } },
      { state: "output-available", output: { count: 4, reflections: [1, 2, 3, 4] } },
    ]);
    expect(counts).toMatchObject({ returned: 1, empty: 2, failed: 0, running: 0, total: 3 });
  });

  it("reproduces the operator's screenshot: three empty searches", () => {
    const parts = Array.from({ length: 3 }, () => ({
      state: "output-available",
      output: { query: "x", count: 0, reflectionCount: 0, brainDumpCount: 0, reflections: [], brainDumps: [] },
    }));
    const counts = summarizeToolReceipts(parts);

    // The old chip said "3 verified" here. That is the bug.
    expect(counts.returned).toBe(0);
    expect(counts.empty).toBe(3);
    expect(formatToolReceipts(counts)).toBe("Tool calls: 3 found nothing");
    expect(formatToolReceipts(counts)).not.toContain("verified");
  });

  it("counts errors and in-flight calls distinctly", () => {
    const counts = summarizeToolReceipts([
      { state: "output-error" },
      { state: "input-available" },
      { state: "output-available", output: { count: 2, memories: [1, 2] } },
    ]);
    expect(counts).toMatchObject({ returned: 1, empty: 0, failed: 1, running: 1, total: 3 });
  });
});

describe("formatToolReceipts", () => {
  it("never uses the word 'verified' for a call that merely completed", () => {
    const mixed = summarizeToolReceipts([
      { state: "output-available", output: { count: 1, memories: [1] } },
      { state: "output-available", output: { count: 0, memories: [] } },
      { state: "output-error" },
    ]);
    const text = formatToolReceipts(mixed);
    expect(text).toBe("Tool calls: 1 returned data · 1 found nothing · 1 failed");
    expect(text.toLowerCase()).not.toContain("verified");
  });

  it("renders nothing when there were no tool calls", () => {
    expect(formatToolReceipts(summarizeToolReceipts([]))).toBe("");
  });
});

describe("collapseRepeatedToolParts", () => {
  it("collapses the operator's five identical 0-match cards into one", () => {
    const parts = Array.from({ length: 5 }, () => ({
      type: "tool-searchReflections",
      state: "output-available",
      output: { count: 0, reflections: [], brainDumps: [] },
    }));
    const runs = collapseRepeatedToolParts(parts);
    expect(runs).toEqual([{ index: 0, repeat: 5 }]);
  });

  it("keeps a run separate when a different part interrupts it", () => {
    // The sequence is real information: search, spoke, searched again.
    const runs = collapseRepeatedToolParts([
      { type: "tool-searchReflections", state: "output-available", output: { count: 0 } },
      { type: "text" },
      { type: "tool-searchReflections", state: "output-available", output: { count: 0 } },
    ]);
    expect(runs.filter((r) => r.index !== 1).map((r) => r.index)).toEqual([0, 2]);
  });

  it("does NOT collapse same-tool calls whose results differ", () => {
    const runs = collapseRepeatedToolParts([
      { type: "tool-searchMemories", state: "output-available", output: { count: 0 } },
      { type: "tool-searchMemories", state: "output-available", output: { count: 3 } },
    ]);
    expect(runs).toEqual([{ index: 0, repeat: 1 }, { index: 1, repeat: 1 }]);
  });

  it("does NOT collapse across different tools", () => {
    const runs = collapseRepeatedToolParts([
      { type: "tool-searchMemories", state: "output-available", output: { count: 0 } },
      { type: "tool-searchReflections", state: "output-available", output: { count: 0 } },
    ]);
    expect(runs.map((r) => r.repeat)).toEqual([1, 1]);
  });
});
