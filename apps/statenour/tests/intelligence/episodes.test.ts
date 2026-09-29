import { buildEpisodeEvent, EPISODE_SCHEMA_VERSION } from "@/lib/intelligence/episodes";
import { RealityEventInputSchema } from "@/lib/services/reality-ledger";

describe("universal episode envelope", () => {
  it("uses RealityEvent as the canonical persistence shape", () => {
    const event = buildEpisodeEvent({
      kind: "decision",
      phase: "Shadow Compared",
      episodeId: "ep-1",
      traceId: "trace-1",
      missionId: "mission-1",
      codeRevision: "abc123",
      decision: { selected: "web", confidence: 0.82 },
      latencyMs: 17,
    });

    expect(RealityEventInputSchema.safeParse(event).success).toBe(true);
    expect(event.eventType).toBe("episode.decision.shadow_compared");
    expect(event.objects).toEqual([
      { type: "episode", id: "ep-1", role: "decision" },
      { type: "mission", id: "mission-1", role: "mission" },
    ]);
    expect(event.source).toMatchObject({ system: "statenour", version: "abc123" });
    expect(event.payload).toMatchObject({
      schemaVersion: EPISODE_SCHEMA_VERSION,
      traceId: "trace-1",
      decision: { selected: "web", confidence: 0.82 },
      latencyMs: 17,
    });
  });

  it("stores hashes/structured outcomes, not raw prompts by contract", () => {
    const event = buildEpisodeEvent({
      kind: "business_outcome",
      phase: "observed",
      inputHash: "sha256:input",
      outcome: { converted: true },
      businessValue: { currency: "USD", grossProfitCents: 12000 },
    });

    expect(event.payload).toMatchObject({ inputHash: "sha256:input" });
    expect(event.payload).not.toHaveProperty("prompt");
    expect(event.payload).not.toHaveProperty("rawInput");
  });
});
