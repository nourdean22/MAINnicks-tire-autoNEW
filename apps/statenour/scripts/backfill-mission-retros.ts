/**
 * scripts/backfill-mission-retros.ts · Wave BE · 2026-05-28.
 *
 * Backfill BrainMemory(category=mission_retro) for COMPLETE/ARCHIVED
 * Missions that pre-date Wave AA's retro modal. Without these the
 * brain layer has no historical record of what was shipped — Nick
 * can't reference past mission lessons because they live only in the
 * Mission row, not the searchable BrainMemory index.
 *
 * Strategy:
 *   1. Find all Mission rows with status in (COMPLETE, ARCHIVED) AND
 *      deletedAt IS NULL.
 *   2. For each, check if a BrainMemory row with
 *      (category=mission_retro, key=mission.id) already exists.
 *   3. If not, generate a SYNTHETIC retro from available fields:
 *      title + taskCount + completion timestamp + weeklyReviewNote
 *      if present.
 *   4. Insert with confidence=0.6 (lower than operator-authored 1.0)
 *      so future quality filters can prefer real retros.
 *   5. source="backfill_synthetic" + createdBy="backfill" so the
 *      audit trail is clean.
 *
 * Idempotent · safe to re-run · uses the unique (category, key)
 * constraint to skip dupes.
 *
 * Run:
 *   pnpm tsx scripts/backfill-mission-retros.ts            # apply
 *   pnpm tsx scripts/backfill-mission-retros.ts --dry-run  # preview only
 */

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  console.log(
    `[backfill-mission-retros] mode=${DRY_RUN ? "DRY-RUN" : "APPLY"} starting…`,
  );

  // Pull every closed mission · operator's full historical roster.
  // MissionStatus enum is ACTIVE | PAUSED | COMPLETE | KILLED · only
  // COMPLETE counts as "shipped" for retro backfill. KILLED is
  // intentionally dropped (no lesson worth synthesizing).
  const closed = await prisma.mission.findMany({
    where: {
      status: "COMPLETE" as const,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      weeklyReviewNote: true,
      updatedAt: true,
      createdAt: true,
      successMetric: true,
    },
    orderBy: { updatedAt: "asc" },
  });

  console.log(`[backfill-mission-retros] found ${closed.length} closed missions`);

  // Pull existing mission_retro entries so we can skip dupes.
  const existing = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.MISSION_RETRO,
      key: { in: closed.map((m) => m.id) },
    },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((e) => e.key));
  console.log(
    `[backfill-mission-retros] ${existingKeys.size} already have retros · ${closed.length - existingKeys.size} need backfill`,
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const mission of closed) {
    if (existingKeys.has(mission.id)) {
      skipped += 1;
      continue;
    }

    // Count tasks for synthetic retro metadata.
    let taskCount = 0;
    try {
      taskCount = await prisma.task.count({ where: { missionId: mission.id } });
    } catch {
      // Non-fatal · default to 0
    }

    const closedAt = mission.updatedAt.toISOString().slice(0, 10);
    const dayCount = Math.max(
      1,
      Math.round(
        (mission.updatedAt.getTime() - mission.createdAt.getTime()) /
          (1000 * 60 * 60 * 24),
      ),
    );

    // Synthesize a retro from what we know · honest about its source.
    const lines = [
      `[Mission Retro · ${mission.title}]`,
      `Shipped: ${closedAt} (${mission.status.toLowerCase()})`,
      `Duration: ${dayCount} day${dayCount === 1 ? "" : "s"} from kickoff`,
      `Tasks closed: ${taskCount}`,
    ];
    if (mission.successMetric) {
      lines.push(`Success metric: ${mission.successMetric}`);
    }
    if (mission.weeklyReviewNote && mission.weeklyReviewNote.trim()) {
      lines.push(`Weekly review note: ${mission.weeklyReviewNote.trim()}`);
    }
    lines.push(
      "(Synthetic backfill · operator did not retro this mission live · " +
        "edit BrainMemory row to overwrite with real lessons.)",
    );
    const content = lines.join(" · ");

    if (DRY_RUN) {
      console.log(
        `[backfill] WOULD CREATE retro · ${mission.id} · ${mission.title.slice(0, 50)}`,
      );
      created += 1;
      continue;
    }

    try {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.MISSION_RETRO,
          key: mission.id,
          content,
          confidence: 0.6,
          source: "backfill_synthetic",
          createdBy: "backfill",
          metadata: {
            missionId: mission.id,
            missionTitle: mission.title,
            missionStatus: mission.status,
            taskCount,
            dayCount,
            closedAt,
            backfilledAt: new Date().toISOString(),
            synthetic: true,
          } as never,
        },
      });
      created += 1;
      if (created % 10 === 0) {
        console.log(`[backfill] created ${created} so far…`);
      }
    } catch (err) {
      failed += 1;
      console.warn(
        `[backfill] FAILED ${mission.id} · ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `[backfill-mission-retros] done · created=${created} skipped=${skipped} failed=${failed}`,
  );

  await prisma.$disconnect();
}

void main().catch(async (err) => {
  console.error("[backfill-mission-retros] fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
