import { prisma } from "@/lib/prisma";
import { syncHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

/** POST /api/sync/session-reports — Accept session reports from Claude sessions */
export const POST = syncHandler(async (req) => {
  const body = await req.json();

  if (!body.sessionDate || !body.summary) {
    throw new ServiceError("sessionDate and summary are required", 400);
  }

  const report = await prisma.sessionReport.create({
    data: {
      sessionDate: body.sessionDate,
      summary: body.summary,
      filesChanged: body.filesChanged ?? null,
      commits: body.commits ?? null,
      decisions: body.decisions ?? null,
      blockers: body.blockers ?? null,
      nextSteps: body.nextSteps ?? null,
      tokenCost: body.tokenCost ?? null,
      durationMin: body.durationMin ?? null,
      agentModel: body.agentModel ?? null,
    },
  });

  return { id: report.id, sessionDate: report.sessionDate };
});
