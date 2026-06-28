/**
 * GET /api/intelligence/briefs/today — owner-only · fetch the most recent Daily Executive Brief
 */
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const latestBrief = await prisma.briefingLog.findFirst({
    where: { briefType: "daily" },
    orderBy: { createdAt: "desc" },
  });

  if (!latestBrief) {
    return {
      status: "error",
      message: "No daily brief generated yet. Run ingestion first.",
    };
  }

  return {
    status: "success",
    brief: latestBrief,
  };
}, { auth: "owner" });
