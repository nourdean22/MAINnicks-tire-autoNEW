// Restore soft-deleted INBOX tasks · operator-controlled
// Read-only DRY-RUN by default · pass --commit to actually flip deletedAt=null
//
// USAGE:
//   pnpm tsx scripts/restore-soft-deleted-tasks.mjs --all                  # all 117
//   pnpm tsx scripts/restore-soft-deleted-tasks.mjs --from 2026-05-08 --to 2026-05-12
//   pnpm tsx scripts/restore-soft-deleted-tasks.mjs --ids id1,id2,id3
//   ... add --commit to actually write
//
// Restored tasks land back in INBOX (their original status) · deletedAt=null.
// updatedBy="operator-restore" so future audits can trace the rehydration.
const { prisma: p } = await import("../lib/prisma.ts");

const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const isAll = args.includes("--all");
const isCommit = args.includes("--commit");
const from = flag("--from");
const to = flag("--to");
const idsArg = flag("--ids");

const where = { deletedAt: { not: null }, status: "INBOX" };
if (from || to) {
  where.deletedAt = {
    not: null,
    ...(from ? { gte: new Date(from + "T00:00:00Z") } : {}),
    ...(to ? { lte: new Date(to + "T23:59:59Z") } : {}),
  };
}
if (idsArg) {
  where.id = { in: idsArg.split(",").map((s) => s.trim()).filter(Boolean) };
}
if (!isAll && !from && !to && !idsArg) {
  console.error("ERROR: pass one of --all / --from <date> --to <date> / --ids id1,id2");
  process.exit(1);
}

const matches = await p.task.findMany({
  where,
  select: { id: true, title: true, deletedAt: true, status: true },
});
console.log(`Matched ${matches.length} soft-deleted INBOX tasks`);
for (const t of matches.slice(0, 10)) {
  console.log(`  ${t.deletedAt.toISOString().slice(0, 10)} ${t.id} :: ${t.title.slice(0, 60)}`);
}
if (matches.length > 10) console.log(`  ...and ${matches.length - 10} more`);

if (!isCommit) {
  console.log("\nDRY RUN · pass --commit to actually restore.");
  console.log(`Would set deletedAt=null + updatedBy="operator-restore" on ${matches.length} rows.`);
  await p.$disconnect();
  process.exit(0);
}

const result = await p.task.updateMany({
  where: { id: { in: matches.map((m) => m.id) } },
  data: { deletedAt: null, updatedBy: "operator-restore", lastTouchedAt: new Date() },
});
console.log(`\nRestored ${result.count} tasks · they're back in INBOX active.`);
console.log("Refresh /tasks (or trigger a bus event) to see them.");

await p.$disconnect();
