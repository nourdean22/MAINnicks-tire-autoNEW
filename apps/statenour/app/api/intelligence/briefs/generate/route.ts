/**
 * POST /api/intelligence/briefs/generate — owner-only · manually run ingestion and compile the latest Daily Brief
 */
import { prisma } from "@/lib/prisma";
import { runIngestion } from "@/lib/intelligence/ingest";
import { processClaimsIntoOpportunities } from "@/lib/intelligence/scoring";
import { getModel } from "@/lib/ai/provider";
import { apiHandler } from "@/lib/utils/http";

import { generateText } from "ai";

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

  // 3. Fetch data for compiling brief
  const opportunities = await prisma.opportunityLog.findMany({
    where: {
      status: "pending",
      score: { gte: 75 },
    },
    orderBy: { score: "desc" },
    take: 5,
  });

  const claims = await prisma.intelligenceClaim.findMany({
    where: {
      confidence: { gte: 0.8 },
      status: "source_supported",
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  // 4. Generate brief text
  const model = getModel("reason");
  const systemPrompt = `You are the executive chief of staff for Nour. Compose a Daily Executive Brief (max 500 words) summarizing key alerts, opportunities, and pending decisions.
Your writing style is direct, clear, highly professional, and action-oriented. No generic fluff.

Format using these exact sections:
# Daily Executive Brief · [Date]

## 🚨 Critical Alerts (Threat Score >= 80 or high-confidence contradictions)
Describe any critical alerts/threats with a clear format:
* **[Category/Domain]** Specific description and implications.
  - *Action*: Clear action verb [Approve] / [Dismiss]

## 💡 Top Opportunities (Score >= 75)
* **[Category/Domain]** Specific description and return on investment (ROI).
  - *Action*: Clear action verb [Approve] / [Defer]

## ⚡ Decisions Pending (Action Ledger)
* **[Category/Domain]** Decision description and immediate context.
  - *Action*: Clear choice [Approve] / [Open Ledger]`;

  const promptText = `Date: ${today}
Opportunities:
${opportunities.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}

Claims:
${claims.map((c) => `- [CLAIM] ${c.text} (Confidence: ${c.confidence})`).join("\n")}`;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: `${promptText}\n\nCompose the brief now.`,
  });

  const briefText = result.text || "No briefing content compiled for today.";

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
