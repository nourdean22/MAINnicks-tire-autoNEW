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
import { logError } from "@/lib/utils/error-log";

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
/**
 * Per-child dispatch ceilings · 2026-07-28 cron-truth hardening.
 *
 * mega-evening logged `partial` SEVEN consecutive nights because two
 * children exceed the flat 90s abort — while finishing fine server-side
 * (their own success rows land at ~03:17 and ~03:23). The abort is a
 * parent-visibility artifact that normalized nightly failure noise.
 *
 * The pair below is INFERRED from child log timestamps (the pre-fix
 * error strings named nobody); now that failures carry their paths,
 * the next partial names its culprits — if a DIFFERENT child appears,
 * add it here and re-shrink this map when jobs get faster. Ceilings
 * chosen from measured completion (~14 and ~20 min past slot start,
 * minus queue-order slack) with headroom, capped at the 240s route
 * maxDuration these children already honor.
 *
 * SUPERSEDED 2026-08-19. That ceiling was read off the wrong number: "~14 and
 * ~20 min past slot start" is when each child FINISHES, not how long the call
 * takes, so a 240s abort was set for jobs that run 14-36 minutes. Measured over
 * 7 days of prod api_request_logs: consolidate avg 19.6 min (max 36),
 * mastery-xp avg 5.1 min (max 9.9) -- and BOTH return 200 every time. Neither
 * was ever "slow but bounded"; both moved to DETACHED_CHILDREN below.
 *
 * What remains here is the genuine slow-but-bounded case: predict averages
 * 82.5s against the 90s default with a 173s max, so it flapped on and off the
 * boundary. 240s gives it headroom while keeping a real ceiling.
 */
const CHILD_TIMEOUT_MS: Record<string, number> = {
  "/api/cron/predict": 240_000,
};
const DEFAULT_CHILD_TIMEOUT_MS = 90_000;

/**
 * Children dispatched FIRE-AND-FORGET: the parent confirms the request was
 * accepted, then stops waiting for it.
 *
 * These are batch jobs whose runtime is a function of how much brain data
 * exists, not of anything the parent can predict -- and it trends upward as the
 * brain grows. No ceiling survives that; this map had already been raised
 * 50s -> 90s -> 240s and still failed 29 nights running.
 *
 * The cost was not cosmetic. Each abort threw, which failed the Inngest step,
 * which `retries: 3` turned into a full re-run of the evening slot -- so
 * consolidate executed FOUR times a night (~2.3h of LLM churn), loading the DB
 * and making the next run slower still.
 *
 * Detaching is safe because aborting the CLIENT never killed the SERVER
 * handler: the parent has been aborting at 240s for weeks while
 * api_request_logs recorded those very runs completing 200 at 34 minutes. And
 * these children already write their own CronJobLog rows -- that is where their
 * real outcome has always lived. The parent's only job is to start them.
 *
 * DELIBERATE TRADE-OFF: the parent can no longer retry these two. A child that
 * starts and then fails server-side is reported as dispatched here, so Inngest
 * will not re-run it. That is the point -- re-running a 34-minute LLM batch on
 * a whim is the pathology being removed -- and the failure is NOT lost:
 * cronHandler still writes that child's own FAILED CronJobLog row, which is
 * exactly what getCronStatus() (lib/services/cron-manager.ts) and the
 * /system/crons panel read. Parent-level retry was never the safety net here;
 * it just multiplied the work.
 */
export const DETACHED_CHILDREN: ReadonlySet<string> = new Set([
  "/api/cron/consolidate",
  "/api/cron/mastery-xp",
]);

/**
 * How long the parent waits for a detached child to prove it STARTED. Long
 * enough to surface an immediate 4xx/5xx or a refused connection, far shorter
 * than any real run. Reaching it means "still working" -- which is success.
 */
const DETACH_ACK_MS = 10_000;

