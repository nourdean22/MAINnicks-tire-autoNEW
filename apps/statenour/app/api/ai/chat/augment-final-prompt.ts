/**
 * app/api/ai/chat/augment-final-prompt.ts — chat-route decomposition
 * slice (2026-07-25). The final-system-prompt augmentation stack moved
 * VERBATIM from route.ts, in the exact original append order:
 *
 *   1. chat-layer prompt (Anthropic-only Greene-law library + business
 *      naming + ACTION_CATALOG; Ollama/Gemini keep the truncated prompt)
 *   2. multi-output mode addendum (/all /ab /reformat /twopass /carousel)
 *   3. content-feedback recall (content turns only; never blocks)
 *   4. NICK_HIGH_SPEC_GATE specificity directive (env-gated)
 *   5. customer-shape hint (regex-detected; anti-fabrication)
 *   6. GSC pre-fetch + inject (SEO turns; real numbers in-context)
 *
 * Error semantics preserved: content-feedback swallows its own errors
 * (supplementary), the high-spec/customer/gsc steps throw through to
 * the route's outer try/catch exactly as before (buildGscPrefetch was
 * always awaited bare inline).
 */

import { ACTION_CATALOG } from "@/lib/ai/nick-agent";
import type { classifyTurn } from "@/lib/ai/turn-intelligence";
import type { logger as rootLogger } from "@/lib/logger";

type Logger = ReturnType<typeof rootLogger.withSurface>;

