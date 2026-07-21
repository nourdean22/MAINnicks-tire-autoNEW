/**
 * Nightly system-health digest — push, not pull.
 *
 * The /system/diagnostics page is GREAT when Nour remembers to open
 * it. This cron runs every night at 4am and writes a compact health
 * summary to BrainMemory(category=BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST), which HQ
 * then surfaces as a card on the morning view.
 *
 * Principle: silent degradation is the enemy. If Drive hasn't ingested
 * in 7 days, if 18 crons have drifted, if AI error rate is climbing —
 * Nour should see those flagged in his morning briefing automatically,
 * not only when he happens to run a probe.
 *
 * Output shape (stored as JSON in BrainMemory.content):
 *   {
 *     generatedAt: ISO,
 *     overall: 'healthy' | 'warning' | 'critical',
 *     counts: { critical, warning, healthy },
 *     highlights: string[]   // 3-5 short bullet points, most urgent first
 *     stats: { ... extra detail for deep-dive }
 *   }
 */

import { scanCronHealth } from "@/lib/system/cron-diagnostics";
import { getDeployMeta } from "@/lib/services/deploy-identity";
import { scanStaleData } from "@/lib/system/stale-data-scanner";
import { prisma } from "@/lib/prisma";
import { safeQuery } from "@/lib/db/safe-prisma";
import {
  getGoogleOauthStatus,
  type GoogleOauthStatus,
} from "@/lib/services/google-oauth";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export type HealthOverall = "healthy" | "warning" | "critical";

export interface SystemHealthDigest {
  generatedAt: string;
  overall: HealthOverall;
  counts: {
    critical: number;
    warning: number;
    healthy: number;
  };
  highlights: Array<{
    severity: "critical" | "warning" | "info";
    headline: string;
    link?: string;
  }>;
  stats: {
    cronsDeclared: number;
    cronsSilent: number;
    cronLogRows48h: number;
    staleRows: number;
    googleOauth: boolean;
    envReady: number;
    envTotal: number;
    /** v10.0.88 — what code generated this digest. Pulled from
     *  Vercel build env. Lets the operator see "this digest was
     *  written by SHA X · deployed Yh ago" without leaving the
     *  page. Null in dev (no Vercel env set). */
    deploy?: {
      sha: string | null;
      shortSha: string | null;
      branch: string | null;
      env: string | null;
      deployedAt: string | null;
    };
  };
  /**
   * Day-over-day delta against yesterday's digest. null when no
   * prior digest exists (fresh install or cron hasn't run 2x yet).
   * Positive deltas mean DEGRADATION (more silent crons, more stale,
   * more critical signals); negative means improvement. Signs chosen
   * so "red" direction == positive, matching the trend-arrow UX.
   */
  trend?: {
    priorDate: string; // YYYY-MM-DD
    criticalDelta: number;
    warningDelta: number;
    silentCronsDelta: number;
    staleRowsDelta: number;
    overallDirection: "improving" | "degrading" | "stable";
  } | null;
}

interface EnvGroups {
  [group: string]: { configured?: boolean };
}

/**
 * Collect deploy provenance. truth-substrate audit P0 (#11/#14): sourced from
 * the canonical getDeployMeta() (Railway-first, then Vercel), replacing the old
 * Vercel-only reads that returned null on Railway prod. Returns null fields only
 * when neither platform's env is present (genuine local dev).
 */
function collectDeployInfo(): SystemHealthDigest["stats"]["deploy"] {
  const m = getDeployMeta();
  return {
    sha: m.sha,
    shortSha: m.shaShort,
    branch: m.branch,
    env: m.env,
    deployedAt: m.buildTime,
  };
}

