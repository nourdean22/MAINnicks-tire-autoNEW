/**
 * GET /api/cron/judge-eval-shadow · Phase X (2026-05-18 PM)
 *
 * Daily shadow-execute cron · the operator-free auto-corpus-builder
 * for the AGENT_V1 → AGENT_V2 (prompt builder) migration.
 *
 * What it does:
 *   1. Pulls N fresh candidate prompts from the sampler (filters out
 *      already-compared rows automatically · see W.2)
 *   2. For each prompt: replays through BOTH V1 and V2 prompt builders
 *      in parallel via `replayPair` · captures matched reply pairs
 *   3. Judges each pair via `compareReplies` (LLM-as-judge · 4 dims)
 *   4. Persists with sourceMessageId so the next run skips this row
 *
 * Why this closes the migration's last Phase 0 checkbox:
 * Pre-X · operator had to manually curl /api/ai/chat with the
 * x-force-agent header for V1 + V2 captures (W workflow). That works
 * but requires the operator to be present and motivated. Post-X · the
 * corpus fills itself overnight without operator action · the
 * /system/judge-eval verdict moves from "insufficient-data" to
 * "safe" / "watch" / "regressing" automatically as samples accumulate.
 *
 * Budget guard · max MAX_REPLAYS_PER_RUN per cron fire (default 5).
 * At ~$0.005/pair (V1 + V2 LLM calls + judge call) this caps daily
 * spend at ~$0.025 · trivial · safe to add to the mega-evening slot.
 *
 * Coexistence note · the per-request /api/judge-eval/run endpoint (V.6)
 * stays mounted · operators can still post comparisons manually with
 * arbitrary intent classes when investigating specific regressions.
 */

import { cronHandler } from "@/lib/utils/http";
import { readRecentV2Samples } from "@/lib/ai/judge-eval/sampler";
import { replayPair } from "@/lib/ai/judge-eval/replay";
import { compareReplies } from "@/lib/ai/judge-eval/comparator";
import { recordComparison } from "@/lib/ai/judge-eval/persistence";
import { logger as rootLogger } from "@/lib/logger";
// 2026-05-23 · Q2 · drain the shadow-queue at the end of the cron tick.
// Closes the V1→V2 cutover quality-signal gap by writing
// prompt.shadow.judge_score_delta SystemMetric rows from operator-real
// turns (sampled at ~10% by the shadow path · queued for offline judging).
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("cron/judge-eval-shadow");

/** Conservative daily ceiling. Tune via env if needed. */
const MAX_REPLAYS_PER_RUN_DEFAULT = 5;
const MAX_REPLAYS_PER_RUN_CEILING = 25;

export const maxDuration = 240;
export const dynamic = "force-dynamic";

/** Parse the per-run budget · clamp to safety ceiling. */
function resolveBudget(): number {
  const raw = process.env.JUDGE_EVAL_SHADOW_MAX_PER_RUN;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(parsed, MAX_REPLAYS_PER_RUN_CEILING);
  }
  return MAX_REPLAYS_PER_RUN_DEFAULT;
}

interface RunResult {
  samples: number;
  replayed: number;
  judged: number;
  persisted: number;
  skipped: number;
  v2WinCount: number;
  v1WinCount: number;
  tieCount: number;
  durationMs: number;
  budget: number;
  // 2026-05-23 · Q2 · shadow-queue drain stats.
  queueDrained?: number;
  queueJudged?: number;
}

