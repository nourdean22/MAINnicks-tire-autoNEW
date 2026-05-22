/**
 * lib/services/deploy-info.ts · Phase B.6c (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · system-domain sub-slice).
 *
 * The current-deployment identity read · lifted verbatim from
 * app/api/system/deploy-info/route.ts so the legacy REST endpoint AND
 * the new `system.deployInfo` tRPC procedure call the SAME function ·
 * drift between consumers structurally impossible.
 *
 * Pure env-var read · no DB, no AI cost. Vercel injects the build-time
 * git vars on every deploy; BUILD_TIME is stamped by next.config.ts.
 * Returns an explicit, shallow `DeployInfo` shape.
 */

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
 * Read the current deployment identity from build-time env vars. The
 * route and the tRPC `system.deployInfo` procedure both call this.
 */
export function buildDeployInfo(): DeployInfo {
  const buildTime =
    process.env.BUILD_TIME ||
    process.env.VERCEL_DEPLOYMENT_CREATED_AT ||
    null;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
  const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null;
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "local";
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? null;
  const env = process.env.VERCEL_ENV ?? "development";

  return {
    sha,
    shaShort: sha.slice(0, 7),
    commitMessage: commitMessage ? commitMessage.slice(0, 140) : null,
    branch,
    deploymentId,
    env,
    buildTime,
    serverTime: new Date().toISOString(),
  };
}