export async function computeHealthDigest(): Promise<SystemHealthDigest> {
  const [cron, stale, env, googleStatus, slowRoutes] = await Promise.all([
    scanCronHealth().catch(() => null),
    scanStaleData().catch(() => null),
    computeEnvReadiness().catch(() => null),
    getGoogleOauthStatus().catch(
      (): GoogleOauthStatus => ({
        state: "missing",
        lastSyncAt: null,
        consecutiveFailures: 0,
        email: null,
        reason: "OAuth status probe failed",
      }),
    ),
    countSlowRoutes24h().catch(() => 0),
  ]);
  const googleOauth = googleStatus.state === "healthy";

  const highlights: SystemHealthDigest["highlights"] = [];

  // ── Critical signals (urgent, push to top) ──
  if (cron && cron.diagnoses) {
    for (const d of cron.diagnoses.filter((d) => d.severity === "critical").slice(0, 2)) {
      highlights.push({
        severity: "critical",
        headline: d.headline,
        link: "/system/health",
      });
    }
  }

  // Google OAuth — emit different headlines based on the actual
  // failure mode so the operator can act without diagnosing first.
  // "expired" + "missing" both kill the 3 ingest crons hard, so
  // they're critical. "stale" is a warning — the token works but
  // ingest hasn't been writing rows lately, which is a different
  // class of problem (cron drift / disabled cron / API quota).
  if (googleStatus.state === "missing") {
    highlights.push({
      severity: "critical",
      headline:
        "Google OAuth not configured — Drive/Gmail/Calendar ingest disabled",
      link: "/api/oauth/google-data/start",
    });
  } else if (googleStatus.state === "expired") {
    highlights.push({
      severity: "critical",
      headline:
        googleStatus.consecutiveFailures > 0
          ? `Google OAuth expired (${googleStatus.consecutiveFailures}× refresh failures) — re-grant access`
          : "Google OAuth expired — re-grant Drive/Gmail/Calendar access",
      link: "/api/oauth/google-data/start",
    });
  } else if (googleStatus.state === "stale") {
    highlights.push({
      severity: "warning",
      headline: googleStatus.reason,
      link: "/system/health",
    });
  }

  // ── Warning signals ──
  if (cron && cron.summary.silentDeclaredCrons > 0) {
    highlights.push({
      severity: "warning",
      headline: `${cron.summary.silentDeclaredCrons} crons silent in last 48h`,
      link: "/system/cron-diagnostics",
    });
  }

  if (cron && cron.summary.killedIndividually > 0) {
    highlights.push({
      severity: "warning",
      headline: `${cron.summary.killedIndividually} cron${cron.summary.killedIndividually === 1 ? "" : "s"} manually disabled`,
      link: "/system/cron-diagnostics",
    });
  }

  if (stale && stale.totalStaleRows > 50) {
    highlights.push({
      severity: "warning",
      headline: `${stale.totalStaleRows} stale rows accumulating across ${stale.categories.filter((c) => c.count > 0).length} categories`,
      link: "/system/stale",
    });
  }

  if (env && env.total - env.ready > 2) {
    highlights.push({
      severity: "warning",
      headline: `${env.total - env.ready} env groups not configured`,
      link: "/system/health",
    });
  }

  if (slowRoutes > 0) {
    highlights.push({
      severity: "warning",
      headline: `${slowRoutes} route${slowRoutes === 1 ? "" : "s"} slow (p95 > 2s, last 24h)`,
      link: "/system/performance",
    });
  }

  const criticalCount = highlights.filter((h) => h.severity === "critical").length;
  const warningCount = highlights.filter((h) => h.severity === "warning").length;

  const overall: HealthOverall =
    criticalCount > 0 ? "critical" : warningCount > 0 ? "warning" : "healthy";

  // If everything is clean, add a positive highlight so the digest has
  // SOMETHING to show rather than an empty list. "Alive and dynamic."
  if (highlights.length === 0) {
    highlights.push({
      severity: "info",
      headline: "All diagnostics healthy",
    });
  }

  const digest: SystemHealthDigest = {
    generatedAt: new Date().toISOString(),
    overall,
    counts: {
      critical: criticalCount,
      warning: warningCount,
      healthy: 6 - criticalCount - warningCount, // 6 probes total
    },
    highlights: highlights.slice(0, 5),
    stats: {
      cronsDeclared: cron?.summary.declaredActiveCrons ?? 0,
      cronsSilent: cron?.summary.silentDeclaredCrons ?? 0,
      cronLogRows48h: cron?.summary.totalLogRowsLast48h ?? 0,
      staleRows: stale?.totalStaleRows ?? 0,
      googleOauth,
      envReady: env?.ready ?? 0,
      envTotal: env?.total ?? 0,
      deploy: collectDeployInfo(),
    },
  };

  // Trend detection — compare to yesterday's digest.
  digest.trend = await computeTrend(digest).catch(() => null);

  return digest;
}