export const GET = cronHandler(async (): Promise<RunResult> => {
  const startedAt = Date.now();
  const budget = resolveBudget();

  const samples = await readRecentV2Samples({
    take: budget,
    sinceDays: 7,
    excludeAlreadyCompared: true,
  });

  const stats: RunResult = {
    samples: samples.length,
    replayed: 0,
    judged: 0,
    persisted: 0,
    skipped: 0,
    v2WinCount: 0,
    v1WinCount: 0,
    tieCount: 0,
    durationMs: 0,
    budget,
  };

  if (samples.length === 0) {
    stats.durationMs = Date.now() - startedAt;
    log.info("shadow_run_empty", { budget });
    return stats;
  }

  // Sequential not parallel · each pair fires V1 + V2 + judge = 3 LLM
  // calls. Running N pairs in parallel would 3x the provider chain
  // pressure during a single cron tick. Sequential keeps it gentle ·
  // 5 samples × ~6s/sample = ~30s wall time · well under the 240s
  // route ceiling.
  for (const sample of samples) {
    try {
      const pair = await replayPair({ prompt: sample.prompt });
      stats.replayed++;

      if (!pair.bothSucceeded) {
        log.debug("shadow_replay_partial", {
          messageId: sample.messageId,
          v1Empty: !pair.v1Reply,
          v2Empty: !pair.v2Reply,
        });
        stats.skipped++;
        continue;
      }

      const judgment = await compareReplies({
        prompt: sample.prompt,
        v1Reply: pair.v1Reply,
        v2Reply: pair.v2Reply,
        intentClass: sample.intentClass ?? undefined,
      });
      stats.judged++;

      if (!judgment.parsed) {
        // Judge LLM returned unparseable output · still persist (the
        // dashboard surfaces the parsed:false flag) so operator can
        // spot judge-failure trends.
        log.debug("shadow_judge_unparsed", { messageId: sample.messageId });
      }

      const id = await recordComparison({
        prompt: sample.prompt,
        v1Reply: pair.v1Reply,
        v2Reply: pair.v2Reply,
        judgment,
        intentClass: sample.intentClass ?? undefined,
        sourceMessageId: sample.messageId,
      });

      if (id) {
        stats.persisted++;
        if (judgment.winner === "v2") stats.v2WinCount++;
        else if (judgment.winner === "v1") stats.v1WinCount++;
        else stats.tieCount++;
      } else {
        stats.skipped++;
      }
    } catch (e) {
      stats.skipped++;
      log.warn("shadow_sample_failed", {
        messageId: sample.messageId,
        err: (e as Error).message?.slice(0, 200),
      });
    }
  }

  // 2026-05-23 · Q2 · drain the shadow-queue. Pre-filled by the live
  // shadow path at ~10% sample rate of real chat turns. Each row has
  // v1Prompt + v2Prompt + userMessage in metadata. We score by judging
  // the v2 prompt against the v1 prompt using the same LLM-judge that
  // scored the sampler-driven batch above. Result lands as a
  // SystemMetric row at metric="prompt.shadow.judge_score_delta" so
  // /system/judge-eval can chart it alongside the structural delta.
  //
  // Budget: drain up to (budget - replayed) so the total LLM-call
  // count per tick stays at `budget`. If sampler ate the whole budget,
  // queue waits until tomorrow.
  let queueDrained = 0;
  let queueJudged = 0;
  const remaining = budget - stats.replayed;
  if (remaining > 0) {
    try {
      const queueRows = await prisma.brainMemory.findMany({
        where: {
          category: BRAIN_CATEGORIES.PROMPT_SHADOW_JUDGE_QUEUE,
          deletedAt: null,
          // Don't re-process already-judged rows (the metadata.judged
          // flag flips to true once we score them below).
          metadata: { path: ["judged"], equals: false },
        },
        orderBy: { createdAt: "asc" },
        take: remaining,
        select: { id: true, key: true, metadata: true },
      });

      for (const row of queueRows) {
        const meta = (row.metadata ?? {}) as {
          userMessage?: string;
          v1Prompt?: string;
          v2Prompt?: string;
          intentClass?: string | null;
          tier?: string;
          slot?: string;
        };
        if (!meta.userMessage || !meta.v1Prompt || !meta.v2Prompt) {
          // Malformed entry · skip + mark judged so it doesn't requeue.
          await prisma.brainMemory
            .update({
              where: { id: row.id },
              data: {
                metadata: { ...meta, judged: true, error: "malformed" },
              },
            })
            .catch(() => {});
          continue;
        }
        try {
          // The shadow path captured v1+v2 system prompts at the
          // moment the chat turn fired. Pass them to replayPair so
          // we score the EXACT historical prompts · not the current
          // builder output. This is what makes the queue valuable
          // vs just re-sampling chat messages.
          //
          // 2026-05-23 · audit follow-up · pre-fix this called
          // replayPair({ prompt: meta.userMessage }) with no
          // overrides · stored v1Prompt/v2Prompt were ignored · the
          // drain was effectively a duplicate sampler. Now actually
          // uses the captured pair.
          const pair = await replayPair({
            prompt: meta.userMessage,
            v1SystemPrompt: meta.v1Prompt,
            v2SystemPrompt: meta.v2Prompt,
          });
          queueDrained++;
          if (!pair.bothSucceeded) continue;
          const judgment = await compareReplies({
            prompt: meta.userMessage,
            v1Reply: pair.v1Reply,
            v2Reply: pair.v2Reply,
            intentClass: meta.intentClass ?? undefined,
          });
          queueJudged++;
          // Persist the score delta as a SystemMetric · separate
          // series from sampler-driven runs so /system/judge-eval
          // can show shadow-pair quality independently.
          await prisma.systemMetric.create({
            data: {
              metric: "prompt.shadow.judge_score_delta",
              value: judgment.v2Score - 50, // centered around 0 · +X = v2 wins
              unit: "score-delta",
              source: "shadow-queue-drain",
              tags: {
                winner: judgment.winner,
                v2Score: judgment.v2Score,
                tier: meta.tier ?? "unknown",
                slot: meta.slot ?? "unknown",
                intentClass: meta.intentClass ?? null,
                parsed: judgment.parsed,
              },
            },
          });
          // Mark the queue row as judged so the next tick skips it.
          await prisma.brainMemory.update({
            where: { id: row.id },
            data: {
              metadata: {
                ...meta,
                judged: true,
                judgedAt: new Date().toISOString(),
                winner: judgment.winner,
                v2Score: judgment.v2Score,
              },
            },
          });
        } catch (e) {
          log.warn("shadow_queue_drain_failed", {
            key: row.key,
            err: (e as Error).message?.slice(0, 200),
          });
        }
      }
    } catch (e) {
      log.warn("shadow_queue_read_failed", {
        err: (e as Error).message?.slice(0, 200),
      });
    }
  }

  stats.durationMs = Date.now() - startedAt;
  log.info("shadow_run_complete", {
    budget,
    samples: stats.samples,
    persisted: stats.persisted,
    v2WinCount: stats.v2WinCount,
    v1WinCount: stats.v1WinCount,
    tieCount: stats.tieCount,
    durationMs: stats.durationMs,
    queueDrained,
    queueJudged,
  });
  return { ...stats, queueDrained, queueJudged };
});
