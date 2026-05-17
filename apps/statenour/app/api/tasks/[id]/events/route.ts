/**
 * GET /api/tasks/[id]/events — fetch TaskEvent history for a task.
 *
 * Apr 26 · F6 of the NOW-mode upgrades. The expanded-panel timeline
 * needs the row's history without joining it into the main list query
 * (would inflate the payload of every task). This endpoint returns
 * events for a single task, ordered newest-first, capped at 30.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// v10.0.37 — owner-gated. Pre-fix unauthed.
export const GET = apiHandler(async (_req, { params }) => {
  const { id } = await params!;
  const events = await prisma.taskEvent.findMany({
    where: { taskId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, kind: true, source: true, payload: true, createdAt: true },
  });
  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    source: e.source,
    payload: e.payload,
    createdAt: e.createdAt.toISOString(),
  }));
}, { auth: "owner" });
