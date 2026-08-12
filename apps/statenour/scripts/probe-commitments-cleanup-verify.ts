/**
 * Read-only probe: verify the 2026-08-12 commitments cleanup landed as
 * expected. SELECT-only, no writes.
 *
 * Run: railway run --service statenour-web -- pnpm exec tsx scripts/probe-commitments-cleanup-verify.ts
 */
import { prisma } from "@/lib/prisma";

const SPOT_CHECK: Array<{ id: number; expect: string }> = [
  { id: 160, expect: "completed" },
  { id: 165, expect: "abandoned" },
  { id: 266, expect: "abandoned" },
  { id: 178, expect: "active" },
  { id: 447, expect: "active" },
];

async function main(): Promise<void> {
  const byStatus = await prisma.commitment.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  console.log("=== status distribution (all non-deleted commitments) ===");
  for (const row of byStatus) {
    console.log(`  ${row.status}: ${row._count._all}`);
  }

  console.log("\n=== spot check ===");
  for (const { id, expect } of SPOT_CHECK) {
    const row = await prisma.commitment.findUnique({
      where: { id },
      select: { id: true, status: true, notes: true },
    });
    const ok = row?.status === expect;
    console.log(
      `  #${id}: expected=${expect} actual=${row?.status ?? "MISSING"} ${ok ? "OK" : "MISMATCH"}${
        row?.notes ? ` · notes="${row.notes}"` : ""
      }`,
    );
  }

  const activeCount = await prisma.commitment.count({ where: { status: "active", deletedAt: null } });
  console.log(`\nactive commitments remaining: ${activeCount} (expected 76)`);
}

void main().finally(() => prisma.$disconnect());
