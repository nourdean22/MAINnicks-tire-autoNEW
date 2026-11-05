import { describe, expect, it } from "vitest";
import {
  exportShortfall,
  findStalePageFiles,
  pageIdsByCategory,
  rollupPageFilename,
} from "@/lib/obsidian/memory-rollup";

describe("pageIdsByCategory", () => {
  it("fills pages in input order per category and drops nothing", () => {
    const rows = [
      { id: "a1", category: "a" },
      { id: "b1", category: "b" },
      { id: "a2", category: "a" },
      { id: "a3", category: "a" },
      { id: "b2", category: "b" },
    ];
    const pages = pageIdsByCategory(rows, 2);
    expect(pages.get("A")).toEqual([["a1", "a2"], ["a3"]]);
    expect(pages.get("B")).toEqual([["b1", "b2"]]);
  });

  it("merges categories that collapse to one filename stem", () => {
    const pages = pageIdsByCategory([{ id: "1", category: "x-y" }, { id: "2", category: "x_y" }], 10);
    expect([...pages.keys()]).toEqual(["X_Y"]);
    expect(pages.get("X_Y")).toEqual([["1", "2"]]);
  });

  it("returns nothing for no rows", () => {
    expect(pageIdsByCategory([]).size).toBe(0);
  });
});

describe("rollupPageFilename", () => {
  it("keeps the plain name for page 1 and numbers later pages", () => {
    expect(rollupPageFilename("INSIGHT", 1)).toBe("INSIGHT.md");
    expect(rollupPageFilename("INSIGHT", 2)).toBe("INSIGHT_PART_002.md");
    expect(rollupPageFilename("INSIGHT", 1000)).toBe("INSIGHT_PART_1000.md");
  });
});

describe("findStalePageFiles", () => {
  it("returns only unwritten page files, never plain notes", () => {
    const stale = findStalePageFiles(
      ["A.md", "A_PART_002.md", "A_PART_003.md", "B.md", "notes.md"],
      new Set(["A.md", "A_PART_002.md", "B.md"]),
    );
    expect(stale).toEqual(["A_PART_003.md"]);
  });
});

describe("exportShortfall", () => {
  it("reports missing rows and treats over-export as no shortfall", () => {
    expect(exportShortfall(10, 7)).toBe(3);
    expect(exportShortfall(10, 10)).toBe(0);
    expect(exportShortfall(10, 12)).toBe(0);
  });
});
