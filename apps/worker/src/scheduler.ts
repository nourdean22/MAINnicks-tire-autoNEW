/**
 * In-process node-cron loop · runs high-frequency jobs by firing HTTP
 * at statenour-web's existing `/api/cron/<name>` route handlers.
 *
 * CP6 design (Option B per MIGRATION_PLAN.md §3):
 * Worker does NOT import handler modules · instead it forwards each
 * tick to statenour-web's existing route handler over Railway's
 * internal hostname. Preserves Vercel-era contract bit-for-bit:
 *   · same auth (CRON_SECRET in Authorization: Bearer header)
 *   · same logging surface (route's cronHandler wrapper · ErrorLog)
 *   · same execution context (Next.js runtime · Prisma pool · etc)
 *   · same observability (request appears in statenour-web logs as
 *     a cron HTTP hit, identical to how Vercel cron hit it)
 *
 * Trade-off accepted: 1 internal network hop per fire (~5-15ms on
 * Railway internal). Worth it · this commit can ship without touching
 * any cron handler code in statenour-web. Rollback note (corrected
 * 2026-09-09): the original plan below was "stop the worker, point
 * Vercel cron at statenour-web again" — Vercel is now fully retired for
 * this app (apps/statenour/AGENTS.md), so that path no longer exists.
 * Current rollback is a straight `git revert` of the commit that
 * introduced this forwarding.
 *
 * Schedule list mirrors apps/statenour/config/crons.ts active rows
 * with frequency < 1h. Daily/weekly rows ride the mega fan-out
 * triggered by Railway cron (see index.ts).
 */

import cron from "node-cron";
import fs from "fs";
import os from "os";
import path from "path";
import { storagePut } from "./storage.js";
import { planRender } from "./renderPlan.js";
import { renderReelVideo } from "@nour/reel-engine";

const STATENOUR_WEB_URL = (process.env.STATENOUR_WEB_URL ?? "").trim();
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
// Hard ceiling per cron fire · prevents a stuck handler from hanging
// the worker process · the handler itself has its own timeout, this
// is just a belt-and-suspenders.
const FORWARD_TIMEOUT_MS = 60_000;

// Scheduler liveness + drain state.
// - scheduledTasks: node-cron handles so shutdown can stop new ticks.
// - inFlightForwards: per-job guard so a slow forward can't stack overlapping
//   HTTP calls against the same route when the next tick fires.
// - lastTickAt: newest tick time, exposed to /health so a wedged loop reads
//   unhealthy instead of the old hard-coded scheduler:"running".
const scheduledTasks: cron.ScheduledTask[] = [];
const inFlightForwards = new Set<string>();
let lastTickAt = 0;

interface JobDef {
  name: string;
  schedule: string; // cron expression (UTC)
  description: string;
}

/**
 * Minutes between consecutive fires, for the cron shapes this service uses.
 *
 * Deliberately narrow: it understands `every-N-minutes` (star-slash-N) (every N minutes) and
 * `M H * * *` (daily). Anything it does not recognise returns Infinity, so an
 * unparsed expression can only ever make the derived health window WIDER, never
 * falsely tighter. A parser that guessed would turn a doc bug into an outage.
 */
export function cronIntervalMinutes(expr: string): number {
  const e = expr.trim();
  const everyN = e.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyN) {
    const n = Number(everyN[1]);
    return n > 0 ? n : Number.POSITIVE_INFINITY;
  }
  if (/^\d+ \d+ \* \* \*$/.test(e)) return 24 * 60; // daily at a fixed time
  return Number.POSITIVE_INFINITY;
}

/**
 * How long /health tolerates silence before calling the loop stalled.
 *
 * DERIVED, not hardcoded. `lastTickAt` is bumped by ANY tick, so the longest
 * healthy gap is the interval of the FASTEST recurring writer.
 *
 * GROUNDING, stated honestly because an unsourced constant is how the previous
 * 5-minute literal survived:
 *   · Expressing the threshold as a COUNT OF MISSED INTERVALS rather than an
 *     absolute duration is established heartbeat-monitoring practice —
 *     incident.io's "missed tolerance: fires an alert after the configured
 *     number of consecutive pings are missed (minimum 1)"
 *     (docs.incident.io/alerts/heartbeat-monitoring). That is why this is a
 *     multiple of the schedule and not another literal.
 *   · The specific values are NOT standards. incident.io gives no recommended
 *     count (minimum 1). Prometheus is deliberately NOT cited here: it uses a
 *     fixed 5-minute lookback-delta, not a multiple of scrape interval, so it
 *     would be the wrong precedent.
 *   · So: `* 2` (tolerate one wholly missed fire before crying stalled) and
 *     `+ 5` minutes (node-cron drift + forward latency) are JUDGMENT CALLS.
 *     Widen them freely; the cost of being late here is a late alert, because
 *     nothing restarts on this signal. Narrowing is the risk — but the margin is
 *     `+ 5`, not the multiplier: at a 15-min floor it clears a healthy gap to ~`* 0.67`.
 *
 * Why derived: this was `5 * 60_000` with the comment "a high-freq job ticks
 * every ~2 min". #1696 moved the render loop from 2-minute to 15-minute cadence and nothing
 * retuned the window, so the floor (15 min) exceeded the threshold (5 min) and
 * /health reported stalled for ~10 of every 15 minutes. A constant that must be
 * hand-synced with cron config rots the next time a schedule changes; this
 * recomputes from the schedules themselves.
 */
