import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/weekly-digest");

import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
export const maxDuration = 60;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  return key ? new Resend(key) : null;
}

function getWeekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return toDateString(d);
}

// AG-03 · Monday-anchored week starts, matching the key format
// (`weekly:<monday>`) that /api/cron/weekly-review writes. Returns
// [thisMonday, lastMonday] so the digest can fall back a week when its own
// earlier Sunday slot beats this week's review into existence.
function getRecentMondays(): [string, string] {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - diff);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  return [toDateString(thisMonday), toDateString(lastMonday)];
}

function formatDate(dateStr: string): string {
  // v10.0.34 — was `new Date(dateStr + "T00:00:00Z")`. UTC midnight
  // converts to ET 8pm the previous day, so every Score Trend point
  // displayed one day early on Monday morning runs. Anchoring at
  // local noon (no TZ suffix) keeps the date stable across all
  // North American timezones; toLocaleDateString then shows the
  // correct day in the recipient's locale.
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function fetchFromAPI(path: string): Promise<any> {
  // Service-to-service URL · use the stable Railway platform URL (or
  // APP_BASE_URL override). Pre-fix used VERCEL_URL → fell back to
  // localhost:3000 → every internal fetch returned null since the
  // Vercel → Railway migration · weekly digest emails have been
  // assembling from empty data every Sunday. Same pattern as cron/mega.
  const baseUrl =
    process.env.APP_BASE_URL?.trim()
    || "https://statenour-web-production.up.railway.app";

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET}`,
      },
    });
    if (!res.ok) {
      log.warn("internal_fetch_non_ok", { path, baseUrl, status: res.status });
      return null;
    }
    return res.json();
  } catch (e) {
    log.error("internal_fetch_failed", { path, baseUrl, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export const GET = cronHandler(async () => {
  const weekStart = getWeekStart();
  const sevenDaysAgo = toDateString(daysAgo(7));
  const now = today();

  // Wave-7 (2026-07-29) · WP-19: revenue-side forecast from the bridge.
  // Best-effort — a dead bridge yields an honest UNAVAILABLE line, never
  // a silent omission. The artifact lands in the outcome ledger as a
  // `prediction` row so the resolution loop can score it against actuals.
  let forecastLine = "Revenue-side forecast: UNAVAILABLE (forecast step failed).";
  try {
    const { buildCashflowForecast, forecastDigestLine } = await import(
      "@/lib/services/cashflow-forecast"
    );
    const forecast = await buildCashflowForecast();
    forecastLine = forecastDigestLine(forecast);
    const { recordShown } = await import("@/lib/services/outcome-ledger");
    await recordShown({
      kind: "prediction",
      sourceEngine: "cashflow-forecast",
      summary: forecastLine,
      shownSurface: "weekly-digest",
      confidence: forecast.confidence,
      evidenceRefs: {
        weekStart: forecast.weekStart,
        basis: forecast.basis,
        dataGaps: forecast.dataGaps,
        freshness: forecast.freshness,
      },
    });
  } catch (err) {
    log.warn("cashflow_forecast_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Apr 19 · DailyScore + MasteryHabit retired. Brain-maturity
  // history + DAILY-task streak counts replace them.
  const [identityHistory, dailyTasks, driftAlerts, healthCheck, weeklyReviewRes] = await Promise.all([
    prisma.brainMemory
      .findMany({
        where: {
          category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
          key: { startsWith: "history:" },
          updatedAt: { gte: new Date(sevenDaysAgo) },
        },
        select: { key: true, content: true },
        orderBy: { key: "asc" },
      })
      // null = read failed — must render "unavailable", never a 0/10 trend
      .catch(() => null),
    prisma.task
      .findMany({
        where: {
          loopKind: "DAILY",
          lastCompletedAt: { gte: new Date(sevenDaysAgo) },
        },
        select: { title: true, streakCount: true, lastCompletedAt: true },
      })
      .catch(() => null),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          createdAt: { gte: new Date(sevenDaysAgo) },
          deletedAt: null,
        },
        select: { content: true, metadata: true },
      })
      .then((rows) => {
        const unresolved = rows.filter((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return !meta.ackedAt;
        });
        return unresolved.map((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return {
            ruleName: e.content,
            severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
            message: typeof meta.body === "string" ? meta.body : "",
          };
        });
      })
      .catch(() => null),
    fetchFromAPI("/api/health"),
    // AG-03 · Read the weekly review directly from BrainMemory. The old
    // fetchFromAPI("/api/ai/weekly-review") targeted a route that does not
    // exist — the producer is /api/cron/weekly-review, which upserts category
    // "weekly_review" at key `weekly:<monday>` — so every digest rendered
    // "Weekly review unavailable."
    (async (): Promise<{ text: string } | null> => {
      const [thisMonday, lastMonday] = getRecentMondays();
      const row = await prisma.brainMemory
        .findFirst({
          where: {
            category: "weekly_review",
            key: { in: [`weekly:${thisMonday}`, `weekly:${lastMonday}`] },
          },
          orderBy: { key: "desc" },
          select: { content: true },
        })
        .catch(() => null);
      return row?.content ? { text: row.content } : null;
    })(),
  ]);

  const weeklyReviewSummary = weeklyReviewRes?.text || "Weekly review unavailable.";

  // Parse brain-maturity series (replaces scoresList)
  interface BrainPoint { date: string; score: number }
  const brainPoints: BrainPoint[] = [];
  for (const row of identityHistory ?? []) {
    const date = row.key.replace("history:", "");
    try {
      const snap = JSON.parse(row.content) as { axes: Record<string, { value: number; manual: number | null }> };
      const axes = Object.values(snap.axes ?? {});
      if (axes.length === 0) continue;
      brainPoints.push({
        date,
        score: Math.round(axes.reduce((s, a) => s + (a.manual ?? a.value), 0) / axes.length),
      });
    } catch {
      // skip
    }
  }
  const scoresList = brainPoints.map((b) => ({ date: formatDate(b.date), score: b.score }));
  const avgScore = brainPoints.length > 0
    ? Math.round(brainPoints.reduce((sum, b) => sum + b.score, 0) / brainPoints.length)
    : 0;

  // Habits from DAILY task streaks
  const habitsByTitle = new Map<string, { days: Set<string>; streak: number }>();
  for (const t of dailyTasks ?? []) {
    if (!t.lastCompletedAt) continue;
    const ds = new Date(t.lastCompletedAt).toISOString().slice(0, 10);
    const entry = habitsByTitle.get(t.title) ?? { days: new Set(), streak: t.streakCount };
    entry.days.add(ds);
    entry.streak = Math.max(entry.streak, t.streakCount);
    habitsByTitle.set(t.title, entry);
  }
  const habitSummary = Array.from(habitsByTitle.entries())
    .map(([title, { days, streak }]) => ({
      name: title,
      pct: Math.round((days.size / 7) * 100),
      streak,
    }))
    .sort((a, b) => b.pct - a.pct);

  const activeDriftCount = driftAlerts === null ? null : driftAlerts.length;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #050505;
      color: #c8c8c8;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #0a0a0a;
      border: 1px solid #222;
      border-radius: 8px;
      padding: 32px;
    }
    h1 {
      margin: 0 0 8px 0;
      font-size: 24px;
      color: #fff;
      font-weight: 600;
    }
    .subtitle {
      color: #888;
      font-size: 14px;
      margin-bottom: 24px;
    }
    .section {
      margin-bottom: 28px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #10b981;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .metric-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #1a1a1a;
      font-size: 14px;
    }
    .metric-row:last-child {
      border-bottom: none;
    }
    .metric-label {
      color: #999;
    }
    .metric-value {
      color: #fff;
      font-weight: 500;
    }
    .score-badge {
      display: inline-block;
      background: #10b981;
      color: #050505;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 13px;
    }
    .alert-critical {
      color: #ef4444;
    }
    .alert-high {
      color: #f97316;
    }
    .habit-bar {
      display: flex;
      align-items: center;
      padding: 8px 0;
      font-size: 13px;
    }
    .habit-name {
      flex: 1;
      color: #999;
    }
    .habit-pct {
      width: 60px;
      text-align: right;
      color: #fff;
      font-weight: 500;
    }
    .review-box {
      background: #1a1a1a;
      border-left: 3px solid #10b981;
      padding: 12px 16px;
      border-radius: 4px;
      font-size: 13px;
      line-height: 1.6;
      color: #c8c8c8;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #1a1a1a;
      font-size: 12px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>NOUR OS Weekly Digest</h1>
    <div class="subtitle">Week of ${formatDate(weekStart)}</div>

    <div class="section">
      <div class="section-title">Score Trend</div>
      ${identityHistory === null ? '<div style="color: #b8860b; font-size: 13px;">Score data unavailable — read failed (unknown, not zero).</div>' : ""}
      ${scoresList
        .map(
          (s) =>
            `<div class="metric-row">
        <span class="metric-label">${s.date}</span>
        <span class="metric-value">${s.score}/10</span>
      </div>`
        )
        .join("")}
      <div class="metric-row" style="border-top: 2px solid #333; padding-top: 12px; margin-top: 12px;">
        <span class="metric-label" style="font-weight: 600;">Weekly Average</span>
        <span class="metric-value"><span class="score-badge">${identityHistory === null ? "?" : avgScore}/10</span></span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Habit Completion</div>
      ${habitSummary
        .map(
          (h) =>
            `<div class="habit-bar">
        <span class="habit-name">${h.name}</span>
        <span class="habit-pct">${h.pct}%</span>
      </div>`
        )
        .join("")}
      ${dailyTasks === null ? '<div style="color: #b8860b; font-size: 13px;">Habit read failed — unknown, not zero.</div>' : habitSummary.length === 0 ? '<div style="color: #666; font-size: 13px;">No habit data logged.</div>' : ""}
    </div>

    <div class="section">
      <div class="section-title">Drift Alerts</div>
      <div style="font-size: 14px;">
        ${activeDriftCount === null ? "Drift-alert read failed — unknown, not zero." : `<strong>${activeDriftCount} active</strong> unresolved alert${activeDriftCount !== 1 ? "s" : ""}`}
      </div>
      ${(driftAlerts ?? [])
        .slice(0, 5)
        .map(
          (a) =>
            `<div style="font-size: 13px; margin-top: 8px; color: #c8c8c8;">
        <span class="alert-${a.severity.toLowerCase()}">[${a.severity.toUpperCase()}]</span> ${a.message}
      </div>`
        )
        .join("")}
    </div>

    <div class="section">
      <div class="section-title">System Health</div>
      <div class="metric-row">
        <span class="metric-label">Status</span>
        <span class="metric-value">${healthCheck?.status || "unknown"}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">AI Weekly Review</div>
      <div class="review-box">
        ${weeklyReviewSummary}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Shop Revenue Forecast (revenue-side only)</div>
      <div class="review-box">
        ${forecastLine}
      </div>
    </div>

    <div class="footer">
      This digest was generated automatically. Review trends and act on high-priority drift alerts.
    </div>
  </div>
</body>
</html>
`;

  const emailSubject = `NOUR OS Weekly Digest — Week of ${formatDate(weekStart)}`;

  // Use the verified sending domain (bdnick.info). The previous
  // `nour@statenour-os.vercel.app` was unverified in Resend → every
  // Sunday 02:00 cron returned 500 → Vercel cron-failure email.
  // Source of recurring "deployment failed" emails Nour was getting
  // (despite the build itself being fine).
  // Guard: if RESEND_API_KEY is unset, the digest still assembled above — just
  // skip the email send gracefully instead of letting `new Resend(undefined)`
  // throw "Missing API key" (the recurring error on /system/logs). Mirrors the
  // ternary guard in lib/services/email.ts + this route's own non-throwing intent.
  const resend = getResend();
  if (!resend) {
    log.warn("resend_unconfigured", {
      reason: "RESEND_API_KEY not set; digest assembled but not emailed",
    });
    return {
      emailSent: false,
      emailError: "RESEND_API_KEY not set",
      weekStart,
      avgScore,
      driftAlerts: activeDriftCount,
    };
  }
  const emailRes = await resend.emails.send({
    from: "NOUR OS <noreply@bdnick.info>",
    to: "nourdean22@gmail.com",
    subject: emailSubject,
    html: htmlContent,
  });

  // Log + return a non-error result on Resend failure instead of
  // throwing. Vercel surfaces 5xx cron returns as "deployment failed"
  // emails which are misleading — the build is fine, the digest just
  // couldn't email. cronHandler still records the outcome to
  // CronJobLog so we see it on /system/cron-diagnostics.
  if (emailRes.error) {
    const err = emailRes.error as { message?: string } | string;
    const errMsg =
      typeof err === "string"
        ? err
        : err.message ?? JSON.stringify(emailRes.error);
    log.error("resend_rejected", { errMsg });
    return {
      emailSent: false,
      emailError: errMsg,
      weekStart,
      avgScore,
      driftAlerts: activeDriftCount,
    };
  }

  return {
    emailSent: true,
    emailId: emailRes.data?.id,
    weekStart,
    avgScore,
    driftAlerts: activeDriftCount,
  };
});
