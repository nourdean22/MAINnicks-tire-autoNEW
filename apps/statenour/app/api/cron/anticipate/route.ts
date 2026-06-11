/**
 * GET /api/cron/anticipate · v10.0.526 · Arc B Feature 6
 *
 * Folded into mega-evening · runs once a night (also safe to call
 * standalone). Builds tomorrow's anticipated question set:
 *
 *   gatherSignals(7) → draftAnticipatedQuestions → precomputeAnswers
 *   → storeAnticipated · upserts BrainMemory(anticipated_question)
 *
 * Idempotent per day · the upsert key is `anticipated_<YYYY-MM-DD>`
 * so a retry collapses to the same row. We still short-circuit if
 * today's row was already built within the last 6h · keeps the
 * mega-evening fan-out under budget when both retries fire.
 *
 * Hard cap · 60s total. 3 questions × 10s precompute timeout = 30s
 * worst case for the heavy step. Draft call adds ~2-5s. Plenty of
 * headroom for the DB writes.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import {
  gatherSignals,
  draftAnticipatedQuestions,
  precomputeAnswers,
  storeAnticipated,
  todayKey,
} from "@/lib/brain/anticipated-questions";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/anticipate");

// Pro plan: 300s ceiling. We cap at 60 to honor the mega-evening
// child budget — the fan-out launches 6 workers in parallel and a
// runaway child can starve the others.
export const maxDuration = 60;

/** Skip-window for in-day retries · 6h is "the situation didn't change". */
const SKIP_WINDOW_MS = 6 * 60 * 60 * 1000;

export const GET = cronHandler(async () => {
  const date = todayKey();
  const key = `anticipated_${date}`;

  // Idempotency · if today's row was built within the last 6h, skip.
  // A retry beyond that window re-runs (fresh signals, fresh answers).
  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "anticipated_question", key } },
      select: { updatedAt: true },
    })
    .catch(() => null as { updatedAt: Date } | null);

  if (existing && Date.now() - existing.updatedAt.getTime() < SKIP_WINDOW_MS) {
    return {
      ok: true,
      skipped: true,
      reason: "already_built_within_skip_window",
      date,
      lastBuiltAt: existing.updatedAt.toISOString(),
    };
  }

  const t0 = Date.now();

  // 1. Gather signals · cheap parallel DB queries.
  const signals = await gatherSignals(7);
  const tGather = Date.now() - t0;

  // Cold start · no signals · write an empty marker so downstream
  // surfaces don't blow up, and exit early.
  if (signals.total === 0) {
    await storeAnticipated([], [], { date });
    log.info("cold_start_no_signals", { date });
    return {
      ok: true,
      date,
      empty: true,
      reason: "no_signals_in_7d_window",
      durationMs: Date.now() - t0,
    };
  }

  // 2. Draft 3 questions · single factual LLM call.
  const tDraftStart = Date.now();
  const questions = await draftAnticipatedQuestions(signals);
  const tDraft = Date.now() - tDraftStart;

  if (questions.length === 0) {
    // Draft failed (parse error, provider outage) · still write the
    // empty row so the morning brief renders cleanly. Operator sees
    // "no anticipated questions today" instead of stale data.
    await storeAnticipated([], [], { date });
    log.warn("draft_returned_empty", { signalCount: signals.total });
    return {
      ok: true,
      date,
      empty: true,
      reason: "draft_returned_empty",
      signalCount: signals.total,
      gatherMs: tGather,
      draftMs: tDraft,
      durationMs: Date.now() - t0,
    };
  }

  // 3. Precompute answers · per-question 10s budget, parallel — worst
  //    case ~10s wall for the step (3 x 10s budgets race together).
  //    This step existed in the doc-comment contract from day one but
  //    was never built — storeAnticipated always received [] so the
  //    chat match + morning brief had no takes to surface (evolution
  //    audit 2026-06-10). Per-question failures degrade to null.
  const tPrecomputeStart = Date.now();
  const answers = await precomputeAnswers(questions);
  const tPrecompute = Date.now() - tPrecomputeStart;

  // 4. Store · upsert into BrainMemory.
  const tStoreStart = Date.now();
  const stored = await storeAnticipated(questions, answers, { date });
  const tStore = Date.now() - tStoreStart;

  const answerCount = answers.filter((a) => typeof a === "string" && a.length > 0).length;
  log.info("anticipate_done", {
    date,
    signalCount: signals.total,
    questionCount: questions.length,
    answerCount,
    gatherMs: tGather,
    draftMs: tDraft,
    precomputeMs: tPrecompute,
    storeMs: tStore,
    totalMs: Date.now() - t0,
  });

  return {
    ok: true,
    date,
    signalCount: signals.total,
    questionCount: questions.length,
    answerCount,
    builtAt: stored.builtAt,
    timing: {
      gatherMs: tGather,
      draftMs: tDraft,
      precomputeMs: tPrecompute,
      storeMs: tStore,
      totalMs: Date.now() - t0,
    },
  };
});
