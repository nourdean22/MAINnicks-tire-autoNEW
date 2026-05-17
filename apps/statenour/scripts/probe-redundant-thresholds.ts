/**
 * scripts/probe-redundant-thresholds.ts · v10.0.415
 *
 * Validates the 0.92 redundant-similarity threshold used in
 * lib/brain/wisdom-evolution.ts · `findRedundantPairs()`.
 *
 * Threshold validation is qualitative:
 *   · Too tight (0.95+) · operator never sees genuine duplicates
 *   · Too loose (0.85-) · false positives flood the panel ·
 *     two wisdoms about "money" surface as merge candidates even
 *     though they're substantively different
 *
 * This probe scans the corpus at thresholds [0.85, 0.88, 0.90,
 * 0.92, 0.95, 0.98] and reports candidate count + a sample at each
 * level. The operator picks the threshold that matches their
 * judgment of "actually duplicate".
 *
 * Run · pnpm tsx scripts/probe-redundant-thresholds.ts
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import { tagWisdomTopics } from "@/lib/brain/wisdom-topic-tagger";

async function main() {
  console.log("=== redundant-threshold probe · v10.0.415 ===\n");

  const wisdoms = await prisma.brainMemory.findMany({
    where: { category: "wisdom", deletedAt: null, confidence: { gte: 0.5 } },
    select: { id: true, key: true, content: true, confidence: true },
  });
  const embeds = await prisma.vectorEmbedding.findMany({
    where: {
      sourceType: "brain_memory",
      sourceId: { in: wisdoms.map((w) => w.id) },
    },
    select: { sourceId: true, embedding: true },
  });
  const wisdomById = new Map(wisdoms.map((w) => [w.id, w]));
  const parsed: { id: string; key: string; content: string; vec: number[]; topics: string[] }[] = [];
  for (const e of embeds) {
    const w = wisdomById.get(e.sourceId);
    if (!w) continue;
    try {
      const v = JSON.parse(e.embedding) as number[];
      if (!Array.isArray(v) || v.length === 0) continue;
      parsed.push({ id: w.id, key: w.key, content: w.content, vec: v, topics: tagWisdomTopics(w.content) });
    } catch { /* skip */ }
  }

  console.log(`scanning ${parsed.length} wisdom embeddings · O(n²) · this may take a few seconds\n`);

  // O(n²) once · score every pair, then bucket by threshold.
  const all: { i: number; j: number; sim: number }[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (parsed[i].vec.length !== parsed[j].vec.length) continue;
      const sim = cosineSimilarity(parsed[i].vec, parsed[j].vec);
      // Lowest threshold we care about
      if (sim < 0.85) continue;
      // Require at least one shared topic
      const shared = parsed[i].topics.filter((t) => parsed[j].topics.includes(t));
      if (shared.length === 0) continue;
      all.push({ i, j, sim });
    }
  }
  all.sort((a, b) => b.sim - a.sim);

  const thresholds = [0.85, 0.88, 0.9, 0.92, 0.95, 0.98];
  console.log("threshold | pair count | sample pair");
  console.log("----------|------------|-----------------------------------------------");
  for (const th of thresholds) {
    const matching = all.filter((p) => p.sim >= th);
    const sample = matching[0];
    const sampleTxt = sample
      ? `${parsed[sample.i].key.slice(0, 30)} ↔ ${parsed[sample.j].key.slice(0, 30)} (${sample.sim.toFixed(3)})`
      : "—";
    console.log(`  ${th.toFixed(2)}    | ${String(matching.length).padStart(4)}       | ${sampleTxt}`);
  }

  console.log("\nlow-end samples (loosest threshold) · check these for false positives:");
  for (const p of all.filter((x) => x.sim >= 0.85 && x.sim < 0.9).slice(0, 5)) {
    console.log(`  ${p.sim.toFixed(3)} · ${parsed[p.i].key} ↔ ${parsed[p.j].key}`);
    console.log(`    a: ${parsed[p.i].content.slice(0, 100)}`);
    console.log(`    b: ${parsed[p.j].content.slice(0, 100)}`);
  }

  console.log("\nhigh-end samples (tightest threshold) · should be near-identical:");
  for (const p of all.filter((x) => x.sim >= 0.95).slice(0, 5)) {
    console.log(`  ${p.sim.toFixed(3)} · ${parsed[p.i].key} ↔ ${parsed[p.j].key}`);
    console.log(`    a: ${parsed[p.i].content.slice(0, 100)}`);
    console.log(`    b: ${parsed[p.j].content.slice(0, 100)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
