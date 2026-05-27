/**
 * 2026-05-27 · Power Atlas Phase 3 · Network analysis.
 *
 * Builds a pure-JS network of the operator's people graph using
 * co-mention edges (people mentioned together in the same chat message
 * within the last 180 days). Nodes get a normalized degree-centrality
 * score [0, 1]; the top-3 highest-degree nodes are flagged as "bridge"
 * candidates (operator's highest-leverage connectors).
 *
 * No external graph library · simple BFS-style aggregation that's fine
 * for an operator network of <500 people. The bridge heuristic is
 * intentionally conservative (top-3 by degree) · a fuller betweenness-
 * centrality computation is reserved for a future wave if it proves
 * worth the extra cycles.
 *
 * Pure read · no DB writes. The /relationships/network page calls this
 * via /api/people/network on each request (no caching · graphs are cheap
 * and the operator's network changes too slowly to make caching a
 * meaningful win in v1).
 */

import "server-only";
import { prisma } from "@/lib/prisma";

export interface NetworkNode {
  id: string;
  name: string;
  role: string;
  trustScore: number;
  status: string;
  centrality: number;
  isBridge: boolean;
}

export interface NetworkEdge {
  source: string;
  target: string;
  weight: number;
}

export interface NetworkSnapshot {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

/**
 * Build the operator's people network from co-mention edges over the
 * last 180 days. Returns nodes + weighted edges.
 */
export async function buildNetwork(): Promise<NetworkSnapshot> {
  const profiles = await prisma.personProfile.findMany({
    where: { status: { not: "blown_up" }, deletedAt: null },
    select: {
      id: true,
      name: true,
      role: true,
      trustScore: true,
      status: true,
    },
  });
  if (profiles.length === 0) return { nodes: [], edges: [] };

  const since = new Date(Date.now() - 180 * 86400_000);
  const messages = await prisma.chatMessage.findMany({
    where: { createdAt: { gte: since } },
    select: { content: true },
    take: 1000,
  });

  // Pre-lower the names once · faster than per-message lower in the inner loop
  const lowerNames = profiles.map((p) => ({
    id: p.id,
    needle: p.name.toLowerCase(),
  }));

  const edgeMap: Map<string, number> = new Map();
  for (const msg of messages) {
    const contentLower = msg.content.toLowerCase();
    const mentionedIds: string[] = [];
    for (const { id, needle } of lowerNames) {
      if (contentLower.includes(needle)) mentionedIds.push(id);
    }
    for (let i = 0; i < mentionedIds.length; i++) {
      for (let j = i + 1; j < mentionedIds.length; j++) {
        const [a, b] =
          mentionedIds[i] < mentionedIds[j]
            ? [mentionedIds[i], mentionedIds[j]]
            : [mentionedIds[j], mentionedIds[i]];
        const key = `${a}|${b}`;
        edgeMap.set(key, (edgeMap.get(key) ?? 0) + 1);
      }
    }
  }

  // Degree centrality from edge weights
  const degree: Map<string, number> = new Map();
  for (const [key, weight] of edgeMap.entries()) {
    const [a, b] = key.split("|");
    degree.set(a, (degree.get(a) ?? 0) + weight);
    degree.set(b, (degree.get(b) ?? 0) + weight);
  }
  const maxDegree = Math.max(1, ...Array.from(degree.values()));

  // Bridge heuristic · top-3 by degree are the operator's high-leverage
  // connectors (a stricter betweenness-centrality computation would be
  // a future-wave win when network size justifies it).
  const sortedByDegree = Array.from(degree.entries()).sort(
    (a, b) => b[1] - a[1],
  );
  const bridgeIds = new Set(
    sortedByDegree.slice(0, 3).map(([id]) => id),
  );

  const nodes: NetworkNode[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    trustScore: p.trustScore,
    status: p.status,
    centrality: (degree.get(p.id) ?? 0) / maxDegree,
    isBridge: bridgeIds.has(p.id),
  }));

  const edges: NetworkEdge[] = Array.from(edgeMap.entries()).map(
    ([key, weight]) => {
      const [source, target] = key.split("|");
      return { source, target, weight };
    },
  );

  return { nodes, edges };
}
