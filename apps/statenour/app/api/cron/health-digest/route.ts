/**
 * GET /api/cron/health-digest · wave 2V review (2026-10-19)
 *
 * Folded into mega-evening. Recomputes the system health digest and persists it
 * (BrainMemory category system_health_digest). The old scheduler was the 4h
 * read-through in GET /api/ultron/health-digest, whose only caller was the
 * SystemHealthCard on the /system/health page that Nour cut; without this cron the rows
 * stop, and with them Brain Health Time Travel (app/api/brain/time-travel/route.ts) and
 * the Google OAuth-expiry highlight.
 *
 * cronHandler gives the kill switch and the CronJobLog row; a throw files the run FAILED.
 *
 * shortcut: refreshHealthDigest persists fire-and-forget, so a failed WRITE is not seen
 * here (a failed COMPUTE is). Upgrade to an awaited persist if a silent write failure shows.
 */
import { cronHandler } from "@/lib/utils/http";
import { refreshHealthDigest } from "@/lib/system/health-digest";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const digest = await refreshHealthDigest();
  return {
    generatedAt: digest.generatedAt,
    overall: digest.overall,
    counts: digest.counts,
    highlights: digest.highlights.length,
  };
});
