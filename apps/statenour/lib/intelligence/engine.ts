import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { AIE_SYSTEM_PROMPT, AIE_EVALUATION_SCHEMA, AIEEvaluationResult } from "./prompts";
import { getActionabilityBand, IntelligenceSignalPayload } from "./types";
import { prisma } from "@/lib/prisma";

export async function processRawSignal(rawContent: string, sourceDomain: string): Promise<IntelligenceSignalPayload | null> {
  // 1. Execute LLM Derivative Extraction & Scoring
  const { object } = await generateObject({
    model: getModel("reason"),
    system: AIE_SYSTEM_PROMPT,
    prompt: `Analyze the following raw signal from ${sourceDomain}:\n\n${rawContent}`,
    schema: AIE_EVALUATION_SCHEMA,
  });

  const evaluation = object as AIEEvaluationResult;

  if (evaluation.isNoise) {
    // Drop noise entirely to save DB bloat
    console.log(`[AIE] Signal Dropped (Noise): ${evaluation.derivativeContext}`);
    return null;
  }

  // 2. Semantic Deduplication (Stubbed: normally we check vector_embeddings within the last 48 hours)
  // const embedding = await generateEmbedding(evaluation.derivativeContext);
  // const similar = await prisma.$queryRaw\`SELECT id FROM vector_embeddings WHERE ... < 0.15\`;
  const isDuplicate = false; // Replace with actual vector sim search
  
  if (isDuplicate) {
    console.log(`[AIE] Signal Dropped (Semantic Duplicate).`);
    return null;
  }

  // 3. Persist to DB (IntelligenceSignal)
  const signal = await prisma.intelligenceSignal.create({
    data: {
      source: sourceDomain,
      title: "Auto-Extracted Signal", // A real implementation would extract title
      summary: rawContent.substring(0, 500),
      derivativeContext: evaluation.derivativeContext,
      actionabilityIndex: evaluation.actionabilityIndex,
      status: "NEW",
    }
  });

  return {
    source: sourceDomain as any,
    title: signal.title,
    summary: signal.summary,
    derivativeContext: evaluation.derivativeContext,
    actionabilityIndex: evaluation.actionabilityIndex,
    metadata: {
      suggestedAction: evaluation.suggestedAction,
      dbId: signal.id
    }
  };
}
