/**
 * lib/ai/vnext/escalation.ts — deterministic frontier ESCALATION for chat
 * (2026-08-28).
 *
 * OPERATOR DECISION THIS IMPLEMENTS: "keep ollama but escalate". Ollama
 * Cloud stays the base lane for every turn — the $0 doctrine and the
 * measured ~$1.05/mo marginal spend are unchanged. A turn only reaches a
 * metered frontier model when the operator ASKED for depth, in words the
 * system can recognise without spending a token to decide.
 *
 * WHY THE TRIGGER IS MARKER-BASED AND NOT A COMPLEXITY CLASSIFIER.
 * The obvious design — classify difficulty from the message and escalate
 * the hard ones — was measured and REJECTED on 2026-08-28:
 *   · `classifyCore` (lib/ai/reasoning/classifier-core.ts) answers "does
 *     this need the deep-reasoning PIPELINE", not "how hard is this". Its
 *     unmarked fallthrough returns "quick" for anything under 200 chars
 *     with fewer than 2 sub-questions (classifier-core.ts:130-136).
 *   · Measured on prod: p50 operator message is 64 chars, and 371 of 655
 *     user turns in 30 days (56.6%) are under 80 chars.
 *   · Worked example: "audit the whole chat stack and tell me what's
 *     broken, then rank fixes by leverage" (78 chars) classifies "quick".
 * A length-sensitive classifier would therefore under-escalate exactly
 * the terse, high-stakes asks this operator actually sends. Predicting
 * difficulty from a 64-character median message is not a solvable
 * problem; recognising an explicit request for depth is trivial and
 * exact. So: explicit markers only, and a documented gap list below.
 *
 * WHY THIS HONOURS THE ROUTER'S `justify` INVARIANT RATHER THAN BYPASSING IT.
 * effort-policy.ts states frontier max "must be justified per-run; never
 * the default". An explicit `/mega` / "spare no expense" / "every angle"
 * from the operator IS the per-run justification — the human asked for
 * the biggest hammer by name. Nothing here can reach `max` implicitly,
 * and no conversation-level pin can make it sticky (pinEffort refuses a
 * `max` pin by design).
 *
 * MARKERS ARE IMPORTED, NEVER RE-DECLARED. classifier.ts's H.4 dedup
 * already moved these regexes into classifier-core so client and server
 * share one source of truth; a second copy here would be a cache with no
 * invalidation. If a marker changes there, escalation follows for free.
 */

import {
  DEEP_MARKERS,
  THOROUGH_MARKERS,
  MEGA_MARKERS,
  QUICK_OVERRIDES,
} from "@/lib/ai/reasoning/classifier-core";
import { CLAUDE5_MODELS, type Claude5ModelId, type ClaudeEffort } from "./effort-policy";

export type EscalationTier = "none" | "deep" | "thorough" | "mega";

/** Why an escalation that WOULD have fired did not. Never silent. */
export type EscalationBlocker =
  | "no-api-key"
  | "daily-cap-reached"
  | "disabled-by-operator"
  | "private-mode";

export interface EscalationDecision {
  /** True only when a frontier attempt should actually be made. */
  escalate: boolean;
  tier: EscalationTier;
  model?: Claude5ModelId;
  effort?: ClaudeEffort;
  /** Frontier max is per-run justified — set only for an explicit mega ask. */
  justify?: true;
  /** Operator-readable; surfaced in logs and (when blocked) to the UI. */
  reason: string;
  /** Present when the operator asked for depth and could not get it. */
  blockedBy?: EscalationBlocker;
}

/**
 * Pure tier detection. No IO, no LLM, safe anywhere.
 *
 * Order matches classifier-core's own precedence: an explicit quick
 * override wins outright, then mega > thorough > deep. Deliberately does
 * NOT apply classifier-core's length gates — this asks a different
 * question ("did the operator ask for depth?"), and length is exactly the
 * signal measured to be misleading here.
 */
export function detectEscalationTier(userContent: string): EscalationTier {
  const text = (userContent ?? "").trim();
  if (!text) return "none";
  // An explicit /quick beats every depth marker: the operator gets the
  // last word on their own turn, in both directions.
  if (QUICK_OVERRIDES.some((re) => re.test(text))) return "none";
  if (MEGA_MARKERS.some((re) => re.test(text))) return "mega";
  if (THOROUGH_MARKERS.some((re) => re.test(text))) return "thorough";
  if (DEEP_MARKERS.some((re) => re.test(text))) return "deep";
  return "none";
}

