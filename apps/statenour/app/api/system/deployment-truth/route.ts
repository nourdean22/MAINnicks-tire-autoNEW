/**
 * GET /api/system/deployment-truth · v10 Track E.4 · Apr 30.
 *
 * One panel answering:
 *   "Is the deployed code, the live schema, and the env config
 *    actually in agreement right now?"
 *
 * Aggregates:
 *   1. Build · git SHA + commit msg + branch + deploy timestamp
 *      (via Vercel build env vars set by next.config.ts)
 *   2. Schema · runs the v8.6 sentinel against live Neon and
 *      summarizes drift findings
 *   3. Env · which secret-class env vars are configured (presence,
 *      not value); flags missing critical secrets
 *   4. NICK Prime · current NICK_PRIME_PROMPT mode (off/shadow/on)
 *   5. Cron health · 24h success rate, oldest stale cron
 *
 * Owner-gated. Cached 30s — composes 3 separate DB reads.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { runSchemaDriftCheck } from "@/lib/db/schema-sentinel";

interface SecretCheck {
  name: string;
  configured: boolean;
  /** Critical = system fails closed without it. */
  critical: boolean;
}

interface DeploymentTruthPayload {
  generatedAt: string;
  build: {
    sha: string;
    shaShort: string;
    commitMessage: string | null;
    branch: string;
    deploymentId: string | null;
    env: string;
    buildTime: string | null;
    serverTime: string;
  };
  schema: {
    ok: boolean;
    reachable: boolean;
    issuesFound: number;
    /** Top 5 drift findings for the panel; full list via /api/system/schema-drift */
    topIssues: Array<{
      severity: string;
      expectationTable: string;
      problem: string;
    }>;
  };
  env: {
    /** Per-secret presence flags. */
    checks: SecretCheck[];
    /** Critical secrets missing → counts toward red status. */
    missingCritical: number;
  };
  nickPrime: {
    mode: "off" | "shadow" | "on" | "unknown";
    description: string;
  };
  cron: {
    last24hRuns: number;
    last24hSuccess: number;
    last24hFailures: number;
    successRate: number;
    oldestStaleJob: { jobName: string; lastSeenAt: string | null } | null;
  };
  health: "green" | "yellow" | "red";
}

const SECRET_CHECKS: Array<Omit<SecretCheck, "configured">> = [
  { name: "DATABASE_URL", critical: true },
  { name: "VENICE_API_KEY", critical: true },
  { name: "OPENAI_API_KEY", critical: false },
  { name: "ANTHROPIC_API_KEY", critical: false },
  { name: "OLLAMA_API_KEY", critical: false },
  { name: "CRON_SECRET", critical: true },
  { name: "TELEGRAM_WEBHOOK_SECRET", critical: false },
  { name: "STATENOUR_SYNC_KEY", critical: false },
  { name: "MAKE_WEBHOOK_SECRET", critical: false },
  { name: "GITHUB_TOKEN", critical: false },
];

function detectPromptMode(): DeploymentTruthPayload["nickPrime"] {
  const v = (process.env.NICK_PRIME_PROMPT ?? "").toLowerCase();
  if (v === "1" || v === "on") {
    return { mode: "on", description: "v2 prompt is production default" };
  }
  if (v === "shadow") {
    return {
      mode: "shadow",
      description: "v1 serves; v2 builds in parallel for parity logging",
    };
  }
  if (v === "" || v === "0" || v === "off") {
    return { mode: "off", description: "v1 prompt is the only path" };
  }
  return { mode: "unknown", description: `unrecognized value: ${v}` };
}

