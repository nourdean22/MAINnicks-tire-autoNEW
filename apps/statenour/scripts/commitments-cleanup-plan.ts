/**
 * Commitments cleanup — PLAN ONLY. Read-only. Writes nothing.
 *
 * Operator-authorized cleanup (2026-08-12) of the 179 active commitments
 * found during the Pulse-staleness probe (scripts/probe-pulse-staleness.ts),
 * ~173 of which carry no deadline and never surface in the Pulse ticker
 * (personal-pulse.ts's query only reads deadline-bearing rows). Most read
 * as extraction noise from a single burst ~112 days ago.
 *
 * This script categorizes every active commitment and prints the plan.
 * It does NOT write. Review the printed plan, then run
 * commitments-cleanup-execute.ts separately against the SAME categorization
 * logic (imported from scripts/lib/commitments-categorize.ts, not re-derived)
 * to act on it.
 *
 * Categories (all status transitions are REVERSIBLE — no deletion):
 *   COMPLETE  — self-evidently done (deploy/launch-type commitments where
 *               the described outcome is verifiably true today). -> "completed"
 *   ABANDON   — no deadline, 90+ days old, reads as noise/duplicate/passing
 *               remark rather than a standing intention. -> "abandoned"
 *   KEEP      — everything else: has a deadline (personal-pulse already
 *               handles these via its own overdue floor/resolve buttons),
 *               or reads as a still-plausible standing intention, or is
 *               too recent (<90d) to confidently call abandoned.
 *
 * Run: railway run --service statenour-web -- pnpm exec tsx scripts/commitments-cleanup-plan.ts
 */
import { prisma } from "@/lib/prisma";
import { categorize, type Category, type CommitmentRow } from "./lib/commitments-categorize";

async function main(): Promise<void> {
  const rows = await prisma.commitment.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, toWhom: true, deadline: true, createdAt: true },
  });

  const byCategory: Record<Category, CommitmentRow[]> = { COMPLETE: [], ABANDON: [], KEEP: [] };
  const reasons = new Map<number, string>();
  for (const row of rows) {
    const { category, reason } = categorize(row);
    byCategory[category].push(row);
    reasons.set(row.id, reason);
  }

  console.log(`Total active commitments: ${rows.length}`);
  console.log(`  COMPLETE: ${byCategory.COMPLETE.length}`);
  console.log(`  ABANDON:  ${byCategory.ABANDON.length}`);
  console.log(`  KEEP:     ${byCategory.KEEP.length}`);
  console.log("");

  for (const cat of ["COMPLETE", "ABANDON", "KEEP"] as Category[]) {
    console.log(`\n=== ${cat} (${byCategory[cat].length}) ===`);
    for (const r of byCategory[cat]) {
      const ageDays = Math.floor((Date.now() - r.createdAt.getTime()) / 86_400_000);
      console.log(
        `  #${r.id} · ${ageDays}d old · owed ${r.toWhom} · deadline=${r.deadline ?? "none"} · "${r.description.slice(0, 80)}" · ${reasons.get(r.id)}`,
      );
    }
  }

  // Full receipt — the durable "before" state for anything this cleanup
  // touches, per prod-db-guard's backup-first rule.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const date = process.env.CLEANUP_DATE || "undated";
  const receipt = rows.map((r) => ({ ...r, ...categorize(r), reason: reasons.get(r.id) }));
  await fs.writeFile(
    path.join(process.cwd(), "docs", `COMMITMENTS-CLEANUP-PLAN-${date}.json`),
    JSON.stringify(receipt, null, 2),
    "utf8",
  );
  console.log(`\nwrote docs/COMMITMENTS-CLEANUP-PLAN-${date}.json (full before-state + category for every row)`);
}

void main().finally(() => prisma.$disconnect());
