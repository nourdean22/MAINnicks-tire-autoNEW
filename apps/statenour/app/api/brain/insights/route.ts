/**
 * GET /api/brain/insights · v10.0.218 · narrative ribbon.
 *
 * Cross-system PATTERN signals (week-over-week trends), distinct
 * from /api/brain/nudges which surfaces actionable now-deltas.
 *
 * Insights are storytelling, not directives:
 *   · "3 critical anti-patterns added · vs 1 prior · learning sprint"
 *   · "captures category +47% · 38 → 56 · emerging theme"
 *   · "reflection gap 11d · usual cadence 4d · overdue"
 *   · "decisions logged 7 · 7d avg 4 · momentum sharp"
 *   · "tech domain · 4 anti-patterns revisited this week"
 *
 * Each insight returns the raw metric + delta + a severity hint so
 * the UI can color-code without re-doing the math.
 *
 * Auth: owner only.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export interface BrainInsight {
  kind:
    | "anti_pattern_sprint"
    | "category_growth"
    | "reflection_gap"
    | "decision_velocity"
    | "domain_clustering"
    | "decision_grade_trend"
    | "cron_failure_trend";
  /** Tiny-caps section label · always uppercase tracked. */
  eyebrow: string;
  /** The pop number (or short string). Renders large. */
  headline: string;
  /** Supporting clause · "vs N prior · learning sprint". */
  supporting: string;
  /** Numeric metric for sorting + sparkline if available. */
  metric: number;
  /** Optional percent delta vs prior period. */
  deltaPct?: number;
  /** Heuristic emphasis · drives tone in the UI. */
  severity: "info" | "warn" | "highlight";
  /** Optional click-through. */
  link?: string;
}

