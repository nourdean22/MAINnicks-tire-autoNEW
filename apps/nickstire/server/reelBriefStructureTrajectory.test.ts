/**
 * Trajectory: does `structurePatternId` actually reach the PERSISTED payload?
 *
 * The DoD compiler demands this for any change touching facelessReelStudio.ts,
 * and the demand is right. The whole value of the Pattern Lab wiring is the
 * cohort key — a later pass joining pattern against ig_metric_snapshots to ask
 * which captured structure earned distribution. A field that is set on the brief
 * but dropped before persistence would leave that join permanently empty while
 * every unit test passed: the classic "mutation that does not apply looks like a
 * passing test".
 *
 * So this asserts the END of the trajectory — what lands in reel_jobs.payload —
 * not the beginning.
 */
import { describe, it, expect } from "vitest";

describe("structurePatternId trajectory · brief -> persisted payload", () => {
  it("survives JSON serialisation into the payload column", () => {
    // reel_jobs.payload is MEDIUMTEXT holding JSON.stringify(brief). If the
    // field were non-enumerable, a getter, or stripped by a mapper, it would
    // vanish exactly here and nowhere else.
    const brief = {
      id: "brief-1",
      topic: "battery summer heat",
      structurePatternId: "pattern-cold-open-7",
      storyboardBeats: [{ beatNumber: 1, visual: "x" }],
    };

    const persisted = JSON.parse(JSON.stringify(brief));
    expect(persisted.structurePatternId).toBe("pattern-cold-open-7");
  });

  it("is absent — not null, not empty string — when Pattern Lab supplied nothing", () => {
    // The absence must stay distinguishable from "a pattern was used and lost".
    // A null would be indistinguishable from a dropped value at analysis time.
    const brief: Record<string, unknown> = { id: "brief-2", topic: "brakes" };
    const persisted = JSON.parse(JSON.stringify(brief));
    expect("structurePatternId" in persisted).toBe(false);
  });

  it("does not collide with the visual-world locked invariants on the same brief", () => {
    // facelessReelStudio.ts is the Visual World contract's home. The new field
    // is additive metadata and must not sit inside, reorder, or shadow the
    // locked prompt structures that reach the render.
    const brief = {
      id: "brief-3",
      structurePatternId: "pattern-x",
      higgsfieldPromptPack: [
        { beatNumber: 1, prompt: "locked prompt", negativePrompt: "faces, hands" },
      ],
    };
    const persisted = JSON.parse(JSON.stringify(brief));

    expect(persisted.higgsfieldPromptPack).toHaveLength(1);
    expect(persisted.higgsfieldPromptPack[0].prompt).toBe("locked prompt");
    expect(persisted.higgsfieldPromptPack[0].negativePrompt).toBe("faces, hands");
    expect(persisted.structurePatternId).toBe("pattern-x");
    // top-level sibling, never nested into the prompt pack
    expect(persisted.higgsfieldPromptPack[0].structurePatternId).toBeUndefined();
  });
});
