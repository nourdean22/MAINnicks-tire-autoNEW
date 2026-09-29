import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  recordEpisode: vi.fn(),
  gapReport: vi.fn(),
  getToolCapability: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    realityEvent: {
      findMany: h.findMany,
    },
  },
}));

vi.mock("@/lib/intelligence/episodes", () => ({
  recordEpisode: (...args: unknown[]) => h.recordEpisode(...args),
}));

vi.mock("@/lib/observability/tool-gap-report", () => ({
  buildToolGapReport: (...args: unknown[]) => h.gapReport(...args),
}));

vi.mock("@/lib/tools/tool-registry", () => ({
  getToolCapability: (...args: unknown[]) => h.getToolCapability(...args),
}));

import {
  buildCapabilityLifecycleReport,
  proposeCapability,
  transitionCapabilityProposal,
} from "@/lib/tools/capability-lifecycle";

beforeEach(() => {
  h.findMany.mockReset();
  h.recordEpisode.mockReset();
  h.gapReport.mockReset();
  h.getToolCapability.mockReset();
  h.recordEpisode.mockResolvedValue(true);
  h.findMany.mockResolvedValue([]);
  h.gapReport.mockResolvedValue({
    available: true,
    topGaps: [],
  });
});

describe("Toolsmith capability proposals", () => {
  it("routes recoverable gaps back to the incumbent instead of inventing a new tool", async () => {
    await expect(
      proposeCapability({
        need: "Expose an existing habit tool more reliably.",
        sourceGapClass: "ROUTING_GAP",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.recordEpisode).not.toHaveBeenCalled();
  });

  it("allows an incumbent repair proposal only when the registered tool is identified", async () => {
    h.getToolCapability.mockReturnValue({ id: "habits.read" });

    const result = await proposeCapability({
      need: "Repair routing for the existing habit streak reader.",
      sourceGapClass: "ROUTING_GAP",
      existingToolId: "habits.read",
      evidenceCount: 8,
    });

    expect(result).toMatchObject({
      ok: true,
      state: "PROPOSED",
      recommendedGapAction: "FIX_ROUTING",
    });
    expect(h.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tool_gap",
        phase: "capability_proposed",
        actor: "operator",
        decision: expect.objectContaining({
          existingToolId: "habits.read",
          recommendedGapAction: "FIX_ROUTING",
        }),
        metadata: expect.objectContaining({
          toolsmithAuthority: "proposal_only",
        }),
      }),
    );
  });

  it("permits a genuinely unresolved need to enter proposal review without activation authority", async () => {
    const result = await proposeCapability({
      need: "Read a vendor status source that no registered capability can access.",
      sourceGapClass: "UNRESOLVED_GAP",
      readAccess: true,
      writeAccess: false,
    });

    expect(result.recommendedGapAction).toBe("INVESTIGATE_NEW_CAPABILITY");
    expect(h.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({
          riskClass: "low",
          approvalPolicy: "none",
        }),
      }),
    );
  });
});

describe("Toolsmith lifecycle transitions", () => {
  const proposalId = "4fd8f902-38ca-4f8f-a58e-a64f241890f3";

  it("refuses to jump from proposed directly to verified", async () => {
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.tool_gap.capability_proposed",
        observedAt: new Date("2026-09-28T20:00:00Z"),
        payload: { episodeId: proposalId },
      },
    ]);

    await expect(
      transitionCapabilityProposal({
        proposalId,
        targetState: "VERIFIED",
        verificationRef: "receipt:123",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("requires an implementation artifact before implementation can be claimed", async () => {
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.tool_gap.capability_proposed",
        observedAt: new Date("2026-09-28T20:00:00Z"),
        payload: { episodeId: proposalId },
      },
      {
        eventType: "episode.tool_gap.capability_approved",
        observedAt: new Date("2026-09-28T20:10:00Z"),
        payload: { episodeId: proposalId },
      },
    ]);

    await expect(
      transitionCapabilityProposal({
        proposalId,
        targetState: "IMPLEMENTED_UNVERIFIED",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("allows approved -> implemented-unverified with an external artifact but does not call it verified", async () => {
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.tool_gap.capability_proposed",
        observedAt: new Date("2026-09-28T20:00:00Z"),
        payload: { episodeId: proposalId },
      },
      {
        eventType: "episode.tool_gap.capability_approved",
        observedAt: new Date("2026-09-28T20:10:00Z"),
        payload: { episodeId: proposalId },
      },
    ]);

    await expect(
      transitionCapabilityProposal({
        proposalId,
        targetState: "IMPLEMENTED_UNVERIFIED",
        implementationRef: "github:pr/9999",
      }),
    ).resolves.toMatchObject({
      previousState: "APPROVED",
      state: "IMPLEMENTED_UNVERIFIED",
    });
    expect(h.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "capability_implemented_unverified",
        outcome: expect.objectContaining({
          implementationRef: "github:pr/9999",
          verificationRef: null,
        }),
        metadata: expect.objectContaining({
          toolsmithAuthority: "no_activation_authority",
        }),
      }),
    );
  });
});

describe("Toolsmith lifecycle report", () => {
  it("keeps unresolved lifecycle state visible beyond the telemetry window", async () => {
    const proposalId = "ff47ae2e-7f3c-4706-83db-6326ee728bc5";
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.tool_gap.capability_proposed",
        observedAt: new Date("2026-01-01T00:00:00Z"),
        payload: {
          episodeId: proposalId,
          decision: {
            need: "Keep a long-running capability proposal visible until it is resolved.",
            sourceGapClass: "UNRESOLVED_GAP",
            existingToolId: null,
            riskClass: "low",
            recommendedGapAction: "INVESTIGATE_NEW_CAPABILITY",
          },
        },
      },
      {
        eventType: "episode.tool_gap.capability_approved",
        observedAt: new Date("2026-01-02T00:00:00Z"),
        payload: { episodeId: proposalId },
      },
    ]);

    const report = await buildCapabilityLifecycleReport(30);

    expect(h.gapReport).toHaveBeenCalledWith(30);
    expect(h.findMany.mock.calls[0]?.[0]?.where).not.toHaveProperty("observedAt");
    expect(report.proposals).toEqual([
      expect.objectContaining({
        proposalId,
        state: "APPROVED",
        need: "Keep a long-running capability proposal visible until it is resolved.",
      }),
    ]);
  });

  it("turns gap telemetry into repair-vs-new-capability recommendations", async () => {
    h.gapReport.mockResolvedValue({
      available: true,
      topGaps: [
        {
          classification: "DISCOVERABILITY_GAP",
          toolName: "getHabitStreaks",
          count: 4,
          gateVerdicts: {},
        },
        {
          classification: "UNRESOLVED_GAP",
          toolName: null,
          count: 3,
          gateVerdicts: {},
        },
      ],
    });
    h.findMany.mockResolvedValue([]);

    const report = await buildCapabilityLifecycleReport(30);

    expect(report.gapRecommendations).toEqual([
      expect.objectContaining({
        recommendedAction: "FIX_DISCOVERABILITY",
        newCapabilityCandidate: false,
      }),
      expect.objectContaining({
        recommendedAction: "INVESTIGATE_NEW_CAPABILITY",
        newCapabilityCandidate: true,
      }),
    ]);
    expect(report.caveat).toMatch(/proposal\/lifecycle authority only/i);
  });
});