export function deriveStaleWindowMs(
  schedules: readonly string[] = TICK_WRITING_SCHEDULES,
): number {
  const fastest = Math.min(...schedules.map(cronIntervalMinutes));
  // No parsable recurring tick at all: fall back to a 1h floor rather than
  // Infinity, so a wedged loop is still eventually reported.
  if (!Number.isFinite(fastest)) return 60 * 60_000;
  return (fastest * 2 + 5) * 60_000;
}

// High-frequency jobs that live in the worker. Matches rows in
// apps/statenour/config/crons.ts where mode="active" AND schedule
// frequency < 1h. Single source of truth STAYS in config/crons.ts ·
// this list is a per-deploy snapshot · keep them in sync manually
// when a new high-freq cron lands.
const HIGH_FREQ_JOBS: JobDef[] = [
  // 2026-07-28 blueprint audit: the four Wave-AE ghosts (brain-bus-backfill ·
  // calendar-premeeting · bus-exhaustion-watch · provider-ping) forwarded to
  // routes DELETED on 2026-05-28 — two months of 404s every 2-60 min that
  // only this process's console ever saw. Removed; every name below must
  // exist in apps/statenour/config/crons.ts with `worker: true` AND have a
  // live /api/cron/<name> route.
  {
    // Replaces the dead brain-bus-backfill: drains the durable BrainBusEvent
    // queue (9 live producers, zero consumers since Wave AE — 393-row
    // backlog measured in prod 2026-07-28). 50/run × 15 min clears the
    // backlog in ~2h, then steady-state.
    name: "brain-bus-drain",
    schedule: "*/15 * * * *",
    description: "Every 15 min · drain durable brain-bus events (revived 2026-07-28)",
  },
  {
    // Post-turn outbox backstop was nightly-only (mega-evening 03:00) — a
    // turn that crashed mid-work stranded its receipts/completion message
    // for up to 24h. The route's claim is atomic first-claimant-wins, so
    // riding both the nightly fan-out and this 15-min loop is safe.
    name: "outbox-drain",
    schedule: "*/15 * * * *",
    description: "Every 15 min · replay orphaned post-turn chat work",
  },
  {
    // NOT high-frequency — deliberately lives here anyway. This is the
    // out-of-band Inngest liveness check (2026-07-28 cron-truth
    // hardening): the fan-out watchdog is itself Inngest-scheduled, so
    // when the Inngest Cloud manifest drifted, the watchdog died with
    // the fleet it watched. The worker is a different service on a
    // different scheduler — the one place a "is Inngest alive at all"
    // check can survive an Inngest outage. Fires 13:00 UTC, one hour
    // after cron-heartbeat's slot, so a healthy day never alerts.
    name: "inngest-liveness",
    schedule: "0 13 * * *",
    description: "Daily 13:00 UTC · out-of-band Inngest scheduler liveness (reads heartbeat self-row age)",
  },
  {
    // 2026-10-02 · operator turned agent follow-ups on. Delivers the
    // follow-ups Nick scheduled for himself (writes into the originating
    // chat thread only). Still gated by NICK_AGENT_FOLLOWUPS=1 and the
    // per-cron kill switch inside the route; daily + per-thread caps apply.
    name: "agent-followups",
    schedule: "*/15 * * * *",
    description: "Every 15 min · deliver agent-scheduled follow-ups into their chat thread (gated by NICK_AGENT_FOLLOWUPS + kill switch)",
  },
  {
    // 2026-09-08 · ADR-0017. The camera bridge PATCHes a heartbeat per camera
    // every 60 s; this tick asks statenour to flip devices silent >20 min to
    // OFFLINE and page once per transition. Rides the same 15-min cadence as
    // the drains so it never becomes the fastest Neon-waking writer (#1696).
    name: "device-heartbeat-sentinel",
    schedule: "*/15 * * * *",
    description: "Every 15 min · camera/bridge heartbeat silence -> OFFLINE + one alert per transition (ADR-0017)",
  },
];

