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

  const manifest = {
    exportedAt: new Date().toISOString(),
    total,
    softDeleted: deleted,
    live: total - deleted,
    categories: Object.keys(byCategory).length,
    byCategory,
    note:
      "Complete archive. The Obsidian category rollups are a READING surface capped at 100 rows " +
      "per category and exclude soft-deleted rows; this file is the backup and excludes nothing.",
  };
  fs.writeFileSync(path.join(dir, "brain-memories.manifest.json"), JSON.stringify(manifest, null, 2));

  const bytes = fs.statSync(target).size;
  console.log(`\nwrote ${target}`);
  console.log(`  memories ....... ${total}  (${total - deleted} live · ${deleted} soft-deleted)`);
  console.log(`  categories ..... ${Object.keys(byCategory).length}`);
  console.log(`  size ........... ${(bytes / 1e6).toFixed(1)} MB`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
