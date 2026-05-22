/**
 * lib/services/industry-intel.ts · cross-domain residuals slice
 * (2026-05-22 · legacy-modernizer REST→tRPC · chat cross-domain
 * residuals).
 *
 * The /intel surface read · wraps `recallIndustryIntel` so the legacy
 * REST endpoint (app/api/intel/route.ts) AND the new `brain.industryIntel`
 * tRPC procedure call the SAME function · drift between consumers
 * structurally impossible.
 *
 * `recallIndustryIntel` already returns a flat scalar array (no Prisma
 * row, no Json column) so the TS2589 firewall is satisfied trivially —
 * this thin wrapper just stamps `generatedAt` to mirror the legacy
 * envelope.
 */

import { recallIndustryIntel } from "@/lib/automotive/industry-monitor";

/** Industry-intel feed · the automotive-trends rollup for /intel. */
export interface IndustryIntelView {
  ok: true;
  generatedAt: string;
  industry: Array<{
    title: string;
    category: string;
    source: string;
    link?: string;
    publishedAt?: string;
    weight: number;
  }>;
}

/**
 * Recall the last-14d automotive industry intel (top 30). The REST
 * route and the tRPC `brain.industryIntel` procedure both call this.
 */
export async function getIndustryIntel(): Promise<IndustryIntelView> {
  const industry = await recallIndustryIntel({ limit: 30, daysBack: 14 });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    industry,
  };
}
