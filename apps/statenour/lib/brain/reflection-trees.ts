/**
 * Layer 4.5: Reflection Trees — higher-order synthesis of reflections.
 *
 * Stanford "Generative Agents" reflection-tree (Park et al. 2023): the
 * memory stream periodically clusters recent LOW-LEVEL reflections into
 * a smaller set of HIGHER-ORDER insights ("you consistently over-commit
 * on Mondays"), and links each insight back to the reflections that
 * support it. This gives Nick abstracted self-knowledge — a tree of
 * "reflections of reflections" — on top of raw episodic rows.
 *
 * Relationship to the existing layers:
 *   · lib/brain/reflection-engine.ts → daily/weekly cross-table engine
 *     → writes the `Reflection` table.
 *   · lib/services/reflection.ts → CoALA per-category synthesis
 *     → writes `reflection`-category BrainMemory rows.
 *   · THIS file → reads BOTH of the above (the leaf reflections) and
 *     synthesizes one level UP → writes new `reflection`-category
 *     BrainMemory rows (source="reflection_trees") + MemoryEdge chains
 *     linking each insight to its source reflections.
 *
 * ADDITIVE-ONLY: never modifies or deletes source reflections. The 2026
 * research is explicit that consolidation which destroys evidence
 * degrades recall — so sources stay untouched and the edges point back
 * to them.
 *
 * Flag-gated on NICK_REFLECTION_TREES (OFF → no-op). Graceful: every
 * failure path returns a result, never throws into the cron.
 */

import { prisma } from "@/lib/prisma";
import { getFlag } from "@/lib/feature-flags";
import { brainMemory } from "@/lib/brain/memory-manager";
import { connect } from "@/lib/brain/relational-graph";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/reflection-trees");
const aiChat = makeTracedAiChat("reflection-trees", "brain");

/** Source kind so the edge endpoint resolves to the right table later. */
type LeafKind = "reflection" | "memory";
interface Leaf {
  kind: LeafKind;
  id: string;
  text: string;
}

export interface ReflectionTreeResult {
  insightsWritten: number;
  edgesWritten: number;
  skipped?: "flag-off" | "insufficient-source" | "recent-run-exists" | "no-insights";
}

interface SynthesisPayload {
  insights: Array<{ content?: unknown; derivedFrom?: unknown; confidence?: unknown }>;
}

/**
 * Synthesize recent low-level reflections into 1-3 higher-order insights.
 * Run nightly. Self-gates on the NICK_REFLECTION_TREES flag.
 */
