/**
 * POST /api/tasks/auto-extract — create a task from an extracted
 * phrase (Nick's reply → "save as task" chip click).
 *
 * Flow:
 *   1. Receive { phrase, context?, effort?, suggestedDeadline? }
 *   2. Infer priority via task-priority-inferrer
 *   3. Resolve a mission (inbox mission as fallback)
 *   4. Create the task with auto-priority + explanation
 *   5. Return the created task
 *
 * Owner-auth.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { inferTaskPriority } from "@/lib/brain/task-priority-inferrer";
import { ServiceError } from "@/lib/utils/service-error";

interface Body {
  phrase?: string;
  title?: string;
  context?: string;
  effort?: string;
  suggestedDeadline?: string | null;
  missionId?: string;
  promiseTo?: string;
}

const DEFAULT_CONTEXT = "ANYWHERE";
const DEFAULT_EFFORT = "M30";

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<Body>(req);
    const title = (body.title ?? body.phrase ?? "").trim();
    if (!title) throw new ServiceError("title or phrase required", 400);

    // Resolve mission — use provided or default to an inbox mission
    let missionId = body.missionId;
    if (!missionId) {
      const inbox = await prisma.mission
        .findFirst({
          where: { status: "ACTIVE", title: { contains: "Inbox", mode: "insensitive" } },
          select: { id: true },
        })
        .catch(() => null);
      if (inbox) {
        missionId = inbox.id;
      } else {
        // Fallback: ANY active mission. Better than erroring.
        const any = await prisma.mission
          .findFirst({ where: { status: "ACTIVE" }, select: { id: true } })
          .catch(() => null);
        if (!any) throw new ServiceError("no active mission available", 400);
        missionId = any.id;
      }
    }

    const missionRow = await prisma.mission.findUnique({
      where: { id: missionId },
      select: { domain: true },
    });

    const priority = await inferTaskPriority({
      title,
      context: body.context,
      effort: body.effort,
      suggestedDeadline: body.suggestedDeadline,
      missionDomain: missionRow?.domain ?? null,
      promiseTo: body.promiseTo,
    });

    const task = await prisma.task.create({
      data: {
        missionId,
        title,
        nextPhysicalAction: title,
        status: "INBOX",
        context: (body.context ?? DEFAULT_CONTEXT) as any,
        effort: (body.effort ?? DEFAULT_EFFORT) as any,
        roiScore: 50,
        frictionScore: 40,
        energyRequired: "MEDIUM",
        finishCondition: title,
        autoPriority: priority.autoPriority,
        autoPriorityExplanation: priority.autoPriorityExplanation,
        loopKind: body.promiseTo ? "PROMISE" : "ONCE",
        promiseTo: body.promiseTo ?? null,
      },
      select: {
        id: true,
        title: true,
        autoPriority: true,
        autoPriorityExplanation: true,
        missionId: true,
      },
    });

    return {
      ok: true,
      task,
      priorityFactors: priority.factors,
    };
  },
  { auth: "owner" },
);
