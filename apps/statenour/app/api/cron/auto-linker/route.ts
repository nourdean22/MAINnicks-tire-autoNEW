import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

/**
 * GET /api/cron/auto-linker — builds + reinforces the relational graph.
 *
 * Runs nightly. For each non-terminal Task (INBOX/READY/DOING), scans
 * for relations against:
 *   • Commitment       (by ≥2 significant-word overlap → "relates_to")
 *   • BrainDump        (via Task.id = OpenLoop.sourceBrainDumpId
 *                       legacy; also title-match against recent
 *                       dumps → "caused_by")
 *   • MasteryDecision  (decision title prefix "Decide: <task-title>")
 *   • Reflection       (reflection insight contains task keywords)
 *
 * Writes MemoryEdge rows, de-duping via the composite unique index.
 * Each existing edge gets a small strength boost so true patterns
 * reinforce over time.
 *
 * Schedule: `0 4 * * *` (4am ET = after brain-intelligence + backlog-
 * triage crons so it has the cleanest data).
 */
export const GET = cronHandler(async () => {
  const since = new Date(Date.now() - 30 * 86400_000); // 30d window
  let edgesCreated = 0;
  let edgesReinforced = 0;

  // ── Load the universe ──
  // v8.27 · soft-delete retrofit · auto-linker shouldn't draw edges
  // to/from tombstoned rows.
  // v10.0.34 — bounded fetches. Pre-fix tasks + commitments had no
  // `take`, so on a mature DB the O(tasks × commitments) inner loop
  // ran 100k+ keyword overlap checks per run + 100k writeEdge calls
  // (each a findFirst + conditional update/create). The cron timed
  // out and never completed a full pass. 300/200/250/250/250 caps
  // cover normal workload (most-recent first) without missing the
  // hot path; older rows already have edges from prior runs.
  const [tasks, commitments, brainDumps, decisions, reflections] = await Promise.all([
    prisma.task.findMany({
      where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
      select: { id: true, title: true, createdAt: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
    prisma.commitment.findMany({
      where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
      select: { id: true, description: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.brainDump.findMany({
      where: { createdAt: { gte: since }, deletedAt: null },
      select: { id: true, rawThoughts: true, summary: true, extractedItems: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.masteryDecision.findMany({
      where: { createdAt: { gte: since }, deletedAt: null },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.reflection.findMany({
      where: { createdAt: { gte: since }, deletedAt: null },
      select: { id: true, insight: true, category: true },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
  ]);

  // ── Keyword extractor: words >3 chars, deduped, lowercased ──
  const keywordsOf = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3)
        .slice(0, 12),
    );

  const overlapCount = (a: Set<string>, b: Set<string>): number => {
    let n = 0;
    for (const x of a) if (b.has(x)) n++;
    return n;
  };

  // ── Pre-compute commitment keywords ──
  const commitmentKeywords = commitments.map((c) => ({
    id: c.id,
    keywords: keywordsOf(c.description),
  }));

  // ── Edge writer: upserts + bumps strength on re-detection ──
  const writeEdge = async (
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
    relationship: string,
    evidence: string,
    baseStrength: number,
  ) => {
    try {
      const existing = await prisma.memoryEdge.findFirst({
        where: { sourceType, sourceId, targetType, targetId, relationship },
        select: { id: true, strength: true },
      });
      if (existing) {
        const newStrength = Math.min(1, existing.strength + 0.05);
        if (Math.abs(newStrength - existing.strength) > 0.001) {
          await prisma.memoryEdge.update({
            where: { id: existing.id },
            data: { strength: newStrength },
          });
          edgesReinforced++;
        }
      } else {
        await prisma.memoryEdge.create({
          data: { sourceType, sourceId, targetType, targetId, relationship, evidence, strength: baseStrength },
        });
        edgesCreated++;
      }
    } catch {
      // silent — constraint violations or transient issues skip
    }
  };

  // ── Task ↔ Commitment ──
  for (const t of tasks) {
    const tk = keywordsOf(t.title);
    for (const c of commitmentKeywords) {
      if (overlapCount(tk, c.keywords) >= 2) {
        await writeEdge(
          "task",
          t.id,
          "commitment",
          String(c.id),
          "relates_to",
          `keyword overlap ≥ 2`,
          0.6,
        );
      }
    }
  }

  // ── Task ↔ BrainDump (title mention) ──
  for (const t of tasks) {
    const titleLower = t.title.toLowerCase();
    const titleWords = [...keywordsOf(t.title)];
    for (const d of brainDumps) {
      const haystack = ((d.summary ?? "") + " " + (d.rawThoughts ?? "")).toLowerCase();
      // Rough heuristic: the task title (or its first 3 significant
      // words) appears in the dump
      if (haystack.length < 30) continue;
      const fullHit = haystack.includes(titleLower);
      const wordHits = titleWords.slice(0, 3).filter((w) => haystack.includes(w)).length;
      if (fullHit || wordHits >= 3) {
        await writeEdge(
          "task",
          t.id,
          "brain_dump",
          d.id,
          "caused_by",
          fullHit ? "task title appears verbatim in brain dump" : "3+ significant task words in dump",
          fullHit ? 0.8 : 0.55,
        );
      }
    }
  }

  // ── Task ↔ MasteryDecision (the inline /decide flow prefixes
  //    decision titles with "Decide: ") ──
  for (const d of decisions) {
    if (!d.title.toLowerCase().startsWith("decide:")) continue;
    const subject = d.title.replace(/^decide:\s*/i, "").toLowerCase().trim();
    if (subject.length < 4) continue;
    for (const t of tasks) {
      if (t.title.toLowerCase().trim() === subject || subject.includes(t.title.toLowerCase().slice(0, 30))) {
        await writeEdge(
          "decision",
          String(d.id),
          "task",
          t.id,
          "relates_to",
          "decision title derived from task title",
          0.85,
        );
      }
    }
  }

  // ── Task ↔ Reflection (reflection insight mentions task keywords) ──
  for (const r of reflections) {
    if (!r.insight || r.insight.length < 30) continue;
    const insightLower = r.insight.toLowerCase();
    const insightWords = keywordsOf(r.insight);
    for (const t of tasks) {
      const tk = keywordsOf(t.title);
      const shared = overlapCount(tk, insightWords);
      if (shared >= 3 || (tk.size >= 2 && shared / tk.size >= 0.6)) {
        await writeEdge(
          "reflection",
          r.id,
          "task",
          t.id,
          "relates_to",
          `reflection shares ${shared} keywords with task`,
          0.5,
        );
      }
      void insightLower;
    }
  }

  return {
    scanned: {
      tasks: tasks.length,
      commitments: commitments.length,
      brainDumps: brainDumps.length,
      decisions: decisions.length,
      reflections: reflections.length,
    },
    edgesCreated,
    edgesReinforced,
    brainEdges: await materializeBrainEdges(writeEdge),
  };
});

/**
 * Apr 19 · Brain-system edges. Materializes the explicit references
 * that skills/beliefs/contradictions/ghost already carry in their
 * content JSON. These were invisible to the graph until now.
 *
 *   skill         ─→ task               (source_evidence)
 *   belief        ─→ chat_importance    (evidence_ids)
 *   contradiction ─→ chat_importance    (new_memory_id + old_memory_id)
 *   ghost_pred    ─→ task               (prediction task_id)
 */
async function materializeBrainEdges(
  writeEdge: (
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
    relationship: string,
    evidence: string,
    baseStrength: number,
  ) => Promise<void>,
): Promise<{ skill: number; belief: number; contradiction: number; ghost: number }> {
  const counts = { skill: 0, belief: 0, contradiction: 0, ghost: 0 };
  const brainRows = await prisma.brainMemory
    .findMany({
      where: {
        category: {
          in: ["skill", "belief", "contradiction", "ghost_prediction"],
        },
      },
      select: { id: true, category: true, content: true },
      take: 500,
    })
    .catch(() => []);

  for (const r of brainRows) {
    try {
      const parsed = JSON.parse(r.content);
      if (r.category === "skill") {
        const evidence = (parsed.source_evidence ?? []) as Array<{ type: string; id: string }>;
        for (const ev of evidence.slice(0, 8)) {
          await writeEdge(
            "brain_memory", r.id,
            ev.type, ev.id,
            "derived_from",
            `skill evidence`,
            0.7,
          );
          counts.skill++;
        }
      } else if (r.category === "belief") {
        const evidenceIds = (parsed.evidence_ids ?? []) as string[];
        for (const eid of evidenceIds.slice(0, 8)) {
          await writeEdge(
            "brain_memory", r.id,
            "brain_memory", eid,
            "grounded_in",
            "belief evidence (chat_importance)",
            0.75,
          );
          counts.belief++;
        }
      } else if (r.category === "contradiction") {
        if (parsed.new_memory_id) {
          await writeEdge(
            "brain_memory", r.id,
            "brain_memory", parsed.new_memory_id,
            "conflicts_with",
            "new side of contradiction",
            0.85,
          );
          counts.contradiction++;
        }
        if (parsed.old_memory_id) {
          await writeEdge(
            "brain_memory", r.id,
            "brain_memory", parsed.old_memory_id,
            "conflicts_with",
            "old side of contradiction",
            0.85,
          );
          counts.contradiction++;
        }
      } else if (r.category === "ghost_prediction") {
        const predictions = (parsed.predictions ?? []) as Array<{ task_id: string | null }>;
        for (const p of predictions) {
          if (!p.task_id) continue;
          await writeEdge(
            "brain_memory", r.id,
            "task", p.task_id,
            "predicts",
            "ghost prediction",
            0.55,
          );
          counts.ghost++;
        }
      }
    } catch {
      // skip malformed
    }
  }
  return counts;
}
