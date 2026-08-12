/**
 * Commitments cleanup — EXECUTE. Writes.
 *
 * Operator-authorized (2026-08-12): "clean up the commitments" — mutates
 * every active commitment per the categorization in
 * scripts/lib/commitments-categorize.ts, the SAME logic
 * commitments-cleanup-plan.ts printed and saved to
 * docs/COMMITMENTS-CLEANUP-PLAN-2026-08-12.json. Re-queries and
 * re-categorizes fresh (does not trust the plan's saved snapshot) so a
 * row changed between plan and execute is picked up correctly.
 *
 * All transitions are reversible status changes (active -> completed |
 * abandoned via the status-guarded service functions) — no deletion, no
 * DDL. KEEP rows are untouched. A row whose status already changed since
 * the plan ran (e.g. resolved via the pulse ticker in the meantime) is
 * a safe no-op — the guard just returns false, never a P2025 throw.
 *
 * Run: railway run --service statenour-web -- pnpm exec tsx scripts/commitments-cleanup-execute.ts
 */
import { prisma } from "@/lib/prisma";
import { categorize } from "./lib/commitments-categorize";
import { completeActiveCommitment, abandonActiveCommitment } from "@/lib/services/commitments";

const CLEANUP_NOTE_SUFFIX = "bulk cleanup 2026-08-12 (operator-authorized, extraction-noise burst ~112d old)";

async function main(): Promise<void> {
  const rows = await prisma.commitment.findMany({
    where: { status: "active", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, description: true, toWhom: true, deadline: true, createdAt: true },
  });

  console.log(`Loaded ${rows.length} active commitments for execution.`);

  const results: Array<{ id: number; category: string; reason: string; mutated: boolean }> = [];
  let completed = 0;
  let abandoned = 0;
  let kept = 0;
  let skippedRace = 0;

  for (const row of rows) {
    const { category, reason } = categorize(row);
    if (category === "KEEP") {
      kept++;
      results.push({ id: row.id, category, reason, mutated: false });
      continue;
    }
    const ok =
      category === "COMPLETE"
        ? await completeActiveCommitment(row.id, `Completed — ${CLEANUP_NOTE_SUFFIX}`, "operator")
        : await abandonActiveCommitment(row.id, `Abandoned — ${CLEANUP_NOTE_SUFFIX}`, "operator");
    if (ok) {
      if (category === "COMPLETE") completed++;
      else abandoned++;
    } else {
      skippedRace++;
      console.warn(`  #${row.id} — status guard didn't match (changed since the plan ran?), skipped`);
    }
    results.push({ id: row.id, category, reason, mutated: ok });
  }

  console.log(`\nDone.`);
  console.log(`  completed: ${completed}`);
  console.log(`  abandoned: ${abandoned}`);
  console.log(`  kept (untouched): ${kept}`);
  if (skippedRace > 0) console.log(`  skipped (race — already changed): ${skippedRace}`);

  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const date = process.env.CLEANUP_DATE || "undated";
  await fs.writeFile(
    path.join(process.cwd(), "docs", `COMMITMENTS-CLEANUP-EXECUTED-${date}.json`),
    JSON.stringify(results, null, 2),
    "utf8",
  );
  console.log(`\nwrote docs/COMMITMENTS-CLEANUP-EXECUTED-${date}.json (action taken for every row)`);
}

void main().finally(() => prisma.$disconnect());
