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

  // Update status in the database
  const updatedOpp = await prisma.opportunityLog.update({
    where: { id: parsed.opportunityId },
    data: { status: parsed.action },
  });

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
