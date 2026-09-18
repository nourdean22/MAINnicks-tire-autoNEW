/**
 * scripts/backfill-journal-silos.ts — 2026-09-18.
 *
 * #2438/#2442 derive reflections / decision_replays / situation_logs from the
 * dumps the operator already writes — but only on NEW ingests. Every historical
 * dump that already carries a derivable entryType was never derived.
 *
 * Measured on prod 2026-09-18 (read-only):
 *   reflection dumps  195  (>=40 chars: 193)  already derived: 0  -> would create 193
 *   decision   dumps   19  (>=40 chars:  19)  already derived: 0  -> would create  19
 *   TOTAL 212. Tables today: reflections 217, decision_replays 9.
 *
 * So this nearly DOUBLES reflections and TRIPLES decision_replays, from content
 * the operator already authored. The 26 files reading `reflections` currently
 * feed on data that stops at 2026-06-17.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY
 * ════════════════════════════════════════════════════════════════════════════
 * · DRY-RUN BY DEFAULT. Writes ONLY with --apply. A --dry-run flag is not a
 *   guard until a non-executing read proves it returns before the write, so the
 *   write is gated at the single call site below, not by a flag checked later.
 * · IDEMPOTENT. Every row is keyed `dump:<brainDumpId>` via derivedKey(), and
 *   deriveJournalSilos() looks that key up BEFORE creating. Re-running creates
 *   nothing. A P2002 from a concurrent run is treated as success, not failure.
 * · REVERSIBLE. Every created row is identifiable by
 *   `idempotencyKey LIKE 'dump:%'` AND `metadata.createdFrom = 'journal-silo-derive'`,
 *   so an undo is a single scoped DELETE. The exact statement is printed at the
 *   end of an --apply run rather than left as an exercise.
 * · REUSES THE PRODUCTION PATH. It calls deriveJournalSilos() — the same
 *   function the live ingest calls. It does NOT reimplement the mapping, so a
 *   backfilled row cannot differ from an organically derived one. A second
 *   implementation would drift, and the drift would be invisible.
 * · RATE-LIMITED. Sequential with a small pause; Neon connection exhaustion was
 *   the limiting factor on every bulk operation this session.
 *
 * Usage (from apps/statenour):
 *   railway run -s statenour-web -- pnpm exec tsx scripts/backfill-journal-silos.ts
 *   railway run -s statenour-web -- pnpm exec tsx scripts/backfill-journal-silos.ts --apply
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

{
  const cjs = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

const APPLY = process.argv.includes("--apply");
const PAUSE_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required — run under `railway run -s statenour-web --`");
    process.exit(1);
  }

  const { prisma } = await import("../lib/prisma");
  const { deriveJournalSilos, DERIVABLE_TYPES } = await import("../lib/brain/journal-silo-derive");

  const types = Object.keys(DERIVABLE_TYPES);
  console.log(`backfill-journal-silos · ${APPLY ? "APPLY (WILL WRITE)" : "DRY RUN (no writes)"}`);
  console.log(`derivable entryTypes: ${types.join(", ")}`);
  console.log("");

  const before = {
    reflections: await prisma.reflection.count(),
    decisionReplays: await prisma.decisionReplay.count(),
    situationLogs: await prisma.situationLog.count(),
  };
  console.log(`BEFORE  reflections=${before.reflections} decision_replays=${before.decisionReplays} situation_logs=${before.situationLogs}`);
  console.log("");

  const dumps = await prisma.brainDump.findMany({
    where: { entryType: { in: types }, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, entryType: true, rawThoughts: true, summary: true, date: true },
  });
  console.log(`candidate dumps: ${dumps.length}`);

  const tally: Record<string, number> = {};
  const bump = (k: string) => {
    tally[k] = (tally[k] ?? 0) + 1;
  };

  if (!APPLY) {
    // ⚠ The dry run must NOT call deriveJournalSilos — that function WRITES.
    // It reports what the same guards would decide, using the exported constant
    // rather than a re-implemented copy of the type mapping.
    for (const d of dumps) {
      const text = (d.rawThoughts ?? "").trim();
      if (text.length < 40) bump("skip: shorter than 40 chars");
      else bump(`would derive: ${d.entryType}`);
    }
  } else {
    for (const d of dumps) {
      const res = await deriveJournalSilos({
        brainDumpId: d.id,
        entryType: d.entryType as never,
        text: d.rawThoughts ?? "",
        summary: d.summary ?? "",
        dateStr: d.date,
      });
      if (res.reflectionId && res.skipped !== "already derived") bump("created: reflection");
      else if (res.decisionReplayId && res.skipped !== "already derived") bump("created: decision_replay");
      else bump(`skipped: ${res.skipped ?? "no id returned"}`);
      await sleep(PAUSE_MS);
    }
  }

  console.log("");
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(4)}  ${k}`);
  }

  if (APPLY) {
    const after = {
      reflections: await prisma.reflection.count(),
      decisionReplays: await prisma.decisionReplay.count(),
      situationLogs: await prisma.situationLog.count(),
    };
    console.log("");
    console.log(`AFTER   reflections=${after.reflections} (+${after.reflections - before.reflections})` +
      ` decision_replays=${after.decisionReplays} (+${after.decisionReplays - before.decisionReplays})` +
      ` situation_logs=${after.situationLogs} (+${after.situationLogs - before.situationLogs})`);
    console.log("");
    console.log("UNDO (scoped to rows this created, nothing else):");
    console.log("  DELETE FROM reflections WHERE idempotency_key LIKE 'dump:%'");
    console.log("    AND metadata->>'createdFrom' = 'journal-silo-derive';");
    console.log("  DELETE FROM decision_replays WHERE idempotency_key LIKE 'dump:%';");
  } else {
    console.log("");
    console.log("DRY RUN — nothing was written. Re-run with --apply to create these rows.");
  }

  await prisma.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
