import { assessDriftState } from "@/lib/scoring/drift";

describe("assessDriftState", () => {
  it("returns LOW for healthy signals", () => {
    const result = assessDriftState({
      recentCompletionCount: 5,
      readyDoingCount: 2,
      staleTaskCount: 0,
      driftIncidents: 0
    });

    expect(result.level).toBe("LOW");
  });

  it("returns HIGH once thresholds stack up", () => {
    const result = assessDriftState({
      recentCompletionCount: 0,
      readyDoingCount: 9,
      staleTaskCount: 4,
      driftIncidents: 4
    });

    expect(result.level).toBe("HIGH");
    expect(result.intervention).toContain("Stop adding work");
  });
});
