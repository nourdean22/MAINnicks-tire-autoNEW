/**
 * Google Search Grounding Integration — v10.0.530
 *
 * Utilizes Gemini's native search grounding via the `@ai-sdk/google` provider
 * to query the web, retrieve grounded answers, and extract citations.
 *
 * Used as a fallback/primary web search source when Perplexity key is missing.
 * Compatible with the multi-source search orchestrator structure.
 */

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { withGuardian } from "@/lib/tools/guardian";

export interface GoogleSearchCitation {
  url: string;
  title?: string;
}

export interface GoogleSearchResponse {
  content: string;
  citations: GoogleSearchCitation[];
  model: string;
}

export interface GoogleSearchOptions {
  model?: string;
}

function getApiKey(): string {
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY not configured");
  return key;
}

async function _askGoogleSearch(
  question: string,
  opts: GoogleSearchOptions = {},
): Promise<GoogleSearchResponse> {
  const apiKey = getApiKey();
  const google = createGoogleGenerativeAI({ apiKey });
  
  // Default to gemini-2.0-flash which has excellent performance and supports grounding
  const modelId = opts.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";

  const model = google(modelId);

  const result = await generateText({
    model,
    prompt: question,
    tools: {
      googleSearch: google.tools.googleSearch({}) as any,
    },
  });

  // Extract grounding metadata and chunks from the provider response
  const providerMetadata = (result as any).providerMetadata || (result as any).experimental_providerMetadata;
  const googleMetadata = providerMetadata?.google;
  const groundingMetadata = googleMetadata?.groundingMetadata;
  const rawChunks = groundingMetadata?.groundingChunks || [];

  const citations: GoogleSearchCitation[] = rawChunks
    .map((chunk: any) => {
      const uri = chunk?.web?.uri || chunk?.uri;
      const title = chunk?.web?.title || chunk?.title;
      if (typeof uri === "string" && uri.length > 0) {
        return { url: uri, title: typeof title === "string" ? title : undefined };
      }
      return null;
    })
    .filter((c: any): c is GoogleSearchCitation => c !== null);

  return {
    content: result.text,
    citations,
    model: modelId,
  };
}

/**
 * Guardian-wrapped exterior for Google search grounding.
 */
export const askGoogleSearch = withGuardian("google-search", _askGoogleSearch, {
  timeoutMs: 25_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal per-source sub-op behind web.search.* tools
});
