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

const RESEARCH_SYSTEM = `You are a research analyst. Given a question, list the 3-5 CONCRETE pieces of information needed to answer it well · numbers, names, current state of relevant systems. No fluff.

Output format · plain text, hyphen list, max 200 words:
- info needed 1
- info needed 2
- ...

NO MARKDOWN. NO HEADERS. Be terse.`;

const RISK_SYSTEM = `You are a contrarian risk analyst. Given a question/decision, list the 3-5 most likely failure modes · what could go wrong · what's being missed. Be specific not generic.

Output format · plain text, hyphen list, max 200 words:
- risk 1
- risk 2
- ...

NO MARKDOWN. NO HEADERS. Be terse.`;

const PLAN_SYSTEM = `You are an execution planner. Given a question/decision (assume it gets approved), sketch the 3-5 step sequence to do it · concrete actions with checkpoints. No vague verbs.

Output format · plain text, numbered list, max 200 words:
1. concrete step
2. ...

NO MARKDOWN. NO HEADERS. Be terse.`;

// v10.0.529.106 · Wave 59 · pre-Wave-59 each lens fired raw at
// api.openai.com burning real OpenAI tokens even when Venice or
// Ollama would handle the same 200-word lens call free. Now routes
// through aiChat() · Venice-first via the provider chain.
async function callLens(systemPrompt: string, userPrompt: string): Promise<string> {
  const { aiChat } = await import("@/lib/ai/provider");
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
