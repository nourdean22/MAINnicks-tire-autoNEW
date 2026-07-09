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
import {
  RESEARCH_PLANNER,
  RESEARCH_SYNTHESIZER,
  personaToSystemPrompt,
} from "@/lib/ai/personas";
import { logError } from "@/lib/utils/error-log";

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
  /** AG-34 · true when served from a <7-day-old persisted report instead
   *  of re-spending 3-5 searches — the spendy tool compounds now. */
  cached?: boolean;
}

const REUSE_WINDOW_MS = 7 * 86400_000;
const REUSE_SIMILARITY_FLOOR = 0.82;

/** AG-34 · look for a recent persisted report semantically matching the
 *  question. Best-effort — any failure returns null (fresh research). */
async function findRecentReport(question: string): Promise<DeepResearchReport | null> {
  try {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch(question, 10, ["brain_memory"]);
    const match = hits.find(
      (h) => h.category === "deep_research" && h.similarity >= REUSE_SIMILARITY_FLOOR,
    );
    if (!match) return null;

    const { prisma } = await import("@/lib/prisma");
    // brain_memory embeddings carry the BrainMemory row id as sourceId.
    const row = await prisma.brainMemory.findFirst({
      where: {
        id: match.sourceId,
        category: "deep_research",
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) },
      },
      select: { content: true, metadata: true, createdAt: true },
    });
    if (!row) return null;
    const meta = (row.metadata ?? {}) as { question?: string; citations?: string[] };
    return {
      question: meta.question ?? question,
      plan: [],
      rounds: [],
      synthesis: row.content,
      allCitations: Array.isArray(meta.citations) ? meta.citations : [],
      durationMs: 0,
      cached: true,
    };
  } catch (err) {
    log.debug("reuse_check_failed", { err: (err as Error).message });
    return null;
  }
}

// Phase T (2026-05-18 PM) · system prompts now come from the typed
// persona library (RESEARCH_PLANNER + RESEARCH_SYNTHESIZER in
// lib/ai/personas/index.ts) so the deep-research worker flows through
// the same persona-as-system-prompt mechanism as runMultiAgent.
// N.6's recordPersonaUsage() telemetry sees these keys too · the
// scorer can finally compute per-persona verdicts for the entire
// reasoning stack, not just the multi-agent fan-out.
//
// The persona backstories preserve all the domain anchors the old
// inline SYSTEM strings had (JSON output shape · Perplexity [N]
// citation markers · Cleveland OH tire-shop framing) · this is NOT
// a generic-personas migration that loses fidelity.
const PLANNER_SYSTEM = personaToSystemPrompt(RESEARCH_PLANNER);
const SYNTHESIZER_SYSTEM = personaToSystemPrompt(RESEARCH_SYNTHESIZER);

interface PlanArgs {
  question: string;
}

// v10.0.529.106 · Wave 59 · routed through aiChat provider chain
// instead of raw fetch to OpenAI. Same Wave 59 pattern as
// pretask-fanout.ts and multi-agent-orchestrator.ts.
async function _planSubQueries(args: PlanArgs): Promise<string[]> {
  // wave-AO follow-up · audit #438 Tier-2 · was bare aiChat.
  const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
  const aiChat = makeTracedAiChat("deep-research", "brain");
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

  // wave-AO follow-up · audit #438 Tier-2 · was bare aiChat.
  const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
  const aiChat = makeTracedAiChat("deep-research", "brain");
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
  reliabilityOnly: true, // internal sub-step of arsenal.deepResearch
});

const synthesize = withGuardian("research-synth", _synthesize, {
  timeoutMs: 15_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal synthesis sub-step of arsenal.deepResearch
});

