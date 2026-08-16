/**
 * POST /api/ai/page-insight
 *
 * The universal "analyze this page" endpoint. Every mastery page that
 * has data can drop in a <PageNick> component which POSTs its current
 * state here and streams back Nick's analysis.
 *
 * Body:
 *   {
 *     page: string        // route identifier, e.g. "body", "financial"
 *     focus?: string      // optional focus area, e.g. "last 7 days"
 *     data: unknown       // current page state — whatever is visible
 *     question?: string   // optional specific question
 *   }
 *
 * Returns a streaming text response — provider-routed (task=reason,
 * whatever getModel resolves; OpenRouter is primary), 600 tokens max,
 * using the full system prompt so Nick has context
 * about who Nour is while analyzing page-specific data.
 */

import { streamText } from "ai";
import { getModel, GEMINI_SAFETY_OFF } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { getCachedPrompt, setCachedPrompt } from "@/lib/ai/system-prompt-cache";
import { getActiveProviderInfo } from "@/lib/ai/provider";
import { mintTraceId, recordTrace } from "@/lib/ai/agent-trace";
import { recordError } from "@/lib/errors/record-error";
import { buildPageData } from "@/lib/ai/page-data";

import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Page-specific framing so Nick knows what angle to analyze from.
// Each entry is injected into the system prompt BEFORE the data.
const PAGE_FRAMING: Record<string, string> = {
  body: "You are looking at Nour's body data. Workout frequency, energy, weight, sleep. Target is 186 lbs from 230. Connect body discipline to business performance — the workout IS the revenue strategy.",
  financial: "You are looking at Nour's personal financial data. He's making six figures but living like it. Target is $10k/month owner take-home. Call out leaks, suggest one concrete move.",
  decisions: "You are looking at Nour's decision log. Look for patterns: what does he decide well vs poorly? Flag decisions that need replay (made in drift, under stress, or with incomplete data).",
  commitments: "You are looking at Nour's commitments. Keep rate, broken reasons, patterns. A broken commitment is data — not shame.",
  loops: "You are looking at Nour's open loops. More than 8 open = scattered state + poor sleep. Triage aggressively: what can be closed, what should be killed, what's genuinely urgent.",
  mastery: "You are looking at Nour's 10-domain mastery tree. Current average ~4.6/10. Identify the one domain with the highest-leverage single move for the next 7 days.",
  "war-room": "You are looking at the war room — strategic overview, Greene laws, current situation. Recommend the ONE power move for the next 48h.",
  revenue: "You are looking at business revenue data. Target is $20K+/month. Flag decay points: stale leads, aging estimates, dropped follow-ups. Every stale estimate is $300-800 walking out the door.",
  reviews: "You are looking at Google Reviews. Flag negatives needing response, patterns in praise, opportunities to ask more customers.",
  habits: "You are looking at habits. Low streaks predict drift. Suggest the ONE habit to protect + ONE to drop.",
  journal: "You are looking at journal entries. Extract the key emotional arc, hidden patterns, unresolved tensions.",
  crm: "You are looking at the customer CRM. Rank by win-back potential + LTV. Flag customers gone 90+ days.",
  missions: "You are looking at active missions. Call out mission drift, recommend re-anchoring, identify the mission most at risk.",
  cameras: "You are looking at the shop security feeds. Describe what you see, flag anomalies.",
  devices: "You are looking at smart home devices + automations. Suggest automations Nour doesn't have.",
  scrapers: "You are looking at competitor price data. Highlight the most actionable pricing move.",
  margins: "You are looking at pricing + margin data. Flag items bleeding margin, suggest price moves.",
  quotes: "You are looking at quote data. Flag quotes aging out, suggest follow-up moves.",
  tires: "You are looking at tire inventory. Flag short stock, suggest ordering.",
  tasks: "You are looking at active tasks. Rank by impact × ease × freshness. Recommend the next single action.",
  projections: "You are looking at Nour's revenue projections. Flag assumptions that look stale or optimistic. Recommend one correction that brings the forecast closer to reality without killing ambition.",
  causation: "You are looking at a causal analysis graph — what drives what in Nour's system. Find the one upstream variable that, if moved, would cascade through the most downstream metrics.",
  brain: "You are looking at the brain engines + memory system. Surface any engines that look stale, memories that contradict each other, or rules that haven't fired in 7+ days.",
  system: "You are looking at NOUR OS system health — routes, crons, drift, errors. Triage the single most concerning signal first.",
  integrations: "You are looking at the arsenal — connected integrations + their usage patterns. Flag any that are silent (not used in 7 days) or that produce no value-per-dollar.",
};

function describeFraming(page: string): string {
  return (
    PAGE_FRAMING[page] ||
    `You are analyzing the ${page} page. Focus on what's actionable right now.`
  );
}

// Truncate JSON data to keep the prompt reasonable — page data can
// get big (full customer lists, full revenue history, etc.). 8K chars
// is plenty for analysis and keeps the total request under the
// model's context window.
function safeStringify(data: unknown, maxChars = 8000): string {
  try {
    const json = JSON.stringify(data, null, 2);
    if (json.length <= maxChars) return json;
    return json.slice(0, maxChars) + "\n\n... (truncated for token budget)";
  } catch {
    return "[unable to serialize]";
  }
}

