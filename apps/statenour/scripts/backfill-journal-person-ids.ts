/**
 * W8b (2026-11-03) · stamp person ids on OLD journal entries, ids only.
 *
 * PR 3522 added brain_dumps.person_ids and W8b adds reflections.person_ids; both are filled for new entries by the
 * journal link. The 1,564 entries before them carry none, so the /people journal line, the person story and Home's
 * journal line cannot see what he wrote about anyone before 2026-11-02. This writes the ids and NOTHING else: no
 * ledger rows (a mention is not a contact), no model calls (the exact whole-word name rule, nameMatcher, the same
 * rule the people engine's chatSnippets uses), no counters.
 *
 *   (default) dry run: reads, prints counts, and RETURNS before the first write (prod-db-guard: the return is
 *              the guard, proven by tests/scripts/backfill-journal-person-ids.test.ts, which asserts the writer is
 *              never reached without --execute AND the env flag).
 *   --execute: writes, only when JOURNAL_PERSON_IDS_EXECUTE=1 is also set; otherwise exits 2 BEFORE any
 *              connection opens. Each write is a compare-and-swap on the still-empty column, and the rows it
 *              stamped go to ./backfill-journal-person-ids.applied.json (ids only).
 *   --revert <manifest>: clears exactly those rows, each only while it still holds what was stamped (a row the live
 *              link has changed since keeps its ids). Same env flag.
 *   --limit N: entries read per table (default 5000).
 *
 *   railway run -s statenour-web -- pnpm exec tsx scripts/backfill-journal-person-ids.ts
 *   JOURNAL_PERSON_IDS_EXECUTE=1 railway run -s statenour-web -- pnpm exec tsx scripts/backfill-journal-person-ids.ts --execute
 *
 * Only entries with an EMPTY person_ids are touched: an entry the link already stamped (even with []) after a real
 * extraction is not re-decided here... except that the link writes [] for "named no one", which this script cannot
 * tell from "never linked". Ruling: an empty list is re-scanned; the name rule is the same gate, so a no-match stays [].
 */
import { loadEnvConfig } from "@next/env";
import Module from "node:module";

loadEnvConfig(process.cwd());

{
  const cjs = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const original = cjs._load;
  cjs._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    return original(request, parent, isMain);
  };
}

export const EXECUTE_ENV = "JOURNAL_PERSON_IDS_EXECUTE";

/** --execute writes what it stamped here (cwd), the input --revert takes. Ids only, never a name or a note. */
export const MANIFEST_FILE = "backfill-journal-person-ids.applied.json";

export interface Args {
  mode: "dry" | "execute" | "revert";
  limit: number;
  /** --revert <file>: the manifest an --execute run wrote. */
  revertFile: string | null;
}

/** Refuses (throws) when --execute or --revert is asked for without the env flag: nothing after this opens a connection. */
export function parseArgs(argv: string[], env: Record<string, string | undefined>): Args {
  const execute = argv.includes("--execute");
  const ri = argv.indexOf("--revert");
  const revertFile = ri >= 0 ? (argv[ri + 1] ?? "") : null;
  if (execute && revertFile !== null) throw new Error("--execute and --revert cannot run together");
  if ((execute || revertFile !== null) && env[EXECUTE_ENV] !== "1") {
    throw new Error(`${execute ? "--execute" : "--revert"} needs ${EXECUTE_ENV}=1 in the environment`);
  }
  if (revertFile === "") throw new Error("--revert needs the manifest path");
  const li = argv.indexOf("--limit");
  const limit = li >= 0 ? Number(argv[li + 1]) : 5000;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return { mode: revertFile !== null ? "revert" : execute ? "execute" : "dry", limit, revertFile };
}

/** The ids of the people whose name appears, whole-word and case-insensitively, in the text. */
export function planPersonIds(
  text: string,
  people: ReadonlyArray<{ id: string; name: string }>,
  matcher: (name: string) => RegExp,
): string[] {
  const out: string[] = [];
  for (const p of people) if (p.name.trim().length >= 2 && matcher(p.name).test(text)) out.push(p.id);
  return out;
}