/**
 * The render loop's schedule. Named so it can join TICK_WRITING_SCHEDULES —
 * it bumps lastTickAt exactly like a forwarded job does, so leaving it out
 * would make the derived health window wrong the moment it becomes the
 * fastest writer.
 */
const RENDER_SCHEDULE = "*/15 * * * *";

/**
 * Every schedule that writes `lastTickAt`. This is the input to the /health
 * staleness window — keep it complete, or /health drifts from reality again.
 */
const TICK_WRITING_SCHEDULES: readonly string[] = [
  ...HIGH_FREQ_JOBS.map((j) => j.schedule),
  RENDER_SCHEDULE,
];

let isRendering = false;

/**
 * Polls Statenour for approved video drafts and compiles them locally
 * using Remotion. Saves resulting MP4 to S3/CDN and updates Next.js.
 */
async function processVideoRenders(): Promise<void> {
  if (!STATENOUR_WEB_URL) return;

  if (isRendering) {
    console.log(`[scheduler-video] render loop in progress, skipping tick`);
    return;
  }

  isRendering = true;
  const STATENOUR_SYNC_KEY = (process.env.STATENOUR_SYNC_KEY || CRON_SECRET).trim();
  const url = `${STATENOUR_WEB_URL}/api/sync/queue/render`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${STATENOUR_SYNC_KEY}`,
        "User-Agent": "statenour-worker/1.0 (railway)",
      },
    });

    if (!res.ok) {
      if (res.status !== 404) {
        console.error(`[scheduler-video] failed to poll render tasks: ${res.status}`);
      }
      return;
    }

    const body = (await res.json()) as { ok: boolean; item: any };
    if (!body.ok || !body.item) {
      return; // No pending renders
    }

    const { id, content, kind, sourceMetadata } = body.item;
    console.log(`[scheduler-video] found render task for queue item ${id}`);

    // A review video only from a declared review; anything that is neither a
    // review nor an alert is refused before rendering (renderPlan.ts). The row
    // keeps its lease, so the lease reclaim retires it after MAX_RENDER_ATTEMPTS.
    const plan = planRender(content, sourceMetadata);
    if ("refuse" in plan) {
      console.warn(`[scheduler-video] refusing queue item ${id} (kind ${kind}): ${plan.refuse}`);
      return;
    }
    const { template, data } = plan;

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `render_${id}.mp4`);

    try {
      console.log(`[scheduler-video] rendering ${template} template to ${tempFile}`);
      await renderReelVideo({
        template,
        data,
        outputPath: tempFile,
      });

      console.log(`[scheduler-video] uploading compiled video to storage`);
      const buffer = fs.readFileSync(tempFile);
      const uploadResult = await storagePut(`social/reels/render_${id}.mp4`, buffer, "video/mp4");

      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }

      console.log(`[scheduler-video] syncing compiled video url back to statenour: ${uploadResult.url}`);
      const completeRes = await fetch(`${STATENOUR_WEB_URL}/api/sync/queue/render-complete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STATENOUR_SYNC_KEY}`,
          "Content-Type": "application/json",
          "User-Agent": "statenour-worker/1.0 (railway)",
        },
        body: JSON.stringify({
          id,
          videoUrl: uploadResult.url,
        }),
      });

      if (!completeRes.ok) {
        console.error(`[scheduler-video] failed to complete render task for ${id}: ${completeRes.status}`);
      } else {
        console.log(`[scheduler-video] render task successfully completed for ${id}`);
      }
    } catch (err: any) {
      console.error(`[scheduler-video] exception during render/upload for ${id}:`, err);
      // Clean up temp file if it exists
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {}
      }

      // Revert queue item back to approved so it can be retried
      console.log(`[scheduler-video] resetting status of ${id} back to approved`);
      await fetch(`${STATENOUR_WEB_URL}/api/sync/queue`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${STATENOUR_SYNC_KEY}`,
          "Content-Type": "application/json",
          "User-Agent": "statenour-worker/1.0 (railway)",
        },
        body: JSON.stringify({
          id,
          action: "approve",
        }),
      }).catch((e) => console.error(`[scheduler-video] failed to reset status for ${id}:`, e));
    }
  } catch (err) {
    console.error(`[scheduler-video] error in processVideoRenders tick:`, err);
  } finally {
    isRendering = false;
  }
}

/**
 * Fire a single cron handler via HTTP. Returns true on success.
 * Never throws · logs structured errors so /system/errors can pick
 * them up via the statenour-web side · worker continues regardless.
 */