export async function buildReflectionTrees(
  windowDays = 14,
): Promise<ReflectionTreeResult> {
  if (!getFlag("NICK_REFLECTION_TREES")?.isOn) {
    return { insightsWritten: 0, edgesWritten: 0, skipped: "flag-off" };
  }

  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const dayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD · daily idempotency

    // 1. Idempotency — skip if a tree run already landed today. The
    // (category, key) unique constraint also blocks dup rows, but this
    // saves the LLM call on a same-day retry/flap.
    const todayRun = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.REFLECTION,
        source: "reflection_trees",
        key: { startsWith: `reflection_tree:${dayKey}:` },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (todayRun) {
      return { insightsWritten: 0, edgesWritten: 0, skipped: "recent-run-exists" };
    }

    // 2. Gather leaf reflections from BOTH engines (additive read only).
    const [tableRows, memoryRows] = await Promise.all([
      prisma.reflection.findMany({
        where: { createdAt: { gte: windowStart }, deletedAt: null },
        orderBy: { confidence: "desc" },
        take: 30,
        select: { id: true, scope: true, category: true, insight: true },
      }),
      prisma.brainMemory.findMany({
        where: {
          category: BRAIN_CATEGORIES.REFLECTION,
          createdAt: { gte: windowStart },
          deletedAt: null,
          // Don't re-synthesize our own tree output — only leaf rows.
          NOT: { source: "reflection_trees" },
        },
        orderBy: { confidence: "desc" },
        take: 30,
        select: { id: true, content: true },
      }),
    ]);

    const leaves: Leaf[] = [
      ...tableRows.map((r) => ({
        kind: "reflection" as const,
        id: r.id,
        text: `[${r.scope}/${r.category}] ${r.insight}`,
      })),
      ...memoryRows.map((m) => ({ kind: "memory" as const, id: m.id, text: m.content })),
    ];

    if (leaves.length < 5) {
      return { insightsWritten: 0, edgesWritten: 0, skipped: "insufficient-source" };
    }

    // 3. One LLM call — cluster leaves into higher-order insights.
    const numbered = leaves
      .map((l, i) => `[${i + 1}] id=${l.id} kind=${l.kind}\n    ${l.text.slice(0, 280)}`)
      .join("\n\n");

    let llmContent: string;
    try {
      const result = await aiChat(
        [
          {
            role: "system",
            content:
              "You are the Reflection-Tree synthesizer for NOUR OS. You read recent low-level reflections and elevate them into a SMALL set of higher-order insights about recurring behavior (e.g. 'you consistently over-commit on Mondays', 'your drift always follows a low-energy streak'). Each insight must span MULTIPLE leaves and name the recurring pattern, not restate one leaf. Output STRICT JSON only — no prose, no markdown fences.",
          },
          {
            role: "user",
            content: `Window: last ${windowDays} days · ${leaves.length} leaf reflections:\n\n${numbered}\n\nIdentify the 1-3 HIGHEST-ORDER recurring patterns that span >=2 leaves. Cite the leaf ids you used in derivedFrom (use the ids shown above).\n\nReturn ONLY:\n{ "insights": [ { "content": "specific recurring pattern (max 400 chars)", "derivedFrom": ["id1","id2"], "confidence": 0.0-1.0 } ] }`,
          },
        ],
        "reason",
      );
      llmContent = result.content;
    } catch (err) {
      log.warn("tree_llm_failed", { error: err instanceof Error ? err.message : String(err) });
      return { insightsWritten: 0, edgesWritten: 0 };
    }

    const parsed = extractJsonObject<SynthesisPayload>(llmContent);
    const raw = parsed.ok ? parsed.value?.insights : null;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { insightsWritten: 0, edgesWritten: 0, skipped: "no-insights" };
    }

    // 4. Validate + persist. New row per insight + edges back to sources.
    const leafById = new Map(leaves.map((l) => [l.id, l]));
    let insightsWritten = 0;
    let edgesWritten = 0;

    const top = raw.slice(0, 3);
    for (let i = 0; i < top.length; i++) {
      const r = top[i];
      if (typeof r.content !== "string") continue;
      const content = r.content.trim();
      if (content.length < 10 || content.length > 1000) continue;

      // Keep only ids that were really in our leaf set — drops hallucinated cuids.
      const derivedFrom = (Array.isArray(r.derivedFrom) ? r.derivedFrom : [])
        .filter((id): id is string => typeof id === "string" && leafById.has(id));
      if (derivedFrom.length < 2) continue; // a tree node must span >=2 leaves

      let confidence =
        typeof r.confidence === "number" && Number.isFinite(r.confidence) ? r.confidence : 0.7;
      confidence = Math.max(0, Math.min(1, confidence));

      const key = `reflection_tree:${dayKey}:${i + 1}`;
      let row;
      try {
        row = await brainMemory.remember(
          BRAIN_CATEGORIES.REFLECTION,
          key,
          content,
          "reflection_trees",
          {
            higherOrder: true,
            derivedFrom,
            reflectionWindow: { from: windowStart.toISOString(), to: now.toISOString(), days: windowDays },
            confidence,
          },
        );
      } catch (err) {
        log.warn("tree_write_failed", { key, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      insightsWritten++;

      // 5. MemoryEdge chain · leaf —[supports]→ insight, insight —[leads_to]→ leaf.
      // connect() is idempotent (reinforces an existing edge) and never throws.
      for (const srcId of derivedFrom) {
        const leaf = leafById.get(srcId)!;
        await connect({ type: leaf.kind, id: srcId }, { type: "memory", id: row.id }, "supports", content.slice(0, 200));
        await connect({ type: "memory", id: row.id }, { type: leaf.kind, id: srcId }, "leads_to", content.slice(0, 200));
        edgesWritten += 2;
      }
    }

    log.info("tree_done", { leaves: leaves.length, insightsWritten, edgesWritten });
    return { insightsWritten, edgesWritten };
  } catch (err) {
    // Never throw into the cron.
    log.warn("tree_failed", { error: err instanceof Error ? err.message : String(err) });
    return { insightsWritten: 0, edgesWritten: 0 };
  }
}
