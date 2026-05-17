/**
 * POST /api/tasks/[id]/domain
 *
 * Apr 27 · DOMAIN-EDIT — lets Nour change a task's domain from the
 * expanded task view. Since `domain` lives on Mission (not Task), we
 * implement this as a mission swap:
 *
 *   1. Map the requested domain string to the MissionDomain enum.
 *   2. Find (or lazily create) an Inbox mission for that domain.
 *      Per-domain inboxes are titled "Inbox - personal", "Inbox -
 *      work", etc. The legacy single "Inbox" mission stays as a
 *      fallback for old data.
 *   3. PATCH the task's missionId.
 *
 * Tasks attached to a real project (non-Inbox mission) get their
 * project's domain effectively changed when the user toggles here —
 * we treat that as "you're moving this task out of its project to a
 * domain inbox", because changing the project's domain would affect
 * every task in it. So when missionId points to a real project, we
 * still swap to the new domain's inbox; the user can re-link to a
 * project later if they want.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

type MissionDomainValue = "BUSINESS" | "PERSONAL" | "HEALTH" | "CONTENT" | "FINANCE";

const DOMAIN_MAP: Record<string, MissionDomainValue> = {
  // user-visible labels → enum
  business: "BUSINESS",
  work: "BUSINESS",
  personal: "PERSONAL",
  health: "HEALTH",
  fitness: "HEALTH",
  content: "CONTENT",
  creative: "CONTENT",
  finance: "FINANCE",
  money: "FINANCE",
};

function normalizeDomain(input: string): MissionDomainValue {
  const lower = input.trim().toLowerCase();
  return DOMAIN_MAP[lower] ?? "PERSONAL";
}

const bodySchema = z.object({
  domain: z.string().min(1).max(50),
});

export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = bodySchema.parse(await req.json());
  const targetDomain = normalizeDomain(body.domain);
  const inboxTitle = `Inbox - ${targetDomain.toLowerCase()}`;

  // Find or create the per-domain Inbox.
  let inbox = await prisma.mission.findFirst({
    where: { title: inboxTitle, status: "ACTIVE", deletedAt: null },
    select: { id: true, title: true, domain: true },
  });
  if (!inbox) {
    inbox = await prisma.mission.create({
      data: {
        title: inboxTitle,
        domain: targetDomain as Prisma.MissionCreateInput["domain"],
        status: "ACTIVE",
        priority: 50,
        roiScore: 50,
        neglectCost: 30,
      },
      select: { id: true, title: true, domain: true },
    });
  }

  // Swap the task's missionId.
  const task = await prisma.task.update({
    where: { id },
    data: { missionId: inbox.id, lastTouchedAt: new Date() },
    include: { mission: true },
  });

  return {
    task: {
      id: task.id,
      missionId: task.missionId,
      mission: task.mission ? { id: task.mission.id, title: task.mission.title, domain: task.mission.domain } : null,
    },
  };
// v10.0.119 audit-pattern follow-up · matches v10.0.118 fix on
// parent /api/tasks/[id] — sub-routes need the same gate.
}, { auth: "owner" });
