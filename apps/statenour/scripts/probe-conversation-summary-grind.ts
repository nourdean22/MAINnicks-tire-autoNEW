/**
 * scripts/probe-conversation-summary-grind.ts — READ-ONLY prod probe
 * (2026-08-19 · memory-loop wave).
 *
 * Discriminates the two starvation theories for "282 conversations →
 * 14 conversation_summary rows":
 *   A) the nightly mergeMemories grinder soft-deletes prose summaries
 *      (predicts: large deleted_at count, live count pinned low)
 *   B) the compiler never ran (predicts: audit conversation_digest
 *      count ≈ live row count, near-zero deleted)
 *
 * findMany/count/groupBy ONLY — nothing writes. Run:
 *   railway run --service statenour-web -- pnpm exec tsx scripts/probe-conversation-summary-grind.ts
 */
import { prisma } from "../lib/prisma";

async function main() {
  const [liveSummaries, deletedSummaries, digestAudits, liveDecisionLog, liveInsightConv, conversations] =
    await Promise.all([
      prisma.brainMemory.count({ where: { category: "conversation_summary", deletedAt: null } }),
      prisma.brainMemory.count({ where: { category: "conversation_summary", deletedAt: { not: null } } }),
      prisma.auditEvent.count({ where: { eventType: "conversation_digest" } }),
      prisma.brainMemory.count({ where: { category: "decision_log", deletedAt: null, key: { startsWith: "conv_" } } }),
      prisma.brainMemory.count({ where: { category: "insight", deletedAt: null, key: { startsWith: "conv_" } } }),
      prisma.chatConversation.count(),
    ]);

  const mergedBlobs = await prisma.brainMemory.findMany({
    where: { category: "conversation_summary", deletedAt: null },
    select: { key: true, confidence: true, seenCount: true, updatedAt: true },
    orderBy: { confidence: "desc" },
    take: 20,
  });

  console.log("── conversation_summary grind probe (read-only) ──");
  console.log(`conversations (all time): ${conversations}`);
  console.log(`conversation_summary LIVE: ${liveSummaries}`);
  console.log(`conversation_summary SOFT-DELETED: ${deletedSummaries}`);
  console.log(`audit conversation_digest events (90d GC window): ${digestAudits}`);
  console.log(`post-#1716 fanout — decision_log conv_*: ${liveDecisionLog} · insight conv_*: ${liveInsightConv}`);
  console.log("top live rows by confidence (0.75 = untouched write; >0.75 = merged blob):");
  for (const r of mergedBlobs) {
    console.log(`  conf=${r.confidence.toFixed(2)} seen=${r.seenCount} ${r.key} (updated ${r.updatedAt.toISOString().slice(0, 10)})`);
  }
  console.log(
    deletedSummaries > liveSummaries
      ? "VERDICT: grinder confirmed — soft-deleted exceeds live; the merger eats prose summaries nightly."
      : "VERDICT: grinder NOT dominant — check digest-audit count vs live rows (compiler-never-ran theory).",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  process.exit(1);
});
