/**
 * Pre-task Fan-out · v10.0.372
 *
 * Per /task-intelligence skill · before answering a hard question, run
 * 3 PARALLEL lenses that gather different angles, then synthesize the
 * result into a decision-grade context block. The actual reply benefits
 * from the multi-agent perspective without the operator having to chain
 * prompts manually.
 *
 * THE 3 LENSES
 *   1. Research Lens · "what concrete information would inform this?"
 *   2. Risk Lens     · "what could go wrong · what's being missed?"
 *   3. Plan Lens     · "if approved, what's the sequence + checkpoints?"
 *
 * Each lens is a parallel gpt-4o-mini call · low max_tokens (~250 each)
 * · ~2s total added latency · firing in parallel via Promise.all.
 *
 * USAGE
 *   const fanout = await runFanout({ question, brainContext? });
 *   // fanout has .research, .risk, .plan, .composite (synthesized block)
 *   // Stuff fanout.composite into the chat input or system prompt
 *   // The main reply call benefits from the multi-angle context
 *
 * Trigger gating · per the skill, fan-out should be RARE (high cost)
 * and applied only on:
 *   · explicit /deep slash command from operator
 *   · auto-detected high-stakes questions (separate gating decision)
 *
 * This file just provides the function · the trigger logic lives in
 * the slash-command + chat-interceptor layer (callers' choice).
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";
import {
  RESEARCH_ANALYST,
  CONTRARIAN_CRITIC,
  EXECUTION_PLANNER,
  personaToSystemPrompt,
} from "@/lib/ai/personas";

const log = rootLogger.withSurface("ai/pretask-fanout");

export interface FanoutReport {
  research: string;
  risk: string;
  plan: string;
  /** Synthesized block ready to inject into chat input or system prompt. */
  composite: string;
  durationMs: number;
}

interface FanoutArgs {
  question: string;
  /** Optional brain context to ground the lenses. */
  brainContext?: string;
}

// Phase U (2026-05-18 PM) · the 3 fanout lenses now flow through the
// typed persona library · closes the M.2 wiring chain (R · runMultiAgent
// + S.1 · per-step routing + T · deep-research worker + U · pretask
// fanout = all reasoning sub-pipelines wired). N.6 scorer can now
// compute per-persona verdicts for the ENTIRE reasoning stack.
//
// Maps · research lens → RESEARCH_ANALYST · risk lens →
// CONTRARIAN_CRITIC · plan lens → EXECUTION_PLANNER. The personas'
// goals + backstories already match each lens's intent exactly so
// no domain fidelity is lost in the swap.
const RESEARCH_SYSTEM = personaToSystemPrompt(RESEARCH_ANALYST);
const RISK_SYSTEM = personaToSystemPrompt(CONTRARIAN_CRITIC);
const PLAN_SYSTEM = personaToSystemPrompt(EXECUTION_PLANNER);

/** Mapping from fanout lens name to persona key · exported so tests
 *  + scorer consumers know which persona key each lens fires under. */
export const LENS_PERSONA_KEY = {
  research: RESEARCH_ANALYST.key,
  risk: CONTRARIAN_CRITIC.key,
  plan: EXECUTION_PLANNER.key,
} as const;

// v10.0.529.106 · Wave 59 · pre-Wave-59 each lens fired raw at
// api.openai.com burning real OpenAI tokens even when Venice or
// Ollama would handle the same 200-word lens call free. Now routes
// through aiChat() · Venice-first via the provider chain.
async function callLens(systemPrompt: string, userPrompt: string): Promise<string> {
  // wave-AO follow-up · audit #438 Tier-2 · was bare aiChat.
  const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
  const aiChat = makeTracedAiChat("pretask-fanout", "brain");
  const reply = await aiChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    "fast",
  );
  return (reply?.content ?? "").trim();
}

const guardedLens = withGuardian("pretask-lens", callLens, {
  timeoutMs: 10_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal per-lens sub-step of arsenalPreTaskFanout
});

/**
 * v10.0.472 · per-lens cost telemetry (ADR-0009 open item) ·
 * wraps a lens call so each one writes a SystemMetric with its
 * lens-name + duration + estimated tokens. Cost-aware orchestrators
 * can later prune the lens that delivers the lowest quality-per-token.
 *
 * Best-effort · telemetry never blocks the lens result. The actual
 * lens text is returned even if the metric write fails.
 */
