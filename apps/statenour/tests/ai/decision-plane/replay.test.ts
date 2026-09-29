import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  recordEpisode: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    realityEvent: {
      findFirst: h.findFirst,
      findMany: h.findMany,
    },
  },
}));

vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...args: unknown[]) => h.recordEpisode(...args),
}));

import {
  buildDecisionPlaneReplayReport,
  recordDecisionPlaneOutcome,
} from "@/lib/ai/decision-plane/replay";

beforeEach(() => {
  h.findFirst.mockReset();
  h.findMany.mockReset();
  h.recordEpisode.mockReset();
  h.recordEpisode.mockResolvedValue(true);
});

describe("decision outcome labels", () => {
  it("rejects labels for an unknown episode", async () => {
    h.findFirst.mockResolvedValue(null);

    await expect(
      recordDecisionPlaneOutcome({
        episodeId: "trace-1:kev",
        observedAnswers: { needsWeb: true },
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.recordEpisode).not.toHaveBeenCalled();
  });

  it("validates labels against the typed question contract", async () => {
    h.findFirst.mockResolvedValue({ id: "re-1" });

    await expect(
      recordDecisionPlaneOutcome({
        episodeId: "trace-1:kev",
        observedAnswers: { intent: "not-a-real-intent" },
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      recordDecisionPlaneOutcome({
        episodeId: "trace-1:kev",
        observedAnswers: { needsWeb: "yes" },
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("appends an observed outcome to the same episode lineage", async () => {
    h.findFirst.mockResolvedValue({ id: "candidate-row-1" });

    await expect(
      recordDecisionPlaneOutcome({
        episodeId: "trace-1:kev",
        observedAnswers: {
          intent: "analytical",
          needsWeb: true,
        },
        note: "Operator reviewed against the completed task.",
      }),
    ).resolves.toEqual({
      ok: true,
      episodeId: "trace-1:kev",
      recorded: true,
    });

    expect(h.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "decision",
        phase: "outcome_observed",
        episodeId: "trace-1:kev",
        actor: "operator",
        quality: "observed",
        outcome: expect.objectContaining({
          observedAnswers: {
            intent: "analytical",
            needsWeb: true,
          },
          labelSource: "operator",
        }),
        metadata: expect.objectContaining({
          candidateRealityEventId: "candidate-row-1",
          questionSet: "turn-decision-v1",
        }),
      }),
    );
  });
});

describe("decision replay scoring", () => {
  it("scores only explicitly labeled candidate answers and leaves unlabeled episodes visible", async () => {
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.decision.shadow_evaluated",
        observedAt: new Date("2026-09-28T18:00:00.000Z"),
        payload: {
          episodeId: "trace-1:kev",
          decision: {
            backend: "kev",
            answers: {
              intent: {
                type: "choice",
                choice: "analytical",
                confidence: 0.8,
                probabilities: { analytical: 0.8, factual: 0.2 },
              },
              needsWeb: { type: "noul", noul: 0.9 },
            },
          },
        },
      },
      {
        eventType: "episode.decision.outcome_observed",
        observedAt: new Date("2026-09-28T19:00:00.000Z"),
        payload: {
          episodeId: "trace-1:kev",
          outcome: {
            observedAnswers: {
              intent: "analytical",
              needsWeb: true,
            },
          },
        },
      },
      {
        eventType: "episode.decision.shadow_evaluated",
        observedAt: new Date("2026-09-28T20:00:00.000Z"),
        payload: {
          episodeId: "trace-2:kev",
          decision: {
            backend: "kev",
            answers: {
              intent: {
                type: "choice",
                choice: "factual",
                confidence: 0.6,
                probabilities: { analytical: 0.4, factual: 0.6 },
              },
            },
          },
        },
      },
    ]);

    const report = await buildDecisionPlaneReplayReport(30);

    expect(report).toMatchObject({
      evaluatedEpisodes: 2,
      labeledEpisodes: 1,
      unlabeledEpisodes: 1,
      scoredAnswers: 2,
      promotionReady: false,
    });
    expect(report.rollups).toHaveLength(1);
    expect(report.rollups[0]).toMatchObject({
      backend: "kev",
      evaluatedEpisodes: 2,
      labeledEpisodes: 1,
      scoredAnswers: 2,
      labelCoverageRate: 0.5,
      lastEvaluatedAt: "2026-09-28T20:00:00.000Z",
    });
    expect(report.rollups[0]!.meanBrier).toBeGreaterThanOrEqual(0);
    expect(report.rollups[0]!.meanLogLoss).toBeGreaterThanOrEqual(0);
    expect(report.caveat).toMatch(/explicit observed labels/i);
  });

  it("uses the latest observed label in the replay window", async () => {
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.decision.shadow_evaluated",
        observedAt: new Date("2026-09-28T18:00:00.000Z"),
        payload: {
          episodeId: "trace-3:kev",
          decision: {
            backend: "kev",
            answers: {
              needsWeb: { type: "noul", noul: 0.9 },
            },
          },
        },
      },
      {
        eventType: "episode.decision.outcome_observed",
        observedAt: new Date("2026-09-28T18:30:00.000Z"),
        payload: {
          episodeId: "trace-3:kev",
          outcome: { observedAnswers: { needsWeb: false } },
        },
      },
      {
        eventType: "episode.decision.outcome_observed",
        observedAt: new Date("2026-09-28T19:00:00.000Z"),
        payload: {
          episodeId: "trace-3:kev",
          outcome: { observedAnswers: { needsWeb: true } },
        },
      },
    ]);

    const report = await buildDecisionPlaneReplayReport(30);
    expect(report.rollups[0]!.meanBrier).toBeCloseTo(0.01);
  });
});
