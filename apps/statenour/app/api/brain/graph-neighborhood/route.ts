/**
 * GET /api/brain/graph-neighborhood?type=<t>&id=<id>&depth=1
 *
 * Returns the edge neighborhood around a single node so the
 * MemoryGraphExplorer modal can show everything the clicked chip is
 * connected to. Depth=1 returns direct edges; depth=2 expands one
 * more hop (capped so we don't flood the UI).
 *
 * Node label resolution reuses the same lookup the chip renderer does:
 * commitments by description, brain dumps by summary, reflections by
 * insight+date, decisions by title, tasks by title, brain memories by
 * content. Unknown types fall back to the raw id.
 *
 * Response shape:
 *   {
 *     root:   { type, id, label },
 *     nodes:  [{ type, id, label, degree }],
 *     edges:  [{ source: {type,id}, target: {type,id}, relationship, strength, evidence }],
 *   }
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type NodeRef = { type: string; id: string };

// Resolve labels in bulk by type → one query per type.
async function resolveLabels(
  refs: NodeRef[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const byType = new Map<string, Set<string>>();
  for (const r of refs) {
    if (!byType.has(r.type)) byType.set(r.type, new Set());
    byType.get(r.type)!.add(r.id);
  }

  const fetchers: Array<Promise<void>> = [];
  for (const [type, idSet] of byType) {
    const ids = Array.from(idSet);
    if (ids.length === 0) continue;

    if (type === "task") {
      fetchers.push(
        prisma.task
          .findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })
          .then((rows) => rows.forEach((r) => labels.set(`${type}:${r.id}`, r.title)))
          .catch(() => {}),
      );
    } else if (type === "commitment") {
      // Commitment is retired; shim returns []. Safe best-effort.
      const numIds = ids.map((i) => Number(i)).filter((n) => Number.isFinite(n));
      fetchers.push(
        prisma.commitment
          .findMany({ where: { id: { in: numIds } }, select: { id: true, description: true } })
          .then((rows) =>
            rows.forEach((r: { id: number; description: string }) =>
              labels.set(`${type}:${r.id}`, r.description),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "reflection") {
      fetchers.push(
        prisma.reflection
          .findMany({ where: { id: { in: ids } }, select: { id: true, insight: true, date: true } })
          .then((rows) =>
            rows.forEach((r) =>
              labels.set(`${type}:${r.id}`, `${r.date} · ${r.insight}`),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "memory" || type === "brain_memory") {
      fetchers.push(
        prisma.brainMemory
          .findMany({ where: { id: { in: ids } }, select: { id: true, content: true, category: true } })
          .then((rows) =>
            rows.forEach((r) =>
              labels.set(`${type}:${r.id}`, `[${r.category}] ${r.content.slice(0, 90)}`),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "brain_dump") {
      fetchers.push(
        prisma.brainDump
          .findMany({ where: { id: { in: ids } }, select: { id: true, summary: true } })
          .then((rows) =>
            rows.forEach((r) =>
              labels.set(`${type}:${r.id}`, r.summary ?? "(dump)"),
            ),
          )
          .catch(() => {}),
      );
    } else if (type === "mastery_decision" || type === "decision") {
      const numIds = ids.map((i) => Number(i)).filter((n) => Number.isFinite(n));
      fetchers.push(
        prisma.masteryDecision
          .findMany({ where: { id: { in: numIds } }, select: { id: true, title: true } })
          .then((rows) =>
            rows.forEach((r) => labels.set(`${type}:${r.id}`, r.title)),
          )
          .catch(() => {}),
      );
    } else if (type === "prediction") {
      fetchers.push(
        prisma.prediction
          .findMany({ where: { id: { in: ids } }, select: { id: true, prediction: true } })
          .then((rows) =>
            rows.forEach((r) => labels.set(`${type}:${r.id}`, r.prediction)),
          )
          .catch(() => {}),
      );
    }
  }
  await Promise.all(fetchers);
  return labels;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "";
  const id = url.searchParams.get("id") ?? "";
  const depth = Math.max(1, Math.min(2, Number(url.searchParams.get("depth") ?? "1")));

  if (!type || !id) {
    return { root: null, nodes: [], edges: [], error: "type + id required" };
  }

  // Depth-1 edges
  const firstHop = await prisma.memoryEdge.findMany({
    where: {
      OR: [
        { sourceType: type, sourceId: id },
        { targetType: type, targetId: id },
      ],
    },
    orderBy: { strength: "desc" },
    take: 40,
    select: {
      sourceType: true,
      sourceId: true,
      targetType: true,
      targetId: true,
      relationship: true,
      strength: true,
      evidence: true,
    },
  });

  // Collect all nodes so we can resolve labels.
  const nodeMap = new Map<string, NodeRef & { degree: number }>();
  const addNode = (t: string, i: string) => {
    const key = `${t}:${i}`;
    const existing = nodeMap.get(key);
    if (existing) existing.degree++;
    else nodeMap.set(key, { type: t, id: i, degree: 1 });
  };
  addNode(type, id);
  for (const e of firstHop) {
    addNode(e.sourceType, e.sourceId);
    addNode(e.targetType, e.targetId);
  }

  // Depth-2 expansion — only fan out from the top-3 most-connected
  // first-hop neighbors to keep the payload bounded.
  let secondHop: typeof firstHop = [];
  if (depth >= 2) {
    const neighbors = Array.from(nodeMap.values())
      .filter((n) => !(n.type === type && n.id === id))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 3);
    const extra = await Promise.all(
      neighbors.map((n) =>
        prisma.memoryEdge.findMany({
          where: {
            OR: [
              { sourceType: n.type, sourceId: n.id },
              { targetType: n.type, targetId: n.id },
            ],
          },
          orderBy: { strength: "desc" },
          take: 12,
          select: {
            sourceType: true,
            sourceId: true,
            targetType: true,
            targetId: true,
            relationship: true,
            strength: true,
            evidence: true,
          },
        }),
      ),
    );
    secondHop = extra.flat();
    for (const e of secondHop) {
      addNode(e.sourceType, e.sourceId);
      addNode(e.targetType, e.targetId);
    }
  }

  const allRefs = Array.from(nodeMap.values()).map((n) => ({ type: n.type, id: n.id }));
  const labels = await resolveLabels(allRefs);

  const nodes = allRefs.map((r) => ({
    ...r,
    label: labels.get(`${r.type}:${r.id}`) ?? `${r.type}:${r.id.slice(0, 8)}`,
    degree: nodeMap.get(`${r.type}:${r.id}`)?.degree ?? 1,
  }));

  const edges = [...firstHop, ...secondHop].map((e) => ({
    source: { type: e.sourceType, id: e.sourceId },
    target: { type: e.targetType, id: e.targetId },
    relationship: e.relationship,
    strength: e.strength,
    evidence: e.evidence,
  }));

  const rootLabel = labels.get(`${type}:${id}`) ?? `${type}:${id.slice(0, 8)}`;
  return {
    root: { type, id, label: rootLabel },
    nodes,
    edges,
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts