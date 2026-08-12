/**
 * Approval-queue census — READ-ONLY probe. No writes anywhere.
 *
 * The Home header's "Approvals (N)" badge is the sum of TWO queues:
 *   1. approval_requests at status "pending_approval"  (browser-automation
 *      approval gate — trpc systemAutomation.getPendingApprovals)
 *   2. autonomous_action rows at approval "pending"    (autopilot queue —
 *      trpc systemAutomation.approvals via approval-queue.listPendingActions)
 *
 * The 2026-08-12 MISSION scan observed "468 PENDING" on the live page and
 * flagged its own kill-shot: if the queue is mostly stale/expired, fix
 * queue hygiene before building any trust-ladder UI on top of it. This
 * probe answers that question with counts only: status split, expired vs
 * live (approval_requests carries expiresAt), age buckets, and per-type /
 * per-rule concentration.
 *
 * Run: railway run --service statenour-web -- pnpm exec tsx scripts/probe-approval-queue-census.ts
 * (or locally with DATABASE_URL exported; the probe prints the DB host
 * first so the target is never assumed.)
 */
import { prisma } from "@/lib/prisma";

function dbHost(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    return new URL(url).host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

function ageBucket(createdAt: Date, now: Date): string {
  const days = (now.getTime() - createdAt.getTime()) / 86_400_000;
  if (days < 1) return "<1d";
  if (days < 7) return "1-7d";
  if (days < 30) return "7-30d";
  if (days < 90) return "30-90d";
  return "90d+";
}

function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

async function main(): Promise<void> {
  console.log(`DB host: ${dbHost()}`);
  const now = new Date();

  // ── Queue 1 · approval_requests ──
  const byStatus = await prisma.approvalRequest.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log("\napproval_requests by status:");
  for (const s of byStatus) console.log(`  ${s.status}: ${s._count._all}`);

  const pending = await prisma.approvalRequest.findMany({
    where: { status: "pending_approval" },
    select: {
      actionType: true,
      riskClass: true,
      requestedBy: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  const expired = pending.filter((p) => p.expiresAt < now);
  console.log(`\npending_approval total: ${pending.length}`);
  console.log(`  expired (expiresAt < now): ${expired.length}`);
  console.log(`  still live:                ${pending.length - expired.length}`);
  console.log("  by actionType:", tally(pending, (p) => p.actionType));
  console.log("  by riskClass: ", tally(pending, (p) => p.riskClass));
  console.log("  by requestedBy:", tally(pending, (p) => p.requestedBy));
  console.log("  by age:       ", tally(pending, (p) => ageBucket(p.createdAt, now)));
  if (pending.length > 0) {
    const oldest = pending.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    const newest = pending.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    console.log(`  oldest: ${oldest.createdAt.toISOString()} · newest: ${newest.createdAt.toISOString()}`);
  }

  // ── Queue 2 · autonomous_action approval="pending" ──
  const autoPending = await prisma.autonomousAction.findMany({
    where: { approval: "pending" },
    select: { ruleName: true, createdAt: true },
  });
  console.log(`\nautonomous_action approval=pending total: ${autoPending.length}`);
  console.log("  by ruleName:", tally(autoPending, (a) => a.ruleName));
  console.log("  by age:     ", tally(autoPending, (a) => ageBucket(a.createdAt, now)));

  console.log(
    `\nHome badge "Approvals (N)" would read: ${pending.length + autoPending.length}`,
  );
}

void main()
  .catch((err) => {
    console.error("probe failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
