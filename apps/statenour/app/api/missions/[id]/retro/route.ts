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
  if (retroText) {
    try {
      const memory = await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.MISSION_RETRO,
          key: missionId,
          content: `[Mission Retro · ${mission.title}] ${retroText}`,
          confidence: 1.0,
          source: "operator",
          createdBy: "user",
          metadata: {
            missionId,
            missionTitle: mission.title,
            taskCount,
            openAtClose: openCount,
            finishedAt: new Date().toISOString(),
            retroText,
          } as never,
        },
        select: { id: true },
      });
      retroId = memory.id;
    } catch (err) {
      log.error("retro_write_failed", {
        err: err instanceof Error ? err.message : String(err),
        missionId,
      });
      // Continue · archiving is still useful even if the retro write
      // failed.
    }
  }

  // ── Close any still-open tasks on the mission ──
  if (archive) {
    try {
      await prisma.task.updateMany({
        where: { missionId, status: { not: "DONE" } },
        data: { status: "DONE", lastTouchedAt: new Date() },
      });
      await prisma.mission.update({
        where: { id: missionId },
        data: { status: "COMPLETE" },
      });
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

  return NextResponse.json({ ok: true, retroId });
}
