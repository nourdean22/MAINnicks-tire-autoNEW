import { describe, expect, it } from "vitest";
import { mapGroupBy } from "@/lib/utils/group-by";

describe("mapGroupBy", () => {
  it("groups items by key into a Map<K, T[]>, preserving insertion order", () => {
    const rows = [
      { tier: "fast", n: 1 },
      { tier: "deep", n: 2 },
      { tier: "fast", n: 3 },
    ];
    const byTier = mapGroupBy(rows, (r) => r.tier);
    expect([...byTier.keys()]).toEqual(["fast", "deep"]);
    expect(byTier.get("fast")).toEqual([
      { tier: "fast", n: 1 },
      { tier: "fast", n: 3 },
    ]);
    expect(byTier.get("deep")).toEqual([{ tier: "deep", n: 2 }]);
  });

  it("returns an empty Map for empty input", () => {
    expect(mapGroupBy([], () => "x").size).toBe(0);
  });

  it("passes a zero-based index to keyFn", () => {
    const seen: number[] = [];
    mapGroupBy(["a", "b", "c"], (_v, i) => {
      seen.push(i);
      return i;
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("groups by a computed key (odd/even)", () => {
    const grouped = mapGroupBy([1, 2, 3, 4, 5], (n) => (n % 2 === 0 ? "even" : "odd"));
    expect(grouped.get("odd")).toEqual([1, 3, 5]);
    expect(grouped.get("even")).toEqual([2, 4]);
  });
});
