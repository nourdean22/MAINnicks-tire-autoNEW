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
 * any cron handler code in statenour-web · and rollback is just
 * "stop the worker, point Vercel cron at statenour-web again."
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
import { renderReelVideo } from "@nour/reel-engine";

const STATENOUR_WEB_URL = (process.env.STATENOUR_WEB_URL ?? "").trim();
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
// Hard ceiling per cron fire · prevents a stuck handler from hanging
// the worker process · the handler itself has its own timeout, this
// is just a belt-and-suspenders.
const FORWARD_TIMEOUT_MS = 60_000;

interface JobDef {
  name: string;
  schedule: string; // cron expression (UTC)
  description: string;
}

// High-frequency jobs that live in the worker. Matches rows in
// apps/statenour/config/crons.ts where mode="active" AND schedule
// frequency < 1h. Single source of truth STAYS in config/crons.ts ·
// this list is a per-deploy snapshot · keep them in sync manually
// when a new high-freq cron lands.
const HIGH_FREQ_JOBS: JobDef[] = [
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

    const isAlert =
      sourceMetadata?.type === "alert" ||
      content?.toLowerCase().includes("warning") ||
      content?.toLowerCase().includes("alert");
    const template = isAlert ? "alert" : "review";

    const data =
      template === "alert"
        ? {
            alertTitle: sourceMetadata?.alertTitle || "Service Alert",
            alertDetails: sourceMetadata?.alertDetails || content || "",
            location: sourceMetadata?.location || "Local Road Safety",
            companyName: sourceMetadata?.companyName || "Nick's Tire & Auto",
          }
        : {
            reviewerName: sourceMetadata?.reviewerName || "Verified Customer",
            reviewText: sourceMetadata?.reviewText || content || "",
            stars: Number(sourceMetadata?.stars ?? 5),
            companyName: sourceMetadata?.companyName || "Nick's Tire & Auto",
          };

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
    cron.schedule(
      job.schedule,
      () => {
        // Fire-and-forget · don't block the cron tick on the forward
        // (next tick may fire before this one resolves on a slow run)
        void forwardCronToWeb(job.name);
      },
      { timezone: "UTC" },
    );
    registered++;
  }

  // Register local video rendering job - runs every 2 minutes
  cron.schedule(
    "*/2 * * * *",
    () => {
      void processVideoRenders();
    },
    { timezone: "UTC" }
  );
  registered++;

  console.log(
    `[scheduler] registered ${registered} jobs · target=${STATENOUR_WEB_URL || "UNSET"} · timezone UTC`,
  );
}
