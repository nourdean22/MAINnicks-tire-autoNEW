/**
 * GET /api/brain/graph · v10.0.91 · 2026-05-02.
 *
 * Extended 2026-06-22 to support Nour Command Center layout and fullscreen brain.
 *
 * Tunable via query:
 *   · ?scope=home|full (new CC/Brain scope)
 *   · ?focus=<nodeId> (focus neighborhood center)
 *   · ?depth=1|2|3 (BFS neighborhood depth, default 2)
 *
 * Legacy:
 *   · ?limit=200 (max nodes)
 *   · ?minConfidence=0.5 (filter weak memories)
 *   · ?categories=wisdom,insight,pattern (filter list)
 *   · ?minEdgeScore=0.6 (filter weak semantic edges)
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { getBrainGraph } from "@/lib/brain/brain-graph";

const DEFAULT_CATEGORIES = [
  "wisdom",
  "insight",
  "pattern",
  "blind_spot",
  "strategic_plan",
  "decision_pattern",
  "qualitative_identity",
  "belief",
  "contradiction",
  "counter_intuitive",
  "meta_pattern",
  "nick_advice",
  "customer_stories",
  "industry_intel",
  "brain_dump",
  "reflection",
];

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") as "home" | "full" | null;
    const focus = url.searchParams.get("focus") || undefined;
    const depth = url.searchParams.get("depth") ? parseInt(url.searchParams.get("depth")!, 10) || 2 : undefined;

    // If scope or focus is present, we route to the new custom graph logic
    if (scope || focus) {
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : undefined;
      const minConfidence = url.searchParams.get("minConfidence") ? parseFloat(url.searchParams.get("minConfidence")!) : undefined;
      const categoriesParam = url.searchParams.get("categories");
      const categories = categoriesParam && categoriesParam.length > 0
        ? categoriesParam.split(",").map((c) => c.trim()).filter(Boolean)
        : undefined;

      const payload = await getBrainGraph({
        scope: scope || undefined,
        focus,
        depth,
        limit,
        minConfidence,
        categories,
      });
      return payload;
    }

    // Otherwise, fallback to the legacy memory-only graph response to preserve backward compatibility
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "200", 10) || 200,
      1000,
    );
    const minConfidence = parseFloat(
      url.searchParams.get("minConfidence") ?? "0.5",
    );
    const minEdgeScore = parseFloat(
      url.searchParams.get("minEdgeScore") ?? "0.6",
    );
    const categoriesParam = url.searchParams.get("categories");
    const categories =
      categoriesParam && categoriesParam.length > 0
        ? categoriesParam.split(",").map((c) => c.trim()).filter(Boolean)
        : DEFAULT_CATEGORIES;

    // 1. Pull nodes
    const memoryNodes = await prisma.brainMemory.findMany({
      where: {
        category: { in: categories },
        confidence: { gte: minConfidence },
        deletedAt: null,
      },
      orderBy: [{ confidence: "desc" }, { lastSeen: "desc" }],
      take: limit,
      select: {
        id: true,
        category: true,
        key: true,
        confidence: true,
        createdAt: true,
        lastSeen: true,
      },
    });

    const nodeIds = new Set(memoryNodes.map((m) => m.id));
    const now = Date.now();
    const nodes = memoryNodes.map((m) => ({
      id: m.id,
      category: m.category,
      label: m.key.length > 80 ? m.key.slice(0, 80) + "…" : m.key,
      confidence: m.confidence,
      ageDays: Math.floor(
        (now - m.createdAt.getTime()) / 86_400_000,
      ),
      lastSeen: m.lastSeen.toISOString(),
    }));

    // 2. Pull semantic_edge rows where BOTH endpoints are in our
    //    node set (otherwise the edge would dangle)
    const edgeRows = await prisma.brainMemory.findMany({
      where: {
        category: "semantic_edge",
        confidence: { gte: minEdgeScore },
        deletedAt: null,
      },
      take: 2000,
      select: { metadata: true },
    });

    const edges: Array<{
      source: string;
      target: string;
      score: number;
      type: "semantic";
    }> = [];
    for (const e of edgeRows) {
      const meta = e.metadata as
        | { fromMemoryId?: string; toMemoryId?: string; score?: number }
        | null;
      if (!meta?.fromMemoryId || !meta.toMemoryId) continue;
      if (!nodeIds.has(meta.fromMemoryId)) continue;
      if (!nodeIds.has(meta.toMemoryId)) continue;
      edges.push({
        source: meta.fromMemoryId,
        target: meta.toMemoryId,
        score: meta.score ?? 0.6,
        type: "semantic",
      });
    }

    // 3. Cluster assignment = category (color-by hint)
    const clusters = [...new Set(nodes.map((n) => n.category))]
      .map((cat, i) => ({
        category: cat,
        colorHint: i, // consumer maps i → palette
        nodeCount: nodes.filter((n) => n.category === cat).length,
      }))
      .sort((a, b) => b.nodeCount - a.nodeCount);

    return {
      generatedAt: new Date().toISOString(),
      filter: {
        limit,
        minConfidence,
        minEdgeScore,
        categories,
      },
      counts: {
        nodes: nodes.length,
        edges: edges.length,
        clusters: clusters.length,
      },
      nodes,
      edges,
      clusters,
    };
  },
  { auth: "owner" },
);