export async function POST(req: Request) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    const body = (await req.json()) as {
      page?: string;
      focus?: string;
      data?: unknown;
      question?: string;
    };

    if (!body.page) {
      return Response.json({ error: "page required" }, { status: 400 });
    }

    const { provider, modelId } = getActiveProviderInfo();
    void modelId;

    // Use the cached full system prompt so Nick has Nour's full
    // identity when analyzing — just like chat. Falls back to a
    // minimal prompt if the builder is too slow on this request.
    let systemPrompt = getCachedPrompt(provider, "full");
    if (!systemPrompt) {
      try {
        systemPrompt = await buildSystemPrompt();
        setCachedPrompt(provider, "full", systemPrompt);
      } catch {
        systemPrompt = `You are Nick, Nour's Chief of Staff. Today is ${new Date().toISOString().slice(0, 10)}. Respond with data-first analysis, one concrete action, no fluff.`;
      }
    }

    // Append page-specific framing + the actual data being analyzed.
    // If the client didn't pass `data`, fall back to the server-side
    // builder (buildPageData) which pulls a compact summary from the
    // DB per page. This lets pages either:
    //   - pass live visible state (richer, preferred)
    //   - pass nothing and rely on the server to grab canonical data
    const framing = describeFraming(body.page);
    let dataBlock: string;
    if (body.data !== undefined && body.data !== null) {
      dataBlock = safeStringify(body.data);
    } else {
      const serverData = await buildPageData(body.page).catch(() => "");
      dataBlock = serverData || "(no structured data available)";
    }
    // v10.0.288 · Strategic Frameworks lens injection (12th surface).
    // Page-insight fires Pareto / North-Star-Metric / OODA on page data
    // — keeps "the one thing you should see" framing rigorous.
    let lensBlock = "";
    try {
      const { pickFrameworks, composeStrategicLensBlock } = await import("@/lib/ai/strategic-frameworks");
      const { recordLensFire } = await import("@/lib/ai/strategic-frameworks/record-lens-fire");
      const lensInput = `${body.page} · ${body.focus ?? ""} · ${dataBlock}`.slice(0, 1200);
      lensBlock = composeStrategicLensBlock(lensInput);
      if (lensBlock) {
        const matches = pickFrameworks(lensInput);
        recordLensFire({ surface: "page-insight", matches, lensBlockLength: lensBlock.length, metadata: { page: body.page } });
      }
    } catch {
      // best-effort · lens injection failures shouldn't break the AI call
    }

    // 2026-05-23 · P3 · ADR-0019 first opt-in · explicit operator-state
    // injection. Pre-fix: Nick inferred operator state from text (chat
    // off-limits per directive · so morning brief was the original
    // candidate, but it's pure template · pivoted to page-insight as the
    // smallest LLM surface that benefits from state). State block tells
    // the model the operator's mood/capacity/drift/momentum so the
    // analysis tone matches (no pep-talks when depleted · cut the list
    // when scattered). Best-effort · degrades to no-block on DB error.
    let stateBlock = "";
    try {
      const { currentOperatorState, formatOperatorStateBlock } = await import(
        "@/lib/services/operator-state"
      );
      const snap = await currentOperatorState();
      // Only inject when confidence > 0 · zero-confidence is the
      // cold-start default with no signal · no value in injecting noise.
      if (snap.confidence > 0) {
        stateBlock = formatOperatorStateBlock(snap);
      }
    } catch {
      // best-effort · state injection failures shouldn't break the AI call
    }

    const enrichedPrompt = `${systemPrompt}${lensBlock ? `\n\n${lensBlock}` : ""}${stateBlock ? `\n\n${stateBlock}` : ""}

# PAGE ANALYSIS MODE — ${body.page}
${framing}

## Current page data:
\`\`\`json
${dataBlock}
\`\`\`

${body.focus ? `## Focus: ${body.focus}\n` : ""}

Rules for this analysis:
- Start with ONE sharp observation, not preamble
- Back every claim with a number from the data
- End with ONE specific action for the next 5 minutes
- Keep under 200 words unless the data demands depth
- No "Great question" or "Based on the data" openers`;

    const userPrompt = body.question
      ? body.question
      : `Analyze this ${body.page} page. What's the one thing I should see here that I'm not?`;

    const model = getModel("reason");
    // v10 E.5 — trace this streaming insight call so it shows up in
    // /system/agent-traces alongside chat + cron AI work. Reuses
    // the provider/modelId already captured at the top of the route.
    const traceId = mintTraceId();
    const startedAt = Date.now();
    // wave-fix-2026-05-26 (skill-audit PORT 8 · prompt-caching deepening) ·
    // page-insight was the gap audit found in #127 · main chat route at
    // line 1649 already folds system into messages[0] with Anthropic
    // ephemeral cacheControl, but this route used the raw `system:`
    // parameter which AI SDK doesn't auto-attach providerOptions to.
    // Fold enrichedPrompt into messages[0] as a system message with
    // cacheControl so repeated page-insight calls within Anthropic's
    // 5-min window get 90% input-token cost reduction. The system
    // prompt is the cache-stable portion · userPrompt stays fresh.
    const result = streamText({
      model,
      providerOptions: { google: GEMINI_SAFETY_OFF }, // 2026-07-06 · no Gemini content filtering
      messages: [
        {
          role: "system",
          content: enrichedPrompt,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        { role: "user", content: userPrompt },
      ],
      maxOutputTokens: 600,
      onFinish: async ({ text }) => {
        // Log short empty responses to aid diagnosis
        if (!text || text.trim().length === 0) {
          recordError(
            "chat:stream",
            new Error(`page-insight empty for page=${body.page}`),
            { page: body.page }
          );
        }
        void recordTrace(
          {
            traceId,
            source: "tool",
            label: "page-insight",
            provider,
            model: modelId,
            inputChars: userPrompt.length,
            metadata: { page: body.page, focus: body.focus ?? null },
          },
          {
            durationMs: Date.now() - startedAt,
            outputChars: text?.length ?? 0,
          },
        );
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    recordError("api:unknown", err, { route: "ai/page-insight" });
    return Response.json(
      { error: err instanceof Error ? err.message : "page insight failed" },
      { status: 500 }
    );
  }
}
