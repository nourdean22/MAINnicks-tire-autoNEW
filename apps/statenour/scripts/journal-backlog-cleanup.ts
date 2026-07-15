/**
 * Journal backlog cleanup · audit 2026-07-15.
 *
 * The /journal feed carries a pre-v10.0.231 backlog: chat commands and
 * questions ingested as journal entries ("look up the best audiobooks",
 * "find the current weather in Cleveland"), plus exact-duplicate rows
 * minted by the old commit_journal re-ingest bug. The live ingest gate
 * (looksLikeBrainDump) now blocks new noise; this script sweeps what is
 * already stored.
 *
 * SAFE BY DEFAULT — dry-run prints what WOULD be quarantined and exits.
 * Nothing is ever hard-deleted: --apply sets deletedAt (soft delete,
 * reversible with a single updateMany), which the feed now respects.
 *
 * Usage (from apps/statenour, DATABASE_URL in env):
 *   pnpm exec tsx scripts/journal-backlog-cleanup.ts            # dry-run
 *   pnpm exec tsx scripts/journal-backlog-cleanup.ts --apply    # quarantine
 *
 * Classification (deterministic, zero AI):
 *   duplicate — exact rawThoughts match of an earlier row (earliest kept)
 *   noise     — fails looksLikeBrainDump (question/command phrasing)
 *               OR is shorter than 20 chars
 */

import { prisma } from "@/lib/prisma";
import { looksLikeBrainDump } from "@/lib/ai/chat/brain-dump-detector";

const APPLY = process.argv.includes("--apply");
const MIN_ENTRY_CHARS = 20;

type Flagged = { id: string; date: string; reason: "duplicate" | "noise"; preview: string };

async function main(): Promise<void> {
  const dumps = await prisma.brainDump.findMany({
    where: { deletedAt: null },
    select: { id: true, date: true, createdAt: true, rawThoughts: true },
    orderBy: { createdAt: "asc" },
  });

  const flagged: Flagged[] = [];
  const seenText = new Map<string, string>(); // rawThoughts -> first id

  for (const d of dumps) {
    const text = d.rawThoughts.trim();
    const preview = text.slice(0, 70).replace(/\s+/g, " ");

    const firstId = seenText.get(text);
    if (firstId) {
      flagged.push({ id: d.id, date: d.date, reason: "duplicate", preview });
      continue;
    }
    seenText.set(text, d.id);

    if (text.length < MIN_ENTRY_CHARS || !looksLikeBrainDump(text)) {
      flagged.push({ id: d.id, date: d.date, reason: "noise", preview });
    }
  }

  const duplicates = flagged.filter((f) => f.reason === "duplicate");
  const noise = flagged.filter((f) => f.reason === "noise");

  console.log(`\nJournal backlog cleanup · ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`Scanned ${dumps.length} live brain_dumps`);
  console.log(`  duplicates: ${duplicates.length}`);
  console.log(`  noise:      ${noise.length}\n`);

  for (const f of flagged) {
    console.log(`  [${f.reason.padEnd(9)}] ${f.date} ${f.id.slice(0, 8)} · ${f.preview}`);
  }

  if (!APPLY) {
    console.log(`\nDry-run only — re-run with --apply to soft-delete the ${flagged.length} rows above.`);
    return;
  }

  if (flagged.length === 0) {
    console.log("Nothing to quarantine.");
    return;
  }

  const now = new Date();
  const result = await prisma.brainDump.updateMany({
    where: { id: { in: flagged.map((f) => f.id) } },
    data: { deletedAt: now },
  });
  console.log(`\nQuarantined ${result.count} rows (deletedAt=${now.toISOString()}).`);
  console.log("Reversible: updateMany({ where: { deletedAt: <that timestamp> }, data: { deletedAt: null } })");
}

main()
  .catch((err) => {
    console.error("cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
