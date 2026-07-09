import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/connector/performance");

export interface BioMetricSummary {
  metric: string;
  value: number;
  unit: string;
  status: string; // "optimal" | "suboptimal" | "critical"
  notes: string;
}

export interface ScienceInsight {
  title: string;
  topic: string;
  source: string;
  summary: string;
  actionableProtocol: string;
}

export interface BioPerformanceData {
  biometrics: BioMetricSummary[];
  insights: ScienceInsight[];
}

/**
 * AG-02 · Fabrication purge. This connector previously invented the
 * operator's personal biometrics (sleep efficiency, HRV, resting heart
 * rate — presented as HIS real recovery data) plus canned "scientific
 * insights" whenever HEALTH_API_KEY was absent — which it always is.
 * Fake health data driving real behavior is the worst fabrication class.
 * Unavailable data is EMPTY, never mocked.
 */
export async function fetchBioPerformanceMetrics(): Promise<BioPerformanceData> {
  const healthApiKey = process.env.HEALTH_API_KEY;
  if (!healthApiKey) {
    log.info("HEALTH_API_KEY not configured; emitting no biometrics rather than mock health data.");
    return { biometrics: [], insights: [] };
  }

  // Real health API integration not yet implemented; return empty until it is.
  return { biometrics: [], insights: [] };
}
