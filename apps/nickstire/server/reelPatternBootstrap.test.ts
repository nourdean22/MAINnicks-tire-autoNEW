import { describe, expect, it, vi } from "vitest";
import { HOUSE_REEL_PATTERN_SEEDS } from "../shared/reelPatternSeeds";
import { ensureHouseReelPatterns } from "./services/reelPatternBootstrap";

function fakeDb(existingIds: string[]) {
  const limit = vi.fn(async () => existingIds.map((id) => ({ id })));
  const from = vi.fn(() => ({ limit }));
  const select = vi.fn(() => ({ from }));

  const onDuplicateKeyUpdate = vi.fn(async () => undefined);
  const values = vi.fn(() => ({ onDuplicateKeyUpdate }));
  const insert = vi.fn(() => ({ values }));

  return {
    database: { select, insert } as any,
    select,
    insert,
    values,
    onDuplicateKeyUpdate,
  };
}

describe("ensureHouseReelPatterns", () => {
  it("does not write when the operator lab already contains any pattern", async () => {
    const f = fakeDb(["rp_operator_real_reference"]);
    const result = await ensureHouseReelPatterns(f.database);

    expect(result).toEqual({ seeded: false, inserted: 0, reason: "lab_not_empty" });
    expect(f.insert).not.toHaveBeenCalled();
  });

  it("seeds the empty lab with stable house hypotheses", async () => {
    const f = fakeDb([]);
    const result = await ensureHouseReelPatterns(f.database);

    expect(result).toEqual({
      seeded: true,
      inserted: HOUSE_REEL_PATTERN_SEEDS.length,
      reason: "seeded_empty_lab",
    });
    expect(f.insert).toHaveBeenCalledTimes(1);
    expect(f.values).toHaveBeenCalledTimes(1);

    const rows = f.values.mock.calls[0]?.[0] as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(HOUSE_REEL_PATTERN_SEEDS.map((p) => p.id));
    expect(rows.every((r) => String(r.patternJson).includes("unmeasured bootstrap"))).toBe(true);
  });

  it("uses a duplicate-key NO-OP that cannot overwrite operator-edited pattern content", async () => {
    const f = fakeDb([]);
    await ensureHouseReelPatterns(f.database);

    expect(f.onDuplicateKeyUpdate).toHaveBeenCalledTimes(1);
    const arg = f.onDuplicateKeyUpdate.mock.calls[0]?.[0] as { set: Record<string, unknown> };
    expect(Object.keys(arg.set)).toEqual(["id"]);
    expect(arg.set).not.toHaveProperty("label");
    expect(arg.set).not.toHaveProperty("patternJson");
    expect(arg.set).not.toHaveProperty("hookType");
    expect(arg.set).not.toHaveProperty("loopType");
  });
});