export async function runDeepResearch(args: {
  question: string;
}): Promise<DeepResearchReport> {
  const startedAt = Date.now();

  // AG-34 · reuse before re-spending: a strong semantic match on a
  // <7-day-old persisted report returns instantly with cached: true.
  const recent = await findRecentReport(args.question);
  if (recent) {
    log.info("deep_research_cache_hit", { question: args.question.slice(0, 80) });
    return recent;
  }

  // 1. Plan sub-queries
  const plannerStart = Date.now();
  let plannerFailed = false;
  const subQueries: string[] = await planSubQueries({ question: args.question }).catch((e) => {
    log.warn("planner_failed", { err: (e as Error).message });
    plannerFailed = true;
    return [] as string[];
  });
  const plannerMs = Date.now() - plannerStart;

  if (subQueries.length === 0) {
    // Fallback · just one direct query
    subQueries.push(args.question);
  }

  // 2. Run each sub-query in parallel. Perplexity is preferred when keyed;
  // AG-16: this step was hardcoded to Perplexity, so without
  // PERPLEXITY_API_KEY every sub-query threw, rounds came back empty, and
  // the operator got an empty synthesis — from chat, the reasoning engine,
  // and nick-agent alike (prod zombie). Unkeyed or failing queries now fall
  // back to the multi-source quorum (Tavily / Google grounding / ...).
  const hasPerplexityKey = Boolean(process.env.PERPLEXITY_API_KEY);
  const { smartWebSearch } = await import("@/lib/integrations/perplexity");
  const { multiSourceSearch } = await import("@/lib/ai/multi-search");

  const runSubQuery = async (
    q: string,
  ): Promise<{ query: string; content: string; citations: string[] }> => {
    if (hasPerplexityKey) {
      try {
        const r = await smartWebSearch({ query: q, recency: "month", tier: "sonar" });
        return {
          query: q,
          content: r?.content ?? "",
          citations: (r?.citations ?? []).map((c) => c.url).filter(Boolean).slice(0, 5),
        };
      } catch (e) {
        log.debug("subquery_perplexity_failed_falling_back", {
          query: q,
          err: (e as Error).message,
        });
      }
    }
    try {
      const m = await multiSourceSearch(q, { recency: "month" });
      return {
        query: q,
        content: m.consensus ?? m.sources[0]?.content ?? "",
        citations: m.citations.map((c) => c.url).filter(Boolean).slice(0, 5),
      };
    } catch (e) {
      log.debug("subquery_failed", { query: q, err: (e as Error).message });
      return { query: q, content: "", citations: [] as string[] };
    }
  };

  const roundResults = await Promise.all(subQueries.map(runSubQuery));

  const successful = roundResults.filter((r) => r.content);

  // 2b. AG-44 · PAGE-READING. Search snippets are ~2-3 sentences per
  // source — the report synthesized from them is a summary of
  // summaries. Read the top cited pages in FULL (max 3, one per
  // distinct host so three cites of one domain don't eat the budget),
  // fenced as untrusted external content. Firecrawl unkeyed or a
  // scrape failing → skip silently; the search rounds still stand.
  const pageRounds: typeof roundResults = [];
  try {
    const { isFirecrawlConfigured, scrapeUrl } = await import("@/lib/integrations/firecrawl");
    if (isFirecrawlConfigured() && successful.length > 0) {
      const seenHosts = new Set<string>();
      const targets: string[] = [];
      for (const url of successful.flatMap((r) => r.citations)) {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "");
          if (seenHosts.has(host)) continue;
          seenHosts.add(host);
          targets.push(url);
        } catch { /* malformed citation URL · skip */ }
        if (targets.length >= 3) break;
      }
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
      const reads = await Promise.all(targets.map(async (url) => {
        try {
          const page = await scrapeUrl(url, { maxLength: 6000 });
          if (!page.markdown?.trim()) return null;
          return {
            query: `full page · ${page.title ?? url}`,
            content: fenceContent("deep-research-page-read", "external_web", page.markdown.slice(0, 6000)),
            citations: [url],
          };
        } catch (e) {
          log.debug("page_read_failed", { url, err: (e as Error).message });
          return null;
        }
      }));
      pageRounds.push(...reads.filter((r): r is NonNullable<typeof r> => r !== null));
    }
  } catch (err) {
    log.debug("page_reading_skipped", { err: err instanceof Error ? err.message : String(err) });
  }

  // 2c. AG-44 · GAP-CHECK. One cheap classify call: given what the
  // rounds already cover, name up to 2 missing angles → run them as
  // extra sub-queries. Bounded: plan≤5 + scrape≤3 + gap≤2 is the
  // whole budget; a failed gap-check costs nothing.
  let gapRounds: typeof roundResults = [];
  if (successful.length > 0) {
    try {
      const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
      const aiChat = makeTracedAiChat("deep-research", "brain");
      const covered = successful.map((r) => `- ${r.query}: ${r.content.slice(0, 150)}`).join("\n");
      const reply = await aiChat(
        [
          {
            role: "system",
            content: `You are a research completeness checker. Given a question and what searches already covered, output STRICT JSON {"gaps": ["query", ...]} — at most 2 NEW search queries for material angles the coverage missed. If coverage is adequate, output {"gaps": []}. JSON only.`,
          },
          { role: "user", content: `QUESTION: ${args.question.slice(0, 800)}\n\nCOVERED:\n${covered.slice(0, 3000)}` },
        ],
        "classify",
      );
      const m = (reply?.content ?? "").match(/\{[\s\S]*\}/);
      const gaps: string[] = m
        ? ((JSON.parse(m[0])?.gaps ?? []) as unknown[])
            .filter((g): g is string => typeof g === "string" && g.trim().length > 0)
            .slice(0, 2)
        : [];
      if (gaps.length > 0) {
        log.info("gap_check_queries", { gaps });
        gapRounds = (await Promise.all(gaps.map(runSubQuery))).filter((r) => r.content);
      }
    } catch (err) {
      log.debug("gap_check_skipped", { err: err instanceof Error ? err.message : String(err) });
    }
  }

  const allRounds = [...successful, ...pageRounds, ...gapRounds];

  // 3. Synthesize
  const synthStart = Date.now();
  let synthesis = "";
  let synthFailed = false;
  if (allRounds.length > 0) {
    synthesis = await synthesize({ question: args.question, rounds: allRounds }).catch(
      (err) => {
        void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.deep-research", err, { fn: "runDeepResearch.synthesize" })).catch((e) => console.error(e));
        synthFailed = true;
        return "";
      },
    );
  } else {
    synthFailed = true;
  }
  const synthMs = Date.now() - synthStart;

  // Flatten unique citations (page-read + gap rounds included)
  const allCitations = Array.from(
    new Set([...roundResults, ...pageRounds, ...gapRounds].flatMap((r) => r.citations)),
  );

  // Phase T · N.6 telemetry · record persona usage for the planner +
  // synthesizer so scorePersonas() can compute per-persona verdicts
  // for the deep-research stack too (previously only multi-agent
  // fan-out fed the scorer). Confidence is implied from success: a
  // planner that returned subQueries gets 0.7 · failed gets 0.2. Same
  // implied-confidence pattern as engine.ts runMultiAgent.
  void (async () => {
    try {
      const { recordPersonaUsage } = await import("@/lib/ai/personas/scorer");
      await recordPersonaUsage({
        personaKey: RESEARCH_PLANNER.key,
        parentTier: "deep-research",
        parentConfidence: plannerFailed ? 0.2 : 0.7,
        durationMs: plannerMs,
      });
      await recordPersonaUsage({
        personaKey: RESEARCH_SYNTHESIZER.key,
        parentTier: "deep-research",
        parentConfidence: synthFailed ? 0.2 : 0.7,
        durationMs: synthMs,
      });
    } catch (err) {
      /* best-effort */
      logError("ai.deep-research", err, { fn: "runDeepResearch.recordPersonaUsage" });
    }
  })();

  // AG-34 · persist non-empty reports so the spendy pipeline compounds:
  // a 5-search cited report used to vanish with the chat turn. The
  // BrainMemory write also triggers the standard embedding pipeline,
  // which is what findRecentReport's semantic reuse rides on.
  if (synthesis) {
    try {
      const { brainMemory } = await import("@/lib/brain/memory-manager");
      await brainMemory.remember(
        "deep_research",
        `research_${Date.now()}`,
        synthesis.slice(0, 800),
        "deep-research",
        { question: args.question, citations: allCitations.slice(0, 10) },
      );
    } catch (err) {
      log.warn("report_persist_failed", { err: (err as Error).message });
    }
  }

  return {
    question: args.question,
    plan: subQueries,
    // AG-44 · page-read + gap rounds ride along so the persisted
    // report and the /research Telegram render show the full chain.
    rounds: [...roundResults, ...pageRounds, ...gapRounds],
    synthesis,
    allCitations,
    durationMs: Date.now() - startedAt,
  };
}
