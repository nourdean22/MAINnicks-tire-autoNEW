import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  statuses: [
    {
      id: "kev",
      requested: true,
      configured: true,
      trust: "private",
      reason: "configured on a private endpoint",
    },
  ],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    realityEvent: {
      findMany: h.findMany,
    },
  },
}));

vi.mock("@/lib/ai/decision-plane/backends", () => ({
  getDecisionBackendStatuses: () => h.statuses,
}));

import { buildDecisionPlaneReport } from "@/lib/observability/decision-plane-report";

beforeEach(() => {
  h.findMany.mockReset();
});

describe("Decision Plane operator report", () => {
  it("aggregates Episode payloads without treating incumbent agreement as promotion evidence", async () => {
    h.findMany.mockResolvedValue([
      {
        eventType: "episode.decision.shadow_evaluated",
        observedAt: new Date("2026-09-28T20:00:00.000Z"),
        payload: {
          decision: { backend: "kev" },
          outcome: {
            incumbentAgreement: { agreementRate: 0.75 },
          },
          latencyMs: 120,
          metadata: { trust: "private" },
        },
      },
      {
        eventType: "episode.decision.shadow_evaluated",
        observedAt: new Date("2026-09-28T19:00:00.000Z"),
        payload: {
          decision: { backend: "kev" },
          outcome: {
            incumbentAgreement: { agreementRate: 0.25 },
          },
          latencyMs: 80,
          metadata: { trust: "private" },
        },
      },
      {
        eventType: "episode.decision.shadow_failed",
        observedAt: new Date("2026-09-28T18:00:00.000Z"),
        payload: {
          decision: { backend: "kev" },
          outcome: { ok: false, errorClass: "AbortError" },
          metadata: { trust: "private" },
        },
      },
    ]);

    const report = await buildDecisionPlaneReport(7);

    expect(report).toMatchObject({
      windowDays: 7,
      featureConfigured: true,
      evaluated: 2,
      failed: 1,
      promotionReady: false,
    });
    expect(report.rollups).toEqual([
      expect.objectContaining({
        backend: "kev",
        evaluated: 2,
        failed: 1,
        avgLatencyMs: 100,
        avgIncumbentAgreement: 0.5,
        lastObservedAt: "2026-09-28T20:00:00.000Z",
      }),
    ]);
    expect(report.caveat).toMatch(/not correctness or calibration/i);
    expect(h.findMany).toHaveBeenCalledOnce();
  });
});
