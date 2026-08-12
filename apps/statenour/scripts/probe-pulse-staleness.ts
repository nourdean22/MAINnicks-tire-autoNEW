/**
 * Read-only probe: Pulse ticker staleness investigation (2026-08-12).
 * SELECT-only — confirms the promise_integrity vocabulary-mismatch
 * theory and the actual commitment ages against live prod data before
 * any fix is written. No writes.
 *
 * Run: railway run --service statenour-web -- pnpm exec tsx scripts/probe-pulse-staleness.ts
 */
import { prisma } from "@/lib/prisma";

async function main(): Promise<void> {
  const snap = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "identity_snapshot", key: "current" } },
    select: { content: true, updatedAt: true },
  });
  console.log("=== identity_snapshot/current ===");
  console.log("row updatedAt:", snap?.updatedAt?.toISOString() ?? "MISSING ROW");
  if (snap?.content) {
    const parsed = JSON.parse(snap.content) as {
      axes?: Record<string, { value: number; manual: number | null; direction: string; evidence: string[]; updated_at: string }>;
      computed_at?: string;
    };
    console.log("computed_at:", parsed.computed_at);
    console.log("promise_integrity axis:", JSON.stringify(parsed.axes?.promise_integrity, null, 2));
    console.log("reflection_cadence axis:", JSON.stringify(parsed.axes?.reflection_cadence, null, 2));
  }

  console.log("\n=== commitment status distribution (all-time) ===");
  const byStatus = await prisma.commitment.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: { deletedAt: null },
  });
  for (const row of byStatus) console.log(`  ${row.status.padEnd(14)} ${row._count._all}`);

  console.log("\n=== active commitments updated in last 60d (computePromiseIntegrity's window) ===");
  const since = new Date(Date.now() - 60 * 86400_000);
  const recent = await prisma.commitment.findMany({
    where: { updatedAt: { gte: since }, deletedAt: null },
    select: { id: true, status: true, updatedAt: true },
  });
  console.log(`  count: ${recent.length}`);
  const recentByStatus = new Map<string, number>();
  for (const r of recent) recentByStatus.set(r.status, (recentByStatus.get(r.status) ?? 0) + 1);
  for (const [status, n] of recentByStatus) console.log(`  ${status.padEnd(14)} ${n}`);

  console.log("\n=== ALL active+overdue commitments (personal-pulse's exact query, no top-3 cap) ===");
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const overdueFloorStr = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const overdue = await prisma.commitment.findMany({
    where: { status: "active", deadline: { lt: todayStr, gte: overdueFloorStr }, deletedAt: null },
    orderBy: { deadline: "asc" },
    select: { id: true, description: true, deadline: true, toWhom: true, createdAt: true, updatedAt: true },
  });
  console.log(`  count: ${overdue.length}`);
  for (const c of overdue) {
    const daysOverdue = c.deadline ? Math.floor((Date.now() - new Date(c.deadline).getTime()) / 86400000) : 0;
    console.log(`  #${c.id} · ${daysOverdue}d overdue · owed ${c.toWhom} · created ${c.createdAt.toISOString().slice(0, 10)} · "${c.description.slice(0, 70)}"`);
  }

  console.log("\n=== ALL active commitments (any deadline, incl. beyond 90d floor) ===");
  const allActive = await prisma.commitment.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, deadline: true, toWhom: true, createdAt: true },
  });
  console.log(`  count: ${allActive.length}`);
  for (const c of allActive.slice(0, 20)) {
    const ageDays = Math.floor((Date.now() - c.createdAt.getTime()) / 86400000);
    console.log(`  #${c.id} · created ${ageDays}d ago · deadline=${c.deadline ?? "none"} · owed ${c.toWhom} · "${c.description.slice(0, 60)}"`);
  }
}

void main().finally(() => prisma.$disconnect());
