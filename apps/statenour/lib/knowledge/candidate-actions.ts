import type { Prisma } from "@prisma/client";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { prisma } from "@/lib/prisma";

export interface AcceptedKnowledgeAction {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function listAcceptedKnowledgeActions(limit = 20): Promise<{
  total: number;
  items: AcceptedKnowledgeAction[];
}> {
  const take = Math.max(1, Math.min(100, Math.trunc(limit)));
  const where: Prisma.BrainMemoryWhereInput = {
    category: BRAIN_CATEGORIES.RESEARCH_PACK,
    deletedAt: null,
    AND: [
      { metadata: { path: ["recordType"], equals: "knowledge_candidate" } },
      { metadata: { path: ["gateDecision"], equals: "accept" } },
      { metadata: { path: ["kind"], equals: "action" } },
      { metadata: { path: ["outcomeStatus"], equals: "pending" } },
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.brainMemory.count({ where }),
    prisma.brainMemory.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      select: {
        id: true,
        content: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      ...row,
      metadata: asRecord(row.metadata),
    })),
  };
}
