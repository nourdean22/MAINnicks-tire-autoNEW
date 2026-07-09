/**
 * Layer 6: Relational Graph — Maps connections between entities.
 *
 * Every memory, decision, commitment, person, and outcome is a node.
 * Edges represent relationships: causes, blocks, supports, contradicts, etc.
 *
 * This layer answers questions like:
 * - "What's connected to this open loop about hiring?"
 * - "What decisions led to the current revenue situation?"
 * - "Which commitments are blocking each other?"
 * - "What pattern always precedes a drift event?"
 *
 * The graph is built incrementally — every new reflection, prediction,
 * or memory creates connections to existing entities.
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("relational-graph");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { logError } from "@/lib/utils/error-log";

// ─── Edge Management ─────────────────────────────────────────

type EntityType = "memory" | "reflection" | "prediction" | "commitment" | "decision" | "person" | "loop" | "alert" | "pattern";
type Relationship = "causes" | "blocks" | "supports" | "contradicts" | "relates_to" | "leads_to" | "depends_on" | "precedes" | "follows";

/**
 * Create or reinforce an edge between two entities.
 */
export async function connect(
  source: { type: EntityType; id: string },
  target: { type: EntityType; id: string },
  relationship: Relationship,
  evidence?: string
): Promise<void> {
  try {
    const existing = await prisma.memoryEdge.findUnique({
      where: {
        sourceType_sourceId_targetType_targetId_relationship: {
          sourceType: source.type,
          sourceId: source.id,
          targetType: target.type,
          targetId: target.id,
          relationship,
        },
      },
    });

    if (existing) {
      // Reinforce existing connection
      await prisma.memoryEdge.update({
        where: { id: existing.id },
        data: {
          strength: Math.min(existing.strength + 0.1, 1.0),
          evidence: evidence || existing.evidence,
        },
      });
    } else {
      await prisma.memoryEdge.create({
        data: {
          sourceType: source.type,
          sourceId: source.id,
          targetType: target.type,
          targetId: target.id,
          relationship,
          strength: 0.5,
          evidence,
        },
      });
    }
  } catch (err) {
    // Non-critical — don't break the caller
    logError("brain.relational-graph", err, { fn: "connect" });
  }
}

/**
 * Find all connections from a given entity.
 */
export async function getConnections(
  entityType: EntityType,
  entityId: string,
  options?: { minStrength?: number; relationship?: Relationship }
): Promise<{ direction: "outgoing" | "incoming"; type: EntityType; id: string; relationship: Relationship; strength: number; evidence: string | null }[]> {
  const [outgoing, incoming] = await Promise.all([
    prisma.memoryEdge.findMany({
      where: {
        sourceType: entityType,
        sourceId: entityId,
        ...(options?.minStrength && { strength: { gte: options.minStrength } }),
        ...(options?.relationship && { relationship: options.relationship }),
      },
      orderBy: { strength: "desc" },
    }),
    prisma.memoryEdge.findMany({
      where: {
        targetType: entityType,
        targetId: entityId,
        ...(options?.minStrength && { strength: { gte: options.minStrength } }),
        ...(options?.relationship && { relationship: options.relationship }),
      },
      orderBy: { strength: "desc" },
    }),
  ]);

  return [
    ...outgoing.map((e) => ({
      direction: "outgoing" as const,
      type: e.targetType as EntityType,
      id: e.targetId,
      relationship: e.relationship as Relationship,
      strength: e.strength,
      evidence: e.evidence,
    })),
    ...incoming.map((e) => ({
      direction: "incoming" as const,
      type: e.sourceType as EntityType,
      id: e.sourceId,
      relationship: e.relationship as Relationship,
      strength: e.strength,
      evidence: e.evidence,
    })),
  ];
}

/**
 * Auto-discover connections between recent entities using AI.
 * Runs as part of the brain cycle — looks at recent memories, reflections,
 * predictions and finds relationships between them.
 */
