/**
 * lib/ai/reasoning/persist-conclusion.ts · 2026-08-19 · outcome-loop wave.
 *
 * The recallable half of a reasoning run. persistTrace (engine.ts) keeps
 * writing the raw `reasoning_trace` bookkeeping row exactly as before —
 * budget.ts sums daily spend from that category, telemetry/history read
 * it, and it is deliberately recall-EXCLUDED (no embedding). What was
 * missing is the other half: the intelligence-architecture audit's
 * verdict was "Nick reasons hard, then forgets what he concluded" —
 * nothing a reasoning run produced could ever re-enter chat context.
 *
 * This module writes ONE distilled `reasoning_conclusion` row per run:
 *   · content sized for recall (question → conclusion, not the full trace)
 *   · inline embedding via storeMemoryEmbedding — the precondition the
 *     memory-recall whitelist note demanded ("revisit only with an
 *     embedding step")
 *   · expiresAt +90d — conclusions age out via the data-cleanup sweeper
 *     (same TTL doctrine as the one-shot judgment categories); the raw
 *     trace keeps its own 500-row rotation independently
 *   · confidence = the engine's own confidence for the run
 *
 * Separate module (not inlined in engine.ts) so it is testable without
 * importing the 1,600-line engine and its provider stack. Fire-and-forget
 * safe: never throws into the engine.
 */
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const CONCLUSION_TTL_DAYS = 90;
const QUESTION_SLICE = 200;
const ANSWER_SLICE = 500;

export interface ConclusionInput {
  question: string;
  answer: string;
  confidence: number;
  tier: string;
  /** The reasoning_trace row's key, for provenance joins. */
  traceKey: string;
}

/** Exported for tests — the exact content the row carries. */
export function composeConclusionContent(input: ConclusionInput): string {
  const q = input.question.replace(/\s+/g, " ").trim().slice(0, QUESTION_SLICE);
  const a = input.answer.replace(/\s+/g, " ").trim().slice(0, ANSWER_SLICE);
  return `Reasoned (${input.tier}): ${q} → concluded: ${a}`;
}

export async function persistReasoningConclusion(
  input: ConclusionInput,
): Promise<void> {
  try {
    if (!input.answer.trim() || !input.question.trim()) return;
    const { prisma } = await import("@/lib/prisma");
    const content = composeConclusionContent(input);
    const row = await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.REASONING_CONCLUSION,
        key: `reasoning_conclusion:${input.traceKey}`,
        content,
        confidence: Math.max(0, Math.min(1, input.confidence)),
        source: "reasoning-engine",
        createdBy: "system",
        expiresAt: new Date(Date.now() + CONCLUSION_TTL_DAYS * 86_400_000),
        metadata: { tier: input.tier, traceKey: input.traceKey },
      },
      select: { id: true },
    });

    // Embed now — without a vector the row is invisible to both recall
    // lanes' vector paths; the nightly embed-backfill would repair a
    // failure here, so the catch stays silent-but-logged.
    const { storeMemoryEmbedding } = await import("@/lib/brain/embedding-utils");
    await storeMemoryEmbedding(row.id, content).catch((err) => {
      logError("reasoning.persist-conclusion", err, { stage: "embed", traceKey: input.traceKey }, "warn");
    });
  } catch (err) {
    // Never throw into the engine — bookkeeping must not block results.
    logError("reasoning.persist-conclusion", err, { stage: "create", traceKey: input.traceKey }, "warn");
  }
}