interface Table {
  label: string;
  rows: () => Promise<Array<{ id: string; text: string }>>;
  /** Compare-and-swap: stamps only a row whose person_ids is still empty (the live link may have written since the read). */
  write: (id: string, personIds: string[]) => Promise<{ count: number }>;
  /** Revert: clears a row only while it still holds exactly what this script stamped. */
  clear: (id: string, personIds: string[]) => Promise<{ count: number }>;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(argv, process.env);
  } catch (err) {
    console.error(`refused: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  // prod-db-guard: say which database before any read or write (a worktree's .env points at production). Host only.
  let host = "unknown (DATABASE_URL unset or unparseable)";
  try {
    if (process.env.DATABASE_URL) host = new URL(process.env.DATABASE_URL).hostname || host;
  } catch {
    /* host stays unknown */
  }
  console.log(`database host: ${host}`);
  const fs = await import("node:fs");
  // --revert reads its manifest BEFORE the Prisma import: a wrong path fails before any connection opens.
  const manifest =
    args.mode === "revert"
      ? (JSON.parse(String(fs.readFileSync(args.revertFile!, "utf8"))) as Array<{ table: string; id: string; personIds: string[] }>)
      : null;
  const { prisma } = await import("@/lib/prisma");
  const { nameMatcher } = await import("@/lib/services/people/backfill-plan");

  const people = await prisma.personProfile.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
  const tables: Table[] = [
    {
      label: "brain_dumps",
      rows: async () =>
        (
          await prisma.brainDump.findMany({
            where: { deletedAt: null, personIds: { isEmpty: true } },
            orderBy: { createdAt: "desc" },
            take: args.limit,
            select: { id: true, rawThoughts: true },
          })
        ).map((d) => ({ id: d.id, text: d.rawThoughts })),
      write: (id, personIds) => prisma.brainDump.updateMany({ where: { id, personIds: { isEmpty: true } }, data: { personIds } }),
      clear: (id, personIds) => prisma.brainDump.updateMany({ where: { id, personIds: { equals: personIds } }, data: { personIds: [] } }),
    },
    {
      label: "reflections",
      rows: async () =>
        (
          await prisma.reflection.findMany({
            where: { deletedAt: null, personIds: { isEmpty: true } },
            orderBy: { createdAt: "desc" },
            take: args.limit,
            select: { id: true, insight: true },
          })
        ).map((r) => ({ id: r.id, text: r.insight })),
      write: (id, personIds) => prisma.reflection.updateMany({ where: { id, personIds: { isEmpty: true } }, data: { personIds } }),
      clear: (id, personIds) => prisma.reflection.updateMany({ where: { id, personIds: { equals: personIds } }, data: { personIds: [] } }),
    },
  ];

  if (manifest) {
    // Revert: each row only while it still holds exactly the ids this script stamped; a row the live link has
    // changed since keeps its ids ("kept").
    let reverted = 0;
    let kept = 0;
    for (const m of manifest) {
      const table = tables.find((t) => t.label === m.table);
      if (!table) throw new Error(`manifest names an unknown table: ${m.table}`);
      const r = await table.clear(m.id, m.personIds);
      if (r.count === 1) reverted++;
      else kept++;
    }
    console.log(`reverted=${reverted} kept=${kept}`);
    await prisma.$disconnect();
    return;
  }

  console.log(`mode=${args.mode} people=${people.length} limit=${args.limit}`);
  const plans: Array<{ table: Table; id: string; personIds: string[] }> = [];
  for (const table of tables) {
    const rows = await table.rows();
    let toStamp = 0;
    const perPerson = new Map<string, number>();
    for (const row of rows) {
      const personIds = planPersonIds(row.text, people, nameMatcher);
      if (personIds.length === 0) continue;
      toStamp++;
      for (const id of personIds) perPerson.set(id, (perPerson.get(id) ?? 0) + 1);
      plans.push({ table, id: row.id, personIds });
    }
    console.log(`${table.label}: scanned=${rows.length} to_stamp=${toStamp} people_named=${perPerson.size}`);
    // Counts and id suffixes only: never a name or a note.
    for (const [id, n] of [...perPerson].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  person …${id.slice(-6)}: ${n} entries`);
  }

  if (args.mode === "dry") {
    console.log("dry run: nothing written. Re-run with --execute and the env flag to stamp these ids.");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  let skipped = 0;
  let failed = 0;
  const applied: Array<{ table: string; id: string; personIds: string[] }> = [];
  for (const p of plans) {
    try {
      const r = await p.table.write(p.id, p.personIds);
      if (r.count === 1) {
        written++;
        applied.push({ table: p.table.label, id: p.id, personIds: p.personIds });
      } else skipped++;
    } catch (err) {
      failed++;
      console.error(`write failed ${p.table.label} …${p.id.slice(-6)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // The revert input: exactly what was stamped, ids only. Written even when some writes failed.
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(applied, null, 2));
  console.log(`written=${written} skipped_already_linked=${skipped} failed=${failed} manifest=${MANIFEST_FILE}`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

if (process.argv[1]?.endsWith("backfill-journal-person-ids.ts")) {
  void main();
}
