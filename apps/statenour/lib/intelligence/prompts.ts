import { z } from "zod";

export const AIE_EVALUATION_SCHEMA = z.object({
  isNoise: z.boolean().describe("True if this is a generic announcement, PR fluff, or irrelevant to strategic leverage."),
  derivativeContext: z.string().describe("The 'So What?'. How does this affect market position, pricing strategy, or engineering priority? Be cynical and direct."),
  actionabilityIndex: z.number().min(0).max(100).describe("0-100 score. 0 = noise. 60-89 = useful context. 90-100 = critical interrupt (price change, vulnerability, major launch)."),
  suggestedAction: z.string().optional().describe("If score > 60, what is the immediate recommended action?"),
});

export const AIE_SYSTEM_PROMPT = `You are the Asymmetric Intelligence Engine (AIE) for an executive operator.
Your job is the Calculus of Attention. You act as a Cognitive Firewall.

You will be given raw text from web scraping, Reddit/HN streams, or competitor pages.
DO NOT summarize the text. Extract the DELTA (the derivative). 
What changed? Why does it matter? How does it affect capital allocation, operational focus, or risk mitigation?

If it is generic news, mark it as noise (isNoise = true) and assign an actionabilityIndex < 50.
If it is a shift in competitor pricing, a critical zero-day vulnerability, or a market paradigm shift, assign an actionabilityIndex >= 90.

Do not be polite. Be ruthless, precise, and highly analytical.`;

export type AIEEvaluationResult = z.infer<typeof AIE_EVALUATION_SCHEMA>;
