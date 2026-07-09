import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
/**
 * lib/ai/personas/scorer.ts · Phase N.6 (2026-05-18 PM)
 *
 * Sub-agent / persona effectiveness scoring. Reads the reasoning_trace
 * BrainMemory rows (Phase H.2.2 persistence) plus persona_usage rows
 * (new this wave) to compute which personas reliably produce high-
 * confidence answers.
 *
 * The scorer doesn't yet ALTER runMultiAgent's persona selection
 * (that's H+ scope · would need runMultiAgent rewrite to read scores
 * before picking sub-agents). What it DOES today:
 *   · Provides a queryable score per persona key
 *   · Lets the operator surface "your best personas this week"
 *     in /system/reviews or /reason/telemetry
 *   · Sets up the data plumbing so the future tuner can read it
 *
 * Scoring rules · same buckets as classifier-tuner (H.5.3 + N.2):
 *   · good · avgConfidence ≥ 0.75 AND fallbackRate < 10%
 *   · ok   · avgConfidence ≥ 0.5  AND fallbackRate < 25%
 *   · tune · everything else
 *
 * Min sample size of 3 runs per persona before scoring · we don't
 * want to demote a persona on 1 unlucky run.
 */

export interface PersonaScore {
  personaKey: string;
  /** Human-readable role (from persona library) */
  role: string;
  /** Run count */
  runs: number;
  /** Mean operator-facing confidence (0-1) */
  avgConfidence: number;
  /** % of runs that hit the H.5.3 fallback threshold (conf ≤ 0.3) */
  fallbackRate: number;
  /** Verdict bucket matching classifier-tuner's taxonomy */
  verdict: "good" | "ok" | "tune";
  /** Most recent run timestamp */
  lastSeenAt: string | null;
}

const MIN_SAMPLE = 3;

/** Record a persona's contribution to a reasoning run · called from
 *  runMultiAgent after a sub-agent completes. Best-effort · failure
 *  here never affects the engine's return.
 *
 *  Metadata flowed: persona key, parent run's confidence, parent
 *  run's tier, ms spent in this sub-agent. */
export async function recordPersonaUsage(args: {
  personaKey: string;
  parentTier: string;
  parentConfidence: number;
  parentRunId?: string;
  durationMs: number;
}): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.PERSONA_USAGE,
        key: `persona_${args.personaKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        content: `${args.personaKey} ran for ${args.parentTier} (${args.durationMs}ms · confidence ${args.parentConfidence.toFixed(2)})`,
        confidence: args.parentConfidence,
        source: "persona-scorer",
        createdBy: "system",
        metadata: {
          personaKey: args.personaKey,
          parentTier: args.parentTier,
          parentConfidence: args.parentConfidence,
          parentRunId: args.parentRunId,
          durationMs: args.durationMs,
        },
      },
    });
  } catch (err) {
    // best-effort
    void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.personas.scorer", err, { fn: "recordPersonaUsage" }, "warn"));
  }
}

/** Read the last N persona_usage rows · score each persona · return
 *  sorted by run count. Caller decides what to do with the verdict
 *  (display in telemetry · feed a future persona-selection tuner). */
export async function scorePersonas(
  options?: { lookbackRows?: number; minSample?: number },
): Promise<PersonaScore[]> {
  const lookback = options?.lookbackRows ?? 500;
  const minSample = options?.minSample ?? MIN_SAMPLE;
  try {
    const { prisma } = await import("@/lib/prisma");
    const { PERSONAS } = await import("./index");
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.PERSONA_USAGE, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: lookback,
      select: { confidence: true, createdAt: true, metadata: true },
    });

    // Group by personaKey (Map.groupBy from L.2 pattern · ES2024)
    const usageByPersona = Map.groupBy(rows, (r) => {
      const m = (r.metadata ?? {}) as { personaKey?: string };
      return m.personaKey ?? "unknown";
    });

    const scores: PersonaScore[] = [];
    for (const [personaKey, items] of usageByPersona) {
      if (items.length < minSample) continue;
      const confidences = items.map((i) => i.confidence ?? 0);
      const fallbacks = confidences.filter((c) => c <= 0.3).length;
      const avg =
        confidences.reduce((s, n) => s + n, 0) / Math.max(1, confidences.length);
      const fb = (fallbacks / items.length) * 100;
      const verdict: PersonaScore["verdict"] =
        avg >= 0.75 && fb < 10
          ? "good"
          : avg >= 0.5 && fb < 25
            ? "ok"
            : "tune";
      const role = PERSONAS[personaKey]?.role ?? personaKey;
      const lastSeenAt =
        items[0]?.createdAt?.toISOString?.() ?? null;
      scores.push({
        personaKey,
        role,
        runs: items.length,
        avgConfidence: Math.round(avg * 1000) / 1000,
        fallbackRate: Math.round(fb * 10) / 10,
        verdict,
        lastSeenAt,
      });
    }
    return scores.toSorted((a, b) => b.runs - a.runs);
  } catch (err) {
    void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.personas.scorer", err, { fn: "scorePersonas" }, "error"));
    return [];
  }
}

