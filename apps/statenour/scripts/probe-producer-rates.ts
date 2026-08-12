/**
 * Producer-rate probe for the two dominant approval-queue producers —
 * READ-ONLY, no writes.
 *
 * Follow-up to the 2026-08-12 queue cleanup (BDN-002): memory_promotion +
 * decision_replay_due generated 60% of the 468-row backlog. Mechanism
 * hypothesis (from code read): both rules fail-closed-defer because no
 * `auto` AutomationPolicy exists, the deferred action never executes, so
 * the trigger condition never clears and the 24h per-target cooldown
 * mints one new pending row per target per night, forever.
 *
 * This probe verifies each link: policy rows, per-target row counts
 * (nag-loop evidence), and current trigger pressure. Prints metadata
 * only — no personal memory content.
 *
 * Run: pnpm exec tsx scripts/probe-producer-rates.ts
 */
import { prisma } from "@/lib/prisma";

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

async function main(): Promise<void> {
  console.log(`DB host: ${dbHost()}`);

  // 1 · Do the two rules have AutomationPolicy rows, and of what class?
  const policies = await prisma.automationPolicy.findMany({
    where: {
      id: {
        in: [
          "autonomous-action.memory_promotion",
          "autonomous-action.decision_replay_due",
        ],
      },
    },
    select: { id: true, approvalClass: true, deletedAt: true },
  });
  console.log("\npolicies for the two rules:", policies.length === 0 ? "NONE" : policies);
  const anyAuto = await prisma.automationPolicy.count({
    where: { approvalClass: "auto", deletedAt: null },
  });
  console.log(`automation policies with approvalClass="auto" (any rule): ${anyAuto}`);

  // 2 · Nag-loop evidence: rows-per-target for each rule, all time.
  for (const ruleName of ["memory_promotion", "decision_replay_due"]) {
    const byTarget = await prisma.autonomousAction.groupBy({
      by: ["targetId"],
      where: { ruleName },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    });
    const total = await prisma.autonomousAction.count({ where: { ruleName } });
    const distinct = await prisma.autonomousAction.findMany({
      where: { ruleName },
      distinct: ["targetId"],
      select: { targetId: true },
    });
    console.log(
      `\n${ruleName}: ${total} rows ever, ${distinct.length} distinct targets ` +
        `(${(total / Math.max(1, distinct.length)).toFixed(1)} rows/target)`,
    );
    console.log(
      "  top targets:",
      byTarget.map((t) => ({ targetId: t.targetId, rows: t._count._all })),
    );
  }

  // 3 · Current trigger pressure.
  const dueReplays = await prisma.decisionReplay.count({
    where: { reviewed: false, reviewAt: { lte: new Date() } },
  });
  const oldestDue = await prisma.decisionReplay.findFirst({
    where: { reviewed: false, reviewAt: { lte: new Date() } },
    orderBy: { reviewAt: "asc" },
    select: { reviewAt: true, createdAt: true },
  });
  console.log(
    `\ndecision_replay_due pressure: ${dueReplays} unreviewed+due replays` +
      (oldestDue ? ` · oldest due since ${oldestDue.reviewAt?.toISOString()}` : ""),
  );

  const promoCandidates = await prisma.brainMemory.findMany({
    where: {
      deletedAt: null,
      category: { not: "wisdom" },
      seenCount: { gte: 5 },
      confidence: { gte: 0.6 },
    },
    orderBy: { seenCount: "desc" },
    take: 10,
    select: { id: true, category: true, seenCount: true, confidence: true },
  });
  const promoTotal = await prisma.brainMemory.count({
    where: {
      deletedAt: null,
      category: { not: "wisdom" },
      seenCount: { gte: 5 },
      confidence: { gte: 0.6 },
    },
  });
  console.log(
    `\nmemory_promotion pressure: ${promoTotal} candidates above threshold; top (metadata only):`,
  );
  for (const c of promoCandidates) {
    console.log(
      `  ${c.id} · category=${c.category} · seen=${c.seenCount} · conf=${c.confidence}`,
    );
  }
}

void main()
  .catch((err) => {
    console.error("probe failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
