/**
 * Memory / simulation action handlers.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split).
 */
import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { runSimulation } from "@/lib/brain/thinking-engine";
import type { ActionParams, ActionResult } from "./types";

export async function handleMemoryRemember(params: ActionParams, type: string): Promise<ActionResult> {
  const mem = await brainMemory.remember(
    String(params.category || BRAIN_CATEGORIES.INSIGHT),
    String(params.key || `nick_${Date.now()}`),
    String(params.content || ""),
    "nick_agent",
  );
  return { action: type, success: true, result: { id: mem.id } };
}

export async function handleMemoryForget(params: ActionParams, type: string): Promise<ActionResult> {
  await brainMemory.forget(String(params.id));
  return { action: type, success: true, result: { deleted: true } };
}

export async function handleSimulationRun(params: ActionParams, type: string): Promise<ActionResult> {
  const sim = await runSimulation(String(params.scenario || ""));
  return { action: type, success: !!sim, result: sim };
}

export async function handleMemorySearch(params: ActionParams, type: string): Promise<ActionResult> {
  const where: any = {
    confidence: { gte: Number(params.minConfidence ?? 0.3) },
    OR: [
      { content: { contains: String(params.query || ""), mode: "insensitive" } },
      { key: { contains: String(params.query || ""), mode: "insensitive" } },
    ],
  };
  if (params.category) where.category = String(params.category);
  const memories = await prisma.brainMemory.findMany({
    where, orderBy: { confidence: "desc" }, take: Number(params.limit ?? 10),
    select: { id: true, category: true, key: true, content: true, confidence: true, source: true },
  });
  return { action: type, success: true, result: { count: memories.length, memories } };
}
