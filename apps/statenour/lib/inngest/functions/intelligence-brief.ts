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
    // AG-40 · shared composer kills the drift pair: this step was
    // duplicated in /api/intelligence/briefs/generate, which had drifted
    // to a pre-AG-02 prompt with NO grounding rule.
    //
    // 2026-07-29 · bounded + degrade (first-fire postmortem). The maiden
    // post-resync run proved steps 1-2 live (claims + opportunities
    // written 10:18) then NEVER saved a brief and left NO error row —
    // the compose's AI call hung and, `maxDuration` being Vercel-only
    // semantics, Railway enforced nothing (the exact unbounded-hang
    // class the mega children were fixed for in #1166). A brief that
    // times out now degrades to an honest ingestion summary instead of
    // losing the whole run: briefing_logs ALWAYS gains its row, the
    // push still fires, and the failure is LOUD in the text itself.
    const briefContent = await step.run("compose-brief-text", async () => {
      const { composeDailyExecutiveBrief } = await import("@/lib/intelligence/compose-daily-brief");
      const COMPOSE_TIMEOUT_MS = 90_000;
      try {
        return await Promise.race([
          composeDailyExecutiveBrief(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`compose timed out after ${COMPOSE_TIMEOUT_MS / 1000}s`)), COMPOSE_TIMEOUT_MS),
          ),
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("brief_compose_failed_degrading", { error: msg });
        const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
        return {
          date,
          text: [
            `# Daily Executive Brief · ${date} (degraded)`,
            "",
            `Compose failed (${msg.slice(0, 160)}) — this is the honest fallback, not the full brief.`,
            "",
            `What DID run: ${ingestionReport.sourcesIngested}/${ingestionReport.sourcesAttempted} sources ingested, ${ingestionReport.totalClaims} claims extracted, ${opportunityReport.opportunitiesCreated} opportunities scored, ${opportunityReport.draftsCreated} drafts.`,
            "",
            "Raw opportunities are on /intelligence — the composed narrative returns when the provider does.",
          ].join("\n"),
        };
      }
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
      // S4 · outcome ledger producer #1: the brief is a recommendation
      // the operator is SHOWN — record it so acceptance/usefulness can
      // ever be measured. First line = the headline recommendation;
      // dedup + failure-safety live in the ledger service.
      const { recordShown } = await import("@/lib/services/outcome-ledger");
      await recordShown({
        kind: "daily_brief",
        sourceEngine: "intelligence-brief",
        summary: briefContent.text.split("\n").find((l: string) => l.trim().length > 0)?.slice(0, 500) ?? "daily brief",
        shownSurface: "push+briefing_log",
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

    // 6. AG-15 · persona-drift scan. The read surfaces (tRPC
    // system.personaDrift, /api/system/persona-drift, the ultron
    // situation card) were live but the PRODUCER — scanRecentReplies —
    // had no scheduled caller, so they consumed an always-empty store.
    // Best-effort: drift observability never fails the brief.
    const driftReport = await step.run("scan-persona-drift", async () => {
      try {
        const { scanRecentReplies } = await import("@/lib/brain/persona-drift-detector");
        const r = await scanRecentReplies({ windowHours: 24 });
        return { scanned: r.scanned, drifted: r.drifted };
      } catch (err) {
        log.warn("persona_drift_scan_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { scanned: 0, drifted: 0 };
      }
    });

    return {
      date: briefContent.date,
      ingested: ingestionReport,
      opportunities: opportunityReport,
      pushSent: pushReport.sent,
      pushFailed: pushReport.failed,
      personaDrift: driftReport,
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
