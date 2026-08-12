/**
 * Approval-queue cleanup — PLAN. Read-only, writes nothing to the DB.
 *
 * Previews exactly what the INCUMBENT purger would do: `stale-data-purger`'s
 * `purgePendingActions()` marks autonomous_action rows rejected
 * (approvedBy="auto-purge") where approval="pending" and createdAt < 7 days
 * ago. That purger is operator-tap-only on the /system stale-data surface,
 * which is how the queue accumulated 468 rows (census probe 2026-08-12).
 *
 * This script uses the SAME predicate (7d, hardcoded in the purger) so the
 * preview cannot drift from the execute path, prints the split, and saves
 * the full candidate row list to docs/APPROVAL-QUEUE-CLEANUP-PLAN-<date>.json
 * as the before-state receipt (and the revert list, if ever needed).
 *
 * Run: pnpm exec tsx scripts/approval-queue-cleanup-plan.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function main(): Promise<void> {
  console.log(`DB host: ${dbHost()}`);
  const now = new Date();
  // The purger's own predicate — 7 days, `<` comparison. Keep identical.
  const since7d = new Date(now.getTime() - 7 * 86400_000);

  const pending = await prisma.autonomousAction.findMany({
    where: { approval: "pending" },
    select: { id: true, ruleName: true, actionType: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const purge = pending.filter((r) => r.createdAt < since7d);
  const keep = pending.filter((r) => r.createdAt >= since7d);

  console.log(`\npending total: ${pending.length}`);
  console.log(`PURGE (older than 7d — purger predicate): ${purge.length}`);
  console.log("  by rule:", tally(purge, (r) => r.ruleName));
  console.log(`KEEP (7d or newer — stays for real review): ${keep.length}`);
  console.log("  by rule:", tally(keep, (r) => r.ruleName));
  if (purge.length > 0) {
    console.log(
      `  purge range: ${purge[0].createdAt.toISOString()} .. ${purge[purge.length - 1].createdAt.toISOString()}`,
    );
  }

  const receiptPath = join(
    process.cwd(),
    "docs",
    "APPROVAL-QUEUE-CLEANUP-PLAN-2026-08-12.json",
  );
  writeFileSync(
    receiptPath,
    JSON.stringify(
      {
        generatedAt: now.toISOString(),
        dbHost: dbHost(),
        predicate: 'approval="pending" AND createdAt < now-7d (purger-identical)',
        executeMechanism:
          'stale-data-purger purgeStaleCategory("pending_actions_7d") — sets approval="rejected", approvedBy="auto-purge"',
        revertRecipe:
          'UPDATE: set approval="pending", approvedBy=NULL where id in purge[] and approvedBy="auto-purge"',
        totals: { pending: pending.length, purge: purge.length, keep: keep.length },
        purge: purge.map((r) => ({
          id: r.id,
          ruleName: r.ruleName,
          actionType: r.actionType,
          createdAt: r.createdAt.toISOString(),
        })),
        keep: keep.map((r) => ({
          id: r.id,
          ruleName: r.ruleName,
          actionType: r.actionType,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nreceipt written: ${receiptPath}`);
}

void main()
  .catch((err) => {
    console.error("plan failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
