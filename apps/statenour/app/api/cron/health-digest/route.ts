/**
 * GET /api/cron/health-digest — nightly system-health push
 *
 * Runs 4am ET via vercel.json cron. Computes a compact digest of
 * every diagnostic surface (crons, stale data, env readiness,
 * Google OAuth) and persists it as a BrainMemory row. HQ picks up
 * the latest digest to render a morning card.
 *
 * Why a cron: "pull" diagnostics (Nour opens /system/diagnostics)
 * only catch issues he thinks to look for. "Push" digests surface
 * silent degradation without him having to remember to check.
 */

import { cronHandler } from "@/lib/utils/http";
import {
  computeHealthDigest,
  persistHealthDigest,
} from "@/lib/system/health-digest";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const digest = await computeHealthDigest();
  await persistHealthDigest(digest);
  return {
    generatedAt: digest.generatedAt,
    overall: digest.overall,
    counts: digest.counts,
    highlights: digest.highlights.length,
  };
});
