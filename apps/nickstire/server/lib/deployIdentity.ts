/**
 * Deployment identity for nickstire — what commit is ACTUALLY serving traffic.
 *
 * `/api/version` used to answer `{ status: "ok", uptime: N }`, which cannot
 * answer the only question the endpoint exists for: "is the thing I just merged
 * the thing that is live?" Uptime tells you the process restarted, not what it
 * restarted INTO.
 *
 * Modelled on statenour's `lib/services/deploy-identity.ts`, including the rule
 * its docstring was written to enforce: **never fabricate**. That module exists
 * because deploy surfaces read Vercel-only env vars Railway never injects and
 * so printed the literals "dev" / "local" — a deployment-truth page lying about
 * what was live. When the SHA is absent, this returns null and says `unknown`.
 *
 * Pure given env, so it is testable without a server.
 */

export type DeploySource = "railway" | "explicit" | "none";

export interface NickDeployIdentity {
  /** Full commit SHA, or null when the platform did not inject one. */
  commit: string | null;
  /** First 9 chars of `commit`, or null. Never a fabricated placeholder. */
  commitShort: string | null;
  branch: string | null;
  environment: string | null;
  deploymentId: string | null;
  source: DeploySource;
  /** Explicitly `unknown` when no SHA is resolvable — never guessed. */
  status: "identified" | "unknown";
  note: string;
}

export function resolveNickDeployIdentity(
  env: Record<string, string | undefined>,
): NickDeployIdentity {
  // Railway is the deploy platform (see docs/CURRENT-TRUTH.md). GIT_SHA /
  // COMMIT_SHA are the manual escape hatch for local or non-Railway builds.
  const railwaySha = env.RAILWAY_GIT_COMMIT_SHA?.trim() || null;
  const explicitSha = (env.GIT_SHA || env.COMMIT_SHA)?.trim() || null;

  const commit = railwaySha || explicitSha;
  const source: DeploySource = railwaySha ? "railway" : explicitSha ? "explicit" : "none";

  return {
    commit,
    commitShort: commit ? commit.slice(0, 9) : null,
    branch: env.RAILWAY_GIT_BRANCH?.trim() || null,
    environment: env.RAILWAY_ENVIRONMENT_NAME?.trim() || env.RAILWAY_ENVIRONMENT?.trim() || env.NODE_ENV?.trim() || null,
    deploymentId: env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    source,
    status: commit ? "identified" : "unknown",
    note: commit
      ? `commit resolved from ${source === "railway" ? "RAILWAY_GIT_COMMIT_SHA" : "GIT_SHA/COMMIT_SHA"}`
      : "no commit SHA in env — cannot identify the running build (set GIT_SHA for non-Railway builds)",
  };
}

/**
 * Whether a capability is CONFIGURED. Deliberately not whether it WORKS.
 *
 * /api/version answers identity; /api/health owns liveness probes. Keeping them
 * apart means this endpoint stays fast and cannot fail, and — more importantly —
 * it never reports a presence check as if it were a functional one, which is the
 * mistake `openaiHealthy: aiKeyPresent` made in health.ts.
 */
export function resolveConfiguredSurfaces(
  env: Record<string, string | undefined>,
): Record<string, boolean> {
  return {
    database: Boolean(env.DATABASE_URL),
    objectStorage: Boolean(env.S3_BUCKET),
    sentry: Boolean(env.SENTRY_DSN),
    voice: Boolean(env.VAPI_API_KEY),
    shopSmsGateway: Boolean(env.SHOP_SMS_GATEWAY_URL),
    telegramAlerts: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  };
}
