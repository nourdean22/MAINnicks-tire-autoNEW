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
  buildCostPerOutcomeAttribution,
  recordValueObservation,
} from "@/lib/intelligence/value-attribution";

beforeEach(() => {
  h.findFirst.mockReset();
  h.findMany.mockReset();
  h.recordEpisode.mockReset();
  h.findFirst.mockResolvedValue(null);
  h.findMany.mockResolvedValue([]);
  h.recordEpisode.mockResolvedValue(true);
});

describe("value observation contract", () => {
  it("records measured send cost on the existing business-outcome Episode spine", async () => {
    const result = await recordValueObservation({
      observationId: "sms-cost-batch-42",
      attributionRef: "recovery:lane-a:2026-09-28",
      direction: "cost",
      category: "sms",
      amountCents: 180,
      measurement: "MEASURED",
      sourceSystem: "nickstire",
      sourceRef: "sms-batch:42",
      method: "provider delivery receipts summed for the recovery cohort",
    });

    expect(result).toMatchObject({
      ok: true,
      recorded: true,
      duplicate: false,
      episodeId: "value:sms-cost-batch-42",
    });
    expect(h.recordEpisode).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "business_outcome",
        phase: "value_observed",
        episodeId: "value:sms-cost-batch-42",
        quality: "observed",
        cost: expect.objectContaining({
          attributionRef: "recovery:lane-a:2026-09-28",
          category: "sms",
          amountCents: 180,
          measurement: "MEASURED",
          sourceSystem: "nickstire",
        }),
        metadata: expect.objectContaining({
          attributionContract: "value-observation-v1",
        }),
      }),
    );
  });

  it("dedupes a stable observationId before appending another episode", async () => {
    h.findFirst.mockResolvedValue({ id: "re-existing" });

    await expect(
      recordValueObservation({
        observationId: "sms-cost-batch-42",
        attributionRef: "recovery:lane-a:2026-09-28",
        direction: "cost",
        category: "sms",
        amountCents: 180,
        measurement: "MEASURED",
        sourceSystem: "nickstire",
        method: "provider receipts",
      }),
    ).resolves.toMatchObject({
      recorded: false,
      duplicate: true,
      realityEventId: "re-existing",
    });
    expect(h.recordEpisode).not.toHaveBeenCalled();
  });

  it("refuses to call recovered revenue MEASURED without a holdout adjustment", async () => {
    await expect(
      recordValueObservation({
        observationId: "revenue-cohort-42",
        attributionRef: "recovery:lane-a:2026-09-28",
        direction: "value",
        category: "recovered_revenue",
        amountCents: 24_000,
        measurement: "MEASURED",
        sourceSystem: "nickstire",
        method: "bookings matched to treated cohort only",
        holdoutAdjusted: false,
        outcomeCount: 3,
      }),
    ).rejects.toThrow(/holdout-adjusted/i);
    expect(h.recordEpisode).not.toHaveBeenCalled();
  });
});

describe("cost per outcome attribution", () => {
  it("computes a measured ratio only when cost and holdout-adjusted revenue share an attributionRef", async () => {
    h.findMany.mockResolvedValue([
      {
        payload: {
          cost: {
            attributionRef: "recovery:lane-a:2026-09-28",
            category: "sms",
            amountCents: 200,
            measurement: "MEASURED",
          },
        },
      },
      {
        payload: {
          cost: {
            attributionRef: "recovery:lane-a:2026-09-28",
            category: "voice",
            amountCents: 300,
            measurement: "MEASURED",
          },
        },
      },
      {
        payload: {
          businessValue: {
            attributionRef: "recovery:lane-a:2026-09-28",
            category: "recovered_revenue",
            amountCents: 25_000,
            measurement: "MEASURED",
            holdoutAdjusted: true,
            outcomeCount: 5,
          },
        },
      },
    ]);

    const report = await buildCostPerOutcomeAttribution(7);

    expect(report).toMatchObject({
      measurementState: "MEASURED",
      measuredSendCostCents: 500,
      measuredRecoveredRevenueCents: 25_000,
      matchedRefs: 1,
      matchedMeasuredCostCents: 500,
      matchedMeasuredRecoveredRevenueCents: 25_000,
      measuredRecoveredOutcomes: 5,
      costPerRecoveredOutcomeCents: 100,
      recoveredRevenuePerSendCostDollar: 50,
    });
    expect(report.reasons).toEqual([]);
  });

  it("does not match measured cost and value that use different attribution refs", async () => {
    h.findMany.mockResolvedValue([
      {
        payload: {
          cost: {
            attributionRef: "recovery:lane-a",
            category: "sms",
            amountCents: 200,
            measurement: "MEASURED",
          },
        },
      },
      {
        payload: {
          businessValue: {
            attributionRef: "recovery:lane-b",
            category: "recovered_revenue",
            amountCents: 10_000,
            measurement: "MEASURED",
            holdoutAdjusted: true,
            outcomeCount: 2,
          },
        },
      },
    ]);

    const report = await buildCostPerOutcomeAttribution(7);
    expect(report.measurementState).toBe("UNMEASURED");
    expect(report.matchedRefs).toBe(0);
    expect(report.costPerRecoveredOutcomeCents).toBeNull();
    expect(report.recoveredRevenuePerSendCostDollar).toBeNull();
    expect(report.reasons.join(" ")).toMatch(/no attributionRef joins both/i);
  });

  it("keeps estimates visible without promoting them into the measured ratio", async () => {
    h.findMany.mockResolvedValue([
      {
        payload: {
          cost: {
            attributionRef: "recovery:lane-a",
            category: "sms",
            amountCents: 150,
            measurement: "ESTIMATE",
          },
        },
      },
      {
        payload: {
          businessValue: {
            attributionRef: "recovery:lane-a",
            category: "recovered_revenue",
            amountCents: 8_000,
            measurement: "ESTIMATE",
            holdoutAdjusted: false,
            outcomeCount: 1,
          },
        },
      },
    ]);

    const report = await buildCostPerOutcomeAttribution(7);
    expect(report).toMatchObject({
      measurementState: "ESTIMATE",
      estimatedSendCostCents: 150,
      estimatedRecoveredRevenueCents: 8_000,
      matchedRefs: 0,
      costPerRecoveredOutcomeCents: null,
    });
  });

  it("returns UNMEASURED rather than zero when no observations exist", async () => {
    const report = await buildCostPerOutcomeAttribution(7);
    expect(report.measurementState).toBe("UNMEASURED");
    expect(report.costPerRecoveredOutcomeCents).toBeNull();
    expect(report.reasons).toEqual(
      expect.arrayContaining([
        "no measured SMS/voice cost observations",
        "no measured holdout-adjusted recovered revenue observations",
      ]),
    );
  });
});
