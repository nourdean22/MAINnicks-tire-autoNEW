/**
 * GET /api/intelligence/opportunities — owner-only · fetch opportunity logs, optionally filtering by status
 */
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";

  const opportunities = await prisma.opportunityLog.findMany({
    where: status === "all" ? {} : { status },
    orderBy: [
      { status: "asc" }, // pending first
      { score: "desc" },
    ],
  });

  return {
    status: "success",
    opportunities,
  };
}, { auth: "owner" });
