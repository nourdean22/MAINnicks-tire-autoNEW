/**
 * v10.0.226 · structured-JSON extraction · pinning the helper's
 * contract so the 6 AI routes that adopt it can rely on consistent
 * parse + repair behavior.
 */
import { describe, it, expect } from "vitest";
import { extractJsonArray, extractJsonObject } from "@/lib/ai/extract-structured";

describe("extractJsonArray · clean inputs", () => {
  it("parses a bare JSON array", () => {
    const r = extractJsonArray<number>("[1, 2, 3]");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([1, 2, 3]);
      expect(r.via).toBe("direct");
    }
  });

  it("parses an array of objects", () => {
    const r = extractJsonArray<{ title: string }>(
      `[{"title":"A"},{"title":"B"}]`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ title: "A" }, { title: "B" }]);
  });
});

describe("extractJsonArray · markdown-wrapped (Venice + Ollama habit)", () => {
  it("strips ```json fences", () => {
    const r = extractJsonArray<number>("```json\n[1,2,3]\n```");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([1, 2, 3]);
  });

  it("strips bare ``` fences", () => {
    const r = extractJsonArray<number>("```\n[4,5]\n```");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([4, 5]);
  });

  it("strips `Here's the result:` preamble", () => {
    const r = extractJsonArray<number>("Here's the JSON:\n[7,8]");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([7, 8]);
  });
});

describe("extractJsonArray · embedded in prose (deepseek artifact)", () => {
  it("extracts the outermost array when wrapped in commentary", () => {
    const r = extractJsonArray<{ a: number }>(
      `Sure! Here are the items: [{"a":1},{"a":2}] · let me know if you need more.`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
      expect(r.via).toBe("extracted");
    }
  });

  it("handles strings containing brackets without breaking the parser", () => {
    const r = extractJsonArray<{ s: string }>(
      `[{"s":"contains [brackets] inside"},{"s":"and ] here"}]`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(r.value[0].s).toBe("contains [brackets] inside");
    }
  });
});

describe("extractJsonArray · repair pass (common AI mistakes)", () => {
  it("repairs trailing commas in arrays", () => {
    const r = extractJsonArray<number>("[1,2,3,]");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([1, 2, 3]);
      expect(r.via).toBe("repaired");
    }
  });

  it("repairs trailing commas in objects within arrays", () => {
    const r = extractJsonArray<{ a: number }>(`[{"a":1,},{"a":2,}]`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("repairs single-quoted keys (Python-leaning models do this)", () => {
    const r = extractJsonArray<{ a: number }>(`[{'a': 1},{'a': 2}]`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

describe("extractJsonArray · failure modes", () => {
  it("returns error for empty input", () => {
    const r = extractJsonArray("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it("returns error for genuinely malformed input", () => {
    const r = extractJsonArray("not even close to json {{{ broken");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/failed to extract/i);
      expect(r.raw).toBeDefined();
    }
  });

  it("truncates raw to 500 chars in error result", () => {
    const long = "x".repeat(5000);
    const r = extractJsonArray(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raw.length).toBeLessThanOrEqual(500);
  });
});

describe("extractJsonObject · object-shaped responses", () => {
  it("parses a plain object", () => {
    const r = extractJsonObject<{ a: number; b: string }>(
      `{"a":1,"b":"two"}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, b: "two" });
  });

  it("extracts an object embedded in prose", () => {
    const r = extractJsonObject<{ name: string }>(
      `The result is {"name":"nick"} as you can see.`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ name: "nick" });
  });

  it("handles nested objects", () => {
    const r = extractJsonObject<{ outer: { inner: number } }>(
      `{"outer":{"inner":42}}`,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outer.inner).toBe(42);
  });
});
