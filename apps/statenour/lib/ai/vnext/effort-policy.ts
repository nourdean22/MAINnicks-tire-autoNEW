/**
 * NICK VNEXT · capability/effort router — SHADOW (2026-08-11).
 *
 * Routes by CAPABILITY NEED instead of provider order: the question is
 * no longer "which provider do I try first?" but "what level of
 * intelligence / effort / trust-boundary does this task require?".
 * Pure function, wired to NO live path yet — the incumbent
 * TASK_ROUTING_PREFERENCES chain keeps serving production until this
 * router wins its eval (additive-migration rule: delete a legacy layer
 * only after it loses an A/B).
 *
 * Model facts (verified against the installed @ai-sdk/anthropic ^3.0.64,
 * which exposes effort low|medium|high|xhigh|max + taskBudget):
 *   · claude-fable-5  — frontier, safety classifier ON. $10/$50 per MTok.
 *   · claude-mythos-5 — same weights, classifier-free, but LIMITED TO
 *     APPROVED ORGS (Project Glasswing). Never assumed available: gated
 *     behind ANTHROPIC_MYTHOS_ENABLED=1, an operator attestation that
 *     access actually exists. Untrusted content NEVER routes here.
 *   · claude-opus-5   — strong-cheap lane (released 2026-07-24 at
 *     unchanged Opus pricing). Default for "hard" until the bake-off
 *     (mythos-xhigh vs opus-5) produces eval data.
 *
 * Effort is pinned per conversation because changing effort invalidates
 * the Anthropic prompt cache — at frontier pricing, cache-hit rate is a
 * top cost lever.
 */

import { isClaude5ThinkingModel } from "@/lib/ai/claude5-compat";

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type CapabilityBand =
  | "deterministic" // math, parsing, known rules — no LLM at all
  | "trivial"       // classify / extract / short rewrite — fast lane
  | "normal"        // everyday chat, simple tools
  | "strategic"     // ambiguity, research, non-trivial tool chains
  | "hard"          // high-value long-horizon work, difficult code
  | "frontier";     // hardest problems where value >> incremental cost

export const CLAUDE5_MODELS = {
  fable: "claude-fable-5",
  mythos: "claude-mythos-5",
  opus: "claude-opus-5",
} as const;

export type Claude5ModelId = (typeof CLAUDE5_MODELS)[keyof typeof CLAUDE5_MODELS];

export interface RouteInput {
  band: CapabilityBand;
  /** Web/Drive/email/unknown-sender content in the turn → classifier is a FEATURE. */
  untrustedInput?: boolean;
  /** Effort already committed for this conversation (prompt-cache stability). */
  conversationEffort?: ClaudeEffort;
  /** Operator attestation of Mythos org access. Defaults to ANTHROPIC_MYTHOS_ENABLED=1. */
  mythosEnabled?: boolean;
}

export interface RouteDecision {
  /** "none" = deterministic code path · "fast" = existing OLLAMA_FAST lane · "claude5" = frontier lane. */
  lane: "none" | "fast" | "claude5";
  model?: Claude5ModelId;
  effort?: ClaudeEffort;
  /** Frontier max-effort runs must be justified by the caller (scarce weapon, never a default). */
  justify?: true;
  rationale: string;
}

