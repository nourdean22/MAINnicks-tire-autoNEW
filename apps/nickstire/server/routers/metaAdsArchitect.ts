import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { 
  CampaignInputSchema, 
  generateCampaignPlan,
  exportPlanToMarkdown,
  exportPlanToJson,
  generateSuggestedUtms,
  extractCreativeBriefs
} from "@nour/meta-ads-architect";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { getDbTyped } from "../db";
import { socialContentInventory } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";

const log = createLogger("routers:metaAdsArchitect");

export const metaAdsArchitectRouter = router({
  /**
   * Generate a compliant Meta Ads campaign plan given business inputs.
   * Uses dependency injection to pass the Nick's Tire LLM provider into the architect package.
   */
  generatePlan: adminProcedure
    .input(CampaignInputSchema)
    .mutation(async ({ input }) => {
      const llmProvider = async (prompt: string, systemPrompt?: string, options?: any) => {
        const messages: any[] = [];
        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const result = await invokeLLM({
          messages,
          maxTokens: options?.maxTokens ?? 4000,
          timeoutMs: options?.timeoutMs ?? 60000,
          outputSchema: options?.outputSchema,
        });

        const message = result.choices[0]?.message;
        if (!message) throw new Error("No response from LLM");
        
        if (Array.isArray(message.content)) {
          const textPart = message.content.find((p: any) => p.type === "text" || typeof p === "string");
          if (typeof textPart === "string") return textPart;
          if (textPart && typeof textPart === "object" && "text" in textPart) return textPart.text;
          return "";
        }
        
        return message.content || "";
      };

      try {
        const plan = await generateCampaignPlan(input, llmProvider);
        
        const exportMarkdown = exportPlanToMarkdown(plan);
        const exportJson = exportPlanToJson(plan);
        const utms = generateSuggestedUtms(
          plan.campaignArchitecture.namingConventions.campaign,
          plan.audienceTargetingBlueprint.coldAudiences.slice(0, 2), // Example ad sets
          plan.adCopyFactory.map(f => f.bundleName)
        );

        return { 
          success: true, 
          plan,
          exportMarkdown,
          exportJson,
          utms
        };
      } catch (error) {
        log.error("Meta Ads Architect generation failed:", error);
        return { success: false, error: String(error) };
      }
    }),

  /**
   * Takes an existing generated campaign plan, extracts the creative briefs,
   * and stages them deterministically in the socialContentInventory table.
   */
  stageCreativeBriefs: adminProcedure
    .input(z.object({
      planJson: z.string().describe("The serialized CampaignOutput plan")
    }))
    .mutation(async ({ input }) => {
      try {
        const db = await getDbTyped();
        if (!db) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database connection failed" });
        }

        const plan = JSON.parse(input.planJson);
        const payloads = extractCreativeBriefs(plan);
        const campaignId = `meta-campaign-${Date.now()}`;

        // Insert iteratively to allow nanoid or default id generation to handle it
        for (const payload of payloads) {
          await db.insert(socialContentInventory).values({
            id: `cb-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            campaignId,
            contentType: payload.contentType,
            platform: payload.platform,
            topic: payload.topic,
            seriesName: payload.seriesName,
            hookCategory: payload.hookCategory,
            hookText: payload.hookText,
            bodyText: payload.bodyText,
            visualStyle: payload.visualStyle,
            persona: payload.persona,
            briefJson: payload.briefJson,
            status: payload.status,
          });
        }

        return { success: true, count: payloads.length, campaignId };
      } catch (error) {
        log.error("Failed to stage creative briefs:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to stage creative briefs",
          cause: error
        });
      }
    }),
});
