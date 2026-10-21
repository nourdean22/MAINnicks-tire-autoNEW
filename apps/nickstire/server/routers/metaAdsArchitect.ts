import { router, adminProcedure } from "../_core/trpc";
import { 
  CampaignInputSchema, 
  generateCampaignPlan,
  exportPlanToMarkdown,
  exportPlanToJson,
  generateSuggestedUtms} from "@nour/meta-ads-architect";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { applyBrandTruthToCampaignInput, compileBrandTruthLive } from "../services/brandTruth";
import { buildOrganicEvidence, renderOrganicEvidenceBlock } from "../services/organicEvidence";

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
        // Server-authoritative facts: the admin form keeps the creative inputs,
        // but warranty / payment programs / hours / reviews / address are
        // REPLACED by the compiled SSOT (brandTruth) — a form field is not a
        // place a business fact may rot (2026-10-01: three copies of a retired
        // mileage warranty reached paid-ad copy through this procedure).
        const grounded = applyBrandTruthToCampaignInput(input, await compileBrandTruthLive());
        // Organic → paid: what the feed already earned (sends/saves per reach),
        // compiled from social_content_inventory. Unavailable reads say so in
        // the block rather than vanishing (empty-vs-error).
        const organic = await buildOrganicEvidence();
        const withEvidence = {
          ...grounded,
          organicEvidence: { block: renderOrganicEvidenceBlock(organic), windowDays: organic.windowDays, measured: organic.measured },
        };
        const plan = await generateCampaignPlan(withEvidence, llmProvider);
        
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
});
