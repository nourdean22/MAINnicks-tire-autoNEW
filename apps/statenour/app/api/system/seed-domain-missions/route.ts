/**
 * POST /api/system/seed-domain-missions  ·  body: { dryRun?: boolean }
 *
 * Operator-gated. Seeds the 6 GENERAL anchor missions + migrates legacy buckets
 * into them:
 *   · "Inbox - <domain>" per-domain auto-inboxes      → matching GENERAL anchor
 *   · "Nick's Tire & Auto Euclid GENERAL" (the shop)   → GENERAL BUSINESS
 * Tasks are moved; the emptied legacy bucket is soft-deleted (KILLED). The bare
 * "Inbox" (m-inbox) staging bucket + real projects (UFC BBQ, Bay 5, KRUEGER…)
 * are untouched. Records a reversible run-marker (BrainMemory · full moveLog).
 *
 * dryRun:true (DEFAULT) → read-only, returns the plan. dryRun:false → writes.
 * PREREQ for a real run: migration 0010 applied (system_kind/canonical_domain).
 * Idempotent: anchors are find-or-create; re-running after a real run is a
 * no-op (legacy buckets already soft-deleted → not re-matched).
 */
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { seedGeneralAnchors, resolveGeneralAnchorId } from "@/lib/services/missions";
import { isInboxMission } from "@/lib/services/mission-helpers";
import { canonicalFromLegacy, type CanonicalDomain } from "@/lib/missions/domains";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  await requireSession(req);

  let dryRun = true;
  try {
    const body = (await req.json()) as { dryRun?: boolean };
    if (body?.dryRun === false) dryRun = false;
  } catch {
    /* default dryRun=true */
  }

  const result: Record<string, unknown> = { dryRun };

  // 1. Seed the 6 anchors (real run only · needs the 0010 columns).
  if (!dryRun) {
    const ids = await seedGeneralAnchors();
    result.anchorsSeeded = ids.filter(Boolean).length;
  }

  // 2. Identify legacy buckets by TITLE (dry-run needs no new columns; the
  //    "GENERAL X" anchors never self-match the Inbox/shop patterns).
  const all = await prisma.mission.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, domain: true },
  });
  const legacy = all.filter(
    (m) =>
      m.id !== "m-inbox" && // keep the staging inbox
      ((isInboxMission(m.title) && /-/.test(m.title ?? "")) || // "Inbox - <domain>"
        /nick'?s tire .*general/i.test(m.title ?? "")), // the shop GENERAL
  );

  const moveLog: Array<{ bucketId: string; bucket: string; toDomain: string; taskCount: number; taskIds: string[] }> = [];
  for (const b of legacy) {
    const domain: CanonicalDomain = /nick'?s tire/i.test(b.title ?? "")
      ? "business"
      : canonicalFromLegacy(b.domain);
    const anchorId = dryRun ? null : await resolveGeneralAnchorId(domain);
    const tasks = await prisma.task.findMany({
      where: { missionId: b.id, deletedAt: null },
      select: { id: true },
    });
    moveLog.push({
      bucketId: b.id,
      bucket: b.title ?? b.id,
      toDomain: domain,
      taskCount: tasks.length,
      taskIds: tasks.map((t) => t.id),
    });
    if (!dryRun && anchorId) {
      await prisma.task.updateMany({
        where: { missionId: b.id, deletedAt: null },
        data: { missionId: anchorId },
      });
      await prisma.mission.update({
        where: { id: b.id },
        data: { deletedAt: new Date(), status: "KILLED" },
      });
    }
  }

  result.buckets = moveLog.length;
  result.totalTasks = moveLog.reduce((s, m) => s + m.taskCount, 0);
  result.plan = moveLog.map((m) => ({ from: m.bucket, to: `GENERAL ${m.toDomain.toUpperCase()}`, tasks: m.taskCount }));

  if (!dryRun) {
    const recorded = await prisma.brainMemory
      .create({
        data: {
          category: "domain_migrate_run",
          key: `domain-migrate-${Date.now()}`,
          content: `Seeded 6 GENERAL anchors + migrated ${moveLog.length} buckets (${result.totalTasks} tasks).`,
          confidence: 1,
          source: "seed-domain-missions",
          metadata: { moveLog } as never,
        },
      })
      .then(() => true)
      .catch((err) => {
        logger.warn("domain_migrate_marker_failed", {
          error: err instanceof Error ? err.message.slice(0, 120) : String(err),
        });
        return false;
      });
    result.runMarkerRecorded = recorded;
  }

  return Response.json(result);
}
