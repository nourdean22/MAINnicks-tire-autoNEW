/**
 * GET /api/cron/preference-tune · v10.0.526
 *
 * Arc B Feature 1 · weekly preference self-tune.
 *
 * Folded into mega-evening Sunday block (see config/crons.ts entry
 * with mode="folded" foldedInto="mega-evening" — the manifest +
 * mega/route.ts both gate Sunday-only execution).
 *
 * Reads the last 7 days of chat_feedback audit events, scores each
 * referenced assistant reply on the 8 style axes, averages the
 * deltas, and applies a weighted update to the operator's
 * preference vector. Idempotent · safe to re-run.
 */

import { cronHandler } from "@/lib/utils/http";
import { runWeeklyTune } from "@/lib/brain/preference-inference";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const result = await runWeeklyTune();

  // Heartbeat row · the operator dashboard reads this to show
  // "last tune at ..." and the sample size.
  void prisma.brainMemory
    .create({
      data: {
        category: "preference_tune",
        key: new Date().toISOString().slice(0, 10),
        source: "cron:preference-tune",
        content: `tuned · n=${result.sampleSize} · rate=${result.learningRate}`,
        confidence: 0.9,
        metadata: {
          prev: result.prev,
          next: result.next,
          sampleSize: result.sampleSize,
          learningRate: result.learningRate,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch(() => undefined);

  return {
    ok: true,
    sampleSize: result.sampleSize,
    learningRate: result.learningRate,
    prev: result.prev,
    next: result.next,
  };
});
