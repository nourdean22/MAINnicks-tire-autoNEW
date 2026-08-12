/**
 * Approval-queue cleanup — EXECUTE. Writes.
 *
 * Operator-authorized (2026-08-12): "clean up the 468 queue" — the
 * autonomous_action approval="pending" backlog flagged by the MISSION-scan
 * gate (docs/GATE-2026-08-12-mission-scan.md, BDN-002).
 *
 * Deliberately does NOT implement its own mutation: it invokes the
 * INCUMBENT purger — `purgeStaleCategory("pending_actions_7d")` from
 * lib/system/stale-data-purger.ts — which marks rows rejected with
 * approvedBy="auto-purge" where approval="pending" and createdAt < 7d.
 * Same mechanism the operator's /system "purge all" tap runs; this is
 * that tap, executed with receipts. The updateMany WHERE re-checks
 * approval="pending", so rows decided between plan and execute are
 * untouched. Reversible: plan receipt holds every affected id; revert =
 * flip approval back to "pending" for those ids where
 * approvedBy="auto-purge". Nothing is deleted.
 *
 * Run: pnpm exec tsx scripts/approval-queue-cleanup-execute.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { purgeStaleCategory } from "@/lib/system/stale-data-purger";

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

async function counts() {
  const pending = await prisma.autonomousAction.count({
    where: { approval: "pending" },
  });
  const autoPurged = await prisma.autonomousAction.count({
    where: { approval: "rejected", approvedBy: "auto-purge" },
  });
  return { pending, autoPurged };
}

async function main(): Promise<void> {
  console.log(`DB host: ${dbHost()}`);
  const before = await counts();
  console.log(`before: pending=${before.pending} auto-purged=${before.autoPurged}`);

  const result = await purgeStaleCategory("pending_actions_7d");
  console.log(`purger: ${result.note}`);

  const after = await counts();
  console.log(`after:  pending=${after.pending} auto-purged=${after.autoPurged}`);

  const receiptPath = join(
    process.cwd(),
    "docs",
    "APPROVAL-QUEUE-CLEANUP-EXECUTED-2026-08-12.json",
  );
  writeFileSync(
    receiptPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        dbHost: dbHost(),
        authorization: 'operator, 2026-08-12: "clean up the 468 queue"',
        mechanism:
          'purgeStaleCategory("pending_actions_7d") — incumbent stale-data-purger',
        before,
        purged: result.purged,
        note: result.note,
        after,
        planReceipt: "docs/APPROVAL-QUEUE-CLEANUP-PLAN-2026-08-12.json",
      },
      null,
      2,
    ),
  );
  console.log(`receipt written: ${receiptPath}`);
}

void main()
  .catch((err) => {
    console.error("execute failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