export async function forwardCronToWeb(name: string): Promise<boolean> {
  if (!STATENOUR_WEB_URL) {
    console.error(
      `[scheduler] STATENOUR_WEB_URL not set · cannot forward ${name} · ` +
        `skipping. Set it to https://statenour-web.railway.internal in Railway env.`,
    );
    return false;
  }
  const url = `${STATENOUR_WEB_URL}/api/cron/${name}`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
        "User-Agent": "statenour-worker/1.0 (railway)",
      },
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    if (!res.ok) {
      console.error(
        `[scheduler] forward FAIL · ${name} · status=${res.status} · ${durationMs}ms`,
      );
      return false;
    }
    console.log(`[scheduler] forward OK · ${name} · ${durationMs}ms`);
    return true;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const msg =
      err instanceof Error && err.name === "AbortError"
        ? `timeout after ${FORWARD_TIMEOUT_MS}ms`
        : err instanceof Error
        ? err.message.slice(0, 200)
        : String(err).slice(0, 200);
    console.error(`[scheduler] forward EXCEPTION · ${name} · ${durationMs}ms · ${msg}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register every job. node-cron handles the timing · each tick fires
 * an HTTP call to statenour-web's existing handler.
 */
export function startScheduler(): void {
  let registered = 0;
  for (const job of HIGH_FREQ_JOBS) {
    const valid = cron.validate(job.schedule);
    if (!valid) {
      console.error(`[scheduler] invalid cron "${job.schedule}" for ${job.name} · skipping`);
      continue;
    }
    const task = cron.schedule(
      job.schedule,
      () => {
        // Overlap guard: if the previous forward for THIS job is still in
        // flight (slow child, tripped 60s timeout), skip this tick instead of
        // stacking a second HTTP call against the same route.
        if (inFlightForwards.has(job.name)) {
          console.warn(`[scheduler] skip ${job.name} · previous forward still in flight`);
          return;
        }
        inFlightForwards.add(job.name);
        lastTickAt = Date.now();
        // Fire-and-forget · don't block the cron tick on the forward.
        void forwardCronToWeb(job.name).finally(() => inFlightForwards.delete(job.name));
      },
      { timezone: "UTC" },
    );
    scheduledTasks.push(task);
    registered++;
  }

  // Register local video rendering job - runs every 15 minutes.
  //
  // WAS `*/2`. That 2-minute poll was the single largest line item on the Neon
  // bill and it bought nothing: the render queue receives roughly one reel a
  // day, so 719 of every 720 daily polls found an empty queue. Because every
  // poll hits /api/sync/queue/render — which touches Postgres — and Neon
  // suspends an idle compute after 5 minutes, a 2-minute tick meant the
  // database could NEVER scale to zero. Measured 2026-08-19: active_time 443.7h
  // out of the ~456h elapsed in the billing period (97% awake), 222.6 CU-h by
  // day 19 against the 300 CU-h Launch allowance — which tipped the project
  // into read-only and silently broke every write in the app.
  //
  // 15 minutes matches the sibling forward loops above and stays comfortably
  // inside RENDER_LEASE_MINUTES = 30 (app/api/sync/queue/render/route.ts), so a
  // lease still gets two claim attempts before it expires and the abandoned-work
  // reclaim path is unaffected. Cost of the change is bounded: a queued reel
  // waits at most ~13 minutes longer to start rendering.
  const renderTask = cron.schedule(
    RENDER_SCHEDULE,
    () => {
      lastTickAt = Date.now();
      void processVideoRenders();
    },
    { timezone: "UTC" }
  );
  scheduledTasks.push(renderTask);
  registered++;

  console.log(
    `[scheduler] registered ${registered} jobs · target=${STATENOUR_WEB_URL || "UNSET"} · timezone UTC`,
  );
}

/** Stop all cron tasks so no NEW ticks fire (used during graceful shutdown). */
export function stopScheduler(): void {
  for (const task of scheduledTasks) {
    try {
      task.stop();
    } catch {
      /* best-effort */
    }
  }
}

/**
 * Liveness snapshot for /health. `msSinceLastTick` is null before the first
 * tick (fresh-boot grace — a high-freq job fires within ~2 min).
 */
export function getSchedulerHealth(): {
  lastTickAt: number;
  msSinceLastTick: number | null;
  isRendering: boolean;
  inFlightForwards: string[];
} {
  return {
    lastTickAt,
    msSinceLastTick: lastTickAt === 0 ? null : Date.now() - lastTickAt,
    isRendering,
    inFlightForwards: [...inFlightForwards],
  };
}

/**
 * Wait (bounded) for in-flight work to finish before exit — an active reel
 * render or an outstanding forward. Polls until idle or the deadline.
 */
export async function drainInFlight(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((isRendering || inFlightForwards.size > 0) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }
}
