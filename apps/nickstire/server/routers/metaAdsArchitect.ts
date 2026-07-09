import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { CampaignInputSchema, generateCampaignPlan } from "@nour/meta-ads-architect";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:metaAdsArchitect");

export const metaAdsArchitectRouter = router({
  /**
   * Generate a compliant Meta Ads campaign plan given business inputs.
   * Uses dependency injection to pass the Nick's Tire LLM provider into the architect package.
   */
  generatePlan: adminProcedure
    .input(CampaignInputSchema)
    .mutation(async ({ input }) => {
      // Create an adapter to convert the (prompt, systemPrompt) signature to invokeLLM
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

        // Ensure we get a text response
        const message = result.choices[0]?.message;
        if (!message) throw new Error("No response from LLM");
        
        // Handle array of content parts
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
        return { success: true, plan };
      } catch (error) {
        log.error("Meta Ads Architect generation failed:", error);
        return { success: false, error: String(error) };
      }
    }),
});
