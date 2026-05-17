/**
 * GET /api/cron/decision-replay · v10.0.528 · Arc B · Feature 3
 *
 * Folded into mega-morning. Picks up to 5 MasteryDecisions whose age ≥
 * 30d AND aren't already reviewed, builds the replay prompts, and
 * persists each prompt as a BrainMemory(category="decision_replay_due",
 * key="replay_due_<decisionId>") so the morning-brief Personal slice
 * can read them without re-running the recall pipeline.
 *
 * Idempotency · the BrainMemory upsert is keyed by decisionId, so the
 * row is created once and only updated if the cron re-fires the same
 * day. The morning-brief consumer marks it consumed by checking
 * BrainMemory metadata.consumedAt · keeps the cron and the brief
 * fully decoupled.
 *
 * Hard cap · 60s. 5 replays × ~1.5s per wisdom-match ≤ 8s typical.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import {
  pickDueReplays,
  gatherOutcomeSignals,
  matchWisdom,
  composeReplayPrompt,
} from "@/lib/services/decision-replay-coach";

const log = rootLogger.withSurface("cron/decision-replay");

export const maxDuration = 60;

const REPLAY_LIMIT = 5;

export const GET = cronHandler(async () => {
  const t0 = Date.now();
  const due = await pickDueReplays(REPLAY_LIMIT);

  if (due.length === 0) {
    log.info("no_due_replays");
    return { ok: true, dueCount: 0, queued: 0, durationMs: Date.now() - t0 };
  }

  let queued = 0;
  let wisdomMatched = 0;
  const writes: Array<Promise<unknown>> = [];

  for (const decision of due) {
    try {
      const signals = await gatherOutcomeSignals(decision);
      const wisdom = await matchWisdom(decision, signals);
      const prompt = composeReplayPrompt(decision, signals, wisdom);
      if (wisdom) wisdomMatched++;

      // Persist the prompt so the morning-brief can read it. Upsert
      // by category+key · the morning-brief check is "consumedAt is
      // null in metadata", so re-runs of this cron in the same day
      // don't accidentally re-queue an already-shown prompt.
      const key = `replay_due_${decision.id}`;
      writes.push(
        prisma.brainMemory.upsert({
          where: { category_key: { category: "decision_replay_due", key } },
          create: {
            category: "decision_replay_due",
            key,
            content: prompt.text,
            source: "cron:decision-replay",
            confidence: 0.9,
            metadata: {
              decisionId: decision.id,
              title: decision.title,
              ageDays: decision.ageDays,
              wisdomKey: wisdom?.key ?? null,
              wisdomSim: wisdom?.similarity ?? null,
              signals: {
                tasksCompleted: signals.tasksCompleted,
                tasksAbandoned: signals.tasksAbandoned,
                driftAlertCount: signals.driftAlertCount,
                topicalMemoryCount: signals.topicalMemoryCount,
                commitments: signals.commitmentStatusDelta,
              },
              consumedAt: null,
              queuedAt: new Date().toISOString(),
            },
          },
          // On retry · refresh signals + text but preserve consumedAt
          // if the morning-brief already showed it. We can't conditionally
          // merge JSON metadata in Prisma, so the update writes a fresh
          // metadata object and the morning-brief is responsible for
          // setting consumedAt at consumption time.
          update: {
            content: prompt.text,
            metadata: {
              decisionId: decision.id,
              title: decision.title,
              ageDays: decision.ageDays,
              wisdomKey: wisdom?.key ?? null,
              wisdomSim: wisdom?.similarity ?? null,
              signals: {
                tasksCompleted: signals.tasksCompleted,
                tasksAbandoned: signals.tasksAbandoned,
                driftAlertCount: signals.driftAlertCount,
                topicalMemoryCount: signals.topicalMemoryCount,
                commitments: signals.commitmentStatusDelta,
              },
              consumedAt: null,
              queuedAt: new Date().toISOString(),
            },
          },
        }),
      );
      queued++;
    } catch (err) {
      log.warn("queue_failed_for_decision", {
        decisionId: decision.id,
        err: String(err),
      });
    }
  }

  await Promise.allSettled(writes);

  log.info("decision_replays_queued", {
    dueCount: due.length,
    queued,
    wisdomMatched,
    durationMs: Date.now() - t0,
  });

  return {
    ok: true,
    dueCount: due.length,
    queued,
    wisdomMatched,
    durationMs: Date.now() - t0,
  };
});