export interface EscalationInput {
  userContent: string;
  /** ANTHROPIC_API_KEY resolved and non-empty. Capability, not hope. */
  apiKeyPresent: boolean;
  /** Escalations already spent in the rolling window. */
  escalationsToday: number;
  /** Hard ceiling; a loop must not be able to bill the operator. */
  dailyCap: number;
  /** Operator kill switch. */
  enabled: boolean;
  /** Private turns never leave the base lane (no persistence semantics). */
  privateMode?: boolean;
  /** Web/Drive/email content in the turn → classifier-ON model is a FEATURE. */
  untrustedInput?: boolean;
  /** Effort already committed this conversation (prompt-cache stability). */
  conversationEffort?: ClaudeEffort;
}

/**
 * Resolve the escalation for one turn.
 *
 * Capability-gated, not hope-gated (blind-spot register #5): with no key
 * the decision is `escalate: false` with an explicit `blockedBy`, so the
 * turn runs on Ollama exactly as today AND the operator can see why the
 * depth they asked for did not happen. A silent downgrade here would
 * recreate the five-silent-gates defect this work exists to end.
 */
/**
 * Escalation kill-switch. ★ INVERTED NAME: the env var is
 * NICK_ESCALATION_DISABLED, so escalation is ENABLED unless it is "1".
 *
 * 2026-09-18 · lifted out of app/api/ai/chat/route.ts so the flag-board mirror
 * can verify it by CALLING it, and so the polarity lives next to the logic it
 * gates instead of inline in a route (review, #2429).
 */
export function isEscalationEnabled(): boolean {
  return process.env.NICK_ESCALATION_DISABLED !== "1";
}

export function resolveEscalation(input: EscalationInput): EscalationDecision {
  const tier = detectEscalationTier(input.userContent);
  if (tier === "none") {
    return { escalate: false, tier, reason: "no depth marker — base lane (ollama)" };
  }

  const blocked = (blockedBy: EscalationBlocker, reason: string): EscalationDecision => ({
    escalate: false,
    tier,
    blockedBy,
    reason,
  });

  // Order matters: report the FIRST reason the operator can act on.
  if (!input.enabled) {
    return blocked("disabled-by-operator", `${tier} requested · escalation is switched off`);
  }
  if (input.privateMode) {
    return blocked("private-mode", `${tier} requested · private turns stay on the base lane`);
  }
  if (!input.apiKeyPresent) {
    return blocked(
      "no-api-key",
      `${tier} requested · no ANTHROPIC_API_KEY — set it on Railway statenour-web to enable`,
    );
  }
  if (input.escalationsToday >= input.dailyCap) {
    return blocked(
      "daily-cap-reached",
      `${tier} requested · daily escalation cap reached (${input.escalationsToday}/${input.dailyCap})`,
    );
  }

  // Trust boundary outranks tier, mirroring routeCapability: untrusted
  // content always gets the classifier-ON model, never mythos, and never
  // the justify-gated max tier — an injected "spare no expense" must not
  // be able to spend the operator's biggest hammer.
  if (input.untrustedInput) {
    return {
      escalate: true,
      tier,
      model: CLAUDE5_MODELS.fable,
      effort: pin(input.conversationEffort, "high"),
      reason: `${tier} + untrusted input → fable-5 (classifier ON) · high`,
    };
  }

  if (tier === "mega") {
    // The ONLY path to max, and only on an explicit operator ask, which
    // is itself the per-run justification the router requires.
    return {
      escalate: true,
      tier,
      model: CLAUDE5_MODELS.fable,
      effort: "max",
      justify: true,
      reason: "explicit mega ask → fable-5 · max (operator request is the per-run justification)",
    };
  }

  // deep + thorough → the strong-cheap lane. Opus 5 is half Fable's input
  // price and a quarter of its output price; reserving fable for mega
  // keeps an explicit "biggest hammer" meaningfully bigger than the
  // everyday depth request.
  return {
    escalate: true,
    tier,
    model: CLAUDE5_MODELS.opus,
    effort: pin(input.conversationEffort, "high"),
    reason: `${tier} ask → opus-5 · ${pin(input.conversationEffort, "high")}`,
  };
}

/**
 * Hold effort constant within a conversation — changing it mid-thread
 * invalidates the Anthropic prompt-cache prefix, and input dominates this
 * app's bill 36:1 (measured). A pinned `max` is ignored on purpose: max is
 * justify-gated per run and must never become a conversation default.
 */
