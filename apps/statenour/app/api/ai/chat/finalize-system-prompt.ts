/**
 * finalizeSystemPrompt · chat-route extract (2026-05-31)
 *
 * Lifted VERBATIM from app/api/ai/chat/route.ts (the system-prompt
 * finalization block, original lines 1055-1191 / post-context-hints
 * 829-965). Runs AFTER all the brain/context blocks have been appended
 * and BEFORE the streaming `try`. Owns, in order:
 *
 *   1. Per-provider context-window truncation (Venice 65K / Anthropic
 *      120K) with a telemetry log on truncation.
 *   2. Greene strategic-law library load (Anthropic only — skipped for
 *      smaller-context providers). Returns the summary + count so the
 *      caller can fold them into the Anthropic chat-layer prompt.
 *   3. Personality-mode injection (master / builder / friend) appended
 *      LAST so the model weights it most heavily.
 *   4. Turn-aware scaffolds: chain-of-thought + output-shape templates.
 *   5. Citation protocol (only when a brain block fired + not casual).
 *   6. Nour voice guardrails (analytical/decision/creative/reflective/
 *      emotional/instructional intents only).
 *   7. Brevity enforcement (non-deep, non-builder).
 *   8. Universal FORBIDDEN-PHRASES voice guard.
 *   9. Tool-first directive (factual query shapes only).
 *
 * Returns the mutated systemPrompt + greeneSummary + strategicLawCount.
 * The only I/O is the Greene-law DB read (Anthropic path); everything
 * else is pure string assembly. No stream coupling, no closures.
 */

import { prisma } from "@/lib/prisma";
import { trimPromptToBudget } from "@/lib/ai/system-prompt";
import { toolFirstDirective } from "@/lib/ai/query-shape";
import {
  buildChainOfThoughtPrompt,
  buildOutputShapePrompt,
} from "@/lib/ai/turn-intelligence";
import type { TurnSignal } from "@/lib/ai/turn-intelligence";
import { buildCitationPrompt } from "@/lib/ai/memory-citations";
import { buildNourVoicePrompt } from "@/lib/ai/nour-voice-profile";
import { getBehaviorDirective } from "@/lib/ai/knowledge/behavior-directive";
import { buildContractDirective } from "@/lib/ai/response-contract";
import type { ResponseContract } from "@/lib/ai/response-contract";
import { SPAR_MODE } from "@/lib/ai/prompt/policy/spar-mode";
import { EARLY_SPAR } from "@/lib/ai/chat/handlers/patterns";
import type { ChatMode } from "@/lib/ai/chat-mode";
import type { ContextBlocksFired } from "@/lib/services/chat/brain-context";

interface ChatLogger {
  info(event: string, ctx?: Record<string, unknown>): void;
}

export interface FinalizeSystemPromptInput {
  /** The system prompt assembled so far (base + all context blocks). */
  systemPrompt: string;
  /** Active provider name — drives truncation cap + Greene-law load. */
  provider: string;
  /** Persona key from the gate ("master" | "builder" | "friend" | ...). */
  personality: string;
  /** Raw user message this turn — drives the behavior directive's
   *  strict-mode escape (/strict, "just answer", etc.). */
  userContent: string;
  /** Turn classifier output — drives CoT/shape/citation/voice gating. */
  turnSignal: TurnSignal;
  /** Brain-block fire flags — gate the citation protocol. */
  contextBlocksFired: ContextBlocksFired;
  /** Chat mode — gates brevity enforcement. */
  mode: ChatMode;
  /** Query-shape result — drives the tool-first directive. */
  queryShape: Parameters<typeof toolFirstDirective>[0];
  /** AG-11 · Per-turn response contract (answerMode, rank counts,
   *  clarifying-question policy). Optional — buildContractDirective
   *  returns "" for unconstrained turns, so this is zero-cost on
   *  casual chat. */
  contract?: ResponseContract;
  log: ChatLogger;
}

