import { describe, it, expect } from "vitest";
import { selectRotationPattern, type RotatablePattern } from "./reelStructureRotation";

const p = (id: string, timesUsed: number, lastUsedAt: Date | null, hookType = "cold_open"): RotatablePattern =>
  ({ id, label: id, hookType, loopType: "hard_cut", timesUsed, lastUsedAt });

describe("selectRotationPattern", () => {
  it("prefers the least-used pattern", () => {
    expect(selectRotationPattern([p("a", 5, new Date(1)), p("b", 1, new Date(2))])?.id).toBe("b");
  });

  it("gives a never-used pattern its first airing before repeating a used one", () => {
    expect(selectRotationPattern([p("used", 1, new Date(1)), p("fresh", 0, null)])?.id).toBe("fresh");
  });

  it("breaks a tie on oldest use, then deterministically on id", () => {
    expect(selectRotationPattern([p("z", 2, new Date(500)), p("y", 2, new Date(100))])?.id).toBe("y");
    // identical counts AND identical timestamps must still be reproducible
    const same = new Date(100);
    expect(selectRotationPattern([p("z", 2, same), p("y", 2, same)])?.id).toBe("y");
  });

  it("avoids a hook type the caller just used", () => {
    const picked = selectRotationPattern(
      [p("a", 0, null, "cold_open"), p("b", 3, new Date(1), "question")],
      { excludeHookTypes: ["cold_open"] },
    );
    expect(picked?.id).toBe("b");
  });

  it("falls back to the full set rather than returning nothing when exclusion empties it", () => {
    const picked = selectRotationPattern([p("a", 0, null, "cold_open")], { excludeHookTypes: ["cold_open"] });
    expect(picked?.id).toBe("a");
  });

  it("returns null only when there are genuinely no patterns", () => {
    expect(selectRotationPattern([])).toBeNull();
  });
});
