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
    expect(event).toMatchObject({
      eventVersion: 1,
      retentionClass: "learning",
      correlationId: "trace-1",
      occurredAt: expect.any(String),
    });
    expect(event.payload).toMatchObject({
      schemaVersion: EPISODE_SCHEMA_VERSION,
      traceId: "trace-1",
      decision: { selected: "web", confidence: 0.82 },
      latencyMs: 17,
    });
  });

  it("preserves explicit causation and does not invent it when absent", () => {
    const caused = buildEpisodeEvent({
      kind: "tool",
      phase: "completed",
      episodeId: "ep-child",
      correlationId: "mission-run-7",
      causationId: "ep-parent",
    });
    expect(caused).toMatchObject({
      correlationId: "mission-run-7",
      causationId: "ep-parent",
    });

    const root = buildEpisodeEvent({
      kind: "mission",
      phase: "started",
      episodeId: "ep-root",
    });
    expect(root.correlationId).toBe("ep-root");
    expect(root.causationId).toBeUndefined();
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
