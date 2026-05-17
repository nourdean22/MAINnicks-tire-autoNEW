/**
 * Cosine distribution probe · v10.0.190
 *
 * v10.0.189 shipped the conversation-mission linker with:
 *   autoThreshold = 0.75  (auto-link)
 *   reviewThreshold = 0.55  (queue for human review)
 *
 * Live run: 0 auto-linked, 25 review candidates, 14 below floor.
 *
 * 0/39 auto-linked is a strong signal the threshold is wrong for
 * the venice-bge-m3 embedding model. This script computes the
 * actual distribution so we can pick a data-driven threshold
 * instead of guessing.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function cosine(a, b) {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

async function main() {
  const [convs, missionEmbedRows, allMissions] = await Promise.all([
    prisma.vectorEmbedding.findMany({
      where: { sourceType: "chat_conversation" },
      select: { sourceId: true, embedding: true, content: true },
    }),
    prisma.vectorEmbedding.findMany({
      where: { sourceType: "mission" },
      select: { sourceId: true, embedding: true, content: true },
    }),
    prisma.mission.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
    }),
  ]);
  // Filter out Inbox missions (matches /^\s*inbox(\s*-\s*[a-z]+)?\s*$/i)
  const inboxRe = /^\s*inbox(\s*-\s*[a-z]+)?\s*$/i;
  const inboxIds = new Set(allMissions.filter((m) => inboxRe.test(m.title)).map((m) => m.id));
  const missions = missionEmbedRows.filter((m) => !inboxIds.has(m.sourceId));
  if (inboxIds.size > 0) {
    console.log(`Excluded ${inboxIds.size} Inbox missions: ${[...inboxIds].slice(0, 3).join(", ")}`);
  }

  console.log(`\nConversations embedded: ${convs.length}`);
  console.log(`Missions embedded: ${missions.length}`);

  if (convs.length === 0 || missions.length === 0) {
    console.log("Not enough data to compute distribution.");
    return;
  }

  // Parse embeddings
  const convVecs = convs
    .map((c) => ({ id: c.sourceId, content: c.content?.slice(0, 60) ?? "", v: JSON.parse(c.embedding) }))
    .filter((x) => Array.isArray(x.v) && x.v.length > 0);
  const missionVecs = missions
    .map((m) => ({ id: m.sourceId, content: m.content?.slice(0, 60) ?? "", v: JSON.parse(m.embedding) }))
    .filter((x) => Array.isArray(x.v) && x.v.length > 0);

  // Pull mission titles for friendlier output
  const missionTitleMap = new Map(
    (
      await prisma.mission.findMany({
        where: { id: { in: missionVecs.map((m) => m.id) } },
        select: { id: true, title: true },
      })
    ).map((m) => [m.id, m.title]),
  );

  // For each conversation, find top mission by cosine
  const bestPerConv = [];
  for (const c of convVecs) {
    let best = { score: 0, missionId: null, missionTitle: null };
    for (const m of missionVecs) {
      const score = cosine(c.v, m.v);
      if (score > best.score) {
        best = { score, missionId: m.id, missionTitle: missionTitleMap.get(m.id) ?? "(unknown)" };
      }
    }
    bestPerConv.push({ convId: c.id, content: c.content, ...best });
  }

  bestPerConv.sort((a, b) => b.score - a.score);

  // Histogram
  const buckets = {
    "0.85+": 0,
    "0.75-0.85": 0,
    "0.65-0.75": 0,
    "0.55-0.65": 0,
    "0.45-0.55": 0,
    "0.35-0.45": 0,
    "<0.35": 0,
  };
  for (const r of bestPerConv) {
    if (r.score >= 0.85) buckets["0.85+"]++;
    else if (r.score >= 0.75) buckets["0.75-0.85"]++;
    else if (r.score >= 0.65) buckets["0.65-0.75"]++;
    else if (r.score >= 0.55) buckets["0.55-0.65"]++;
    else if (r.score >= 0.45) buckets["0.45-0.55"]++;
    else if (r.score >= 0.35) buckets["0.35-0.45"]++;
    else buckets["<0.35"]++;
  }

  console.log(`\n=== Top-mission cosine score distribution (per conversation) ===`);
  for (const [k, v] of Object.entries(buckets)) {
    const bar = "█".repeat(v);
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(3)}  ${bar}`);
  }

  console.log(`\n=== Top 15 best-matched conversations ===`);
  for (const r of bestPerConv.slice(0, 15)) {
    console.log(
      `  ${r.score.toFixed(3)}  ${r.content.padEnd(50)}  →  ${(r.missionTitle ?? "").slice(0, 40)}`,
    );
  }

  // Threshold recommendation
  const sortedScores = bestPerConv.map((r) => r.score).sort((a, b) => b - a);
  const p50 = sortedScores[Math.floor(sortedScores.length * 0.5)] ?? 0;
  const p75 = sortedScores[Math.floor(sortedScores.length * 0.25)] ?? 0;
  const p90 = sortedScores[Math.floor(sortedScores.length * 0.1)] ?? 0;

  console.log(`\n=== Percentiles ===`);
  console.log(`  p50 (median): ${p50.toFixed(3)}`);
  console.log(`  p75:          ${p75.toFixed(3)}`);
  console.log(`  p90:          ${p90.toFixed(3)}`);

  console.log(`\n=== Recommendation ===`);
  if (p90 < 0.5) {
    console.log("  Embeddings/missions don't share enough vocabulary.");
    console.log("  The summary text is too distilled OR mission descriptions too sparse.");
    console.log("  Action: enrich mission embeddings with task titles + planData");
  } else {
    console.log(`  autoThreshold ≈ ${p75.toFixed(2)} (top 25% of matches)`);
    console.log(`  reviewThreshold ≈ ${p50.toFixed(2)} (top 50% of matches)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