export interface FinalizeSystemPromptOutput {
  /** The finalized system prompt, ready to feed into the chat-layer prompt. */
  systemPrompt: string;
  /** Greene-law index summary (empty unless Anthropic + laws loaded). */
  greeneSummary: string;
  /** Number of Greene laws loaded (0 unless Anthropic). */
  strategicLawCount: number;
}

export async function finalizeSystemPrompt(
  input: FinalizeSystemPromptInput,
): Promise<FinalizeSystemPromptOutput> {
  const { provider, personality, userContent, turnSignal, contextBlocksFired, mode, queryShape, log } =
    input;
  let systemPrompt = input.systemPrompt;

  // Context window limits per provider
  // Venice GLM-4.7-flash: 128K total. Budget split (Apr 15 refactor):
  //   - System prompt: 65K (raised from 50K after the cold memory +
  //     engine cap work. The trimmed builder sits around 65K with
  //     breathing room. Anything beyond that reaches Nick via the
  //     searchColdMemory tool, so inline truncation is no longer the
  //     bottleneck it was.)
  //   - Tools + pruned catalog: ~8K typical, ~45K in full deep mode
  //     (pruning keeps standard mode lean)
  //   - Messages + conversation: 10-25K
  //   - Tool results: 5-15K
  //   - Output tokens: 2-8K
  //   Total worst case: 65 + 45 + 25 + 15 + 8 = 158K — OVER 128K.
  //   Deep mode IS the risk — but deep mode is rare and the model
  //   handles 128K context gracefully by dropping oldest messages.
  // Anthropic Claude Sonnet 4.6: ~200K, system prompt can take 120K.
  const MAX_SYSTEM_CHARS = provider === "anthropic" ? 120000 : 65000;
  if (systemPrompt.length > MAX_SYSTEM_CHARS) {
    // 2026-07-12 review · was a blind `slice(0, MAX)` that amputated the
    // business-knowledge layer MID-SENTENCE on content/deep asks (which run
    // 77-135K before this cap). Use the section-aware trimmer instead: it
    // drops whole `## ` sections by priority — and now protects the TRUTH
    // RULE / operator rules / Tools (getSectionPriority, 2026-07-11) — so
    // the cut lands on a section boundary, dropping the lowest-value blocks
    // (cold memory, brain dumps, knowledge sub-blocks) rather than slicing a
    // guardrail in half. Falls back to a marked slice only if the protected
    // core alone still exceeds the cap.
    const before = systemPrompt.length;
    systemPrompt = trimPromptToBudget(systemPrompt, MAX_SYSTEM_CHARS);
    log.info("system_prompt_truncated", { from: before, to: systemPrompt.length, cap: MAX_SYSTEM_CHARS, provider, sectionAware: true });
  }

  // Load Greene strategic law library for context. 2026-07-11 review ·
  // gated back to anthropic-ONLY to match CONSUMPTION: route.ts builds the
  // chat-layer block (which is the only place greeneSummary is used) only
  // for non-ollama/gemini providers, so AG-14's addition of ollama here ran
  // a ~189-row strategicLaw query every ollama turn and then discarded the
  // result. Giving ollama the Greene laws is a deliberate prompt change
  // (wire the route.ts chat-layer for ollama) — not a silent side effect of
  // this query. Until then, don't pay for a result nobody reads.
  const strategicLaws = provider === "anthropic" ? await prisma.strategicLaw.findMany({
    select: { book: true, number: true, shortTitle: true, essence: true, shopApplication: true, nourApplication: true },
    orderBy: [{ book: "asc" }, { number: "asc" }],
  }).catch((): never[] => []) : [];
  const greeneSummary = strategicLaws.length > 0
    ? strategicLaws.map(l => `[${l.book} #${l.number}] ${l.shortTitle}: ${l.essence}`).join("\n")
    : "";

  // ── Personality mode injection ──
  // Appended LAST so it's the closest instruction to the conversation,
  // meaning the model weights it most heavily. Each personality changes
  // Nick's behavior without touching the data sections above.
  const personalityPrompts: Record<string, string> = {
    master: `[ACTIVE MODE: MASTER]
You are in Master mode — Nour's operator + strategist.
- Default: terse, actionable, 40-60 words. Sales floor focus — "close the deal", not "call the lead."
- When Nour asks for analysis: go deeper with data, pros/cons, second-order effects. Up to 150 words.
- Always cite a specific number from his data. Always end with ONE next move.
- No ALL-CAPS headings. No sections. No bullets unless asked. Just answer.`,

    builder: `[ACTIVE MODE: BUILDER]
You are in Builder mode — Nour's technical partner.
- Focus on code, architecture, deployment. Show file paths. Explain WHY not just WHAT.
- Use githubReadMultiple to read the actual files before asserting.
- Can be longer (up to 300 words) when explaining architecture decisions.
- Connect code to business outcomes.
- When Nour describes a feature, break it into steps and estimate effort.`,

    friend: `[ACTIVE MODE: FRIEND]
You are in Friend mode — just Nour's friend Nick.
- Casual. Warm but honest. No data, no metrics, no business unless he asks.
- Match his vibe. If he's joking, joke back. If he's venting, listen then respond like a real friend would.
- No "strategic layers", no "next actions", no tools unless asked.
- Keep it natural. Talk like a person, not a system.
- Still honest — friends tell the truth. But with warmth.`,

    // AG-32 · standing conversational stances for the two new personas.
    // Mode = every turn; the /spar and /battle prefixes remain the
    // per-turn versions of the same disciplines.
    "thought-partner": `[ACTIVE MODE: THOUGHT PARTNER]
You are in Thought Partner mode — Nour's dialectic sparring partner.
- Never cheerlead, never rubber-stamp. Develop his ideas WITH him.
- On any idea or decision: steelman it first, then attack the strongest version harder than a rival would, then name the real tension — do NOT resolve it unless he asks. The choice stays his.
- Ground every option and every attack in his actual data (numbers, names, dates). A generic risk is filler.
- Keep answers under 200 words unless he asks to go deeper. End with the single question that decides it.`,

    tactician: `[ACTIVE MODE: TACTICIAN]
You are in Tactician mode — short-horizon move counsel, not strategy seminars.
- Every answer converges on concrete moves executable within 48 hours: verb first, target named, visible checkpoint.
- Vague counsel ("build relationships", "stay consistent") is a failure. Numbers and names or nothing.
- When a NEXT MOVE block or Greene corpus move is in context, use it verbatim where it fits, cited [Book · Law].
- End with exactly ONE move — one, not a menu. If he wants alternatives he'll ask.`,
  };

  const personalityBlock = personalityPrompts[personality] || personalityPrompts.master;
  systemPrompt += `\n\n${personalityBlock}`;

  // ── Behavior directive (ANTICIPATE→ANSWER→ELEVATE · Sparring at HIGH) ──
  // AG-10 wiring · the directive was authored + unit-tested in
  // lib/ai/knowledge/behavior-directive.ts but never injected into any live
  // prompt, and the /strict · /chill interceptors set an intensity override
  // nothing read. getBehaviorDirective self-gates: strict-mode messages
  // ("/strict", "just answer", …) return "", and casual turns skip below.
  // Intensity: NICK_CHAT_INTENSITY env (MINIMAL/STANDARD/HIGH) with the
  // /strict · /chill override taking priority (per-instance state).
  const behaviorDirective = getBehaviorDirective(userContent);
  if (behaviorDirective && turnSignal.intent !== "casual") {
    systemPrompt += `\n\n${behaviorDirective}`;
  }

  // ═══ Apr 19 · Turn-aware prompt scaffolds ═══
  // Chain-of-thought fires on complex/analytical/decision/reflective turns.
  // Output-shape fires when Nour asked for a specific form (email / SMS /
  // proposal / code / JSON / table / list / summary). Both are appended
  // AFTER personality so they're the closest instructions to the
  // conversation — the model weights them most heavily. Pure overhead is
  // a few hundred tokens on turns that benefit; zero tokens on casual chat.
  if (turnSignal.useChainOfThought) {
    systemPrompt += `\n\n${buildChainOfThoughtPrompt()}`;
  }
  const shapePrompt = buildOutputShapePrompt(turnSignal.outputShape);
  if (shapePrompt) {
    systemPrompt += `\n\n${shapePrompt}`;
  }

  // AG-11 · Response-contract directive — the turn's explicit output
  // obligations (exact item counts, no-clarifying-questions, don't claim
  // actions, ...). Empty string for unconstrained turns.
  const contractDirective = input.contract ? buildContractDirective(input.contract) : "";
  if (contractDirective) {
    systemPrompt += `\n\n${contractDirective}`;
  }

  // AG-30 · SPAR MODE (diverge → attack → converge). Fires on brainstorm
  // contract turns or the explicit /spar prefix — the thought-partner
  // scaffold that brainstorm turns never had (they got only temperature).
  const sparTurn =
    input.contract?.answerMode === "brainstorm" || EARLY_SPAR.test(userContent);
  if (sparTurn) {
    systemPrompt += `\n\n${SPAR_MODE}`;
  }

  // Apr 19 · Citation protocol — added on turns where any brain block
  // fired. Tells the model it MAY cite sources with [brain:TAG]. We
  // skip the directive on casual turns to save tokens.
  const anyBrainBlockFired =
    contextBlocksFired.recall ||
    contextBlocksFired.skills ||
    contextBlocksFired.identity ||
    contextBlocksFired.ghost ||
    contextBlocksFired.qualitative ||
    contextBlocksFired.beliefs ||
    contextBlocksFired.nudges ||
    contextBlocksFired.contradictions;
  if (anyBrainBlockFired && turnSignal.intent !== "casual") {
    systemPrompt += `\n\n${buildCitationPrompt()}`;
  }

  // Apr 19 · Nour voice guardrails. Appended on turns where voice
  // matters most (analytical / decision / creative / reflective /
  // emotional). Casual / factual turns skip it — short pragmatic
  // replies naturally avoid the corporate-speak we're guarding against
  // and the extra tokens would crowd out content.
  const voiceGuardIntents = new Set<typeof turnSignal.intent>([
    "analytical",
    "decision",
    "creative",
    "reflective",
    "emotional",
    "instructional",
  ]);
  if (voiceGuardIntents.has(turnSignal.intent)) {
    systemPrompt += `\n\n${buildNourVoicePrompt()}`;
    // AG-15 · corpus-derived identity anchor (8-axis identity + voice
    // profile built from Nour's REAL writing by the persona-corpus
    // importer). The import script's own success message claimed "next
    // chat turn picks them up" — but no chat code ever called this.
    // Self-caches 15min and returns "" when no identity snapshot exists,
    // so it's a safe no-op until the corpus is imported.
    const { getPersonaAnchorPrompt } = await import("@/lib/brain/persona-drift-detector");
    const anchorPrompt = await getPersonaAnchorPrompt().catch(() => "");
    if (anchorPrompt) {
      systemPrompt += `\n\n${anchorPrompt}`;
    }
  }

  // Brevity nudge. 2026-07-11 review · gated to CASUAL turns only. This
  // hard "under 60 words" line used to fire on every non-deep/non-builder
  // turn, directly contradicting the static prefix ("never sacrifice
  // substance to hit a word count"), BREVITY_DEFAULT (≤80, the single
  // source of default length), and the master persona (40-60 / up to 150
  // on analysis). On analytical/strategy turns those all fought each other;
  // now the 60-word cap only reinforces brevity where it belongs — quick
  // casual replies — and BREVITY_DEFAULT owns everything else.
  if (mode !== "deep" && personality !== "builder" && turnSignal.intent === "casual") {
    systemPrompt += `\nRemember: under 60 words unless analyzing. Nour is on his phone.`;
  }

  // ── FORBIDDEN PHRASES — universal voice guard ──
  // Prevention layer for Nick's distinct voice. Without this, Venice
  // slipped into generic-LLM filler ("Certainly!", "I hope this helps")
  // on standard + deep. Paired with lib/ai/output-sanitizer.ts which
  // scrubs the saved history as a cure layer.
  systemPrompt += `\n\nFORBIDDEN PHRASES — never emit:
- Pleasantries: "Certainly!" / "Of course!" / "Absolutely!" / "Great question!" / "Sure thing!"
- Help filler: "I hope this helps" / "Let me know if..." / "Happy to help" / "Feel free to ask"
- AI disclaimers: "As an AI" / "As a language model" / "As an AI assistant I can't" (banned as GENERIC deflection — saying a SPECIFIC tool is unavailable, e.g. "web search isn't available right now", is honest and encouraged)
- Hedges: "It seems like" / "It appears that" / "I think that" / "Based on my analysis"
- Self-reference: "In this response" / "In my answer"
- Sentences starting with: However / Additionally / Furthermore / Moreover / In summary / In conclusion
Speak as Nour's operator. Direct, specific, grounded in his data.`;

  // ── HONESTY + RESPECT (always-on) ──
  // 2026-06-06 · Fixes two failures caught in a reviewed chat: Nick asserted
  // a task's completion status it never checked (the response-verifier flagged
  // the unbacked claim), and it scolded Nour for changing topics. ~80 tokens
  // that keep Nick honest (facts-vs-coaching lanes, empty-tool-result, no
  // unverified claims) and respectful (no assume-failure, no topic-policing)
  // WHILE preserving the unprompted push on the work — the multi-agent review
  // flagged the prior wording as risking a yes-man. (2026-06-06 · REVISE ·
  // see memory/statenour-nick-behavioral-review.md)
  systemPrompt += `\n\nHONESTY + RESPECT:
- FACTS vs COACHING — two lanes. For a FACT about Nour's data (is a task done? a number? a name? what was said?): verify first — call the tool / read his data. If the tool returns nothing, say "I don't see any X" — never invent it or blame an "outage." If you can't check, say "can't confirm that — want me to pull it?" and offer the fix. For COACHING (advice, judgment, strategy, how he's doing): engage fully and with conviction — never hedge or say "can't confirm" about an opinion.
- Never assume he failed. Don't say "you didn't" about anything you haven't actually checked.
- Don't police his attention — if he changes topics, follow his lead; flag a genuinely dropped ball ONCE, never repeatedly.
- Still push hard, on your own initiative, on the WORK — a weak number, a soft price, an avoided call. Push the work, not the man; challenge the plan, never assume the failure.
- TOOL UNAVAILABILITY: if a tool or integration isn't available this turn (not attached, not configured, or it errored), say so plainly and specifically ("web search isn't available right now", "GitHub access isn't configured", "no browser access this session"). Never imply you checked when the tool didn't fire; never say "I found nothing" when the truth is you couldn't look.
- TOOL CONFIRMS ACTION: never write a past-tense action ("added", "created", "sent", "saved", "scheduled", "marked done", "pinned") unless the matching tool fired this turn. If it didn't, say what you can do next ("I can create that — want me to?"). The verifier checks every turn.`;

  // ── TOOL-FIRST DIRECTIVE (injected only when query is factual) ──
  // When the user asks a data question Nick has tools for, force the
  // tool call before the answer. Prevents hallucinated numbers.
  const toolFirstPrompt = toolFirstDirective(queryShape);
  if (toolFirstPrompt) {
    systemPrompt += `\n\n${toolFirstPrompt}`;
  }

  return { systemPrompt, greeneSummary, strategicLawCount: strategicLaws.length };
}
