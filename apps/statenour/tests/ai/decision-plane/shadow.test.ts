import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  flagOn: false,
  inngestConfigured: true,
  statuses: [] as Array<{ configured: boolean }>,
  send: vi.fn(),
  findPii: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFlag: () => ({ isOn: h.flagOn }),
}));

vi.mock("@/lib/ai/decision-plane/backends", () => ({
  getDecisionBackendStatuses: () => h.statuses,
}));

vi.mock("@/lib/inngest/client", () => ({
  isInngestFullyConfigured: () => h.inngestConfigured,
  getInngest: () => ({ send: h.send }),
}));

vi.mock("@/lib/services/reality-ledger", () => ({
  findPii: (...args: unknown[]) => h.findPii(...args),
}));

import {
  isDecisionShadowSampled,
  scheduleTurnDecisionShadow,
} from "@/lib/ai/decision-plane/shadow";

const turnSignal = {
  complexity: "complex",
  intent: "analytical",
  outputShape: "table",
  urgency: "high",
  domain: "business",
  temperature: 0.2,
  useChainOfThought: true,
  useTwoPassCritique: false,
  reasons: [],
} as const;

function input(over: Record<string, unknown> = {}) {
  return {
    userContent: "Compare the two current approaches.",
    traceId: "trace-decision-1",
    conversationId: "conv-1",
    privateMode: false,
    turnSignal,
    mode: "deep",
    finalTaskType: "deep",
    pythonExecuteIntent: false,
    actionIntent: false,
    webSearchIntent: true,
    webSearchRecency: false,
    ...over,
  };
}

beforeEach(() => {
  h.flagOn = false;
  h.inngestConfigured = true;
  h.statuses = [];
  h.send.mockReset();
  h.send.mockResolvedValue({ ids: ["evt-1"] });
  h.findPii.mockReset();
  h.findPii.mockReturnValue(null);
  process.env.DECISION_PLANE_SHADOW_SAMPLE_PCT = "100";
});

describe("decision shadow scheduling", () => {
  it("is deterministic at the sampling boundaries", () => {
    expect(isDecisionShadowSampled("same", 0)).toBe(false);
    expect(isDecisionShadowSampled("same", 100)).toBe(true);
    expect(isDecisionShadowSampled("same", 37)).toBe(
      isDecisionShadowSampled("same", 37),
    );
  });

  it("does zero work when the feature is off", async () => {
    const result = await scheduleTurnDecisionShadow(input());
    expect(result).toEqual({ queued: false, reason: "feature_disabled" });
    expect(h.findPii).not.toHaveBeenCalled();
    expect(h.send).not.toHaveBeenCalled();
  });

  it("rejects private and PII-bearing turns before enqueue", async () => {
    h.flagOn = true;

    await expect(
      scheduleTurnDecisionShadow(input({ privateMode: true })),
    ).resolves.toEqual({ queued: false, reason: "private_mode" });

    h.findPii.mockReturnValue({ path: "message", reason: "email" });
    await expect(scheduleTurnDecisionShadow(input())).resolves.toEqual({
      queued: false,
      reason: "pii_detected",
    });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("refuses to enqueue when no backend or durable runner is configured", async () => {
    h.flagOn = true;

    await expect(scheduleTurnDecisionShadow(input())).resolves.toEqual({
      queued: false,
      reason: "no_configured_backend",
    });

    h.statuses = [{ configured: true }];
    h.inngestConfigured = false;
    await expect(scheduleTurnDecisionShadow(input())).resolves.toEqual({
      queued: false,
      reason: "inngest_not_configured",
    });
    expect(h.send).not.toHaveBeenCalled();
  });

  it("queues a bounded provenance-bearing event while keeping authority with the incumbent", async () => {
    h.flagOn = true;
    h.statuses = [{ configured: true }];

    const result = await scheduleTurnDecisionShadow(input());
    expect(result).toMatchObject({
      queued: true,
      eventIds: ["evt-1"],
      incumbent: {
        needsWeb: true,
        needsTools: true,
        needsBackgroundMission: null,
      },
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    const event = h.send.mock.calls[0]![0];
    expect(event.name).toBe("decision-plane/shadow.requested");
    expect(event.data).toMatchObject({
      schemaVersion: 1,
      traceId: "trace-decision-1",
      conversationId: "conv-1",
      state: {
        message: "Compare the two current approaches.",
        truncated: false,
      },
      incumbent: {
        intent: "analytical",
        mode: "deep",
      },
    });
    expect(event.data.inputHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
