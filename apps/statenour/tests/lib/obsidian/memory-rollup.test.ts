import { describe, expect, it } from "vitest";
import { pickNewestIdsPerCategory } from "@/lib/obsidian/memory-rollup";

describe("pickNewestIdsPerCategory", () => {
  it("keeps only the first N newest rows per category while preserving global order", () => {
    const rows = [
      { id: "a3", category: "a" },
      { id: "b3", category: "b" },
      { id: "a2", category: "a" },
      { id: "a1", category: "a" },
      { id: "b2", category: "b" },
      { id: "b1", category: "b" },
    ];

    expect(pickNewestIdsPerCategory(rows, 2)).toEqual(["a3", "b3", "a2", "b2"]);
  });

  it("returns no ids when the limit is zero", () => {
    expect(pickNewestIdsPerCategory([{ id: "x", category: "a" }], 0)).toEqual([]);
  });
});
