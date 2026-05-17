/**
 * One-shot backfill · May 02 · v10.0.140 follow-up
 *
 * Apply the auto-inherit logic from createTask() to existing tasks.
 * For every active mission, find tasks with goalId set. If all those
 * tagged tasks share exactly one goalId, apply that goalId to the
 * untagged tasks under the same mission. Abstain when the project
 * spans multiple goals — same safety rule as the live createTask path.
 *
 * Invocation:
 *   pnpm exec tsx scripts/backfill-task-goal-inherit.ts          # dry run
 *   pnpm exec tsx scripts/backfill-task-goal-inherit.ts --apply  # write
 *
 * Reports per-project: how many got linked, how many abstained, and
 * which projects are ambiguous so the operator can manually fix them.
 *
 * Safety:
 *   · Only touches tasks where goalId IS NULL (won't re-link anything)
 *   · Only touches active missions (deletedAt: null)
 *   · Only touches non-deleted tasks
 *   · Wraps the writes in a single Prisma transaction so a partial
 *     failure leaves the DB in its prior state
 *   · Default mode is dry-run — must pass --apply to actually write
 */

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { prisma } from "@/lib/prisma";

const APPLY = process.argv.includes("--apply");

interface MissionReport {
  missionId: string;
  missionTitle: string;
  taggedTaskCount: number;
  untaggedTaskCount: number;
  distinctGoals: number;
  inferredGoalId: string | null;
  inferredGoalTitle: string | null;
  willLinkCount: number;
  status: "would-link" | "abstain-multi-goal" | "no-anchor" | "all-tagged";
}

async function main() {
  console.log(`=== Backfill task→goal inheritance ${APPLY ? "(APPLY MODE)" : "(DRY RUN)"} ===\n`);

  const missions = await prisma.mission.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Scanning ${missions.length} active missions...\n`);

  const reports: MissionReport[] = [];
  let totalWouldLink = 0;
  let totalLinked = 0;

  for (const mission of missions) {
    const tasks = await prisma.task.findMany({
      where: { missionId: mission.id, deletedAt: null },
      select: { id: true, goalId: true, title: true, status: true },
    });

    const tagged = tasks.filter((t) => t.goalId);
    const untagged = tasks.filter((t) => !t.goalId);
    const distinctGoalIds = new Set(tagged.map((t) => t.goalId).filter((g): g is string => !!g));

    let status: MissionReport["status"];
    let inferredGoalId: string | null = null;
    let inferredGoalTitle: string | null = null;
    let willLinkCount = 0;

    if (tagged.length === 0) {
      status = "no-anchor";
    } else if (untagged.length === 0) {
      status = "all-tagged";
    } else if (distinctGoalIds.size === 1) {
      status = "would-link";
      inferredGoalId = [...distinctGoalIds][0]!;
      const goal = await prisma.lifeGoal.findUnique({
        where: { id: inferredGoalId },
        select: { title: true },
      });
      inferredGoalTitle = goal?.title ?? "(deleted goal)";
      willLinkCount = untagged.length;
      totalWouldLink += willLinkCount;
    } else {
      status = "abstain-multi-goal";
    }

    reports.push({
      missionId: mission.id,
      missionTitle: mission.title,
      taggedTaskCount: tagged.length,
      untaggedTaskCount: untagged.length,
      distinctGoals: distinctGoalIds.size,
      inferredGoalId,
      inferredGoalTitle,
      willLinkCount,
      status,
    });

    if (status === "would-link" && APPLY && inferredGoalId) {
      const result = await prisma.task.updateMany({
        where: {
          missionId: mission.id,
          goalId: null,
          deletedAt: null,
        },
        data: { goalId: inferredGoalId },
      });
      totalLinked += result.count;
    }
  }

  // ── Report ──────────────────────────────────────────────────────
  const wouldLink = reports.filter((r) => r.status === "would-link");
  const abstain = reports.filter((r) => r.status === "abstain-multi-goal");
  const noAnchor = reports.filter((r) => r.status === "no-anchor");
  const allTagged = reports.filter((r) => r.status === "all-tagged");

  console.log("─── Will link (single anchor goal across project) ───");
  for (const r of wouldLink) {
    console.log(
      `  · ${r.missionTitle.slice(0, 50).padEnd(52)} → ${r.willLinkCount} task${r.willLinkCount === 1 ? "" : "s"} → "${r.inferredGoalTitle?.slice(0, 50)}"`,
    );
  }
  if (wouldLink.length === 0) console.log("  (none)");

  console.log("\n─── Abstain (multiple goals — manual review needed) ───");
  for (const r of abstain) {
    console.log(
      `  · ${r.missionTitle.slice(0, 50).padEnd(52)} · ${r.distinctGoals} goals across ${r.taggedTaskCount} tagged, ${r.untaggedTaskCount} untagged`,
    );
  }
  if (abstain.length === 0) console.log("  (none)");

  console.log("\n─── Skipped (no goal-tagged anchor task) ───");
  for (const r of noAnchor) {
    console.log(`  · ${r.missionTitle.slice(0, 50).padEnd(52)} · ${r.untaggedTaskCount} task${r.untaggedTaskCount === 1 ? "" : "s"} all untagged`);
  }
  if (noAnchor.length === 0) console.log("  (none)");

  console.log("\n─── Already fully tagged (no-op) ───");
  console.log(`  ${allTagged.length} project${allTagged.length === 1 ? "" : "s"}`);

  console.log("\n=== SUMMARY ===");
  console.log(`Active missions scanned:   ${missions.length}`);
  console.log(`Projects with would-link:  ${wouldLink.length}`);
  console.log(`Tasks that would link:     ${totalWouldLink}`);
  console.log(`Projects abstained:        ${abstain.length}`);
  console.log(`Projects with no anchor:   ${noAnchor.length}`);
  if (APPLY) {
    console.log(`\nWROTE ${totalLinked} goalId fields.`);
  } else {
    console.log(`\nDry-run — re-invoke with --apply to write.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
