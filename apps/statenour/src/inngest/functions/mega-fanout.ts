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
  return (
    process.env.APP_BASE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://autonicks.com")
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
    concurrency: { limit: 6 },
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
    const cronSecret = (process.env.CRON_SECRET ?? "").trim();
    if (!cronSecret) {
      // Refuse to fan-out with empty Bearer · same defense as the
      // legacy route (v10.0.114 audit fix).
      log.error("mega_morning_missing_secret", {});
      throw new Error("CRON_SECRET unset · refusing to fan out");
    }

    // Each step.run is a separately-retryable checkpoint. Inngest
    // schedules them with the concurrency limit set above (6).
    const results = await Promise.all(
      MORNING_JOBS.map((path) =>
        step.run(stepIdFor(path), () => dispatchChild(path, cronSecret)),
      ),
    );

    return {
      slot: "morning",
      jobsRun: results.length,
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
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
    concurrency: { limit: 6 },
    retries: 3,
    triggers: [{ cron: "0 3 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const cronSecret = (process.env.CRON_SECRET ?? "").trim();
    if (!cronSecret) {
      log.error("mega_evening_missing_secret", {});
      throw new Error("CRON_SECRET unset · refusing to fan out");
    }

    const jobs = isSundayET()
      ? [...EVENING_JOBS, ...WEEKLY_JOBS]
      : EVENING_JOBS;

    const results = await Promise.all(
      jobs.map((path) =>
        step.run(stepIdFor(path), () => dispatchChild(path, cronSecret)),
      ),
    );

    return {
      slot: "evening",
      isSundayET: isSundayET(),
      jobsRun: results.length,
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
    };
  },
);
