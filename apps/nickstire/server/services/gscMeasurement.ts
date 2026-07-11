export const GSC_METRIC_DEFINITION_VERSION = "gsc-revenue-ops-v1";

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscDetailRow {
  clicks: number;
  impressions: number;
  position: number;
}

export interface GscCoverage {
  clicks: number | null;
  impressions: number | null;
}

export interface GscMeasurementReport {
  metricDefinitionVersion: typeof GSC_METRIC_DEFINITION_VERSION;
  officialAggregate: GscTotals | null;
  storedDetail: GscTotals;
  coverage: GscCoverage;
  rowCount: number;
  requestedRowLimit: number | null;
  detailComplete: false;
  aggregateStatus: "available" | "unavailable";
  detailStatus: "available" | "empty" | "failed";
  limitations: string[];
}

export function aggregateGscDetail(rows: readonly GscDetailRow[]): GscTotals {
  const clicks = rows.reduce((sum, row) => sum + Math.max(0, Number(row.clicks) || 0), 0);
  const impressions = rows.reduce((sum, row) => sum + Math.max(0, Number(row.impressions) || 0), 0);
  const weightedPosition = rows.reduce(
    (sum, row) => sum + (Number(row.position) || 0) * Math.max(0, Number(row.impressions) || 0),
    0,
  );
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosition / impressions : 0,
  };
}

function ratio(detail: number, official: number): number | null {
  if (!Number.isFinite(official) || official <= 0) return null;
  return Math.max(0, detail / official);
}

export function buildGscMeasurementReport(args: {
  officialAggregate?: GscTotals | null;
  detailRows?: readonly GscDetailRow[];
  detailFailed?: boolean;
  requestedRowLimit?: number | null;
}): GscMeasurementReport {
  const detailRows = args.detailRows ?? [];
  const storedDetail = aggregateGscDetail(detailRows);
  const official = args.officialAggregate ?? null;
  const limitations = [
    "Stored dimensional rows are bounded top-row analysis and are not guaranteed exhaustive.",
    "Average position is impression-weighted and is not a universal rank tracker.",
  ];
  if (!official) limitations.push("Official no-dimension aggregate was unavailable for this response.");
  if (args.detailFailed) limitations.push("Detailed-row retrieval failed; official aggregate remains usable when present.");

  return {
    metricDefinitionVersion: GSC_METRIC_DEFINITION_VERSION,
    officialAggregate: official,
    storedDetail,
    coverage: {
      clicks: official ? ratio(storedDetail.clicks, official.clicks) : null,
      impressions: official ? ratio(storedDetail.impressions, official.impressions) : null,
    },
    rowCount: detailRows.length,
    requestedRowLimit: args.requestedRowLimit ?? null,
    detailComplete: false,
    aggregateStatus: official ? "available" : "unavailable",
    detailStatus: args.detailFailed ? "failed" : detailRows.length ? "available" : "empty",
    limitations,
  };
}
