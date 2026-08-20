/**
 * READ-ONLY prod probe (2026-08-20 · memory-loop wave review fix).
 *
 * Question: can `ChatConversation.messageCount` (denormalized, default 0)
 * be trusted as the SQL eligibility filter for the compile sweep, or do
 * old rows predate the counter and sit stale-low (which would make a
 * `messageCount >= 4` WHERE clause EXCLUDE real backlog)?
 *
 * count/findMany only — nothing writes. Run:
 *   railway run --service statenour-web -- pnpm exec tsx scripts/probe-messagecount-truth.ts
 */
import { prisma } from "../lib/prisma";

async function main() {
  const suspects = await prisma.chatConversation.findMany({
    where: { messageCount: { lt: 4 } },
    select: { id: true, messageCount: true, _count: { select: { messages: true } } },
    take: 500,
  });
  const liars = suspects.filter((c) => c._count.messages >= 4);
  const total = await prisma.chatConversation.count();
  const lowCount = await prisma.chatConversation.count({ where: { messageCount: { lt: 4 } } });

  console.log("── messageCount truth probe (read-only) ──");
  console.log(`conversations total: ${total} · messageCount<4: ${lowCount} (sampled ${suspects.length})`);
  console.log(`LIARS (messageCount<4 but real messages>=4): ${liars.length}`);
  for (const l of liars.slice(0, 10)) {
    console.log(`  ${l.id} · counter=${l.messageCount} · real=${l._count.messages}`);
  }
  console.log(
    liars.length === 0
      ? "VERDICT: counter is truthful — safe as the SQL eligibility filter."
      : "VERDICT: counter lies low on some rows — SQL filter needs a backfill or an OR-guard.",
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[probe] fatal:", err);
  process.exit(1);
});
