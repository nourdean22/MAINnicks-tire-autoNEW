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
 * Idempotent · keys are date-stamped so re-running same day
 * rewrites today's row but doesn't pollute the corpus.
 *
 * Auth · CRON_SECRET bearer (matches v10.0.370 agent-eval pattern).
 */

import { NextResponse } from "next/server";
import { runImproveAgent } from "@/lib/brain/improve-agent";
import { runWisdomEvolution } from "@/lib/brain/wisdom-evolution";
import { brainMemory } from "@/lib/brain/memory-manager";

export const maxDuration = 120;

function authorizeCron(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return auth === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

  return NextResponse.json({
    ok: errors.length === 0,
    durationMs: Date.now() - startedAt,
    improve: {
      judgmentCount: improveJudgmentCount,
      hypothesisCount: improveHypothesisCount,
      persisted: improvePersisted,
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