export const GET = apiHandler(
  async () => {
    const payload = await cached(
      "system_deployment_truth",
      30,
      async (): Promise<DeploymentTruthPayload> => {
        const [drift, cronStats, oldestStale] = await Promise.all([
          runSchemaDriftCheck().catch(
            (err): Awaited<ReturnType<typeof runSchemaDriftCheck>> => ({
              ok: false,
              reachable: false,
              checkedAt: new Date().toISOString(),
              expectationCount: 0,
              findings: [
                {
                  severity: "high",
                  expectation: {
                    kind: "table" as never,
                    table: "<sentinel>",
                  } as never,
                  problem:
                    err instanceof Error
                      ? err.message.slice(0, 200)
                      : String(err),
                },
              ],
            }),
          ),
          // Cron 24h aggregate
          prisma.cronJobLog
            .groupBy({
              by: ["status"],
              where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } },
              _count: { _all: true },
            })
            .catch(
              () =>
                [] as Array<{ status: string; _count: { _all: number } }>,
            ),
          // Oldest job that hasn't run in >24h (potential stale)
          prisma.cronJobLog
            .groupBy({
              by: ["jobName"],
              _max: { createdAt: true },
            })
            .then((rows) => {
              const stale = rows
                .map((r) => ({
                  jobName: r.jobName,
                  lastSeenAt: r._max.createdAt?.toISOString() ?? null,
                  ageMs: r._max.createdAt
                    ? Date.now() - r._max.createdAt.getTime()
                    : Number.POSITIVE_INFINITY,
                }))
                .filter((r) => r.ageMs > 24 * 3_600_000)
                .sort((a, b) => b.ageMs - a.ageMs);
              return stale[0]
                ? { jobName: stale[0].jobName, lastSeenAt: stale[0].lastSeenAt }
                : null;
            })
            .catch(() => null),
        ]);

        const cronSuccess =
          cronStats.find((s) => s.status === "success")?._count._all ?? 0;
        const cronFailed =
          cronStats.find((s) => s.status === "failed")?._count._all ?? 0;
        const cronTotal = cronSuccess + cronFailed;
        const cronRate =
          cronTotal === 0 ? 100 : Math.round((cronSuccess / cronTotal) * 1000) / 10;

        const envChecks: SecretCheck[] = SECRET_CHECKS.map((s) => ({
          ...s,
          configured: !!process.env[s.name],
        }));
        const missingCritical = envChecks.filter(
          (c) => c.critical && !c.configured,
        ).length;

        const driftIssues = drift.findings.slice(0, 5).map((f) => ({
          severity: f.severity,
          expectationTable: f.expectation.table ?? "<unknown>",
          problem: f.problem,
        }));

        // Health roll-up
        let health: "green" | "yellow" | "red" = "green";
        const hasHighDrift = drift.findings.some((f) => f.severity === "high");
        if (missingCritical > 0 || (hasHighDrift && drift.findings.length > 0)) {
          health = "red";
        } else if (
          drift.findings.length > 0 ||
          cronFailed > 0 ||
          oldestStale != null
        ) {
          health = "yellow";
        }

        const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? "dev";
        const BUILD_TIME =
          process.env.BUILD_TIME ||
          process.env.VERCEL_DEPLOYMENT_CREATED_AT ||
          null;

        return {
          generatedAt: new Date().toISOString(),
          build: {
            sha,
            shaShort: sha.slice(0, 7),
            commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE
              ? process.env.VERCEL_GIT_COMMIT_MESSAGE.slice(0, 200)
              : null,
            branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
            deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
            env: process.env.VERCEL_ENV ?? "development",
            buildTime: BUILD_TIME,
            serverTime: new Date().toISOString(),
          },
          schema: {
            ok: drift.ok,
            reachable: drift.reachable,
            issuesFound: drift.findings.length,
            topIssues: driftIssues,
          },
          env: {
            checks: envChecks,
            missingCritical,
          },
          nickPrime: detectPromptMode(),
          cron: {
            last24hRuns: cronTotal,
            last24hSuccess: cronSuccess,
            last24hFailures: cronFailed,
            successRate: cronRate,
            oldestStaleJob: oldestStale,
          },
          health,
        };
      },
    );

    return payload;
  },
  { auth: "owner" }, // sensitive — exposes build SHA + env presence + drift
);
