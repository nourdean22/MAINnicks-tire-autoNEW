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