/**
 * Daily Executive Brief composer · AG-40 (2026-07-09)
 *
 * ONE compose function for the classic drift pair: the inngest daily
 * cron (lib/inngest/functions/intelligence-brief.ts) and the manual
 * owner route (app/api/intelligence/briefs/generate) each hand-rolled
 * the compose step — and they had already drifted: the manual route
 * still carried the PRE-AG-02 prompt with no grounding rule and a
 * different section contract, so a manually-generated brief could
 * invent data the cron brief was forbidden to.
 *
 * This is the canonical grounded V2 composer (AG-02 rules). Heading
 * contract note: the morning push's chatSeed references the "daily
 * executive brief" — keep the H1 stable.
 */

import { prisma } from "@/lib/prisma";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";

const SYSTEM_PROMPT = `You are Nour's Chief of Staff and chief intelligence officer. Compose the Daily Executive Brief V2.
Your tone is ruthlessly direct, quantitative, hyper-strategic, and action-oriented. Eliminate all passive fluff or generic warnings.

GROUNDING RULE (absolute): every number, price, name, and claim in the brief MUST appear verbatim in the input data below. If the input contains no signal for a section, write exactly "no signal today" under that heading and move on — NEVER invent competitor prices, search metrics, biomarkers, or any other data.

You must format using these exact headings:
# Daily Executive Brief V2 · [Date]

## 💼 CEO Brief (Highest ROI opportunity & Threat level)
From the input opportunities/claims only: the highest-ROI opportunity and most critical threat. Quantify impact only when the input carries numbers.
- *Recommended Action*: Action verb with clear instructions.

## ✍️ Content Brief (Auto-generated publish queue suggestions)
Detail the fresh content drafts created today in the SocialPublishQueue (from the Drafts in Queue input).
- *Action*: Approve or decline content templates for review.

## 🗺️ Local Market Brief (verified market & search signals)
Summarize competitor/market/search claims that are PRESENT in the input data.
- *Action*: One concrete move, or "no signal today".

## 🚀 Frontier Brief (AI & performance signals)
Summarize AI/engineering/performance claims that are PRESENT in the input data.
- *Action*: One concrete move, or "no signal today".`;

export async function composeDailyExecutiveBrief(): Promise<{ date: string; text: string }> {
  // High-scoring pending opportunities (score >= 75)
  const opportunities = await prisma.opportunityLog.findMany({
    where: { status: "pending", score: { gte: 75 } },
    orderBy: { score: "desc" },
    take: 5,
  });

  // Recent pending content drafts
  const drafts = await prisma.socialPublishQueue.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  // High-confidence source-supported claims
  const claims = await prisma.intelligenceClaim.findMany({
    where: { confidence: { gte: 0.8 }, status: "source_supported" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const promptText = `Date: ${today}
Opportunities:
${opportunities.map((o) => `- [${o.domain.toUpperCase()}] ${o.title}: ${o.description} (Score: ${o.score})`).join("\n")}

Drafts in Queue:
${drafts.map((d) => `- [DRAFT] Kind: ${d.kind} | Platforms: ${d.platforms.join(", ")} | Preview: "${d.content.slice(0, 100)}..."`).join("\n")}

Claims:
${claims.map((c) => `- [CLAIM] ${c.text} (Confidence: ${c.confidence})`).join("\n")}`;

  const result = await generateText({
    model: getModel("reason"),
    system: SYSTEM_PROMPT,
    prompt: `${promptText}\n\nCompose the brief now.`,
  });

  return {
    date: today,
    text: result.text || "No briefing content compiled for today.",
  };
}