export async function discoverConnections(): Promise<{ discovered: number }> {
  // Gather recent entities from all layers
  const [memories, reflections, predictions, commitments, loops] = await Promise.all([
    prisma.brainMemory.findMany({
      where: { confidence: { gte: 0.5 } },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, category: true, content: true },
    }),
    prisma.reflection.findMany({
      where: { deletedAt: null }, // v10.0.68
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, category: true, insight: true },
    }),
    prisma.prediction.findMany({
      where: { status: "pending" },
      take: 5,
      select: { id: true, category: true, prediction: true },
    }),
    prisma.commitment.findMany({
      where: { deletedAt: null, status: { in: ["active", "in_progress"] } }, // v9.1.15
      take: 10,
      select: { id: true, description: true },
    }),
    // Apr 17: OpenLoop retired → Task INBOX/READY/DOING is the source.
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: ["INBOX", "READY", "DOING"] } }, // v9.1.15
      take: 10,
      select: { id: true, title: true },
    }),
  ]);

  if (memories.length + reflections.length + predictions.length === 0) {
    return { discovered: 0 };
  }

  // Format entities for AI analysis
  const entities: string[] = [];
  for (const m of memories) entities.push(`[memory:${m.id}] (${m.category}) ${m.content.slice(0, 100)}`);
  for (const r of reflections) entities.push(`[reflection:${r.id}] (${r.category}) ${r.insight.slice(0, 100)}`);
  for (const p of predictions) entities.push(`[prediction:${p.id}] (${p.category}) ${p.prediction.slice(0, 100)}`);
  for (const c of commitments) entities.push(`[commitment:${c.id}] ${c.description.slice(0, 100)}`);
  for (const l of loops) entities.push(`[task:${l.id}] ${l.title.slice(0, 100)}`);

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Relational Graph builder for NOUR OS — Layer 6 of the memory system.
Given a list of entities (memories, reflections, predictions, commitments, open loops),
find MEANINGFUL connections between them.

Only connect entities that have a real, non-obvious relationship.
Each connection must have:
- source: entity ID (e.g., "memory:cm1abc")
- target: entity ID
- relationship: one of: causes, blocks, supports, contradicts, relates_to, leads_to, depends_on, precedes, follows
- evidence: brief explanation of WHY these are connected

Return ONLY a JSON array (3-8 connections):
[{ "source": "type:id", "target": "type:id", "relationship": "...", "evidence": "..." }]

GOOD connections:
- memory about "low energy" → leads_to → prediction about "workout skips"
- commitment about "scaling revenue" → depends_on → loop about "hiring a tech"
- reflection about "drift pattern" → relates_to → memory about "boredom trigger"

