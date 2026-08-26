import { apiHandler } from "@/lib/utils/http";
import { getDeployMeta } from "@/lib/services/deploy-identity";

/**
 * GET /api/version — what commit is ACTUALLY serving bdnick.info.
 *
 * WHY THIS EXISTS. On 2026-08-25 an audit produced a merged-vs-deployed table
 * for both web apps and could fill in only one of them. nickstire answers this
 * question in one unauthenticated request (`/api/version` -> a full SHA that
 * matched origin/main exactly). statenour answered HTTP 401 on `/api/health`,
 * `/api/version`, `/api/ping`, `/api/system/hub` and 307 on `/`, so "merged"
 * and "deployed" stayed different claims for half the estate — and SHAs had
 * been reported to the operator all day as though they were delivery.
 *
 * `lib/services/deploy-identity.ts` already resolved this correctly and had for
 * a month; it was consumed only by internal, session-gated system pages. The
 * resolver was never the missing piece. The unauthenticated SURFACE was.
 *
 * WHY IT IS SAFE TO EXPOSE. Three deliberate limits, matching the shape
 * nickstire's `server/_core/index.ts` settled on:
 *   · identity only — commit, branch, environment, deployment id. A commit SHA
 *     is not a credential, and without one the endpoint is useless.
 *   · `configured` is BOOLEANS ONLY. Never a value, and never whether the
 *     surface WORKS — that is a probe, it belongs to /api/system/health, and
 *     conflating the two is how `openaiHealthy: aiKeyPresent` came to report a
 *     presence check as a functional one.
 *   · commitMessage is deliberately OMITTED even though resolveDeployMeta
 *     returns it. It adds nothing to "is my merge live" and is the one field in
 *     the bag that carries free prose from a private repo.
 *
 * NO DATABASE, NO AWAIT ON ANYTHING FALLIBLE. A version endpoint that can fail
 * cannot answer the question you ask it when things are failing. Liveness is
 * /api/system/heartbeat's job.
 *
 * Session-exempt via PUBLIC_EXACT in lib/security/route-policy.ts — EXACT, not
 * a prefix, so it cannot also exempt `/api/versions` or a future
 * `/api/version/<anything>`. Canaried in tests/security/route-policy.test.ts.
 */
export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const m = getDeployMeta();
  const env = process.env;

  return {
    service: "statenour",
    status: "ok",
    uptime: Math.round(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    build: {
      commit: m.sha,
      commitShort: m.shaShort,
      branch: m.branch,
      environment: m.env,
      deploymentId: m.deploymentId,
      buildTime: m.buildTime,
      source: m.source,
      // "unknown" when no SHA is resolvable — never a fabricated one. This is
      // the rule deploy-identity.ts was extracted to enforce after prod
      // surfaces printed the literals "dev"/"local" off Vercel-only env vars.
      status: m.status === "unknown" ? "unknown" : "identified",
      note: m.note,
    },
    configured: {
      database: Boolean(env.DATABASE_URL),
      ai: Boolean(env.OPENAI_API_KEY || env.AI_GATEWAY_API_KEY),
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      langfuse: Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY),
      sentry: Boolean(env.SENTRY_DSN || env.NEXT_PUBLIC_SENTRY_DSN),
      cron: Boolean(env.CRON_SECRET),
    },
  };
});