async function computeTrend(
  current: SystemHealthDigest,
): Promise<SystemHealthDigest["trend"]> {
  // Pull the most-recent digest strictly BEFORE today. Because digests
  // are keyed by YYYY-MM-DD, ordering by createdAt desc gives us the
  // latest prior run — usually yesterday, but might be 2+ days ago if
  // the cron missed a beat.
  //
  // Guard: require ≥2 prior digests before emitting a trend. A single
  // prior data point makes noisy "degrading"/"improving" signals
  // against a fabricated baseline (especially on days 1-2 post-deploy).
  // Three data points (today + 2 prior) is the minimum for a trend to
  // be meaningfully directional rather than a single-comparison delta.
  const todayKey = current.generatedAt.slice(0, 10);
  const priorRows = await safeQuery(
    () =>
      prisma.brainMemory.findMany({
        where: {
          category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST,
          key: { lt: todayKey },
        },
        orderBy: { key: "desc" },
        take: 2,
        select: { key: true, content: true },
      }),
    [] as Array<{ key: string; content: string }>,
    { label: "health-digest.trend" },
  );
  if (priorRows.length < 2) return null; // not enough history
  const prior = priorRows[0];
  if (!prior?.content) return null;

  try {
    const priorDigest = JSON.parse(prior.content) as SystemHealthDigest;
    const criticalDelta =
      current.counts.critical - priorDigest.counts.critical;
    const warningDelta =
      current.counts.warning - priorDigest.counts.warning;
    const silentCronsDelta =
      current.stats.cronsSilent - priorDigest.stats.cronsSilent;
    const staleRowsDelta =
      current.stats.staleRows - priorDigest.stats.staleRows;

    // Overall direction: positive deltas == degrading, negative ==
    // improving. Sum of weighted deltas gives the headline signal.
    // Critical delta weighs 3x, warning 2x, others 1x.
    const weightedDelta =
      criticalDelta * 3 +
      warningDelta * 2 +
      silentCronsDelta +
      Math.sign(staleRowsDelta) * Math.min(2, Math.abs(staleRowsDelta) / 50);

    const direction: "improving" | "degrading" | "stable" =
      weightedDelta > 0
        ? "degrading"
        : weightedDelta < 0
          ? "improving"
          : "stable";

    return {
      priorDate: prior.key,
      criticalDelta,
      warningDelta,
      silentCronsDelta,
      staleRowsDelta,
      overallDirection: direction,
    };
  } catch {
    return null;
  }
}

/**
 * Count USER-FACING routes whose p95 latency exceeded 2s in the last
 * 24h. Used to surface slow-route drift as a warning on the morning
 * digest. Uses percentile_cont + HAVING so Postgres does the heavy
 * lifting.
 *
 * Excludes /api/cron/* explicitly — cron AI routes (embed-backfill,
 * think, brain-cycle, provider-ping) routinely take 3-40s by design
 * and aren't user-facing. Cron performance has its own dashboard at
 * /system/cron-runs/[jobName] with per-job p50/p95 spark-lines. The
 * pre-fix flagged 4 cron routes as "slow" daily even though their
 * latency was expected — pure noise on the digest.
 *
 * Also excludes /api/ai/* heavy generation routes (chat streaming,
 * strategy-daily, strategy-analyze) where >2s is normal for the
 * complete-token-stream lifecycle. The user-facing "perceived"
 * latency for those is TTFT (first-token-latency), tracked separately
 * on ChatMessage.firstTokenLatencyMs (v7.6).
 */
