import { prisma } from "@/lib/prisma";
import { getModel } from "@/lib/ai/provider";
import { generateText } from "ai";
import { createDraft } from "@/lib/content/drafts";
import { extractStructured } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/content-alpha");

interface GeneratedDraftOutput {
  content: string;
  kind: "post" | "thread" | "story" | "reel";
  suggestedPlatforms: string[];
}

export async function processOpportunityContentDrafts(): Promise<number> {
  try {
    log.info("Running Content Alpha Engine...");
    
    // 1. Fetch high scoring pending opportunities (score >= 75)
    const opportunities = await prisma.opportunityLog.findMany({
      where: {
        status: "pending",
        score: { gte: 75 },
      },
      orderBy: { score: "desc" },
      take: 3,
    });
    
    if (opportunities.length === 0) {
      log.info("No high-priority opportunities found to generate content drafts for.");
      return 0;
    }
    
    log.info(`Found ${opportunities.length} opportunities for content generation.`);
    
    const model = getModel("reason");
    let generatedCount = 0;
    
    // Fetch recent drafts from Content Alpha Engine to check for duplicates in-memory
    const recentDrafts = await prisma.socialPublishQueue.findMany({
      where: {
        source: "content_alpha_engine",
        createdAt: { gte: new Date(Date.now() - 14 * 86400 * 1000) }
      }
    });
    
    for (const opp of opportunities) {
      const alreadyGenerated = recentDrafts.some(d => {
        const meta = (d.sourceMetadata ?? {}) as Record<string, any>;
        return meta.opportunityId === opp.id;
      });
      
      if (alreadyGenerated) {
        log.info(`Drafts already exist for opportunity: "${opp.title}". Skipping.`);
        continue;
      }
      
      log.info(`Generating content drafts for opportunity: "${opp.title}" (Score: ${opp.score})`);
      
      const systemPrompt = `You are a world-class copywriter, content theorist, and brand editor for Nick's Tire & Auto (a premier tire and auto repair center in Cleveland, OH).
Your goal is to translate a raw strategic opportunity into highly engaging, conversion-optimized content drafts.

For the provided opportunity, draft exactly two distinct social/outreach assets:
1. An Instagram/Facebook post (kind: "post", suggestedPlatforms: ["instagram", "facebook"]) - engaging, punchy local tone, with local Cleveland/Parma references and a strong call-to-action. Include relevant hashtags.
2. A Google Business Profile (GBP) update (kind: "post", suggestedPlatforms: ["gbp"]) - professional, clear local offer or service update.

Respond ONLY with a JSON array of two objects matching the schema. Do not include markdown fences, preambles, or postambles.
JSON Schema:
[
  {
    "content": "The drafted post copy, including hashtags and call-to-action details...",
    "kind": "post",
    "suggestedPlatforms": ["instagram", "facebook"]
  },
  {
    "content": "The drafted GBP update copy...",
    "kind": "post",
    "suggestedPlatforms": ["gbp"]
  }
]`;

      const promptText = `Opportunity:
- Title: "${opp.title}"
- Description: "${opp.description}"
- Domain: "${opp.domain}"
- Score: ${opp.score}`;

      const result = await generateText({
        model,
        system: systemPrompt,
        prompt: `${promptText}\n\nDraft the content assets now.`,
      });
      
      const parsed = extractStructured<GeneratedDraftOutput[]>(result.text || "", "array");
      
      if (!parsed.ok) {
        log.warn(`Failed to parse content drafts JSON for opportunity: ${opp.title}`, {
          error: parsed.error,
          raw: result.text?.slice(0, 200),
        });
        continue;
      }
      
      for (const draft of parsed.value) {
        await createDraft({
          content: draft.content,
          suggestedPlatforms: draft.suggestedPlatforms,
          kind: draft.kind,
          source: "content_alpha_engine",
          sourceMetadata: {
            opportunityId: opp.id,
            opportunityTitle: opp.title,
          },
        });
        generatedCount++;
      }
      
      log.info(`Generated 2 content drafts for opportunity: "${opp.title}"`);
    }
    
    return generatedCount;
  } catch (err) {
    log.error("Failed to run Content Alpha Engine:", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
