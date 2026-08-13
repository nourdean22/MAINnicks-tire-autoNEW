/**
 * extractBeatStructureSignals — the beat-count/length/CTA half of the swipe
 * file (hookSignals.ts covers only the opening). Factual extraction, same
 * "measure, don't judge" discipline: nothing here scores a duration as good
 * or bad, it just reports what the design says.
 */
import { describe, it, expect } from "vitest";
import { extractBeatStructureSignals } from "../../../shared/beatStructureSignals";

describe("extractBeatStructureSignals", () => {
  it("counts beats and derives total duration from the LAST beat's endSecond", () => {
    const s = extractBeatStructureSignals({
      storyboardBeats: [
        { beatNumber: 1, startSecond: 0, endSecond: 4 },
        { beatNumber: 2, startSecond: 4, endSecond: 9 },
        { beatNumber: 3, startSecond: 9, endSecond: 18 },
      ],
    });
    expect(s.beatCount).toBe(3);
    expect(s.totalDurationSeconds).toBe(18);
  });

  it("reports null duration, never zero, when no beat carries an endSecond", () => {
    const s = extractBeatStructureSignals({ storyboardBeats: [{ beatNumber: 1 }] });
    expect(s.totalDurationSeconds).toBeNull();
  });

  it("an empty/missing beat list is zero beats, not an error", () => {
    expect(extractBeatStructureSignals({}).beatCount).toBe(0);
    expect(extractBeatStructureSignals({ storyboardBeats: [] }).beatCount).toBe(0);
  });

  it("'none' is a real CTA value, not a missing one — hasCta reflects it exactly", () => {
    expect(extractBeatStructureSignals({ ctaType: "none" }).hasCta).toBe(false);
    expect(extractBeatStructureSignals({ ctaType: "send" }).hasCta).toBe(true);
    expect(extractBeatStructureSignals({ ctaType: "send" }).ctaType).toBe("send");
  });

  it("an absent ctaType defaults to 'none', matching CtaType's own no-CTA member", () => {
    const s = extractBeatStructureSignals({});
    expect(s.ctaType).toBe("none");
    expect(s.hasCta).toBe(false);
  });
});
