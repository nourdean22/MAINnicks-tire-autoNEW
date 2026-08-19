/**
 * GET /api/cron/data-source-health · 2026-05-29
 *
 * Runs the data-source canary probes (lib/contracts/data-source-health.ts)
 * and persists one BrainMemory(category="data_source_probe") row per probe
 * per ET-day. The /system/health operational rollup + /system/data-source-
 * probes surface read these rows.
 *
 * WHY THIS EXISTS: the probe pipeline + reader were built in v10.0.58
 * (Wave B) — but this cron route was never created and never registered,
 * so the canary that should catch a dead bridge / $0-revenue feeder ran
 * ZERO times. That's why nothing screamed when the nickstire bridge went
 * unreachable and revenue silently read $0. Now wired.
 */
import { cronHandler } from "@/lib/utils/http";
import { runHealthProbes } from "@/lib/contracts/data-source-health";
import { recordCoachEvent } from "@/lib/services/coach-events";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const result = await runHealthProbes();

  // The canary now SCREAMS. The probe module shipped in v10.0.58 with
  // "NOT in v1: Telegram alerts (just persist + dashboard-render)" — so
  // a dead bridge / Unauthorized revenue feeder sat in a dashboard
  // nobody watched. The moment a probe HARD-FAILS (errored, not merely
  // empty — e.g. bridge unreachable / 401), push a Coach Channel event
  // to the operator's scoreboard + brain surfaces. Empty-but-ok probes
  // are NOT alerted here (a single quiet day is legitimate; the streak-
  // based "data_source_dead" determination stays a separate concern).
  const failures = result.results.filter((r) => !r.ok);
  if (failures.length > 0) {
    const businessDown = failures.some(
      (f) => f.kind === "bridge" || f.kind === "shop",
    );
    const names = failures.map((f) => f.name).join(", ");
    // fire-and-forget · recordCoachEvent never throws (returns null on
    // failure) so a coach-write hiccup never fails the probe cron. Dedup
    // is per (kind, subjectId) within 10min; the fixed subjectId keeps
    // re-fires collapsing into one banner. 25h expiry self-heals: if the
    // feeder recovers, tomorrow's run doesn't re-fire and the banner
    // ages out instead of nagging forever.
    await recordCoachEvent({
      kind: "system-alert",
      subjectId: "data-source-health",
      priority: businessDown ? "P0" : "P1",
      title: `Data feeder down · ${failures.length} probe${failures.length > 1 ? "s" : ""} failing`,
      body: businessDown
        ? `Failing: ${names}. A business-data feeder (nickstire bridge / shop) is unreachable — surfaces reading it may show $0 or stale numbers. Check /system/health.`
        : `Failing: ${names}. A personal-data feeder is erroring. Check /system/health.`,
      deepLink: "/system/health",
      surfaces: ["scoreboard", "brain"],
      expiresAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
    });
  }

  // 2026-08-19 · `ok` was the COUNT of passing probes (a number), so
  // logCronRun's reported-failure detection (literal boolean ok === false
  // only) could never see this route degrade — 0-of-6 probes passing
  // still filed a green cron row. The count moves to okCount; `ok` is now
  // the route's actual failure claim.
  return {
    ok: result.failed === 0,
    ...(result.failed > 0 ? { reason: `${result.failed} of ${result.total} probes failing` } : {}),
    status: result.failed > 0 ? "degraded" : "ok",
    total: result.total,
    okCount: result.ok,
    failed: result.failed,
    empty: result.empty,
    alerted: failures.length > 0,
  };
});