export function routeCapability(input: RouteInput): RouteDecision {
  const mythosEnabled = input.mythosEnabled ?? process.env.ANTHROPIC_MYTHOS_ENABLED === "1";

  if (input.band === "deterministic") {
    return { lane: "none", rationale: "deterministic work — no LLM (cheapest correct path)" };
  }

  // Trust boundary outranks band: untrusted content gets the classifier
  // ON (fable), quarantine-read semantics, regardless of Mythos access.
  if (input.untrustedInput) {
    return pinEffort(input, {
      lane: "claude5",
      model: CLAUDE5_MODELS.fable,
      effort: "medium",
      rationale:
        "untrusted input → fable-5 with classifier ON (a feature on this surface; untrusted content never routes to mythos)",
    });
  }

  if (input.band === "trivial") {
    return {
      lane: "fast",
      rationale:
        "high-frequency trivial transform → existing fast lane (OLLAMA_FAST_MODEL); frontier tokens here are 10-50x waste",
    };
  }

  const primary = mythosEnabled ? CLAUDE5_MODELS.mythos : CLAUDE5_MODELS.fable;
  const primaryNote = mythosEnabled
    ? "mythos-5 (operator-attested org access)"
    : "fable-5 (mythos not attested — ANTHROPIC_MYTHOS_ENABLED unset)";

  switch (input.band) {
    case "normal":
      return pinEffort(input, {
        lane: "claude5",
        model: primary,
        effort: "medium",
        rationale: `default turn → ${primaryNote} · medium`,
      });
    case "strategic":
      return pinEffort(input, {
        lane: "claude5",
        model: primary,
        effort: "high",
        rationale: `strategy/research → ${primaryNote} · high`,
      });
    case "hard":
      // Bake-off pending (mythos-xhigh vs opus-5 per task-class). Opus 5
      // is the strong-cheap default until eval data says otherwise —
      // do not hard-code a winner from marketing claims.
      return pinEffort(input, {
        lane: "claude5",
        model: CLAUDE5_MODELS.opus,
        effort: "high",
        rationale: "hard work → opus-5 · high (strong-cheap default; bake-off vs mythos-xhigh pending eval data)",
      });
    case "frontier":
      return {
        lane: "claude5",
        model: CLAUDE5_MODELS.fable,
        effort: "max",
        justify: true,
        rationale: "frontier difficulty → fable-5 · max (must be justified per-run; never the default)",
      };
  }
}

/**
 * Hold effort constant within a conversation — changing effort breaks
 * the Anthropic prompt-cache prefix. Frontier (justify) runs are exempt:
 * they belong in their own child run, not the cached conversation.
 */
function pinEffort(input: RouteInput, decision: RouteDecision): RouteDecision {
  if (!input.conversationEffort || decision.lane !== "claude5" || decision.justify) return decision;
  if (decision.effort === input.conversationEffort) return decision;
  return {
    ...decision,
    effort: input.conversationEffort,
    rationale: `${decision.rationale} · effort pinned to conversation value (changing effort invalidates the prompt cache)`,
  };
}

// ---------------------------------------------------------------------------
// Deep-mode canary (2026-08-11) — the FIRST live wiring of this module.
// NICK_CANARY_DEEP_ANTHROPIC=1 sends deep-mode chat turns to the Anthropic
// lane first (which ANTHROPIC_MODEL now resolves to claude-fable-5) at
// effort "high". Degrades safely on two axes, both incumbent patterns:
//   · no ANTHROPIC_API_KEY → getModel() skips the lane entirely (same as
//     the dormant high-stakes anthropic pin in the chat route);
//   · fallback rotation to a non-5-family model → no effort param is sent
//     (per-attempt gate on the resolved model id).
// ---------------------------------------------------------------------------

/**
 * Provider force for the deep-mode canary. Slots in as the LAST fallback in
 * the chat route's force precedence (tool-mandatory force and the user's
 * validated override always win).
 */
export function canaryDeepForce(
  mode: string,
  enabled = process.env.NICK_CANARY_DEEP_ANTHROPIC === "1",
): "anthropic" | undefined {
  return enabled && mode === "deep" ? "anthropic" : undefined;
}

/**
 * Per-attempt effort injection for the canary. Returns an effort ONLY when
 * the attempt actually resolved a Claude 5 thinking model — a rotation to
 * sonnet-5 or any other lane must never carry a stray effort param.
 */
export function claude5EffortForAttempt(input: {
  mode: string;
  modelId: string;
  enabled?: boolean;
}): ClaudeEffort | undefined {
  const enabled = input.enabled ?? process.env.NICK_CANARY_DEEP_ANTHROPIC === "1";
  if (!enabled || input.mode !== "deep") return undefined;
  return isClaude5ThinkingModel(input.modelId) ? "high" : undefined;
}
