/**
 * /api/cron/brain-feedback-loop · v10.0.408
 *
 * Daily cron that closes the eval feedback loop and refreshes
 * wisdom evolution candidates:
 *
 *   1. runImproveAgent(7) · last 7d of LLM-as-judge scores →
 *      improvement hypotheses (axis failure clusters) ·
 *      persists `improvement_hypothesis` brain memories
 *
 *   2. runWisdomEvolution() · stale + redundant + low-trust
 *      wisdom candidates · persists count summary as a
 *      `evolution_summary` brain memory · operator confirms
 *      individual moves on /brain/wisdom
 *
 *   3. runSuggestionImproveAgent() · last 30d of suggestion-loop
 *      act/dismiss signals → per-kind `suggestion_hypothesis`
 *      brain memories flagging noisy suggestion kinds
 *
 * Idempotent · keys are date-stamped so re-running same day
 * rewrites today's row but doesn't pollute the corpus.
 *
 * Auth · CRON_SECRET bearer (matches v10.0.370 agent-eval pattern).
 */

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { runImproveAgent } from "@/lib/brain/improve-agent";
import { runSuggestionImproveAgent } from "@/lib/brain/suggestion-improve";
import { runWisdomEvolution } from "@/lib/brain/wisdom-evolution";
import { brainMemory } from "@/lib/brain/memory-manager";

export const maxDuration = 120;

export async function GET(req: Request) {
  // 2026-05-24 · Wave X.e · timing-safe auth via shared
  // `requireCronAuth` · pre-fix this route inlined a plain
  // string-equality `authorizeCron` that leaked timing
  // information on the Bearer comparison.
  try {
    requireCronAuth(req);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const errors: string[] = [];

  // 1 · improve-agent · always persist (cron is the canonical writer)
  let improvePersisted = 0;
  let improveJudgmentCount = 0;
  let improveHypothesisCount = 0;
  try {
    const result = await runImproveAgent(7);
    improveJudgmentCount = result.judgmentCount;
    improveHypothesisCount = result.hypotheses.length;
    improvePersisted = result.persisted;
  } catch (err) {
    errors.push(`improve-agent: ${(err as Error).message?.slice(0, 200)}`);
  }

  // 2 · wisdom-evolution · summary memory + counts (individual moves
  // happen via operator UI; cron just keeps the snapshot fresh)
  let staleCount = 0;
  let redundantCount = 0;
  let lowTrustCount = 0;
  try {
    const result = await runWisdomEvolution();
    staleCount = result.stale.length;
    redundantCount = result.redundant.length;
    lowTrustCount = result.lowTrust.length;

    const summary = `Evolution ${result.totalCandidates} candidates · stale ${staleCount} · redundant ${redundantCount} · low-trust ${lowTrustCount}`;
    await brainMemory.remember(
      "evolution_summary",
      `evolution_${today}`,
      summary,
      "brain-feedback-loop",
      {
        date: today,
        staleCount,
        redundantCount,
        lowTrustCount,
        totalCandidates: result.totalCandidates,
      },
    ).catch((err) => {
      errors.push(`evolution-persist: ${(err as Error).message?.slice(0, 200)}`);
    });
  } catch (err) {
    errors.push(`wisdom-evolution: ${(err as Error).message?.slice(0, 200)}`);
  }

  // 3 · suggestion-improve · per-kind hypotheses from the suggestion-loop.
  //     runSuggestionImproveAgent is self-protecting; the try/catch here
  //     mirrors blocks 1-2 so a regression can never reach the response.
  let suggestionHypothesisCount = 0;
  let suggestionPersisted = 0;
  try {
    const result = await runSuggestionImproveAgent(30);
    suggestionHypothesisCount = result.hypotheses.length;
    suggestionPersisted = result.persisted;
  } catch (err) {
    errors.push(`suggestion-improve: ${(err as Error).message?.slice(0, 200)}`);
  }

  return NextResponse.json({
    ok: errors.length === 0,
    durationMs: Date.now() - startedAt,
    improve: {
      judgmentCount: improveJudgmentCount,
      hypothesisCount: improveHypothesisCount,
      persisted: improvePersisted,
    },
    suggestion: {
      hypothesisCount: suggestionHypothesisCount,
      persisted: suggestionPersisted,
    },
    evolution: {
      staleCount,
      redundantCount,
      lowTrustCount,
      totalCandidates: staleCount + redundantCount + lowTrustCount,
    },
    errors,
  });
}
