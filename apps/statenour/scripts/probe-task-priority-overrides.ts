/**
 * Read-only census for manual task priorities written before the
 * 2026-08-19 higher-is-hotter polarity change.
 *
 * This intentionally performs SELECTs only. The old and new conventions are
 * not safely distinguishable for every arbitrary 0-100 value, so this probe
 * gives the operator the affected rows and a suggested remap without guessing
 * or mutating production data.
 *
 * Run with the intended target environment, for example:
 *   railway run --service statenour-web -- pnpm exec tsx scripts/probe-task-priority-overrides.ts
 */
import { prisma } from "@/lib/prisma";
import { priorityBandLabel } from "@/lib/scoring/task-priority";

function suggestedLegacyRemap(value: number): number {
  if (value < 10) return 100;
  if (value < 20) return 90;
  if (value < 40) return 70;
  if (value < 60) return 50;
  return 30;
}

async function main(): Promise<void> {
  const rows = await prisma.task.findMany({
    where: { deletedAt: null, manualPriorityOverride: { not: null } },
    select: {
      id: true,
      title: true,
      status: true,
      manualPriorityOverride: true,
      autoPriority: true,
      autoPriorityExplanation: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "asc" },
  });

  console.log(`manual overrides: ${rows.length}`);
  for (const row of rows) {
    const value = row.manualPriorityOverride;
    if (value === null) continue;
    const suggested = suggestedLegacyRemap(value);
    console.log(
      JSON.stringify({
        id: row.id,
        title: row.title.slice(0, 120),
        status: row.status,
        stored: value,
        currentBand: priorityBandLabel(value),
        suggestedLegacyRemap: suggested,
        suggestedBand: priorityBandLabel(suggested),
        autoPriority: row.autoPriority,
        explanation: row.autoPriorityExplanation,
        updatedAt: row.updatedAt.toISOString(),
      }),
    );
  }
}

void main()
  .catch((error) => {
    console.error("priority override probe failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