async function instrumentedLens(
  lensName: "research" | "risk" | "plan",
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const startedAt = Date.now();
  let text = "";
  let success = true;
  try {
    text = await guardedLens(systemPrompt, userPrompt);
  } catch (e) {
    success = false;
    log.debug(`${lensName}_lens_failed`, { err: (e as Error).message });
    text = "";
  }
  const durationMs = Date.now() - startedAt;
  // Token estimate: chars / 4 is a rough proxy for English-language
  // GPT tokenization. Captures input + output combined.
  const estimatedTokens = Math.round((systemPrompt.length + userPrompt.length + text.length) / 4);

  // Phase U · N.6 telemetry · record persona usage for the lens so
  // scorePersonas() sees the fanout personas alongside multi-agent +
  // deep-research. Implied confidence from success (0.7 / 0.2).
  const personaKey = LENS_PERSONA_KEY[lensName];

  void (async () => {
    try {
      const { prisma } = await import("@/lib/prisma");
      await prisma.systemMetric.create({
        data: {
          metric: `pretask.lens.${lensName}`,
          value: estimatedTokens,
          unit: "tokens",
          tags: {
            lens: lensName,
            personaKey,
            durationMs,
            success,
            outputChars: text.length,
          },
          source: "pretask-fanout",
        },
      });
    } catch {
      // telemetry must never block the lens result
    }
  })();

  void (async () => {
    try {
      const { recordPersonaUsage } = await import("@/lib/ai/personas/scorer");
      await recordPersonaUsage({
        personaKey,
        parentTier: "pretask-fanout",
        parentConfidence: success ? 0.7 : 0.2,
        durationMs,
      });
    } catch {
      /* best-effort · same pattern as runMultiAgent + deep-research */
    }
  })();

  return text;
}

/**
 * Run the 3 lenses in parallel + synthesize the composite block.
 * Best-effort · individual lens failures degrade gracefully (empty
 * string), composite is built from whichever lenses succeeded.
 */
export async function runFanout(args: FanoutArgs): Promise<FanoutReport> {
  const startedAt = Date.now();
  const ctx = args.brainContext?.slice(0, 1500) ?? "";
  const userPrompt = `QUESTION: ${args.question.slice(0, 1500)}${ctx ? `\n\nKNOWN CONTEXT: ${ctx}` : ""}`;

  // v10.0.472 · each lens fires through the instrumented wrapper that
  // writes per-lens SystemMetric rows for cost-aware orchestration.
  const [research, risk, plan] = await Promise.all([
    instrumentedLens("research", RESEARCH_SYSTEM, userPrompt),
    instrumentedLens("risk", RISK_SYSTEM, userPrompt),
    instrumentedLens("plan", PLAN_SYSTEM, userPrompt),
  ]);

  const sections: string[] = [];
  if (research) sections.push(`## Pre-task · Information needed\n${research}`);
  if (risk) sections.push(`## Pre-task · Risks + failure modes\n${risk}`);
  if (plan) sections.push(`## Pre-task · Execution plan sketch\n${plan}`);
  const composite =
    sections.length > 0
      ? `# PRE-TASK ANALYSIS\nThe following multi-lens analysis was run before this reply. Use it to ground the answer; don't restate it verbatim.\n\n${sections.join("\n\n")}`
      : "";

  return {
    research,
    risk,
    plan,
    composite,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Heuristic · is this question worth the fan-out cost?
 * Returns true for questions that look like decisions, strategy, or
 * trade-off analyses. False for simple lookups + factual reads.
 *
 * Used by callers that want to auto-gate (vs explicit /deep trigger).
 */
export function isDeepWorthy(question: string): boolean {
  const q = question.trim();
  if (q.length < 60) return false; // too short
  const lc = q.toLowerCase();
  // Decision/strategy markers
  if (/\b(should i|should we|decide|deciding|weighing|trade[- ]?off|pros and cons)\b/.test(lc)) return true;
  if (/\b(strategy|strategic|plan for|approach to|long[- ]?term|big picture)\b/.test(lc)) return true;
  if (/\b(big call|important decision|major (move|change))\b/.test(lc)) return true;
  // Multi-clause investment / time questions
  if (q.length > 250 && /\?/.test(q)) return true;
  return false;
}
