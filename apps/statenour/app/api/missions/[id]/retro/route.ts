/**
 * /api/missions/[id]/retro · Wave AA Phase 3 · 2026-05-28.
 *
 * Captures a mission retrospective + archives the mission. Sam-layer
 * compound feature · every completed mission contributes a learning
 * row to BrainMemory(category=mission_retro) that Nick's morning brief
 * + Nick's pick can read into future syntheses.
 *
 * Body: { retroText: string, archive: boolean }
 * Returns: { ok: true, retroId?: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/missions/retro");

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id: missionId } = await context.params;
  if (!missionId) {
    return NextResponse.json({ error: "missing_mission_id" }, { status: 400 });
  }

  let body: { retroText?: string; archive?: boolean };
  try {
    body = (await req.json()) as { retroText?: string; archive?: boolean };
  } catch {
    body = {};
  }

  const retroText = (body.retroText ?? "").trim().slice(0, 2000);
  const archive = body.archive !== false; // default true

  let mission: { id: string; title: string; status: string } | null = null;
  try {
    mission = await prisma.mission.findUnique({
      where: { id: missionId },
      select: { id: true, title: true, status: true },
    });
  } catch (err) {
    log.error("mission_lookup_failed", {
      err: err instanceof Error ? err.message : String(err),
      missionId,
    });
    return NextResponse.json(
      { error: "mission_lookup_failed" },
      { status: 500 },
    );
  }

  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ── Count task footprint for the retro metadata ──
  let taskCount = 0;
  let openCount = 0;
  try {
    const counts = await prisma.task.groupBy({
      by: ["status"],
      where: { missionId },
      _count: { _all: true },
    });
    for (const row of counts) {
      taskCount += row._count._all;
      if (row.status !== "DONE") openCount += row._count._all;
    }
  } catch (err) {
    log.warn("task_count_failed", {
      err: err instanceof Error ? err.message : String(err),
      missionId,
    });
  }

  // ── Write the retro to BrainMemory ──
  let retroId: string | undefined;
  let retroWarning: string | undefined;
  if (retroText) {
    try {
      // Upsert on the (category, key) unique — key=missionId means a
      // second retro for the same mission hit P2002 forever with
      // create(); the latest retro now overwrites content/metadata.
      const retroData = {
        content: `[Mission Retro · ${mission.title}] ${retroText}`,
        confidence: 1.0,
        metadata: {
          missionId,
          missionTitle: mission.title,
          taskCount,
          openAtClose: openCount,
          finishedAt: new Date().toISOString(),
          retroText,
        } as never,
      };
      const memory = await prisma.brainMemory.upsert({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.MISSION_RETRO,
            key: missionId,
          },
        },
        create: {
          category: BRAIN_CATEGORIES.MISSION_RETRO,
          key: missionId,
          source: "operator",
          createdBy: "user",
          ...retroData,
        },
        update: retroData,
        select: { id: true },
      });
      retroId = memory.id;
    } catch (err) {
      log.error("retro_write_failed", {
        err: err instanceof Error ? err.message : String(err),
        missionId,
      });
      // wave-AA-audit · don't silently lose the retro · surface a
      // partial-success warning so the caller can re-prompt the operator
      // to re-enter their retro. Pre-fix this swallowed the loss and
      // returned ok:true so the modal told the operator "saved" when it
      // hadn't.
      retroWarning = "retro_write_failed";
    }
  }

  // ── Close any still-open tasks on the mission ──
  if (archive) {
    try {
      // Scope: live rows only (soft-deleted tombstones must not be
      // resurrected as DONE) and only genuinely-open statuses —
      // ARCHIVED is an intentionally broken promise and must NOT be
      // DONE-washed. One transaction so the task-close and the
      // mission-COMPLETE flip land atomically.
      await prisma.$transaction([
        prisma.task.updateMany({
          where: {
            missionId,
            deletedAt: null,
            status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
          },
          data: { status: "DONE", lastTouchedAt: new Date() },
        }),
        prisma.mission.update({
          where: { id: missionId },
          data: { status: "COMPLETE" },
        }),
      ]);
    } catch (err) {
      log.error("archive_failed", {
        err: err instanceof Error ? err.message : String(err),
        missionId,
      });
      return NextResponse.json(
        { error: "archive_failed" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    retroId,
    ...(retroWarning ? { warning: retroWarning } : {}),
  });
}
