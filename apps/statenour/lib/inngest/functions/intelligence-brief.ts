/**
 * Inngest functions for Intelligence OS Briefings
 * Daily and Weekly Cron workflows for raw ingestion, scoring, synthesis, and dispatch.
 */
import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { runIngestion } from "@/lib/intelligence/ingest";
import { processClaimsIntoOpportunities } from "@/lib/intelligence/scoring";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/intelligence-brief");
const inngest = getInngest();

/**
 * Daily Ingestion & Briefing Orchestrator
 * Cron: Daily at 10:00 UTC
 */
export const intelligenceDailyBrief = inngest.createFunction(
  {
    id: "intelligence-daily-brief",
    name: "Intelligence OS · Daily Briefing",
    retries: 2,
    // Staggered +15min off operator-morning-brief (0 10) — both fired at
    // 10:00 UTC, double-firing a high-priority Web Push at the operator
    // and contending for the shared AI provider. This analytics brief
    // sends no push, so it yields the exact-hour slot.
    triggers: [{ cron: "15 10 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 1. Run Ingestion for all active sources
    const ingestionReport = await step.run("ingest-active-sources", async () => {
      const { prisma } = await import("@/lib/prisma");
      const activeSources = await prisma.registeredSource.findMany();
      let ingestedCount = 0;
      let totalClaims = 0;

      for (const source of activeSources) {
        try {
          const res = await runIngestion(source.id);
          if (res.success) {
            ingestedCount++;
            totalClaims += res.claimsCount;
          }
        } catch (err) {
          log.error(`Inngest step runIngestion failed for source ${source.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { sourcesAttempted: activeSources.length, sourcesIngested: ingestedCount, totalClaims };
    });

    // 2. Synthesize Claims into Opportunities & score them
    const opportunityReport = await step.run("synthesize-opportunities", async () => {
      const { processSearchOpportunities } = await import("@/lib/intelligence/search-opportunity");
      const { processOpportunityContentDrafts } = await import("@/lib/intelligence/content-alpha");
      
      const claimsCount = await processClaimsIntoOpportunities();
      const searchCount = await processSearchOpportunities();
      const draftsCount = await processOpportunityContentDrafts();
      
      return { opportunitiesCreated: claimsCount + searchCount, draftsCreated: draftsCount };
    });

    // 3. Compose Daily Executive Brief text
    const briefContent = await step.run("compose-brief-text", async () => {
      const { prisma } = await import("@/lib/prisma");
      
      // Fetch high scoring pending opportunities (score >= 75)
      const opportunities = await prisma.opportunityLog.findMany({
        where: {
          status: "pending",
          score: { gte: 75 },
        },
        orderBy: { score: "desc" },
        take: 5,
      });

      // Fetch recent pending content drafts
      const drafts = await prisma.socialPublishQueue.findMany({
        where: {
          status: "pending",
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      });

      // Fetch high confidence claims (confidence >= 0.8) or recent alerts
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

      const model = getModel("reason");
      const systemPrompt = `You are Nour's Chief of Staff and chief intelligence officer. Compose the Daily Executive Brief V2.
Your tone is ruthlessly direct, quantitative, hyper-strategic, and action-oriented. Eliminate all passive fluff or generic warnings.

You must format using these exact headings:
# Daily Executive Brief V2 · [Date]

## 💼 CEO Brief (Highest ROI opportunity & Threat level)
Detail the highest-ROI opportunity and most critical threat. Quantify estimated cash flow impact or margin exposure if ignored.
- *Recommended Action*: Action verb with clear instructions.

## ✍️ Content Brief (Auto-generated publish queue suggestions)
Detail the fresh content drafts created today in the SocialPublishQueue.
- *Action*: Approve or decline content templates for review.

## 🗺️ Local Market Brief (Competitor price checks & GSC query gaps)
Detail competitor tire pricing deviations and high-intent Google search Console organic click opportunities.
- *Action*: Select targeted landing pages or price matching overrides.

## 🚀 Frontier Brief (AI agent engineering & Cognitive biomarker protocols)
Summarize cutting-edge developer/AI workflow improvements and biomarker adjustments based on recovery logs.
- *Action*: Protocol adjustment command.`;

      const promptText = `Date: ${today}
Opportunities:
${opportunities.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}

Drafts in Queue:
${drafts.map((d) => `- [DRAFT] Kind: ${d.kind} | Platforms: ${d.platforms.join(", ")} | Preview: "${d.content.slice(0, 100)}..."`).join("\n")}

Claims:
${claims.map((c) => `- [CLAIM] ${c.text} (Confidence: ${c.confidence})`).join("\n")}`;

      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: `${promptText}\n\nCompose the brief now.`,
      });

      return {
        date: today,
        text: result.text || "No briefing content compiled for today.",
      };
    });

    // 4. Save Brief to BriefingLog
    await step.run("save-brief-log", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.briefingLog.create({
        data: {
          briefType: "daily",
          content: briefContent.text,
        },
      });
    });

    // 5. Dispatch Web Push Notification
    const pushReport = await step.run("dispatch-push", async () => {
      const { sendPush } = await import("@/lib/notifications/push");
      const result = await sendPush({
        title: "Daily Executive Brief",
        body: briefContent.text.slice(0, 200).replace(/\n+/g, " · "),
        level: "high",
        url: "/intelligence/brief",
        tag: `intelligence-brief-${briefContent.date}`,
        chatSeed: {
          prompt: `walk me through the daily executive brief for ${briefContent.date}`,
          suggKind: "intelligence-brief",
          suggId: briefContent.date,
        },
      });
      return result;
    });

    return {
      date: briefContent.date,
      ingested: ingestionReport,
      opportunities: opportunityReport,
      pushSent: pushReport.sent,
      pushFailed: pushReport.failed,
    };
  },
);

/**
 * Weekly Ingestion & Briefing Orchestrator
 * Cron: Sundays at 11:00 UTC
 */
export const intelligenceWeeklyBrief = inngest.createFunction(
  {
    id: "intelligence-weekly-brief",
    name: "Intelligence OS · Weekly Strategic Briefing",
    retries: 2,
    triggers: [{ cron: "0 11 * * 0" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const briefContent = await step.run("compose-weekly-brief", async () => {
      const { prisma } = await import("@/lib/prisma");
      
      const weeklyOpps = await prisma.opportunityLog.findMany({
        where: {
          status: "pending",
          score: { gte: 50 },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        orderBy: { score: "desc" },
      });

      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });

      const model = getModel("reason");
      const systemPrompt = `You are Nour's senior macro-investment advisor. Compose a Weekly Strategic Brief (max 1000 words) summarizing macro indicator shifts, competitor movements, and weekly opportunities.
Your writing style is highly strategic, analytical, and outcomes-oriented.

Format using these exact sections:
# Weekly Strategic Brief · [Date]

## 📈 Macro Indicator Trends
Summarize interest rate or price trends observed from FRED and macro sources.

## ⚔️ Competitor & Market Shifts
Analyze competitor movements and SEO rankings.

## 💡 Top Strategic Opportunities (Score >= 50)
Summarize key opportunities compiled this week.`;

      const promptText = `Date: ${today}
Weekly Opportunities:
${weeklyOpps.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}`;

      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: `${promptText}\n\nCompose the weekly strategic brief now.`,
      });

      return {
        date: today,
        text: result.text || "No strategic briefing content compiled for this week.",
      };
    });

    // Save to BriefingLog
    await step.run("save-weekly-log", async () => {
      const { prisma } = await import("@/lib/prisma");
      await prisma.briefingLog.create({
        data: {
          briefType: "weekly",
          content: briefContent.text,
        },
      });
    });

    return {
      date: briefContent.date,
      status: "completed",
    };
  },
);
