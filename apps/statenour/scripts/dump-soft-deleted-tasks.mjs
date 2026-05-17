// Dump full list of soft-deleted INBOX tasks for operator review
// One-shot · read-only · output: soft-deleted-tasks-<date>.md in cwd
const { prisma: p } = await import("../lib/prisma.ts");
import { writeFile } from "node:fs/promises";

const rows = await p.task.findMany({
  where: { deletedAt: { not: null }, status: "INBOX" },
  orderBy: { deletedAt: "desc" },
  select: {
    id: true,
    title: true,
    deletedAt: true,
    createdAt: true,
    lastTouchedAt: true,
    autoPriority: true,
    nextPhysicalAction: true,
    mission: { select: { title: true, domain: true } },
  },
});

console.log(`Found ${rows.length} soft-deleted INBOX tasks`);

const lines = [];
lines.push(`# Soft-deleted INBOX tasks · ${rows.length} total · generated ${new Date().toISOString()}`);
lines.push("");
lines.push("## Format");
lines.push("- `[deleted-date] [created-date] (mission/domain · pri=N) <id> :: <title>`");
lines.push("- Sorted newest-deleted first");
lines.push("- All have `status=INBOX` AND `deletedAt != null`");
lines.push("");
lines.push("## Bulk restore commands");
lines.push("```");
lines.push("# Restore ALL 117:");
lines.push("pnpm tsx scripts/restore-soft-deleted-tasks.mjs --all");
lines.push("");
lines.push("# Restore a date range (delete-date · ISO yyyy-mm-dd):");
lines.push("pnpm tsx scripts/restore-soft-deleted-tasks.mjs --from 2026-05-08 --to 2026-05-12");
lines.push("");
lines.push("# Restore specific ids (space-separated):");
lines.push("pnpm tsx scripts/restore-soft-deleted-tasks.mjs --ids cmosul72o002,cmp7fekbo000");
lines.push("```");
lines.push("");

// Group by deleted-date for readability
const byDay = {};
for (const r of rows) {
  const day = r.deletedAt.toISOString().slice(0, 10);
  if (!byDay[day]) byDay[day] = [];
  byDay[day].push(r);
}

const sortedDays = Object.keys(byDay).sort().reverse();
for (const day of sortedDays) {
  const dayRows = byDay[day];
  lines.push(`## ${day} · ${dayRows.length} deleted`);
  lines.push("");
  for (const r of dayRows) {
    const created = r.createdAt.toISOString().slice(0, 10);
    const mission = r.mission ? `${r.mission.title}/${r.mission.domain}` : "(no mission)";
    const pri = r.autoPriority ?? "?";
    lines.push(`- \`${day}\` from \`${created}\` (${mission} · pri=${pri}) \`${r.id}\``);
    lines.push(`  - **${r.title}**`);
    if (r.nextPhysicalAction && r.nextPhysicalAction !== r.title) {
      lines.push(`  - next: ${r.nextPhysicalAction.slice(0, 100)}`);
    }
    lines.push("");
  }
}

const filename = `soft-deleted-tasks-${new Date().toISOString().slice(0, 10)}.md`;
await writeFile(filename, lines.join("\n"));
console.log(`Wrote ${lines.length} lines to ${filename}`);
console.log(`Open with: code ${filename}`);

await p.$disconnect();
