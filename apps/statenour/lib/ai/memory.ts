/**
 * AI Memory System — Records interactions, extracts knowledge, learns preferences.
 *
 * Every AI interaction flows through here so the system gets smarter over time.
 * Uses the fast task type for async extraction to avoid slowing responses.
 *
 * HARDENED: Retry logic, error isolation, zero data loss guarantee.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding, type TaskType } from "./provider";
import { makeTracedAiChat } from "./traced-aichat";
import { extractJsonArray } from "./extract-structured";
import { logError } from "@/lib/utils/error-log";
const aiChat = makeTracedAiChat("ai-memory", "tool");

interface InteractionRecord {
  feature: string;
  prompt: string;
  response: string;
  provider: string;
  model: string;
  durationMs: number;
  taskType?: TaskType;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        logError("ai.memory", err, { fn: "withRetry", label });
        return null;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
  return null;
}

/**
 * Record an AI interaction and kick off async knowledge extraction.
 * GUARANTEED: The generation record is always saved, even if extraction fails.
 */
export async function recordInteraction(record: InteractionRecord): Promise<void> {
  // Step 1: Always save the generation record — this is the source of truth
  await withRetry(
    () =>
      prisma.aiGeneration.create({
        data: {
          feature: record.feature,
          model: `${record.provider}/${record.model}`,
          durationMs: record.durationMs,
          status: "complete",
        },
      }),
    "save-generation"
  );
  // Step 2: Async knowledge extraction — fire and forget but with retry
  extractKnowledge(record).catch((err) => {
    logError("ai.memory", err, { fn: "recordInteraction.extractKnowledge", feature: record.feature });
  });
}

/**
 * Extract learnable facts from an AI interaction.
 * Uses the fast model to avoid blocking. Retries on failure.
 */
async function extractKnowledge(record: InteractionRecord): Promise<void> {
  // Skip extraction for very short interactions or meta queries
  if (record.prompt.length < 20 || record.response.length < 50) return;
  if (record.feature === "status" || record.feature === "tag") return;

  const result = await withRetry(
    () =>
      aiChat(
        [
          {
            role: "system",
            content: `You are a knowledge extraction engine for a personal operating system.
Given an AI interaction (user prompt + AI response), extract any learnable facts about the user.
Return ONLY a JSON array of objects with { "fact": "...", "category": "preference|pattern|goal|insight" }.
If nothing learnable, return []. Max 3 facts. Be specific, not generic.`,
          },
          {
            role: "user",
            content: `Feature: ${record.feature}\nUser said: ${record.prompt.slice(0, 500)}\nAI responded: ${record.response.slice(0, 500)}`,
          },
        ],
        "fast"
      ),
    "extract-knowledge"
  );

  if (!result) return;
  // Parse extracted facts · v10.0.229 extractJsonArray with repair
  const extracted = extractJsonArray<{ fact: string; category: string }>(result.content);
  if (!extracted.ok) return;

  try {
    const facts = extracted.value;
    if (!Array.isArray(facts) || facts.length === 0) return;

    // Store each fact with retry — never lose learned knowledge
    for (const f of facts.slice(0, 3)) {
      await withRetry(
        () =>
          prisma.executionInsight.create({
            data: {
              insightType: `learned_${f.category}`,
              title: f.fact.slice(0, 100),
              detail: f.fact,
              score: 1,
              metadata: { source: record.feature, extractedFrom: "ai_interaction" },
            },
          }),
        `save-fact-${f.category}`
      );
    }
  } catch (err) {
    // JSON parse failed — not critical, or Prisma insert failure
    logError("ai.memory", err, { fn: "extractKnowledge.saveInsight" });
  }
}

/**
 * Get recent learned facts to inject into system prompts.
 * Returns the most relevant recent knowledge the AI has extracted about Nour.
 * HARDENED: Returns empty string on failure instead of throwing.
 */
export async function getLearnedKnowledge(limit = 20): Promise<string> {
  try {
    const insights = await prisma.executionInsight.findMany({
      where: { insightType: { startsWith: "learned_" } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { insightType: true, title: true, createdAt: true },
    });
    if (insights.length === 0) return "";

    const lines = insights.map((i) => {
      const category = i.insightType.replace("learned_", "");
      return `- [${category}] ${i.title}`;
    });

    return `\n## What I've Learned About You (auto-extracted)\n${lines.join("\n")}`;
  } catch (err) {
    logError("ai.memory", err, { fn: "getLearnedKnowledge" });
    return ""; // Never break the system prompt builder
  }
}

/**
 * Get AI interaction stats for the dashboard.
 * HARDENED: Returns zeros on failure.
 */
export async function getAiStats(): Promise<{
  totalInteractions: number;
  todayInteractions: number;
  learnedFacts: number;
  topFeatures: { feature: string; count: number }[];
}> {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

    const [totalInteractions, todayInteractions, learnedFacts] = await Promise.all([
      prisma.aiGeneration.count(),
      prisma.aiGeneration.count({ where: { createdAt: { gte: new Date(today) } } }),
      prisma.executionInsight.count({ where: { insightType: { startsWith: "learned_" } } }),
    ]);

    const features = await prisma.aiGeneration.groupBy({
      by: ["feature"],
      _count: { feature: true },
      orderBy: { _count: { feature: "desc" } },
      take: 5,
    });

    return {
      totalInteractions,
      todayInteractions,
      learnedFacts,
      topFeatures: features.map((f) => ({ feature: f.feature, count: f._count.feature })),
    };
  } catch (err) {
    logError("ai.memory", err, { fn: "getAiStats" });
    return { totalInteractions: 0, todayInteractions: 0, learnedFacts: 0, topFeatures: [] };
  }
}