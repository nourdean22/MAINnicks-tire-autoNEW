/**
 * Deep Research · v10.0.373
 *
 * Per /deep-research skill · autonomous research worker that runs a
 * multi-step plan-search-read-synthesize loop. Distinct from the
 * one-shot web search (v10.0.358):
 *   · webSearch · single Perplexity query · returns content + citations
 *   · deepResearch · plan multiple queries → run each → cross-check →
 *                    synthesize cited report
 *
 * USE WHEN
 *   · "research X competitor's pricing structure"
 *   · "what are emerging tire-tech trends · cite sources"
 *   · "due diligence on supplier Y"
 *   · "literature review on tire-shop SEO patterns"
 *
 * Architecture:
 *   1. PLAN · gpt-4o-mini decomposes the question into 3-5 sub-queries
 *   2. SEARCH · Perplexity runs each sub-query in parallel
 *   3. SYNTHESIZE · gpt-4o-mini writes a final report with inline citations
 *
 * Total cost · ~3-5 Perplexity searches + 2 gpt-4o-mini calls + ~10-15s.
 * NOT cheap · use sparingly. Returned report goes into the response so
 * the operator sees the full chain, not just the final answer.
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/deep-research");

export interface DeepResearchReport {
  question: string;
  plan: string[];
  /** Per-sub-query result · content + citation URLs. */
  rounds: Array<{
    query: string;
    content: string;
    citations: string[];
  }>;
  /** Final synthesized report with inline [N] citation markers. */
  synthesis: string;
  /** Flat list of all unique citation URLs across rounds. */
  allCitations: string[];
  durationMs: number;
}

const PLANNER_SYSTEM = `You decompose a research question into 3-5 specific sub-queries that, together, would yield a comprehensive answer.

GOOD sub-query examples:
- "Goodyear UltraGrip 215/55R17 wholesale price 2024"
- "Cleveland tire shop average labor rate 2024 BLS"
- "Discount Tire vs Tire Choice customer review themes"

BAD sub-queries (too broad):
- "tires"
- "industry trends"
- "auto repair"

Output JSON only:
{
  "subQueries": ["...", "...", "..."]
}

Max 5 sub-queries. NO MARKDOWN.`;

const SYNTHESIZER_SYSTEM = `You synthesize multiple research rounds into a tight cited report for an operator who runs a tire shop in Cleveland OH.

REQUIREMENTS
- Use inline [N] markers for each claim · N matches the citation list at the bottom
- 200-400 words total
- Prefer specific numbers / dates / quotes over generic claims
- If sources contradict, say so
- If a claim has only one source, mark it "[N · single source]"
- Plain text · no markdown headers · no bullets unless absolutely necessary
- End with a 1-line "what to do next" if the operator could act on this

NO HEDGING. NO PREAMBLE. Just the report.`;

interface PlanArgs {
  question: string;
}

// v10.0.529.106 · Wave 59 · routed through aiChat provider chain
// instead of raw fetch to OpenAI. Same Wave 59 pattern as
// pretask-fanout.ts and multi-agent-orchestrator.ts.
async function _planSubQueries(args: PlanArgs): Promise<string[]> {
  const { aiChat } = await import("@/lib/ai/provider");
  const reply = await aiChat(
    [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: args.question.slice(0, 1500) },
    ],
    "classify",
  );
  const text = reply?.content ?? "";
  if (!text) return [];
  // Extract JSON from the response (some models wrap it in markdown
  // fences · be tolerant).
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  let parsed: { subQueries?: unknown };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.subQueries)) return [];
  return parsed.subQueries
    .filter((q): q is string => typeof q === "string")
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 5);
}

interface SynthesizeArgs {
  question: string;
  rounds: Array<{ query: string; content: string; citations: string[] }>;
}

// v10.0.529.106 · Wave 59 · routed through aiChat() provider chain.
async function _synthesize(args: SynthesizeArgs): Promise<string> {
  // Build a compact "rounds dossier" with source markers
  const dossier = args.rounds
    .map((r, i) => {
      const cites = r.citations.slice(0, 3).map((c, j) => `  [${i + 1}.${j + 1}] ${c}`).join("\n");
      return `# Round ${i + 1} · ${r.query}\n\n${r.content.slice(0, 1500)}\n\nSources:\n${cites || "  (no citations returned)"}`;
    })
    .join("\n\n---\n\n");

  const userPrompt = `RESEARCH QUESTION: ${args.question}

DOSSIER (${args.rounds.length} rounds):

${dossier}

Synthesize a tight cited report.`;

  const { aiChat } = await import("@/lib/ai/provider");
  const reply = await aiChat(
    [
      { role: "system", content: SYNTHESIZER_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    "deep",
  );
  return (reply?.content ?? "").trim();
}

const planSubQueries = withGuardian("research-planner", _planSubQueries, {
  timeoutMs: 12_000,
  maxRetries: 1,
});

const synthesize = withGuardian("research-synth", _synthesize, {
  timeoutMs: 15_000,
  maxRetries: 1,
});

export async function runDeepResearch(args: {
  question: string;
}): Promise<DeepResearchReport> {
  const startedAt = Date.now();

  // 1. Plan sub-queries
  const subQueries: string[] = await planSubQueries({ question: args.question }).catch((e) => {
    log.warn("planner_failed", { err: (e as Error).message });
    return [] as string[];
  });

  if (subQueries.length === 0) {
    // Fallback · just one direct query
    subQueries.push(args.question);
  }

  // 2. Run each sub-query in parallel via Perplexity
  const { smartWebSearch } = await import("@/lib/integrations/perplexity");
  const roundResults = await Promise.all(
    subQueries.map((q) =>
      smartWebSearch({ query: q, recency: "month", tier: "sonar" })
        .then((r) => ({
          query: q,
          content: r?.content ?? "",
          citations: (r?.citations ?? []).map((c) => c.url).filter(Boolean).slice(0, 5),
        }))
        .catch((e) => {
          log.debug("subquery_failed", { query: q, err: (e as Error).message });
          return { query: q, content: "", citations: [] as string[] };
        }),
    ),
  );

  const successful = roundResults.filter((r) => r.content);

  // 3. Synthesize
  let synthesis = "";
  if (successful.length > 0) {
    synthesis = await synthesize({ question: args.question, rounds: successful }).catch(
      () => "",
    );
  }

  // Flatten unique citations
  const allCitations = Array.from(
    new Set(roundResults.flatMap((r) => r.citations)),
  );

  return {
    question: args.question,
    plan: subQueries,
    rounds: roundResults,
    synthesis,
    allCitations,
    durationMs: Date.now() - startedAt,
  };
}
