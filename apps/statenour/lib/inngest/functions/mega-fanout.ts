/**
 * mega-fanout · Wave-200 Phase 3 (2026-05-17)
 *
 * Inngest re-implementation of `/api/cron/mega` · each child cron is
 * a `step.run` checkpoint. The semantic difference vs the existing
 * `Promise.all`/`withConcurrency` fan-out:
 *
 *   · step.run() checkpoints survive function crashes — Inngest
 *     stores the result of every completed step. If the function
 *     re-runs (timeout · pod restart · manual replay) the completed
 *     steps are SKIPPED and execution resumes from the failing one.
 *   · Per-step retry with exponential backoff. The default 4 retries
 *     across ~5min covers transient AI provider rate-limit blips
 *     that today make the cron-log say "partial" forever.
 *   · Per-step failure surfaces in the Inngest dashboard with the
 *     full input + error + retry count — beats grepping `cronJobLog`
 *     rows for stack traces.
 *
 * Concurrency: we use `concurrency: { limit: 6 }` to preserve the
 * v10.0.195 sliding-window pattern that solved the AI rate-limit
 * thundering herd. Same value, different mechanism.
 *
 * Cron schedule: kept SAME as the existing mega cron · two daily
 * triggers (morning 9:00 UTC · evening 03:00 UTC).
 *
 * Cutover plan: this function exists alongside the existing
 * `/api/cron/mega` route. The route stays the source of truth until
 * the operator flips `INNGEST_MEGA_V2=true` in Railway env. At that
 * point the Vercel/Railway cron schedule for `/api/cron/mega` is
 * deactivated (operator-side · the Inngest cron triggers take over).
 * Rollback: flip the env back · re-enable the Railway cron · zero
 * code change required.
 *
 * Migration path for new crons: add them ONLY to this fan-out (do
 * not re-add to the legacy route). Old crons migrate one-by-one
 * during routine maintenance.
 *
 * See: docs/adr/0005-inngest-durable-workflows.md
 *      apps/statenour/app/api/cron/mega/route.ts (legacy fan-out)
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
// 2026-05-17 follow-up · shared job arrays (single source of truth)
// replace the formerly-duplicated MORNING_JOBS / EVENING_JOBS /
// WEEKLY_JOBS that lived here AND in app/api/cron/mega/route.ts.
import { MORNING_JOBS, EVENING_JOBS, WEEKLY_JOBS } from "../jobs";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = rootLogger.withSurface("inngest/mega-fanout");

/**
 * Sanitize a child cron path into a stable Inngest step ID.
 *
 * 2026-05-17 follow-up · Inngest's per-step checkpoint keys break
 * when IDs contain `?`, `=`, or `/`. Raw URLs like
 * `/api/cron/journal-checkin?slot=morning` corrupt dashboard replay
 * and (more dangerously) two paths whose hash collides after URL
 * encoding can silently share a checkpoint. Strip to alphanumeric +
 * dash/underscore which is the Inngest-recommended shape.
 */