BAD connections:
- Two random things that happen to exist at the same time
- Connections between entities in the same category with the same content (duplicates)`,
    },
    { role: "user", content: `Entities:\n${entities.join("\n")}` },
  ], "fast");

  const extracted = extractJsonArray<{
    source: string; target: string; relationship: string; evidence: string;
  }>(result.content);
  if (!extracted.ok) return { discovered: 0 };

  try {
    const connections = extracted.value;

    if (!Array.isArray(connections)) return { discovered: 0 };

    let discovered = 0;
    for (const conn of connections.slice(0, 8)) {
      const [sourceType, sourceId] = conn.source.split(":");
      const [targetType, targetId] = conn.target.split(":");
      if (!sourceType || !sourceId || !targetType || !targetId) continue;

      await connect(
        { type: sourceType as EntityType, id: sourceId },
        { type: targetType as EntityType, id: targetId },
        conn.relationship as Relationship,
        conn.evidence
      );
      discovered++;
    }

    return { discovered };
  } catch (err) {
    logError("brain.relational-graph", err, { fn: "discoverConnections" });
    return { discovered: 0 };
  }
}

/**
 * Get graph summary for system prompt — strongest connections with
 * human-readable node labels.
 *
 * Apr 18: previously dumped raw ID pairs (`memory:cm1abc —[relates_to]→
 * reflection:cm2def`) which the chat model couldn't ground anything on.
 * Now resolves each endpoint to its title/description/content and
 * formats as `[task] Close Mike quote —[relates_to]→ [commitment] Hit $20K`
 * so downstream reasoning can reference the actual content, not a hash.
 */
export async function getGraphSummary(limit = 10): Promise<string> {
  try {
    const edges = await prisma.memoryEdge.findMany({
      where: { strength: { gte: 0.5 } },
      orderBy: { strength: "desc" },
      take: limit,
    });

    if (edges.length === 0) return "";

    // Group IDs by type so we batch-fetch labels
    const byType: Record<string, Set<string>> = {};
    for (const e of edges) {
      (byType[e.sourceType] ??= new Set()).add(e.sourceId);
      (byType[e.targetType] ??= new Set()).add(e.targetId);
    }

    const labels = new Map<string, string>();
    const fetchers: Array<Promise<void>> = [];

    for (const [type, idSet] of Object.entries(byType)) {
      const ids = Array.from(idSet);
      if (ids.length === 0) continue;

      if (type === "task") {
        fetchers.push(
          prisma.task
            .findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })
            .then((rows) => rows.forEach((r) => labels.set(`task:${r.id}`, r.title)))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: ids.length });
            }),
        );
      } else if (type === "commitment") {
        const numIds = ids.map((i) => Number(i)).filter((n) => Number.isFinite(n));
        fetchers.push(
          prisma.commitment
            .findMany({ where: { id: { in: numIds } }, select: { id: true, description: true } })
            .then((rows) => rows.forEach((r) => labels.set(`commitment:${r.id}`, r.description)))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: numIds.length });
            }),
        );
      } else if (type === "reflection") {
        fetchers.push(
          prisma.reflection
            .findMany({ where: { id: { in: ids } }, select: { id: true, insight: true } })
            .then((rows) => rows.forEach((r) => labels.set(`reflection:${r.id}`, r.insight)))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: ids.length });
            }),
        );
      } else if (type === "memory" || type === "brain_memory") {
        fetchers.push(
          prisma.brainMemory
            .findMany({ where: { id: { in: ids } }, select: { id: true, content: true } })
            .then((rows) => rows.forEach((r) => labels.set(`${type}:${r.id}`, r.content)))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: ids.length });
            }),
        );
      } else if (type === "brain_dump") {
        fetchers.push(
          prisma.brainDump
            .findMany({ where: { id: { in: ids } }, select: { id: true, summary: true } })
            .then((rows) => rows.forEach((r) => labels.set(`brain_dump:${r.id}`, r.summary ?? "dump")))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: ids.length });
            }),
        );
      } else if (type === "mastery_decision" || type === "decision") {
        const numIds = ids.map((i) => Number(i)).filter((n) => Number.isFinite(n));
        fetchers.push(
          prisma.masteryDecision
            .findMany({ where: { id: { in: numIds } }, select: { id: true, title: true } })
            .then((rows) => rows.forEach((r) => labels.set(`${type}:${r.id}`, r.title)))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: numIds.length });
            }),
        );
      } else if (type === "prediction") {
        fetchers.push(
          prisma.prediction
            .findMany({ where: { id: { in: ids } }, select: { id: true, prediction: true } })
            .then((rows) => rows.forEach((r) => labels.set(`prediction:${r.id}`, r.prediction)))
            .catch((err) => {
              recordError("brain:relational-graph", err, { phase: "label-fetch", type, count: ids.length });
            }),
        );
      }
    }
    await Promise.all(fetchers);

    const pretty = (type: string, id: string): string => {
      const label = labels.get(`${type}:${id}`);
      return label ? `[${type}] ${label.slice(0, 60)}` : `${type}:${id.slice(0, 8)}`;
    };

    const lines = edges.map((e) => {
      const src = pretty(e.sourceType, e.sourceId);
      const tgt = pretty(e.targetType, e.targetId);
      const strength = (e.strength * 100).toFixed(0);
      const ev = e.evidence ? `  ·  ${e.evidence.slice(0, 80)}` : "";
      return `${src} —[${e.relationship}]→ ${tgt} (${strength}%)${ev}`;
    });

    return `\n## Layer 6 — Memory Graph (${edges.length} connections)\n${lines.join("\n")}`;
  } catch (err) {
    logError("brain.relational-graph", err, { fn: "getGraphSummary" });
    return "";
  }
}

/**
 * Get graph stats for dashboard.
 */
export async function getGraphStats() {
  try {
    const [totalEdges, byRelationship, avgStrength] = await Promise.all([
      prisma.memoryEdge.count(),
      prisma.memoryEdge.groupBy({
        by: ["relationship"],
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.memoryEdge.aggregate({ _avg: { strength: true } }),
    ]);

    return {
      totalEdges,
      avgStrength: Math.round((avgStrength._avg.strength ?? 0) * 100) / 100,
      byRelationship: byRelationship.map((r) => ({ relationship: r.relationship, count: r._count.id })),
    };
  } catch (err) {
    logError("brain.relational-graph", err, { fn: "getGraphStats" });
    return { totalEdges: 0, avgStrength: 0, byRelationship: [] };
  }
}
