/**
 * POST /api/intelligence/decisions/log — owner-only · update and record an operator's choice on a pending opportunity
 */
import { prisma } from "@/lib/prisma";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const LogDecisionSchema = z.object({
  opportunityId: z.string().cuid(),
  action: z.enum(["accepted", "declined", "resolved"]),
});

export const POST = apiHandler(async (req) => {
  const payload = await readRequestJson(req);
  const parsed = LogDecisionSchema.parse(payload);

  const opportunity = await prisma.opportunityLog.findUnique({
    where: { id: parsed.opportunityId },
  });

  if (!opportunity) {
    return {
      status: "error",
      message: "Opportunity not found.",
    };
  }

  // Update status in the database. ACCEPTING opens a closed-loop experiment:
  // we start TRACKING whether this bet actually holds up over a 14-day horizon,
  // and (via the experiment-measure cron) feed that outcome back into the
  // attributed source's authScore. Upsert on the unique opportunityId makes a
  // double-accept idempotent; the $transaction rolls the status flip back if the
  // experiment write throws, so the two never diverge.
  let updatedOpp;
  if (parsed.action === "accepted") {
    const HORIZON_MS = 14 * 24 * 60 * 60 * 1000;
    [updatedOpp] = await prisma.$transaction([
      prisma.opportunityLog.update({
        where: { id: parsed.opportunityId },
        data: { status: parsed.action },
      }),
      prisma.experiment.upsert({
        where: { opportunityId: opportunity.id },
        update: {}, // already tracking — accepting twice is a no-op
        create: {
          opportunityId: opportunity.id,
          sourceId: opportunity.sourceId ?? null,
          hypothesis: `${opportunity.title}\n\n${opportunity.description}`,
          expectedEffect: opportunity.impact,
          status: "running",
          dueAt: new Date(Date.now() + HORIZON_MS),
        },
      }),
    ]);
  } else {
    updatedOpp = await prisma.opportunityLog.update({
      where: { id: parsed.opportunityId },
      data: { status: parsed.action },
    });
  }

  // Log to brain memory to feed back into the learning loop
  try {
    await prisma.brainMemory.create({
      data: {
        category: "operator_decision",
        key: opportunity.id,
        content: `Operator ${parsed.action} opportunity: "${opportunity.title}" (Domain: ${opportunity.domain}, Score: ${opportunity.score})`,
        confidence: 1.0,
        source: "intelligence/decisions/log",
        metadata: {
          opportunityId: opportunity.id,
          action: parsed.action,
          domain: opportunity.domain,
          score: opportunity.score,
        } as any,
      },
    });
  } catch (err) {
    // Non-blocking log failure
    console.error("Failed to log operator decision to brain memory:", err);
  }

  return {
    status: "success",
    opportunity: updatedOpp,
    message: `Opportunity successfully updated to ${parsed.action}.`,
  };
}, { auth: "owner" });
