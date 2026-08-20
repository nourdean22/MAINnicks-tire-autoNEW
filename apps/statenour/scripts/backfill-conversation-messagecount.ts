/**
 * Backfill ChatConversation.messageCount (2026-08-20 · memory-loop wave).
 *
 * The denormalized counter defaults to 0 and is bumped per turn; rows
 * predating the counter (or that missed fire-and-forget bumps) sit
 * stale-low. Measured on prod first: 5 of 283 conversations lied low
 * (worst: counter=1, real=15). The compile sweep's SQL eligibility
 * filter (`messageCount >= 4`) needs the counter truthful.
 *
 * CORRECTIVE + IDEMPOTENT + RECOMPUTABLE: sets the counter to the real
 * per-conversation message count. No deletes; the source of truth
 * (chat_messages) is untouched; re-running converges to the same state.
 *
 * DRY-RUN by default — prints the mismatches and exits BEFORE any write.
 * Pass --apply to execute the single corrective UPDATE.
 *
 *   railway run --service statenour-web -- pnpm exec tsx scripts/backfill-conversation-messagecount.ts
 *   railway run --service statenour-web -- pnpm exec tsx scripts/backfill-conversation-messagecount.ts --apply
 */
import { prisma } from "../lib/prisma";

const APPLY = process.argv.includes("--apply");

async function main() {
  const mismatches = await prisma.$queryRaw<
    Array<{ id: string; counter: number; real: bigint }>
  >`
    SELECT c.id, c.message_count AS counter, count(m.id) AS real
    FROM chat_conversations c
    LEFT JOIN chat_messages m ON m.conversation_id = c.id
    GROUP BY c.id, c.message_count
    HAVING c.message_count <> count(m.id)
    ORDER BY count(m.id) DESC
  `;

  console.log(`── messageCount backfill (${APPLY ? "APPLY" : "dry-run"}) ──`);
  console.log(`mismatched conversations: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 15)) {
    console.log(`  ${m.id} · counter=${m.counter} → real=${m.real}`);
  }

  if (!APPLY) {
    console.log("dry-run: no writes performed. Re-run with --apply to correct.");
    await prisma.$disconnect();
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE chat_conversations SET message_count = sub.real
    FROM (
      SELECT c.id, count(m.id) AS real
      FROM chat_conversations c
      LEFT JOIN chat_messages m ON m.conversation_id = c.id
      GROUP BY c.id
    ) sub
    WHERE chat_conversations.id = sub.id
      AND chat_conversations.message_count <> sub.real
  `;
  console.log(`corrected rows: ${updated}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
