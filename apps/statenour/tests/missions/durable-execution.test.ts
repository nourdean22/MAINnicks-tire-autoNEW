import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  configured: true,
  featureOn: true,
  send: vi.fn(),
  missionFindFirst: vi.fn(),
  realityFindFirst: vi.fn(),
  recordEpisode: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFlag: () => ({ isOn: state.featureOn }),
}));

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ send: state.send }),
  isInngestFullyConfigured: () => state.configured,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: { findFirst: (...a: unknown[]) => state.missionFindFirst(...a) },
    realityEvent: { findFirst: (...a: unknown[]) => state.realityFindFirst(...a) },
  },
}));

vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...a: unknown[]) => state.recordEpisode(...a),
}));

import {
  getLatestMissionExecution,
  queueDurableMissionExecution,
} from "@/lib/missions/durable-execution";
beforeEach(() => {
  vi.clearAllMocks();
  state.featureOn = true;
  state.configured = true;
  state.missionFindFirst.mockResolvedValue({ id: "m1" });
  state.send.mockResolvedValue({ ids: ["evt-1"] });
  state.recordEpisode.mockResolvedValue(true);
});

describe("queueDurableMissionExecution", () => {
  const input = {
    missionId: "m1",
    objective: "Research and checkpoint the migration plan",
    requestedBy: "operator" as const,
    steps: [
      { id: "cp1", label: "Checkpoint", kind: "checkpoint" as const },
      {
        id: "r1",
        label: "Research",
        kind: "research" as const,
        question: "What are the current migration risks?",
      },
    ],
  };

  it("is feature-gated until the deployed runner has a live receipt", async () => {
    state.featureOn = false;
    expect(await queueDurableMissionExecution(input)).toEqual({
      queued: false,
      reason: "feature_disabled",
    });
    expect(state.send).not.toHaveBeenCalled();
  });

  it("fails closed when Inngest is not fully configured", async () => {
    state.configured = false;
    expect(await queueDurableMissionExecution(input)).toEqual({
      queued: false,
      reason: "inngest_not_configured",
    });
    expect(state.send).not.toHaveBeenCalled();
  });
  it("requires a real active mission before queueing work", async () => {
    state.missionFindFirst.mockResolvedValueOnce(null);
    expect(await queueDurableMissionExecution(input)).toEqual({
      queued: false,
      reason: "active_mission_not_found",
    });
    expect(state.send).not.toHaveBeenCalled();
  });

  it("rejects obvious PII before it reaches the event bus", async () => {
    const result = await queueDurableMissionExecution({
      ...input,
      objective: "Call 216-555-1212 and research the migration",
    });
    expect(result).toMatchObject({ queued: false });
    expect((result as { reason: string }).reason).toContain("pii_not_allowed");
    expect(state.send).not.toHaveBeenCalled();
  });

  it("queues a bounded run and records only hashed objective/progress metadata", async () => {
    const result = await queueDurableMissionExecution(input);

    expect(result).toMatchObject({
      queued: true,
      missionId: "m1",
      eventIds: ["evt-1"],
    });
    expect(state.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "mission/execution.requested",
        data: expect.objectContaining({
          missionId: "m1",
          objective: input.objective,
          steps: input.steps,
          runId: expect.any(String),
        }),
      }),
    );
    expect(state.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mission",
        phase: "queued",
        missionId: "m1",
        inputHash: expect.stringMatching(/^sha256:/),
        action: {
          stepCount: 2,
          stepKinds: ["checkpoint", "research"],
        },
      }),
    );
    expect(state.recordEpisode.mock.calls[0]?.[0]).not.toHaveProperty("objective");
  });
});

describe("getLatestMissionExecution", () => {
  it("reads the latest mission episode from the existing Reality Ledger", async () => {
    state.realityFindFirst.mockResolvedValueOnce({
      eventType: "episode.mission.step_completed",
      observedAt: new Date("2026-09-28T12:00:00.000Z"),
      payload: {
        episodeId: "run-1",
        missionId: "m1",
        metadata: { stepId: "r1", stepIndex: 0 },
      },
    });

    const result = await getLatestMissionExecution("m1");

    expect(result).toEqual({
      runId: "run-1",
      phase: "step_completed",
      observedAt: "2026-09-28T12:00:00.000Z",
      metadata: { stepId: "r1", stepIndex: 0 },
    });
  });
});
