/**
 * lib/services/deploy-identity.ts · truth-substrate audit P0 (2026-07-21 · #11/#14)
 *
 * THE single source of deployment identity. statenour deploys to Railway
 * (bdnick.info), but every deploy-identity surface used to read Vercel-only
 * env vars (VERCEL_GIT_COMMIT_SHA/REF/ENV/…) that Railway never injects, so on
 * prod they fabricated the literals "dev" / "local" / "development" — the
 * "deployment TRUTH" page was lying about what is live.
 *
 * This module reads RAILWAY_* first, Vercel second, and returns an explicit
 * `unknown` status (never a fabricated SHA/env) when neither is present. It was
 * extracted from the one call site that already got this right
 * (system-change-digest.readDeployIdentity), and every other surface now shares it.
 */

export type DeployStatus = "production" | "non-production" | "unknown";

/** The core 6-field identity (kept for the system-change-digest consumer). */
export interface DeployIdentity {
  sha: string | null;
  branch: string | null;
  env: string | null;
  source: "railway" | "vercel" | "none";
  status: DeployStatus;
  note: string;
}

/** The full deploy metadata that build/deploy-truth surfaces render. */
export interface DeployMeta extends DeployIdentity {
  shaShort: string | null;
  commitMessage: string | null;
  deploymentId: string | null;
  buildTime: string | null;
}

/**
 * Resolve full deploy metadata from an env bag. Pure given env. Railway first,
 * then Vercel, then an honest `unknown` — never asserts a deploy without a SHA.
 */
export function resolveDeployMeta(env: Record<string, string | undefined>): DeployMeta {
  // BUILD_TIME is stamped by next.config.ts on every platform; Vercel's
  // created-at is a fallback. Railway has no standard deploy-time env var.
  const buildTime = env.BUILD_TIME || env.VERCEL_DEPLOYMENT_CREATED_AT || null;

  const railSha = env.RAILWAY_GIT_COMMIT_SHA;
  if (railSha) {
    const envName = env.RAILWAY_ENVIRONMENT_NAME ?? env.RAILWAY_ENVIRONMENT ?? null;
    const isProd = (envName ?? "").toLowerCase() === "production";
    return {
      sha: railSha,
      shaShort: railSha.slice(0, 7),
      commitMessage: env.RAILWAY_GIT_COMMIT_MESSAGE ?? null,
      branch: env.RAILWAY_GIT_BRANCH ?? null,
      deploymentId: env.RAILWAY_DEPLOYMENT_ID ?? null,
      env: envName,
      buildTime,
      source: "railway",
      status: isProd ? "production" : "non-production",
      note: `Railway ${envName ?? "env"} @ ${railSha.slice(0, 7)}${env.RAILWAY_GIT_BRANCH ? ` (${env.RAILWAY_GIT_BRANCH})` : ""}.`,
    };
  }

  const vercelSha = env.VERCEL_GIT_COMMIT_SHA;
  if (vercelSha && vercelSha !== "dev") {
    const envName = env.VERCEL_ENV ?? null;
    const isProd = (envName ?? "").toLowerCase() === "production";
    return {
      sha: vercelSha,
      shaShort: vercelSha.slice(0, 7),
      commitMessage: env.VERCEL_GIT_COMMIT_MESSAGE ?? null,
      branch: env.VERCEL_GIT_COMMIT_REF ?? null,
      deploymentId: env.VERCEL_DEPLOYMENT_ID ?? null,
      env: envName,
      buildTime,
      source: "vercel",
      status: isProd ? "production" : "non-production",
      note: `Vercel ${envName ?? "env"} @ ${vercelSha.slice(0, 7)} (note: statenour prod is Railway — verify).`,
    };
  }

  return {
    sha: null,
    shaShort: null,
    commitMessage: null,
    branch: null,
    deploymentId: null,
    env: null,
    buildTime,
    source: "none",
    status: "unknown",
    note: "Deploy identity not available from this runtime (no RAILWAY_*/VERCEL_* env). Not asserting a deploy — verify on bdnick.info.",
  };
}

/** Full deploy metadata from the live process env. */
export function getDeployMeta(): DeployMeta {
  return resolveDeployMeta(process.env as Record<string, string | undefined>);
}

/** The core 6-field identity (subset of resolveDeployMeta) — used by system-change-digest. */
export function readDeployIdentity(env: Record<string, string | undefined>): DeployIdentity {
  const m = resolveDeployMeta(env);
  return { sha: m.sha, branch: m.branch, env: m.env, source: m.source, status: m.status, note: m.note };
}
