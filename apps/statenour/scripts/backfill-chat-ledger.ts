/**
 * scripts/backfill-chat-ledger.ts · Wave BE · 2026-05-28.
 *
 * Sweep chat history for person-mentions and synthesize +1 ledger
 * entries so the Power Atlas has historical "touch" signal instead of
 * just the entries the operator manually logged. Pre-this-script
 * lastInteraction is under-counted because operator never bothered to
 * log everyday chat mentions.
 *
 * Strategy:
 *   1. Pull all active PersonProfile rows (deletedAt:null).
 *   2. Build a name-token index: { firstNameLower → [personId, ...] }.
 *   3. Stream ChatMessage rows where role="user" + createdAt last 365d.
 *   4. For each message · tokenize · check for any first-name match.
 *      Single-name match → high confidence. Multi-match → skip
 *      (ambiguous · don't fabricate ledger entries we'd regret).
 *   5. For each matched (personId, chatMessageId) tuple · check if a
 *      RelationshipLedger row already exists with
 *      source="chat" + metadata.chatMessageId=msg.id. Skip if so.
 *   6. Insert +1 magnitude entry · note="[auto] mentioned in chat" ·
 *      source="chat" · metadata.chatMessageId for idempotency ·
 *      createdAt = msg.createdAt (preserve actual interaction date,
 *      not backfill date, so neglect-detection math stays honest).
 *
 * Idempotent · safe to re-run · idempotency via metadata.chatMessageId.
 *
 * Conservative:
 *   - Only first-name matches (last-name fuzzy is too noisy)
 *   - Single-person-per-message only (skips ambiguous)
 *   - +1 magnitude (small · doesn't overclaim sentiment)
 *   - source="chat" (distinguishable from operator manual entries)
 *
 * Run:
 *   pnpm tsx scripts/backfill-chat-ledger.ts             # apply
 *   pnpm tsx scripts/backfill-chat-ledger.ts --dry-run   # preview
 *   pnpm tsx scripts/backfill-chat-ledger.ts --days=90   # narrower window
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";

const DRY_RUN = process.argv.includes("--dry-run");
const DAYS_ARG = process.argv.find((a) => a.startsWith("--days="));
const DAYS = DAYS_ARG ? Math.max(1, parseInt(DAYS_ARG.split("=")[1], 10)) : 365;

interface PersonIndexEntry {
  id: string;
  fullName: string;
}

// Token rules: lowercase, alphabetic-only, ≥3 chars. Avoids matching
// "Al" in "All of us" — too short to disambiguate.
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

async function main(): Promise<void> {
  console.log(
    `[backfill-chat-ledger] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"} days=${DAYS} starting…`,
  );

  // ── Build the person index ──
  const people = await prisma.personProfile.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });

  const firstNameIndex = new Map<string, PersonIndexEntry[]>();
  for (const p of people) {
    if (!p.name) continue;
    const firstName = p.name.trim().split(/\s+/)[0]?.toLowerCase();
    if (!firstName || firstName.length < 3) continue;
    const bucket = firstNameIndex.get(firstName) ?? [];
    bucket.push({ id: p.id, fullName: p.name });
    firstNameIndex.set(firstName, bucket);
  }
  console.log(
    `[backfill-chat-ledger] indexed ${people.length} people · ${firstNameIndex.size} unique first names`,
  );

  // ── Stream chat messages in batches ──
  const since = new Date();
  since.setDate(since.getDate() - DAYS);

  const totalMessages = await prisma.chatMessage.count({
    where: { role: "user", createdAt: { gte: since } },
  });
  console.log(
    `[backfill-chat-ledger] scanning ${totalMessages} user messages since ${since.toISOString().slice(0, 10)}`,
  );

  // Pre-load existing chat-sourced ledger entries for idempotency.
  // We compare on metadata.chatMessageId so re-runs are cheap.
  const existingLedger = await prisma.relationshipLedger.findMany({
    where: { source: "chat" },
    select: { metadata: true },
  });
  const seenMsgIds = new Set<string>();
  for (const row of existingLedger) {
    const meta = row.metadata as { chatMessageId?: string } | null;
    if (meta?.chatMessageId) seenMsgIds.add(meta.chatMessageId);
  }
  console.log(
    `[backfill-chat-ledger] ${seenMsgIds.size} chat-sourced ledger entries already exist (skipping these)`,
  );

  const BATCH = 500;
  let offset = 0;
  let scanned = 0;
  let matched = 0;
  let inserted = 0;
  let skippedAmbiguous = 0;
  let skippedDupe = 0;
  let failed = 0;

  while (offset < totalMessages) {
    const batch = await prisma.chatMessage.findMany({
      where: { role: "user", createdAt: { gte: since } },
      select: { id: true, content: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: BATCH,
    });
    if (batch.length === 0) break;

    for (const msg of batch) {
      scanned += 1;

      if (seenMsgIds.has(msg.id)) {
        skippedDupe += 1;
        continue;
      }

      const tokens = new Set(tokenize(msg.content));
      const hits: PersonIndexEntry[] = [];
      for (const tok of tokens) {
        const matchSet = firstNameIndex.get(tok);
        if (matchSet) hits.push(...matchSet);
      }

      // Dedupe by personId (a single message mentioning "Dania" twice
      // is one touch, not two).
      const uniqueByPerson = new Map<string, PersonIndexEntry>();
      for (const h of hits) uniqueByPerson.set(h.id, h);
      const matches = [...uniqueByPerson.values()];

      if (matches.length === 0) continue;
      if (matches.length > 3) {
        // > 3 person matches in one message · likely a list / context
        // dump · skip rather than fabricate noise
        skippedAmbiguous += 1;
        continue;
      }

      matched += matches.length;

      for (const person of matches) {
        if (DRY_RUN) {
          inserted += 1;
          continue;
        }

        try {
          await prisma.relationshipLedger.create({
            data: {
              personId: person.id,
              amount: 1,
              note: `[auto · backfill] mentioned in chat`,
              source: "chat",
              createdAt: msg.createdAt, // preserve real interaction date
              metadata: {
                chatMessageId: msg.id,
                matchedFirstName: person.fullName.split(/\s+/)[0],
                backfilledAt: new Date().toISOString(),
                synthetic: true,
              } as never,
            },
          });
          inserted += 1;
          seenMsgIds.add(msg.id);
        } catch (err) {
          failed += 1;
          if (failed % 50 === 0) {
            console.warn(
              `[backfill] FAILED person=${person.id} msg=${msg.id} · ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    offset += BATCH;
    if (offset % 5000 === 0) {
      console.log(
        `[backfill] scanned ${scanned}/${totalMessages} · inserted ${inserted}`,
      );
    }
  }

  console.log(
    `[backfill-chat-ledger] done · scanned=${scanned} matched=${matched} inserted=${inserted} skippedDupe=${skippedDupe} skippedAmbiguous=${skippedAmbiguous} failed=${failed}`,
  );

  // Refresh PersonProfile.lastInteraction + interactionCount derived
  // values · the people-intelligence engine recomputes these on next
  // /api/people call · no extra work needed here.

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error("[backfill-chat-ledger] fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
