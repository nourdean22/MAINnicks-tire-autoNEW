import { describe, expect, it } from "vitest";
import { evidenceMetadata, withEvidence } from "@/lib/observability/evidence-metadata";

describe("evidence metadata on Langfuse traces", () => {
  it("emits flat, prefixed keys and clips to Langfuse's 200-char value limit", () => {
    const m = evidenceMetadata({ grade: "H4", claimId: "c".repeat(300), hypothesisId: "home-hero-subline-2026-09" });
    expect(m.evidence_grade).toBe("H4");
    expect(m.evidence_claim_id).toHaveLength(200);
    expect(m.evidence_hypothesis_id).toBe("home-hero-subline-2026-09");
    expect(Object.keys(m).every((k) => k.startsWith("evidence_"))).toBe(true);
  });
  it("merges into telemetry input without clobbering, and adds one low-cardinality tag", () => {
    const t = withEvidence({ functionId: "chat-turn", tags: ["chat"], metadata: { turn: 3 } }, { grade: "H2", goalId: "nicks-public-tires-arrivals" });
    expect(t.tags).toEqual(["chat", "evidence:H2"]);
    expect(t.metadata).toMatchObject({ turn: 3, evidence_grade: "H2", evidence_goal_id: "nicks-public-tires-arrivals" });
    expect(withEvidence(t, { grade: "H2" }).tags).toEqual(["chat", "evidence:H2"]);
  });
});