function pin(conversationEffort: ClaudeEffort | undefined, fallback: ClaudeEffort): ClaudeEffort {
  if (!conversationEffort || conversationEffort === "max") return fallback;
  return conversationEffort;
}

/**
 * Hard ceiling on metered escalations per rolling day.
 *
 * Sized against measured volume: 626 assistant turns / 30 days = ~21/day,
 * and only marker-carrying turns escalate at all. 20 is therefore well
 * above any honest day's demand while still bounding a runaway — the cap
 * exists to stop a LOOP, not to ration the operator. At the opus-5 rate
 * and this app's measured ~24k input / ~676 output per turn, 20
 * escalations is roughly $2.90 of exposure in the worst case.
 * Override with NICK_ESCALATION_DAILY_CAP.
 */
export const ESCALATION_DAILY_CAP = (() => {
  const raw = Number((process.env.NICK_ESCALATION_DAILY_CAP ?? "").trim());
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
})();

/**
 * Escalations already spent today, counted from the SPEND RECORD itself
 * (`ai_generations` rows on the anthropic provider) rather than a
 * bespoke counter.
 *
 * Deliberate: a separate counter is a second source of truth that can
 * drift from the bill. Counting the actual generations means the cap is
 * enforced against what was really spent, and it needs no new table.
 *
 * TWO MEASURED IMPRECISIONS, stated rather than glossed. The chat row is
 * written by recordInteraction from deferred-background-work.ts:104, and:
 *   1. it is skipped when `userContent.length < 40` (isLightweight), so a
 *      very short marked ask ("/mega go") escalates WITHOUT consuming
 *      budget; and
 *   2. it is written POST-turn and fire-and-forget, so two escalations
 *      seconds apart can both read a stale count.
 * Both are acceptable because of what this cap is FOR: bounding a
 * runaway, not rationing precisely. Neither hole is reachable by an
 * automated loop — escalation requires marker text in an operator-sent
 * message, and a scheduled follow-up cannot escalate (it never calls
 * this path). A human typing "/mega" repeatedly is not the threat model.
 * If precise accounting is ever needed, write the resolved lane into
 * ChatMessage.routerReason from the streaming persist path and count
 * that instead — it is a single, always-written row per turn.
 *
 * FAILS CLOSED. If the count cannot be read, this returns the cap — so
 * escalation is refused rather than allowed. That is the opposite of
 * getAiConfig()'s deliberate fail-OPEN (lib/settings/ai-config.ts:124,
 * "DB unreachable -> fall back to defaults so chat still works"), and the
 * inversion is the point: chat degrading to the free lane is harmless,
 * an unbounded metered lane is not.
 */
export async function countEscalationsToday(): Promise<number> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    // Counted by MODEL, not provider: `ai_generations` has no provider
    // column (schema.prisma: feature / model / status / conversationId /
    // createdAt only), and the model list is the more precise question
    // anyway — a non-escalation anthropic fallback to sonnet-5 must not
    // consume the escalation budget.
    //
    // 2026-08-28 · MATCH ON A SUFFIX, NOT AN EQUALITY. The chat path
    // records this column through recordInteraction as
    // `${provider}/${model}` (lib/ai/memory.ts:55) — e.g.
    // "anthropic/claude-opus-5". An `in:` list of bare ids therefore
    // matched NOTHING and the cap was a dead guard: every marked turn
    // could keep spending past it. Caught in review; verified at the
    // writer before fixing. `endsWith` covers both the prefixed chat
    // rows and any writer that stores the bare id.
    return await prisma.aiGeneration.count({
      where: {
        createdAt: { gte: since },
        OR: [CLAUDE5_MODELS.opus, CLAUDE5_MODELS.fable, CLAUDE5_MODELS.mythos].flatMap((m) => [
          { model: m },
          { model: { endsWith: `/${m}` } },
        ]),
      },
    });
  } catch {
    return ESCALATION_DAILY_CAP;
  }
}

/**
 * Markers this deliberately does NOT recognise, recorded so the gap is a
 * known quantity rather than a surprise. Each is a phrasing that reads as
 * a depth request to a human but matches no marker today:
 *   "audit …", "figure out why …", "get to the bottom of …",
 *   "what am I missing", "check everything".
 * Adding one is a one-line change in classifier-core's marker arrays,
 * which this module imports — but it widens the DEEP-REASONING pipeline's
 * trigger too, so it is a deliberate joint decision, not a local tweak.
 */
export const KNOWN_UNMATCHED_DEPTH_PHRASINGS = [
  "audit",
  "figure out why",
  "get to the bottom of",
  "what am I missing",
  "check everything",
] as const;