function stepIdFor(path: string): string {
  return `child:${path.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function getBaseUrl(): string {
  // Internal cron fan-out targets the stable Railway service URL
  // (or APP_BASE_URL). The browser-facing custom domain (bdnick.info)
  // is deliberately NOT used here — service-to-service calls should
  // hit the platform URL, which never changes with a domain swap.
  return (
    process.env.APP_BASE_URL?.trim() ||
    "https://statenour-web-production.up.railway.app"
  );
}

function isSundayET(): boolean {
  return (
    new Date().toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
    }) === "Sunday"
  );
}

/**
 * Dispatch a single child cron via HTTP. Pure helper so step.run can
 * call it as an isolated checkpoint.
 *
 * Throws on non-2xx so Inngest retries the step. The legacy
 * fan-out swallows all errors into the result array — that's the
 * behavior we DON'T want with Inngest. The whole point of the rewire
 * is to let the platform manage retries per-step instead of "let one
 * slot fail forever".
 */
async function dispatchChild(path: string, cronSecret: string): Promise<{
  path: string;
  status: number;
  durationMs: number;
}> {
  const start = Date.now();
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(90_000),
  });
  const durationMs = Date.now() - start;
  if (!res.ok) {
    throw new Error(
      `child cron ${path} returned ${res.status} after ${durationMs}ms`,
    );
  }
  return { path, status: res.status, durationMs };
}

/** Child cron result shape returned by dispatchChild. */
type ChildResult = { path: string; status: number; durationMs: number };

/**
 * Summarize an allSettled batch of child-cron dispatches. We use
 * allSettled (NOT Promise.all) so ONE failing child — a deleted route
 * (404), a throwing job — can never reject the batch and starve the
 * jobs that haven't completed yet. That exact failure mode, plus ~51
 * stale jobs.ts refs to deleted routes left by the Wave AE prune,
 * silently killed ~70% of the fan-out for 2 days (2026-05). Failures
 * are still surfaced: the caller logs them and throws a SUMMARY after
 * every survivor has run, so onFailure (Telegram) fires — a partial
 * run must never be logged as healthy.
 */
function summarizeSettled(settled: PromiseSettledResult<ChildResult>[]) {
  const ok = settled.filter(
    (s): s is PromiseFulfilledResult<ChildResult> => s.status === "fulfilled",
  );
  const failures = settled
    .filter((s): s is PromiseRejectedResult => s.status === "rejected")
    .map((s) => String(s.reason?.message ?? s.reason));
  return {
    jobsRun: ok.length,
    jobsFailed: failures.length,
    totalDurationMs: ok.reduce((sum, r) => sum + r.value.durationMs, 0),
    failures,
  };
}

/**
 * Build the slot-level heartbeat row that /settings/crons + cron
 * diagnostics key on. config/crons.ts names the mega slots "mega"
 * (morning) and "mega-evening" (evening); the "is the mega slot alive?"
 * monitors query those exact names. Child jobs write their OWN
 * CronJobLog rows, but this slot heartbeat was written ONLY by the
 * legacy /api/cron/mega route — post-cutover (INNGEST_MEGA_V2) the
 * Inngest fan-out replaced the route but not the heartbeat, so the slot
 * looked dead to monitors while every child ran fine. Uses
 * sum.totalDurationMs (deterministic across Inngest replays) rather
 * than a wall-clock Date.now() diff.
 */
function megaHeartbeatData(
  jobName: string,
  sum: ReturnType<typeof summarizeSettled>,
) {
  return {
    jobName,
    status: sum.jobsFailed === 0 ? "success" : "partial",
    duration: sum.totalDurationMs,
    error:
      sum.jobsFailed > 0
        ? sum.failures.slice(0, 8).join(" ; ").slice(0, 1900)
        : null,
  };
}

const inngest = getInngest();

/**
 * Morning fan-out · 9:00 UTC daily (matches existing Railway cron).
 *
 * Concurrency 6 mirrors v10.0.195 fix · keeps AI providers below
 * thundering-herd rate-limit threshold.
 */
export const megaFanoutMorning = inngest.createFunction(
  {
    id: "mega-fanout-morning",
    name: "Mega cron fan-out · morning",
    // 2026-05-17 · Inngest free tier caps concurrency at 5 (was 6 to
    // mirror v10.0.195's withConcurrency · close enough · the rate-
    // limit pressure spread benefit holds at 5). Bump back to 6 when
    // upgrading the Inngest plan.
    concurrency: { limit: 5 },
    retries: 3,
    // Cron trigger uses TZ=UTC by default — keep schedule identical
    // to the existing Vercel/Railway 9am UTC trigger. v4 SDK takes
    // triggers inside the config object (v2/v3 used a 3-arg form).
    triggers: [{ cron: "0 9 * * *" }],
    // 2026-05-17 follow-up · Telegram alert on final failure after
    // all retries exhaust. Shared handler in ../on-failure.
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 2026-05-30 · double-fire guard. This Inngest cron + the legacy Railway
    // /api/cron/mega cron share the 9:00 UTC schedule. Until the operator
    // flips INNGEST_MEGA_V2=true (and disables the Railway cron), the Railway
    // route is the source of truth — skip here so every child job doesn't run
    // twice. The trigger stays registered → cutover is one env-flip, no redeploy.
    if (process.env.INNGEST_MEGA_V2 !== "true") {
      log.info("mega_morning_skipped_cutover_off", {});
      return { slot: "morning", skipped: true, reason: "INNGEST_MEGA_V2 off" };
    }
    const cronSecret = (process.env.CRON_SECRET ?? "").trim();
    if (!cronSecret) {
      // Refuse to fan-out with empty Bearer · same defense as the
      // legacy route (v10.0.114 audit fix).
      log.error("mega_morning_missing_secret", {});
      throw new Error("CRON_SECRET unset · refusing to fan out");
    }

    // Each step.run is a separately-retryable checkpoint. allSettled
    // (not Promise.all) so one failing child never starves the rest.
    const settled = await Promise.allSettled(
      MORNING_JOBS.map((path) =>
        step.run(stepIdFor(path), () => dispatchChild(path, cronSecret)),
      ),
    );
    const sum = summarizeSettled(settled);
    // Slot-level heartbeat (jobName "mega") so /settings/crons + cron
    // diagnostics see the mega slot alive. step.run → written once,
    // survives replay; .catch keeps a log-write failure from breaking
    // the fan-out (matches the legacy route's fire-and-forget intent).
    await step.run("mega-heartbeat", async () => {
      await prisma.cronJobLog
        .create({ data: megaHeartbeatData("mega", sum) })
        .catch(() => {});
      return { logged: "mega" };
    });
    if (sum.jobsFailed > 0) {
      log.warn("mega_morning_partial", {
        ok: sum.jobsRun,
        failed: sum.jobsFailed,
        failures: sum.failures.slice(0, 10),
      });
      // Survivors have all run (allSettled); throw now so onFailure
      // fires — a partial fan-out must not be logged as healthy.
      throw new Error(
        `mega-morning: ${sum.jobsFailed}/${settled.length} child crons failed · ${sum.failures.slice(0, 8).join(" ; ")}`,
      );
    }
    return {
      slot: "morning",
      jobsRun: sum.jobsRun,
      totalDurationMs: sum.totalDurationMs,
    };
  },
);

/**
 * Evening fan-out · 03:00 UTC daily (10pm ET previous day).
 *
 * Includes the WEEKLY_JOBS append on Sunday-ET (matches the legacy
 * route's `if (slot === 'evening' && isSunday)` branch).
 */
export const megaFanoutEvening = inngest.createFunction(
  {
    id: "mega-fanout-evening",
    name: "Mega cron fan-out · evening",
    // 2026-05-17 · Inngest free tier caps concurrency at 5 (was 6 to
    // mirror v10.0.195's withConcurrency · close enough · the rate-
    // limit pressure spread benefit holds at 5). Bump back to 6 when
    // upgrading the Inngest plan.
    concurrency: { limit: 5 },
    retries: 3,
    triggers: [{ cron: "0 3 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 2026-05-30 · double-fire guard (see morning fn). Skip unless the cutover
    // flag is on, so the Railway /api/cron/mega cron isn't run twice.
    if (process.env.INNGEST_MEGA_V2 !== "true") {
      log.info("mega_evening_skipped_cutover_off", {});
      return { slot: "evening", skipped: true, reason: "INNGEST_MEGA_V2 off" };
    }
    const cronSecret = (process.env.CRON_SECRET ?? "").trim();
    if (!cronSecret) {
      log.error("mega_evening_missing_secret", {});
      throw new Error("CRON_SECRET unset · refusing to fan out");
    }

    const jobs = isSundayET()
      ? [...EVENING_JOBS, ...WEEKLY_JOBS]
      : EVENING_JOBS;

    const settled = await Promise.allSettled(
      jobs.map((path) =>
        step.run(stepIdFor(path), () => dispatchChild(path, cronSecret)),
      ),
    );
    const sum = summarizeSettled(settled);
    // Slot-level heartbeat (jobName "mega-evening") — see morning fn.
    await step.run("mega-heartbeat", async () => {
      await prisma.cronJobLog
        .create({ data: megaHeartbeatData("mega-evening", sum) })
        .catch(() => {});
      return { logged: "mega-evening" };
    });
    if (sum.jobsFailed > 0) {
      log.warn("mega_evening_partial", {
        ok: sum.jobsRun,
        failed: sum.jobsFailed,
        failures: sum.failures.slice(0, 10),
      });
      throw new Error(
        `mega-evening: ${sum.jobsFailed}/${settled.length} child crons failed · ${sum.failures.slice(0, 8).join(" ; ")}`,
      );
    }
    return {
      slot: "evening",
      isSundayET: isSundayET(),
      jobsRun: sum.jobsRun,
      totalDurationMs: sum.totalDurationMs,
    };
  },
);
