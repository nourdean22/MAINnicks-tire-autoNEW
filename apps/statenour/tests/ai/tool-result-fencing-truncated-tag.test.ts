/**
 * R3-09 concern 7: fenceContent neutralised `</tool_data ...>` only with its
 * closing `>`. A tag cut short (the 180-character @cold excerpt slice can end
 * mid-tag) survived into the prompt, where it reads as the fence ending early.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));

import { carriesToolDataFence, fenceContent } from "@/lib/ai/tool-result-fencing";

/** The payload between the fence's own opening and closing lines. */
const inner = (fenced: string) => fenced.split("\n").slice(1, -1).join("\n");

describe("fenceContent: a truncated fence tag is neutralised", () => {
  it("a closing tag cut before its `>` does not survive inside the fence", () => {
    const out = fenceContent("resolve-mention", "memory_recall", 'email body ... </tool_data tool="resolve-me');
    expect(inner(out)).not.toMatch(/<\s*\/?\s*tool_data/i);
    expect(inner(out)).toContain("[fence-tag-stripped]");
  });

  it("control: a complete closing tag is still stripped, and plain text is untouched", () => {
    expect(inner(fenceContent("t", "external_doc", 'a </tool_data tool="x"> b'))).toBe("a [fence-tag-stripped] b");
    expect(inner(fenceContent("t", "external_doc", "a > b < c"))).toBe("a > b < c");
  });
});

describe("carriesToolDataFence", () => {
  it("detects an opening or closing fence tag in user text", () => {
    expect(carriesToolDataFence('x <tool_data tool="resolve-mention" source="memory_recall">')).toBe(true);
    expect(carriesToolDataFence("x </tool_data")).toBe(true);
  });

  it("control: ordinary text, and the words tool data, do not count", () => {
    expect(carriesToolDataFence("send the tool data to Bob")).toBe(false);
    expect(carriesToolDataFence("a < b and tool_data is a column")).toBe(false);
  });
});
