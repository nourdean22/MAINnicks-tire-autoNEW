/**
 * POST /api/intelligence/briefs/generate — owner-only · manually run ingestion and compile the latest Daily Brief
 */
import { prisma } from "@/lib/prisma";
import { runIngestion } from "@/lib/intelligence/ingest";
import { processClaimsIntoOpportunities } from "@/lib/intelligence/scoring";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (req) => {
  const activeSources = await prisma.registeredSource.findMany();
  let ingestedCount = 0;
  let totalClaims = 0;

  // 1. Run ingestion on all active sources
  for (const source of activeSources) {
    try {
      const res = await runIngestion(source.id);
      if (res.success) {
        ingestedCount++;
        totalClaims += res.claimsCount;
      }
    } catch (err) {
      console.error(`Failed to ingest source ${source.id}:`, err);
    }
  }

  // 2. Synthesize claims into opportunities
  const opportunitiesCreated = await processClaimsIntoOpportunities();

  // 3-4. AG-40 · compose via the SHARED grounded composer. This route
  // had drifted to a pre-AG-02 prompt with different headings and NO
  // grounding rule — a manually-generated brief could invent data the
  // cron brief was forbidden to.
  const { composeDailyExecutiveBrief } = await import("@/lib/intelligence/compose-daily-brief");
  const composed = await composeDailyExecutiveBrief();
  const briefText = composed.text;

  // 5. Store the briefing log
  const newLog = await prisma.briefingLog.create({
    data: {
      briefType: "daily",
      content: briefText,
    },
  });

  return {
    status: "success",
    brief: newLog,
    summary: {
      sourcesAttempted: activeSources.length,
      sourcesIngested: ingestedCount,
      claimsProcessed: totalClaims,
      opportunitiesCreated,
    },
    message: "Successfully generated new daily brief.",
  };
}, { auth: "owner" });
