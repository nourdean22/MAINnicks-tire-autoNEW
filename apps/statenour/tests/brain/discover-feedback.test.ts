/**
 * Canaries · what the operator is TOLD when he judges a cluster (2026-08-28).
 *
 * The defect: on the ordinary tap — the one that suppresses a whole cluster —
 * discover-tab's judge() set NO message. It spoke only on partial failure or
 * beyond-page extras, and that informational case rode the error string and
 * painted amber. An invisible effect is indistinguishable from no effect.
 *
 * These assert the MESSAGE, not its presence in source: the happy path must
 * speak, must name the count, and must not be toned as a failure.
 */
import { describe, it, expect } from "vitest";
import { describeJudgeOutcome } from "@/lib/brain/discover-feedback";

const base = { rated: 6, failed: 0, requested: 6 } as const;

describe("describeJudgeOutcome · the happy path speaks", () => {
  it("BREAKS: 'known' on a 6-row cluster reports the suppressed count", () => {
    const out = describeJudgeOutcome({ ...base, verdict: "known" });
    expect(out.text).toContain("suppressed 6 similar");
    expect(out.tone).toBe("info");
  });

  it("BREAKS: 'noise' on a 6-row cluster reports the count AND the eval case", () => {
    const out = describeJudgeOutcome({ ...base, verdict: "noise" });
    expect(out.text).toContain("suppressed 6 similar");
    expect(out.text).toMatch(/retrieval eval case/i);
    expect(out.tone).toBe("info");
  });

  it("every verdict produces a non-empty INFO message on the ordinary path", () => {
    for (const verdict of ["known", "noise", "investigate"] as const) {
      const out = describeJudgeOutcome({ ...base, verdict });
      expect(out.text.length, `${verdict} must say something`).toBeGreaterThan(0);
      expect(out.tone, `${verdict} is not a failure`).toBe("info");
    }
  });

  it("a single-row cluster does not claim a count it does not have", () => {
    const out = describeJudgeOutcome({ verdict: "known", rated: 1, failed: 0, requested: 1 });
    expect(out.text).toContain("Already knew — suppressed.");
    expect(out.text).not.toMatch(/suppressed 1 similar/);
  });

  it("'known' names the durable effect: regenerated copies stay hidden", () => {
    const out = describeJudgeOutcome({ ...base, verdict: "known" });
    expect(out.text).toMatch(/regenerate/i);
  });

  it("'investigate' promises the task, never suppression", () => {
    const out = describeJudgeOutcome({ ...base, verdict: "investigate" });
    expect(out.text).toMatch(/task/i);
    expect(out.text).not.toMatch(/suppress/i);
  });
});

describe("describeJudgeOutcome · tone is not decoration", () => {
  it("BREAKS: beyond-page extras are INFO, not an error", () => {
    // This message used to ride `actionError` and render amber, so the cluster
    // feature working looked like a fault.
    const out = describeJudgeOutcome({ verdict: "known", rated: 9, failed: 0, requested: 6 });
    expect(out.tone).toBe("info");
    expect(out.text).toContain("3 more copies were found beyond this page.");
  });

  it("singular extra reads as a copy, not copies", () => {
    const out = describeJudgeOutcome({ verdict: "noise", rated: 7, failed: 0, requested: 6 });
    expect(out.text).toContain("1 more copy was found beyond this page.");
  });

  it("positive control: partial failure stays amber and never claims a clean sweep", () => {
    const out = describeJudgeOutcome({ verdict: "noise", rated: 4, failed: 2, requested: 6 });
    expect(out.tone).toBe("warn");
    expect(out.text).toBe("Saved 4 — 2 had already been consolidated away.");
    expect(out.text).not.toMatch(/suppressed 6/);
  });

  it("positive control: a thrown mutation is an error and promises nothing", () => {
    const out = describeJudgeOutcome({ ...base, verdict: "known", threw: true });
    expect(out.tone).toBe("error");
    expect(out.text).toMatch(/didn't save/);
    expect(out.text).not.toMatch(/suppressed/i);
  });

  it("rated 0 with no failure does not render as success", () => {
    const out = describeJudgeOutcome({ verdict: "known", rated: 0, failed: 0, requested: 3 });
    expect(out.tone).toBe("warn");
    expect(out.text).not.toMatch(/suppressed \d/);
  });
});