export const GET = apiHandler(
  async () => {
    const now = Date.now();
    const week = 7 * 86400_000;
    const recentSince = new Date(now - week);
    const priorSince = new Date(now - 2 * week);

    const insights: BrainInsight[] = [];

    // ── 1. Anti-pattern sprint ─────────────────────────────────────
    // Critical/warn anti-patterns added in the last 7 days vs prior 7.
    // High recent count = "operator is in a learning sprint" — when
    // someone is logging more lessons it usually means they're actively
    // confronting a tough problem space. Worth surfacing.
    const apRecent = await prisma.brainMemory.count({
      where: {
        category: "anti_pattern",
        deletedAt: null,
        createdAt: { gte: recentSince },
      },
    });
    const apPrior = await prisma.brainMemory.count({
      where: {
        category: "anti_pattern",
        deletedAt: null,
        createdAt: { gte: priorSince, lt: recentSince },
      },
    });
    if (apRecent > 0) {
      const delta = apPrior > 0 ? Math.round(((apRecent - apPrior) / apPrior) * 100) : null;
      const sprint = apRecent >= 3 && (apPrior === 0 || apRecent > apPrior * 1.5);
      insights.push({
        kind: "anti_pattern_sprint",
        eyebrow: "this week",
        headline: `${apRecent} lesson${apRecent === 1 ? "" : "s"} logged`,
        supporting: sprint
          ? `vs ${apPrior} prior · learning sprint`
          : delta != null
            ? `vs ${apPrior} prior · ${delta >= 0 ? "+" : ""}${delta}%`
            : `first week with lessons`,
        metric: apRecent,
        deltaPct: delta ?? undefined,
        severity: sprint ? "highlight" : "info",
        link: "/system/anti-patterns",
      });
    }

    // ── 2. Category growth ─────────────────────────────────────────
    // Top brain-memory category by recent-vs-prior count growth. The
    // category whose recent count grew the MOST relative to its prior
    // is the emerging theme. Skip categories with < 3 prior or < 5
    // recent so we don't celebrate noise.
    //
    // Bot-fed categories (cron-driven telemetry / industry pulls /
    // provider pings) are excluded — they grow with the cron schedule
    // not the operator's attention, so surfacing their growth as an
    // "emerging theme" would be a lie. The list is conservative; add
    // here if a new category gets added that's also non-felt.
    const NOISE_CATEGORIES = new Set([
      "industry_intel",
      "provider_ping",
      "tool_telemetry",
      "telemetry_tool_verb",
      "telemetry_temporal_warn",
      "autonomous_event",
      "semantic_edge",
      "chat_summary",
      "nick_quality",
      "nick_advice",
      "tool_embedding",
      "page_visit",
      "score_logged",
    ]);
    const noiseList = `(${[...NOISE_CATEGORIES].map((c) => `'${c}'`).join(",")})`;
    const recentByCat = await prisma.$queryRawUnsafe<Array<{ c: string; n: number }>>(`
      SELECT category::text AS c, COUNT(*)::int AS n
      FROM brain_memories
      WHERE deleted_at IS NULL
        AND created_at >= NOW() - INTERVAL '7 days'
        AND category NOT IN ${noiseList}
      GROUP BY category
    `);
    const priorByCat = await prisma.$queryRawUnsafe<Array<{ c: string; n: number }>>(`
      SELECT category::text AS c, COUNT(*)::int AS n
      FROM brain_memories
      WHERE deleted_at IS NULL
        AND created_at >= NOW() - INTERVAL '14 days'
        AND created_at < NOW() - INTERVAL '7 days'
        AND category NOT IN ${noiseList}
      GROUP BY category
    `);
    const priorMap = new Map(priorByCat.map((r) => [r.c, Number(r.n)]));
    let topGrower: { c: string; recent: number; prior: number; growth: number } | null = null;
    for (const r of recentByCat) {
      const recent = Number(r.n);
      if (recent < 5) continue;
      const prior = priorMap.get(r.c) ?? 0;
      if (prior < 3) continue; // not enough baseline to claim growth
      const growth = (recent - prior) / prior;
      if (growth > 0.25 && (topGrower === null || growth > topGrower.growth)) {
        topGrower = { c: r.c, recent, prior, growth };
      }
    }
    if (topGrower) {
      insights.push({
        kind: "category_growth",
        eyebrow: "emerging theme",
        headline: topGrower.c.replace(/_/g, " "),
        supporting: `${topGrower.prior} → ${topGrower.recent} (+${Math.round(topGrower.growth * 100)}%) · 7d vs prior 7d`,
        metric: topGrower.recent,
        deltaPct: Math.round(topGrower.growth * 100),
        severity: topGrower.growth > 1 ? "highlight" : "info",
      });
    }

    // ── 3. Reflection gap ──────────────────────────────────────────
    // How long since the most recent reflection vs the median gap
    // between reflections in the last 30. If the current gap is more
    // than 2× median, surface it.
    const recentReflections = await prisma.reflection.findMany({
      where: { createdAt: { gte: new Date(now - 30 * 86400_000) } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { createdAt: true },
    });
    if (recentReflections.length >= 3) {
      const latest = recentReflections[0].createdAt.getTime();
      const gapHoursNow = Math.round((now - latest) / 3600_000);
      const gapDaysNow = Math.round(gapHoursNow / 24);
      // Median of consecutive gaps
      const gaps: number[] = [];
      for (let i = 1; i < recentReflections.length; i++) {
        gaps.push(
          (recentReflections[i - 1].createdAt.getTime() -
            recentReflections[i].createdAt.getTime()) / 86400_000,
        );
      }
      gaps.sort((a, b) => a - b);
      const medianGap = gaps[Math.floor(gaps.length / 2)];
      const overdue = gapDaysNow > medianGap * 2 && gapDaysNow >= 3;
      insights.push({
        kind: "reflection_gap",
        eyebrow: "reflection",
        headline: `${gapDaysNow}d since last`,
        supporting: overdue
          ? `usual cadence ${medianGap.toFixed(1)}d · overdue`
          : `usual cadence ${medianGap.toFixed(1)}d · on rhythm`,
        metric: gapDaysNow,
        severity: overdue ? "warn" : "info",
        link: "/journal",
      });
    }

    // ── 4. Decision velocity ───────────────────────────────────────
    // MasteryDecision rows in last 7d vs prior 7d. The "logged
    // decision" is the canonical operator artifact — counting them
    // tracks deliberate-mode vs autopilot-mode.
    const decRecent = await prisma.masteryDecision.count({
      where: { createdAt: { gte: recentSince } },
    });
    const decPrior = await prisma.masteryDecision.count({
      where: { createdAt: { gte: priorSince, lt: recentSince } },
    });
    if (decRecent > 0 || decPrior > 0) {
      const delta = decPrior > 0 ? Math.round(((decRecent - decPrior) / decPrior) * 100) : null;
      const sharp = decRecent >= 3 && decRecent > decPrior * 1.3;
      insights.push({
        kind: "decision_velocity",
        eyebrow: "decisions",
        headline: `${decRecent} this week`,
        supporting: delta != null
          ? `vs ${decPrior} prior${sharp ? " · momentum sharp" : ""}`
          : `first deliberate week`,
        metric: decRecent,
        deltaPct: delta ?? undefined,
        severity: sharp ? "highlight" : "info",
      });
    }

    // ── 5. Anti-pattern domain clustering ──────────────────────────
    // Which domain absorbed the most anti-pattern revisits in the last
    // 7d? Repeated revisits in one domain = structural problem worth
    // surfacing — not generic "12 revisits" but "tech: 4 revisits."
    const revisitsByDomain = await prisma.$queryRawUnsafe<
      Array<{ d: string; n: number }>
    >(`
      SELECT (metadata->>'domain')::text AS d, COUNT(*)::int AS n
      FROM brain_memories
      WHERE category = 'anti_pattern'
        AND deleted_at IS NULL
        AND metadata->>'lastRevisitedAt' IS NOT NULL
        AND (metadata->>'lastRevisitedAt')::timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY metadata->>'domain'
      HAVING COUNT(*) >= 2
      ORDER BY n DESC
      LIMIT 1
    `);
    if (revisitsByDomain.length > 0) {
      const r = revisitsByDomain[0];
      insights.push({
        kind: "domain_clustering",
        eyebrow: "domain cluster",
        headline: `${r.d ?? "unknown"} · ${r.n} revisits`,
        supporting: "structural pattern · same domain repeating",
        metric: Number(r.n),
        severity: Number(r.n) >= 4 ? "warn" : "info",
        link: `/system/anti-patterns`,
      });
    }

    // ── 6. Decision grade trend ─────────────────────────────────
    // Compares avg grade of decisions reviewed in the last 7d to
    // those reviewed in the prior 7d. Surfaces "calibration is
    // tightening" or "predictions are slipping" — the kind of
    // self-knowledge that's invisible without aggregation.
    const gradeNumeric: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    const recentReviewed = await prisma.masteryDecision.findMany({
      where: {
        deletedAt: null,
        grade: { not: null },
        updatedAt: { gte: recentSince },
      },
      select: { grade: true },
    });
    const priorReviewed = await prisma.masteryDecision.findMany({
      where: {
        deletedAt: null,
        grade: { not: null },
        updatedAt: { gte: priorSince, lt: recentSince },
      },
      select: { grade: true },
    });
    const avg = (rows: Array<{ grade: string | null }>) => {
      if (rows.length === 0) return null;
      const sum = rows.reduce(
        (s, r) => s + (gradeNumeric[(r.grade ?? "F").toUpperCase().charAt(0)] ?? 0),
        0,
      );
      return sum / rows.length;
    };
    const recentAvg = avg(recentReviewed);
    const priorAvg = avg(priorReviewed);
    if (recentAvg !== null && priorAvg !== null && recentReviewed.length >= 2) {
      const delta = recentAvg - priorAvg;
      const sharp = Math.abs(delta) >= 0.5;
      insights.push({
        kind: "decision_grade_trend",
        eyebrow: "calibration",
        headline:
          delta > 0
            ? `${recentAvg.toFixed(1)} avg · sharper`
            : delta < 0
              ? `${recentAvg.toFixed(1)} avg · slipping`
              : `${recentAvg.toFixed(1)} avg · steady`,
        supporting: `${recentReviewed.length} reviewed · prior ${priorAvg.toFixed(1)} (${priorReviewed.length})`,
        metric: recentAvg,
        deltaPct: priorAvg !== 0 ? Math.round((delta / priorAvg) * 100) : undefined,
        severity: sharp && delta > 0 ? "highlight" : sharp && delta < 0 ? "warn" : "info",
        link: "/system/decision-drift",
      });
    }

    // ── 7. Cron failure trend ───────────────────────────────────
    // Total cron failures last 7d vs prior 7d. A spike here means
    // something structural broke (deploy regression, env drift,
    // rate-limit cascade). Worth elevating.
    const recentCronFails = await prisma.cronJobLog.count({
      where: { status: { not: "success" }, createdAt: { gte: recentSince } },
    });
    const priorCronFails = await prisma.cronJobLog.count({
      where: { status: { not: "success" }, createdAt: { gte: priorSince, lt: recentSince } },
    });
    if (recentCronFails > 0 || priorCronFails > 0) {
      const delta = recentCronFails - priorCronFails;
      const spiking = recentCronFails > priorCronFails * 1.5 && recentCronFails >= 5;
      insights.push({
        kind: "cron_failure_trend",
        eyebrow: "cron health",
        headline:
          delta > 0
            ? `${recentCronFails} fails · ↑${delta}`
            : delta < 0
              ? `${recentCronFails} fails · ↓${Math.abs(delta)}`
              : `${recentCronFails} fails · flat`,
        supporting: spiking
          ? "spiking · likely structural — check deploys"
          : `vs ${priorCronFails} prior · ${recentCronFails === 0 ? "all green" : "watch"}`,
        metric: recentCronFails,
        severity: spiking ? "warn" : recentCronFails === 0 && priorCronFails > 0 ? "highlight" : "info",
        link: "/system/health",
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      insights,
    };
  },
  { auth: "owner" },
);