export async function dispatchChild(path: string, cronSecret: string): Promise<{
  path: string;
  status: number;
  durationMs: number;
}> {
  const start = Date.now();
  const baseUrl = getBaseUrl();

  if (DETACHED_CHILDREN.has(path)) {
    // Deliberately NO abort signal -- letting the child outlive this call is
    // the entire point. Rejections are folded into the value so losing the
    // race below can never surface as an unhandled rejection.
    const inFlight = fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${cronSecret}` },
    }).then(
      (r) => ({ kind: "responded" as const, status: r.status, ok: r.ok }),
      (err: unknown) => ({ kind: "failed" as const, err }),
    );

    let ackTimer: ReturnType<typeof setTimeout> | undefined;
    const ack = await Promise.race([
      inFlight,
      new Promise<{ kind: "running" }>((resolve) => {
        ackTimer = setTimeout(() => resolve({ kind: "running" }), DETACH_ACK_MS);
      }),
    ]);
    if (ackTimer) clearTimeout(ackTimer);

    // A child that never started is still a real failure worth retrying.
    if (ack.kind === "failed") {
      const msg = ack.err instanceof Error ? ack.err.message : String(ack.err);
      throw new Error(
        `child cron ${path} failed to dispatch after ${Date.now() - start}ms: ${msg}`,
      );
    }
    if (ack.kind === "responded" && !ack.ok) {
      throw new Error(
        `child cron ${path} returned ${ack.status} after ${Date.now() - start}ms`,
      );
    }

    // "running" == accepted and still working server-side. 202 reads as
    // ACCEPTED, not COMPLETED, so the slot heartbeat never claims otherwise.
    return {
      path,
      status: ack.kind === "responded" ? ack.status : 202,
      durationMs: Date.now() - start,
    };
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(CHILD_TIMEOUT_MS[path] ?? DEFAULT_CHILD_TIMEOUT_MS),
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
export function summarizeSettled(
  settled: PromiseSettledResult<ChildResult>[],
  paths: readonly string[],
) {
  const ok = settled.filter(
    (s): s is PromiseFulfilledResult<ChildResult> => s.status === "fulfilled",
  );
  // 2026-07-28 cron-truth audit · attach the CHILD'S IDENTITY to every
  // failure string. Before this, failures kept only `reason.message` —
  // seven consecutive nights of mega-evening "partial" logged exactly
  // "The operation was aborted due to timeout ; The operation was
  // aborted due to timeout" with NO WAY to know which two children
  // timed out (short of correlating child log timestamps by hand).
  // `settled` is index-aligned with the jobs array Promise.allSettled
  // received, so the path is recoverable for free.
  const failures = settled
    .map((s, i) =>
      s.status === "rejected"
        ? `${paths[i] ?? `#${i}`}: ${String(s.reason?.message ?? s.reason)}`
        : null,
    )
    .filter((f): f is string => f !== null);
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
    const sum = summarizeSettled(settled, MORNING_JOBS);
    // Slot-level heartbeat (jobName "mega") so /settings/crons + cron
    // diagnostics see the mega slot alive. step.run → written once,
    // survives replay; .catch keeps a log-write failure from breaking
    // the fan-out (matches the legacy route's fire-and-forget intent).
    await step.run("mega-heartbeat", async () => {
      await prisma.cronJobLog
        .create({ data: megaHeartbeatData("mega", sum) })
        .catch((e) => logError("inngest.mega-fanout", e, { stage: "heartbeat", slot: "mega" }, "warn"));
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
    const sum = summarizeSettled(settled, jobs);
    // Slot-level heartbeat (jobName "mega-evening") — see morning fn.
    await step.run("mega-heartbeat", async () => {
      await prisma.cronJobLog
        .create({ data: megaHeartbeatData("mega-evening", sum) })
        .catch((e) => logError("inngest.mega-fanout", e, { stage: "heartbeat", slot: "mega-evening" }, "warn"));
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
