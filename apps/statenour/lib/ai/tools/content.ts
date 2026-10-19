/**
 * Content generation tools — content + ai_analysis.
 *
 * Includes: generateImage · renderInlineChart · summarize · writeCreative.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";

/** aiChat returns an apology instead of throwing on a total outage; the
 *  model must not read that as the tool's output (SQL, code, summary...). */
async function providerDown(result: { provider?: string; content?: string }) {
  const { isAiSentinel } = await import("@/lib/ai/provider");
  return isAiSentinel(result) ? { error: "AI providers unavailable · no result produced, try again shortly" } : null;
}

export const contentTools = {
  generateImage: tool({
    description:
      "Generate an AI image using Venice AI. Use for social media content, marketing visuals, concept art, memes, or anything Nour asks you to visualize. Nick's Tire brand context is auto-injected.",
    inputSchema: z.object({
      prompt: z.string().describe("Detailed image description — be specific about style, colors, composition"),
      size: z.enum(["512x512", "1024x1024", "1536x1024", "1024x1536"]).default("1024x1024").describe("Image dimensions — 512x512 fastest · 1024x1024 default · 1536x1024 landscape · 1024x1536 portrait (matches Venice flux-2-pro accepted enum)"),
    }),
    execute: async ({ prompt, size }) => {
      // v10.0.529.47 · Venice-first with Gemini fallback (was
      // Venice-only). When Venice returns 402 / 429 / 5xx the helper
      // automatically tries Gemini's gemini-2.5-flash-image · matching
      // ImageResult shape · zero downstream change. Original 4xx
      // validation errors still bubble up loud · they're prompt issues.
      const { generateImageWithFallback } = await import(
        "@/lib/ai/gemini-image"
      );
      const { brandedPrompt: makeBrandedPrompt } = await import(
        "@/lib/ai/brand-context"
      );
      const brandedPrompt = makeBrandedPrompt(prompt);
      const result = await generateImageWithFallback(brandedPrompt, { size, autoAspect: !size });
      // Return BOTH the relative URL (fast, cached, cheap to stream)
      // AND the dataUrl (inline base64 — always renders even if the
      // URL fetch fails). Chat page prefers dataUrl first for total
      // reliability. Base64 for a 512x512 is ~300-400KB which is fine
      // for the tool-result stream.
      return {
        imageGenerated: true,
        prompt: result.prompt,
        model: result.model,
        size: result.size,
        imageUrl: result.imageUrl,
        dataUrl: result.dataUrl,
        imageId: result.imageId,
      };
    },
  }),

  // ── INLINE RICH RENDERERS (v10.0.49) ──
  // Ports of the open-webui-plugins Inline Visualizer + Email Composer.
  // Both emit a fenced markdown block with a special language tag; the
  // chat-message renderer (components/chat/nick-message.tsx <pre>
  // override) detects the language and renders the React component
  // directly. Bad payloads degrade gracefully to a plain code block —
  // a hallucinated payload never breaks the message.

  renderInlineChart: tool({
    description:
      "Render an inline chart in the chat reply. Use whenever Nour asks for a trend / distribution / comparison and the data fits a small (≤60 points) chart. Types: line (continuous over time), sparkline (compact line, no axes — for in-paragraph trend hints), bar (categorical comparison), pie (parts-of-whole, ≤8 slices). Returns markdown that includes a fenced ```chart code block — INCLUDE THE RETURNED MARKDOWN IN YOUR REPLY for it to render.",
    inputSchema: z.object({
      type: z.enum(["line", "bar", "sparkline", "pie"]),
      data: z
        .array(
          z.object({
            label: z.string().min(1).max(40).describe("X-axis label or slice name"),
            value: z.number().describe("Y-axis value"),
          }),
        )
        .min(1)
        .max(60)
        .describe("Data points. Pie: ≤8 slices is readable. Line/bar: ≤30 ideal."),
      title: z.string().max(80).optional().describe("Optional chart title shown above"),
      color: z
        .enum(["gold", "emerald", "rose", "blue", "violet"])
        .default("gold")
        .describe("Accent color (pie chart auto-rotates a palette regardless)"),
    }),
    execute: async ({ type, data, title, color }) => {
      const payload = JSON.stringify({ type, data, title, color });
      // The fenced block IS the render trigger. Returning it as the
      // tool output means Nick's reply markdown picks it up; the chat
      // <pre> override (nick-message.tsx) parses + renders <InlineChart/>.
      return {
        markdown: `\n\`\`\`chart\n${payload}\n\`\`\`\n`,
        // Plain summary for non-rendering contexts (search index,
        // export to JSON, AgentTrace UI rendering when the chart isn't
        // part of the visible reply).
        summary: `${title ?? "chart"} · ${type} · ${data.length} point${data.length === 1 ? "" : "s"}`,
      };
    },
  }),

  summarize: tool({
    description: "Quickly summarize text, emails, documents, or chat threads",
    inputSchema: z.object({
      text: z.string().describe("Text to summarize"),
      style: z.enum(["bullets", "oneliner", "paragraph"]).default("bullets"),
    }),
    execute: async ({ text, style }) => {
      // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget).
      // Migrated to tracedAiChat factory · same drop-in signature.
      const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
      const aiChat = makeTracedAiChat("content-tool", "tool");
      const stylePrompt = style === "bullets" ? "as bullet points" : style === "oneliner" ? "in one sentence" : "as a short paragraph";
      const result = await aiChat([
        { role: "system", content: `Summarize the following ${stylePrompt}. Be concise.` },
        { role: "user", content: text },
      ], "summary");
      const down = await providerDown(result);
      if (down) return down;
      return { summary: result.content, model: result.model };
    },
  }),

  writeCreative: tool({
    description: "Write creative content: social posts, ad copy, email subject lines, slogans",
    inputSchema: z.object({
      type: z.enum(["social_post", "ad_copy", "email_subject", "slogan", "description"]),
      topic: z.string(),
      tone: z.enum(["professional", "casual", "urgent", "funny", "inspirational"]).default("professional"),
      count: z.number().default(3).describe("Number of variations"),
    }),
    execute: async ({ type, topic, tone, count }) => {
      // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget).
      // Migrated to tracedAiChat factory · same drop-in signature.
      const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
      const aiChat = makeTracedAiChat("content-tool", "tool");
      const result = await aiChat([
        { role: "system", content: `You are a creative writer for Nick's Tire & Auto, a family-owned shop in Euclid, OH. Write ${count} ${tone} ${type.replace("_", " ")} variations.` },
        { role: "user", content: topic },
      ], "creative");
      const down = await providerDown(result);
      if (down) return down;
      return { variations: result.content, model: result.model };
    },
  }),

  // Apr 18: 13 shop/business tools retired — business layer lives at
  // nickstire.org/admin now. Retired tools: generateInstantQuote,
  // respondToLead, scoreLead, getLeadPipeline, getTodayRevenue,
  // getRevenueComparison, getRevenueAlerts, getDailyRevSnapshot,
  // getTechPerformance, processVoiceNote, getDailyClose, getStaffReport.

};