async function countSlowRoutes24h(): Promise<number> {
  const rows = await safeQuery(
    () =>
      prisma.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*)::bigint AS c FROM (
          SELECT path FROM api_request_logs
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND path NOT LIKE '/api/cron/%'
            AND path NOT LIKE '/api/ai/chat%'
            AND path NOT LIKE '/api/ai/strategy/%'
            AND path NOT LIKE '/api/ai/assist%'
            AND path NOT LIKE '/api/images/%'
            -- /api/system/crons/run is a thin shim that fires a cron;
            -- its p95 is the cron's p95, already covered above. Manual
            -- fires from /system/crons "Run Now" button only.
            AND path != '/api/system/crons/run'
          GROUP BY path, method
          HAVING COUNT(*) >= 5
             AND percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) > 2000
        ) s
      `,
    [{ c: BigInt(0) }] as Array<{ c: bigint }>,
    { label: "health-digest.slow-routes" },
  );
  return Number(rows?.[0]?.c ?? 0);
}

async function computeEnvReadiness(): Promise<{ ready: number; total: number }> {
  // Inline rollup: count how many of the `summary.ready` booleans in
  // env-check are true. Avoids cross-endpoint call from a cron.
  //
  // Only REQUIRED groups count toward the warning. browserbase +
  // vercel_rollback are operator-tier optional integrations (browser
  // automation + auto-rollback button on /system/power) — leaving
  // them unset is a deliberate choice, not a problem to flag daily.
  const has = (k: string): boolean => {
    const v = process.env[k];
    return typeof v === "string" && v.trim().length > 0;
  };
  const required = {
    push: has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY"),
    gemini: has("GEMINI_API_KEY") || has("GOOGLE_GENERATIVE_AI_API_KEY"),
    crons: has("CRON_SECRET"),
    google_data:
      (has("AUTH_GOOGLE_CLIENT_ID") ||
        has("GOOGLE_OAUTH_CLIENT_ID") ||
        has("GOOGLE_CLIENT_ID")) &&
      (has("AUTH_GOOGLE_CLIENT_SECRET") ||
        has("GOOGLE_OAUTH_CLIENT_SECRET") ||
        has("GOOGLE_CLIENT_SECRET")),
  };
  const vals = Object.values(required);
  return {
    ready: vals.filter(Boolean).length,
    total: vals.length,
  };
}

/**
 * Persist the digest to BrainMemory so HQ can render it on the
 * morning view. Uses category=BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST + key=date so
 * re-runs on the same day upsert cleanly.
 */
export async function persistHealthDigest(
  digest: SystemHealthDigest,
): Promise<void> {
  const dateKey = digest.generatedAt.slice(0, 10);
  await safeQuery(
    () =>
      prisma.brainMemory.upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST, key: dateKey } },
        create: {
          category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST,
          key: dateKey,
          content: JSON.stringify(digest),
          confidence: 1.0,
          source: "cron:health-digest",
          expiresAt: new Date(Date.now() + 30 * 86400_000),
        },
        update: {
          content: JSON.stringify(digest),
          lastSeen: new Date(),
        },
      }),
    null,
    { label: "health-digest.persist" },
  );
}

/**
 * Recompute the digest live + persist it (fire-and-forget) and return
 * the fresh result. This is the "force a fresh digest now" path the
 * SystemHealthCard's manual-refresh button triggers.
 *
 * Phase B.6a (2026-05-22) · extracted from the route-local
 * `recomputeAndPersist` helper in app/api/ultron/health-digest/route.ts
 * so BOTH the legacy REST POST AND the new `operator.refreshHealthDigest`
 * tRPC mutation call the SAME function · drift impossible.
 */
export async function refreshHealthDigest(): Promise<SystemHealthDigest> {
  const fresh = await computeHealthDigest();
  // Persist is fire-and-forget — we return fresh either way.
  persistHealthDigest(fresh).catch(() => {
    /* nightly cron will retry */
  });
  return fresh;
}

/**
 * Read the latest persisted digest. Used by HQ to render the card.
 * Returns null if no digest has been written yet (fresh install OR
 * cron hasn't run since feature shipped).
 */
export async function loadLatestHealthDigest(): Promise<SystemHealthDigest | null> {
  const row = await safeQuery(
    () =>
      prisma.brainMemory.findFirst({
        where: { category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST },
        orderBy: { createdAt: "desc" },
        select: { content: true, createdAt: true },
      }),
    null,
    { label: "health-digest.load" },
  );
  if (!row) return null;
  try {
    return JSON.parse(row.content) as SystemHealthDigest;
  } catch {
    return null;
  }
}
