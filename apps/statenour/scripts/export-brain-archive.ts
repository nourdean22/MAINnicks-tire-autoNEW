/**
 * Complete, machine-readable archive of the brain — the half the Obsidian
 * export was never doing.
 *
 * TWO DIFFERENT JOBS, PREVIOUSLY CONFLATED.
 *
 *   export-brain-to-obsidian.ts is a READING surface. It writes category rollup
 *   markdown and caps each at `slice(0, 100)` so Obsidian does not choke on a
 *   huge note. That cap is CORRECT for reading — and it means the vault is not a
 *   backup. Measured 2026-08-16: 2,822 of 18,027 live memories reachable
 *   (15.7%); 15,205 never exported, 17 categories truncated, `archive_document`
 *   losing 6,969 and `insight` losing 1,024. It also filters `deletedAt: null`,
 *   so anything soft-deleted is absent entirely.
 *
 *   This script is the BACKUP. One JSON object per line, every memory, including
 *   soft-deleted ones (with `deletedAt` preserved so a restore can tell the
 *   difference). No rendering, no cap, no truncation — NDJSON costs Obsidian
 *   nothing because nothing tries to render it.
 *
 * IT ALSO ARCHIVES ORPHANED EMBEDDINGS. `vector_embeddings` rows whose
 * brain_memory is gone are the LAST COPY of their text — measured 2026-08-16,
 * 100% of them had no surviving row with the same key. They are invisible to a
 * `brain_memories` export by definition, so a memories-only archive silently
 * omits exactly the content most at risk. 2,158 rows / 1.5M chars, including
 * 123 gmail_thread.
 *
 * They are archived, NOT restored. Restoring would put raw email content back
 * into recall; archiving preserves the text while it stays structurally
 * invisible (no memory row means no recall path can reach it). Those are
 * different decisions and only one of them is reversible without a PII call.
 *
 * WHY IT LIVES IN THE VAULT. Not for Obsidian to read, but because the vault
 * directory is OneDrive-synced — which makes it an OFF-MACHINE copy without
 * standing up any new infrastructure. The DB is the primary; this is the
 * did-something-eat-it copy.
 *
 * WHY IT CANNOT BE A RAILWAY CRON. The vault is a local Windows path
 * (`C:\Users\nourd\OneDrive\Documents\Obsidian Vault`) and OBSIDIAN_VAULT_PATH
 * is not set on the deployed service. Railway runs Linux containers; there is no
 * filesystem there to write to. This has to run on the operator's machine —
 * README.md alongside carries the scheduled-task command.
 *
 * Path note: the default uses FORWARD slashes. Node accepts them on Windows,
 * and a backslash literal here is one heredoc or one escape away from becoming
 * "Users
ourd" — a real newline in the middle of the path.
 *
 * Usage:
 *   pnpm exec tsx scripts/export-brain-archive.ts --env <path-to-.env>
 *   pnpm exec tsx scripts/export-brain-archive.ts --env <path> --out D:\backups
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

// Parsed BEFORE any client is constructed. ES imports are hoisted above this
// block, so `@/lib/prisma` must be imported dynamically inside main() or it
// builds its adapter without DATABASE_URL and fails while still printing a host.
{
  const i = process.argv.indexOf("--env");
  if (i >= 0 && process.argv[i + 1]) {
    for (const line of fs.readFileSync(process.argv[i + 1], "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}

type Prisma = typeof import("@/lib/prisma")["prisma"];

const PAGE = 1000;

function outDir(): string {
  const i = process.argv.indexOf("--out");
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  const vault = process.env.OBSIDIAN_VAULT_PATH || "C:/Users/nourd/OneDrive/Documents/Obsidian Vault";
  return path.join(path.resolve(vault), "Statenour", "_archive");
}

async function main() {
  const { prisma }: { prisma: Prisma } = await import("@/lib/prisma");
  const dir = outDir();
  fs.mkdirSync(dir, { recursive: true });

  const target = path.join(dir, "brain-memories.ndjson");
  // Write to a temp file and rename at the end: a crash mid-export must not
  // leave a truncated archive where a complete one used to be.
  const tmp = `${target}.partial`;
  const stream = fs.createWriteStream(tmp, { encoding: "utf8" });

  let cursor: string | undefined;
  let total = 0;
  let deleted = 0;
  const byCategory: Record<string, number> = {};

  for (;;) {
    const batch = await prisma.brainMemory.findMany({
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
      select: {
        id: true, category: true, key: true, content: true, confidence: true,
        source: true, createdBy: true, lastSeen: true, seenCount: true,
        expiresAt: true, deletedAt: true, metadata: true, createdAt: true,
      },
    });
    if (batch.length === 0) break;
    for (const m of batch) {
      stream.write(JSON.stringify(m) + "\n");
      total++;
      if (m.deletedAt) deleted++;
      byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
    }
    cursor = batch[batch.length - 1].id;
    if (total % 5000 === 0) console.log(`  ...${total}`);
  }

  await new Promise<void>((res, rej) => stream.end((e?: Error) => (e ? rej(e) : res())));
  fs.renameSync(tmp, target);

  // ── orphaned embeddings ──────────────────────────────────────────────
  // Paged the same way, into a separate file: they are a different kind of
  // record (no memory row, so no confidence/metadata) and mixing them into the
  // memories archive would make a restore ambiguous about what it is reading.
  const orphanPath = path.join(dir, "brain-orphans.ndjson");
  const orphanTmp = `${orphanPath}.partial`;
  const orphanStream = fs.createWriteStream(orphanTmp, { encoding: "utf8" });
  let orphans = 0;
  let orphanCursor = "";
  for (;;) {
    const batch = await prisma.$queryRaw<
      { id: string; sourceId: string; content: string; createdAt: Date }[]
    >`
      SELECT v.id, v."sourceId", v.content, v."createdAt"
      FROM vector_embeddings v
      LEFT JOIN brain_memories bm ON bm.id = v."sourceId"
      WHERE v."sourceType" = 'brain_memory' AND bm.id IS NULL AND v.id > ${orphanCursor}
      ORDER BY v.id ASC
      LIMIT ${PAGE}
    `;
    if (batch.length === 0) break;
    for (const o of batch) {
      // Recover the category from the "[category] key: body" prefix — with
      // position(), not regex: POSIX rejects [^\]] and JS template literals eat
      // the backslashes, and both failures are SILENT (everything parses as
      // unknown) rather than throwing.
      const close = o.content.indexOf("]");
      const category =
        o.content.startsWith("[") && close > 1 ? o.content.slice(1, close) : null;
      orphanStream.write(
        JSON.stringify({ ...o, category, orphaned: true, lastCopy: true }) + "\n",
      );
      orphans++;
    }
    orphanCursor = batch[batch.length - 1].id;
  }
  await new Promise<void>((res, rej) =>
    orphanStream.end((e?: Error) => (e ? rej(e) : res())),
  );
  fs.renameSync(orphanTmp, orphanPath);

  const manifest = {
    exportedAt: new Date().toISOString(),
    total,
    softDeleted: deleted,
    live: total - deleted,
    orphanedEmbeddings: orphans,
    categories: Object.keys(byCategory).length,
    byCategory,
    note:
      "Complete archive. The Obsidian category rollups are a READING surface capped at 100 rows " +
      "per category and exclude soft-deleted rows; these files are the backup and exclude nothing. " +
      "brain-orphans.ndjson holds embeddings whose memory row is gone — the last copy of that text, " +
      "archived but deliberately NOT restored (restoring would return raw content, incl. email, to recall).",
  };
  fs.writeFileSync(path.join(dir, "brain-memories.manifest.json"), JSON.stringify(manifest, null, 2));

  const bytes = fs.statSync(target).size;
  console.log(`\nwrote ${target}`);
  console.log(`  memories ....... ${total}  (${total - deleted} live · ${deleted} soft-deleted)`);
  console.log(`  categories ..... ${Object.keys(byCategory).length}`);
  console.log(`  size ........... ${(bytes / 1e6).toFixed(1)} MB`);
  console.log(`wrote ${orphanPath}`);
  console.log(`  orphans ........ ${orphans}  (last copy — no memory row exists)`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
