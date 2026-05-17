/**
 * In-process node-cron loop · runs high-frequency jobs without
 * Railway-cron HTTP overhead. The 2-min · 5-min · 15-min · 30-min
 * jobs all fire here. Slower jobs (>1h) fold into the mega fan-out
 * triggered by Railway cron.
 *
 * CP4 ships the SCAFFOLD · each job is a stub log. CP6 wires the
 * stubs to the real statenour handlers either via internal HTTP to
 * the web service OR by importing the handler module directly (TBD
 * based on which is cleaner in practice).
 *
 * Schedule list mirrors statenour's config/crons.ts to keep one
 * source of truth · CP6 will swap the local STUB_JOBS array for a
 * runtime read of @statenour/web/config/crons.
 */

import cron from "node-cron";

interface JobDef {
  name: string;
  schedule: string; // cron expression (UTC)
  description: string;
}

// High-frequency jobs that live in the worker process (not Railway
// cron). Matches the rows in apps/statenour/config/crons.ts that
// have mode="active" AND schedule frequency < 1h. CP6 will replace
// this with a dynamic load of the canonical manifest.
const STUB_JOBS: JobDef[] = [
  {
    name: "brain-bus-backfill",
    schedule: "*/2 * * * *",
    description: "Every 2 min · backfill brain-bus events queue",
  },
  {
    name: "error-telegram-push",
    schedule: "*/5 * * * *",
    description: "Every 5 min · push queued error alerts to Telegram",
  },
  {
    name: "alert-telegram-push",
    schedule: "*/15 * * * *",
    description: "Every 15 min · push queued alerts to Telegram",
  },
  {
    name: "calendar-premeeting",
    schedule: "*/15 11-23,0 * * *",
    description: "Every 15 min · 7am-8pm ET · pre-meeting cards",
  },
  {
    name: "bus-exhaustion-watch",
    schedule: "*/30 * * * *",
    description: "Every 30 min · watch for stuck brain-bus events",
  },
  {
    name: "provider-ping",
    schedule: "0 * * * *",
    description: "Hourly · ping LLM providers for health/latency",
  },
];

/**
 * Register every job. Each job currently logs · CP6 wires each one
 * to the real statenour handler (either via internal HTTP to the
 * web service OR by importing the handler module).
 */
export function startScheduler(): void {
  let registered = 0;
  for (const job of STUB_JOBS) {
    const valid = cron.validate(job.schedule);
    if (!valid) {
      console.error(`[scheduler] invalid cron "${job.schedule}" for ${job.name} · skipping`);
      continue;
    }
    cron.schedule(
      job.schedule,
      () => {
        const ts = new Date().toISOString();
        console.log(`[scheduler] tick · ${ts} · ${job.name} · ${job.description}`);
        // CP6: replace this log with the actual job invocation.
        // Two options to pick at CP6:
        //   (a) import the handler module from @statenour/web and
        //       call it in-process (zero HTTP overhead · uses
        //       worker's Neon connection pool)
        //   (b) fetch the canonical /api/cron/<name> endpoint on
        //       the web service over Railway internal hostname
        //       (preserves Vercel-era behavior exactly · adds 1
        //       network hop per fire)
      },
      { timezone: "UTC" },
    );
    registered++;
  }
  console.log(`[scheduler] registered ${registered} jobs · timezone UTC`);
}
