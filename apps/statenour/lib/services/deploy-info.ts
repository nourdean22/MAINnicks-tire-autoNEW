/**
 * lib/services/deploy-info.ts · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The current-deployment identity read · lifted verbatim from
 * app/api/system/deploy-info/route.ts so the legacy REST endpoint AND
 * the new `system.deployInfo` tRPC procedure call the SAME function ·
 * drift between consumers structurally impossible.
 *
 * Pure env-var read · no DB, no AI cost. truth-substrate audit P0 (#11/#14):
 * identity now comes from the canonical getDeployMeta() (Railway-first), not
 * Vercel-only reads that showed "dev"/"local"/"development" on Railway prod.
 * Returns an explicit, shallow `DeployInfo` shape.
 */

import { getDeployMeta } from "@/lib/services/deploy-identity";

/** Current deployment identity · build SHA + branch + deploy timestamp. */
export interface DeployInfo {
  sha: string;
  shaShort: string;
  commitMessage: string | null;
  branch: string;
  deploymentId: string | null;
  env: string;
  buildTime: string | null;
  serverTime: string;
}

/**
 * Read the current deployment identity. The route and the tRPC
 * `system.deployInfo` procedure both call this. When neither Railway nor
 * Vercel env is present the fields read "unknown"/"local" HONESTLY rather
 * than pretending a specific dev SHA.
 */
export function buildDeployInfo(): DeployInfo {
  const m = getDeployMeta();
  return {
    sha: m.sha ?? "unknown",
    shaShort: m.shaShort ?? "unknown",
    commitMessage: m.commitMessage ? m.commitMessage.slice(0, 140) : null,
    branch: m.branch ?? "local",
    deploymentId: m.deploymentId,
    env: m.env ?? "development",
    buildTime: m.buildTime,
    serverTime: new Date().toISOString(),
  };
}