export async function augmentFinalPrompt(args: {
  systemPrompt: string;
  provider: string;
  greeneSummary: string | null | undefined;
  strategicLawCount: number;
  userContent: string;
  contentMode: boolean;
  turnSignal: ReturnType<typeof classifyTurn>;
  log: Logger;
}): Promise<string> {
  const {
    systemPrompt,
    provider,
    greeneSummary,
    strategicLawCount,
    userContent,
    contentMode,
    turnSignal,
    log,
  } = args;

  // For Ollama/Gemini (small context), use just the truncated system prompt — it already has Nick's identity
  // For Anthropic (large context), append the full chat-layer identity + Greene laws
  const chatLayerPrompt = (provider === "ollama" || provider === "gemini") ? systemPrompt : `${systemPrompt}

# NICK — Chief of Staff, NOUR OS (Chat Layer)

${greeneSummary ? `## Greene Strategic Law Library (${strategicLawCount} laws loaded)
When analyzing patterns, decisions, or strategy, reference specific laws by [BOOK #NUMBER] format.
For business situations, apply the shopApplication. For personal situations, apply the nourApplication.
Be specific: not "consider Law 28" but "Law 28 (Enter Action with Boldness) — your 3 pending estimates need follow-up calls TODAY."

### Law Index:
${greeneSummary}` : ""}

## Business naming conventions
- **Auto Labor Guide** = the CRM at nickstire.org/admin (leads, estimates, invoices, scheduling, callbacks). Always call it by name.
- **Revenue pipeline**: Google Ads/walk-ins/calls → Auto Labor Guide estimates → invoices → revenue. #1 leak = unfollowed estimates.

## Action engine
${ACTION_CATALOG}

Reference Greene Laws ONLY on strategic decisions, not casual messages.`;

  // v6 · BATCH 3 · Apr 28 — Multi-output mode addendum.
  // Detect /all, /ab, /reformat, /twopass, /carousel slash commands and
  // append the matching shape template to the system prompt. The model
  // still produces a single stream, but it's structured so the chat
  // surface can render multiple cards from one response.
  const { detectMultiMode, buildMultiPromptAddendum } = await import("@/lib/ai/content-multi");
  const multiCtx = detectMultiMode(userContent);
  const multiAddendum = multiCtx ? buildMultiPromptAddendum(multiCtx) : "";
  let finalSystemPrompt = multiAddendum
    ? `${chatLayerPrompt}\n\n${multiAddendum}`
    : chatLayerPrompt;
  if (multiCtx) {
    log.info("multi_output_mode", { mode: multiCtx.mode, subject: multiCtx.subject.slice(0, 60) });
  }

  // AG-15 · content-feedback RECALL. detectContentFeedback has CAPTURED
  // Nour's reactions to generated content since Apr 28 (persist-assistant-
  // turn.ts), but the read half — recallRecentContentFeedback +
  // buildFeedbackPromptBlock — had zero call-sites: the "compounding
  // voice" loop was write-only. On content turns, his recent reactions
  // now ride into the prompt.
  if (contentMode) {
    try {
      const { recallRecentContentFeedback, buildFeedbackPromptBlock } = await import(
        "@/lib/ai/content-feedback"
      );
      const feedbackBlock = buildFeedbackPromptBlock(await recallRecentContentFeedback());
      if (feedbackBlock) {
        finalSystemPrompt += `\n\n${feedbackBlock}`;
        log.info("content_feedback_recalled", { chars: feedbackBlock.length });
      }
    } catch {
      // Supplementary voice context — never blocks the stream.
    }
  }

  // v10.0.499 · ADR-0011 Tier 2-lite · high-specificity gate.
  //
  // When NICK_HIGH_SPEC_GATE=on (env flag · default off · reversible),
  // factual/decision/instructional/procedural/analytical turns get a
  // preemptive specificity directive prepended to the system prompt.
  // This is the smaller-cost version of Tier 2 · no probe call, no
  // regen, no double LLM cost · just a harder prompt on the turns
  // that need specifics most.
  //
  // If the chat-quality dashboard shows spec axis rising from 50 →
  // 65+ over a 7-day window with this enabled, the full Tier 2
  // (with auto-regen winner-selection) is unnecessary. If it doesn't
  // move the needle · the full path with UI-stream-compat is
  // justified.
  //
  // Skill stance: prompt-engineering + error-handling-patterns +
  // kaizen (smallest reversible change that tests the hypothesis).
  if (process.env.NICK_HIGH_SPEC_GATE === "on") {
    const { shouldGateForIntent, REGEN_SYSTEM_PREFIX } = await import(
      "@/lib/ai/chat/pre-stream-regen"
    );
    const intent = turnSignal.intent as Parameters<typeof shouldGateForIntent>[0];
    if (shouldGateForIntent(intent)) {
      // Append the hard directive so the static system prompt prefix remains cached.
      finalSystemPrompt = `${finalSystemPrompt}\n\n${REGEN_SYSTEM_PREFIX}`;
      log.info("high_spec_gate_active", {
        intent,
        addedChars: REGEN_SYSTEM_PREFIX.length,
      });
    }
  }

  // v10.0.503 · ADR-0011 Tier 3 surfacing fix · customer-shape hint.
  // Even with the findCustomer tool registered, the model would
  // sometimes hallucinate customer details rather than calling the
  // tool · the description-clarity gap diagnosed at v10.0.494. This
  // detector recognizes customer-shaped user content (10-digit phone,
  // name patterns, ownership phrasing) and INJECTS a hard hint to
  // call findCustomer first.
  //
  // The detector is cheap (regex · zero AI cost · <1ms) and the hint
  // only fires on matches · non-customer turns stay unchanged.
  // Always-on (no env flag) because the cost of a wrong fabrication
  // is much higher than the cost of an extra tool call.
  const userTextSlice = userContent.slice(0, 1500);
  const { buildCustomerShapeHint } = await import("./customer-shape-hint");
  const customerHint = buildCustomerShapeHint(userTextSlice);
  if (customerHint) finalSystemPrompt = finalSystemPrompt + "\n\n" + customerHint;

  // v10.0.511 · GSC pre-fetch + inject · the 2026-05-12 smoke tests
  // showed venice-uncensored consistently ignores the tool-call-first
  // directive on SEO queries even when getGscSummary is in the toolset
  // (post v10.0.510 pruner expansion). The model invents narratives
  // about "Google logging errors" instead of calling the tool.
  //
  // This pre-fetch bypasses the model's tool-call decision entirely:
  // when SEO/GSC regex matches the user content, we call queryNick
  // ourselves BEFORE streamText runs and inject the JSON result as a
  // system-prompt addendum. The model has the real numbers in its
  // context · fabrication becomes structurally impossible.
  //
  // If the call fails or returns no data, we inject a "NO DATA AVAILABLE"
  // block so the model says that instead of fabricating.
  //
  // Cost: 1 extra bridge call per matching turn (~200-500ms). Latency
  // hit is acceptable for the failure-mode it eliminates.
  const { buildGscPrefetch } = await import("./gsc-prefetch");
  const gscBlock = await buildGscPrefetch(userTextSlice);
  if (gscBlock) finalSystemPrompt = finalSystemPrompt + "\n\n" + gscBlock;

  return finalSystemPrompt;
}
