import { describe, expect, it } from "vitest";
import { aggregateGscDetail, buildGscMeasurementReport } from "../services/gscMeasurement";

describe("GSC measurement contract", () => {
  it("keeps official aggregate above incomplete stored detail", () => {
    const report = buildGscMeasurementReport({
      officialAggregate: { clicks: 100, impressions: 1000, ctr: 0.1, position: 12 },
      detailRows: [{ clicks: 80, impressions: 800, position: 14 }],
      requestedRowLimit: 25_000,
    });
    expect(report.officialAggregate?.clicks).toBe(100);
    expect(report.storedDetail.clicks).toBe(80);
    expect(report.coverage.clicks).toBe(0.8);
    expect(report.detailComplete).toBe(false);
  });

  it("retains official totals when detailed rows are empty", () => {
    const report = buildGscMeasurementReport({
      officialAggregate: { clicks: 20, impressions: 500, ctr: 0.04, position: 18 },
      detailRows: [],
    });
    expect(report.aggregateStatus).toBe("available");
    expect(report.detailStatus).toBe("empty");
    expect(report.officialAggregate?.impressions).toBe(500);
  });

  it("keeps a partial detail failure visible without discarding aggregate truth", () => {
    const report = buildGscMeasurementReport({
      officialAggregate: { clicks: 12, impressions: 300, ctr: 0.04, position: 9 },
      detailFailed: true,
    });
    expect(report.detailStatus).toBe("failed");
    expect(report.officialAggregate?.clicks).toBe(12);
    expect(report.limitations.join(" ")).toContain("retrieval failed");
  });

  it("recomputes CTR and impression-weighted position", () => {
    const totals = aggregateGscDetail([
      { clicks: 10, impressions: 100, position: 2 },
      { clicks: 10, impressions: 900, position: 20 },
    ]);
    expect(totals.ctr).toBe(0.02);
    expect(totals.position).toBe(18.2);
  });

  it("returns null coverage when the official denominator is unavailable or zero", () => {
    const report = buildGscMeasurementReport({
      officialAggregate: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      detailRows: [{ clicks: 1, impressions: 10, position: 4 }],
    });
    expect(report.coverage.clicks).toBeNull();
    expect(report.coverage.impressions).toBeNull();
  });
});