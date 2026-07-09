/**
 * Multi-Agent Task Orchestrator · v10.0.374
 *
 * Per /multi-agent-task-orchestrator skill · spawn N sub-agents to work
 * on parallel sub-tasks, then synthesize their outputs into a single
 * coherent answer. Distinct from preTaskFanout (which has fixed lenses)
 * and deepResearch (which is web-research only):
 *
 *   · preTaskFanout (v10.0.372) · 3 fixed lenses (research/risk/plan)
 *   · deepResearch (v10.0.373)  · web search rounds + synthesis
 *   · multiAgent (this)         · N user-defined sub-tasks in parallel
 *
 * USE CASES
 *   · "Compare 3 competitors on pricing, hours, and reviews"
 *     → 3 sub-agents, each focusing on one competitor
 *   · "Draft 3 different post angles for Instagram"
 *     → 3 sub-agents, each with a different creative direction
 *   · "Audit the brand voice across {posts, emails, scripts}"
 *     → 3 sub-agents, each on one channel
 *
 * Sub-agents run in parallel via Promise.all · synthesizer composes a
 * unified answer from their outputs. Each sub-agent uses gpt-4o-mini
 * (fast + cheap) so 5 sub-agents = ~5x cheaper than one slow GPT-4 pass.
 *
 * RAILS
 *   · Max 8 sub-agents per call (operator-grade limit · prevents
 *     accidental cost blowups)
 *   · Each sub-task max 800 chars · keeps context focused
 *   · Sub-agent max 600 tokens output · synthesizer max 1500
 *   · Total budget · ~$0.001-0.002 per call · cheap
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";
import { getPersona, personaToSystemPrompt } from "@/lib/ai/personas";

const log = rootLogger.withSurface("ai/multi-agent");

const MAX_SUB_AGENTS = 8;
const SUB_TASK_LIMIT = 800;

export interface SubAgentTask {
  /** Stable name · used in synthesis to reference this sub-agent's output */
  name: string;
  /** What this sub-agent should do · 1-2 sentences */
  task: string;
  /** Optional · constrain output to a specific shape */
  outputHint?: string;
  /**
   * Phase R · M.2 wiring · optional persona key from the typed
   * library (`lib/ai/personas/index.ts`). When set:
   *   1. The sub-agent uses `personaToSystemPrompt(persona)` as its
   *      system prompt (role + goal + backstory + outputHint) instead
   *      of the generic SUB_AGENT_SYSTEM.
   *   2. The result's `name` field becomes the persona key — so the
   *      synthesizer dossier reads `# research-analyst` instead of
   *      `# step_1`, and N.6's recordPersonaUsage telemetry sees real
   *      persona keys instead of placeholders.
   *
   * Unknown persona keys fall back to the generic system prompt and
   * are logged as a soft warning · prevents typos from silently
   * disabling persona steering.
   */
  persona?: string;
}

export interface SubAgentResult {
  name: string;
  output: string;
  durationMs: number;
  failed?: boolean;
  error?: string;
}

export interface MultiAgentReport {
  goal: string;
  subAgents: SubAgentTask[];
  results: SubAgentResult[];
  synthesis: string;
  totalDurationMs: number;
  costEstimateUsd: number;
}

const SUB_AGENT_SYSTEM = `You are a focused sub-agent working on ONE specific sub-task as part of a larger investigation. Be terse, factual, action-oriented. No preamble. No closing platitudes.

CONSTRAINTS
- Output max 200 words
- Concrete and specific
- Cite sources only if you have them
- If you can't accomplish the task, say so in one line · don't waffle

Just do the task and return the answer.`;

const SYNTHESIZER_SYSTEM = `You synthesize the outputs of multiple sub-agents into ONE coherent answer for the operator.

REQUIREMENTS
- Lead with the headline answer · 1-2 sentences
- Then the integration of sub-agent findings · reference each by name
- Surface contradictions or gaps explicitly
- 250-450 words total
- Operator-grade tone · direct, dry, no fluff
- End with a 1-line "what to do next" if applicable

Plain text. No markdown headers. No bullets unless absolutely necessary.`;

/**
 * Phase R · pure helper · resolves the system prompt for a sub-agent.
 * Used by `callSubAgent` and exported for unit-testability (the prompt
 * resolution is the only behavior worth testing in isolation; the rest
 * is provider plumbing).
 *
 *   · No persona key → generic SUB_AGENT_SYSTEM (back-compat)
 *   · Known persona key → personaToSystemPrompt(persona) (role + goal
 *     + backstory + outputHint composed)
 *   · Unknown persona key → SUB_AGENT_SYSTEM + warn log (typos don't
 *     silently disable steering)
 */
export function resolveSubAgentSystemPrompt(personaKey?: string): string {
  if (!personaKey) return SUB_AGENT_SYSTEM;
  const persona = getPersona(personaKey);
  if (!persona) {
    log.warn("persona_unknown", { personaKey, fallback: "generic" });
    return SUB_AGENT_SYSTEM;
  }
  return personaToSystemPrompt(persona);
}

// ── AG-42 · scorer→selection · demote-only substitution ──
// The persona scorer (AG-21) computed verdicts nobody consumed. Now a
// persona with verdict "tune" over a real sample (runs ≥ 10) is DEMOTED
// to the generic sub-agent prompt — never swapped for a different
// persona (demote-only: a mis-scored persona can only cost us its
// steering, never inject a wrong one). Each demotion is recorded as
// SystemMetric `persona.swap` so /system/metrics shows the loop acting.
// Scores are cached 30s so an 8-agent fan-out costs one scorer query.
const SCORE_CACHE_TTL_MS = 30_000;
const DEMOTE_MIN_RUNS = 10;
let scoreCache: { at: number; scores: Awaited<ReturnType<typeof import("@/lib/ai/personas/scorer").scorePersonas>> } | null = null;

async function getPersonaScoresCached() {
  if (scoreCache && Date.now() - scoreCache.at < SCORE_CACHE_TTL_MS) {
    return scoreCache.scores;
  }
  const { scorePersonas } = await import("@/lib/ai/personas/scorer");
  const scores = await scorePersonas().catch(() => []);
  scoreCache = { at: Date.now(), scores };
  return scores;
}

/** Test hook · reset the 30s score cache between cases. */
export function __resetPersonaScoreCache(): void {
  scoreCache = null;
}

/**
 * Score-aware prompt resolution. Falls back to the plain resolver's
 * result unless the scorer says this persona is underperforming on a
 * meaningful sample. Scoring failure never blocks a sub-agent run.
 */
export async function resolveSubAgentSystemPromptScored(
  personaKey?: string,
): Promise<string> {
  const prompt = resolveSubAgentSystemPrompt(personaKey);
  if (!personaKey || prompt === SUB_AGENT_SYSTEM) return prompt;
  try {
    const scores = await getPersonaScoresCached();
    const s = scores.find((x) => x.personaKey === personaKey);
    if (s && s.verdict === "tune" && s.runs >= DEMOTE_MIN_RUNS) {
      log.warn("persona_demoted", {
        personaKey,
        runs: s.runs,
        avgConfidence: s.avgConfidence,
        fallbackRate: s.fallbackRate,
      });
      void import("@/lib/prisma")
        .then(({ prisma }) =>
          prisma.systemMetric.create({
            data: {
              metric: "persona.swap",
              value: s.avgConfidence,
              unit: "confidence",
              source: "multi-agent",
              tags: { personaKey, runs: s.runs, verdict: s.verdict, to: "generic" },
            },
          }),
        )
        .catch(() => undefined);
      return SUB_AGENT_SYSTEM;
    }
  } catch {
    /* scoring is advisory · never block the run */
  }
  return prompt;
}

// v10.0.529.106 · Wave 59 · routes through aiChat() provider chain
// instead of raw fetch to OpenAI. Same Wave 59 fix applied across
// pretask-fanout.ts and deep-research.ts.
//
// Phase R · `task.persona` overrides the generic system prompt when set.
async function callSubAgent(
  task: SubAgentTask,
  goalContext: string,
): Promise<string> {
  const prompt = `OVERALL GOAL: ${goalContext}\n\nYOUR SPECIFIC TASK: ${task.task.slice(0, SUB_TASK_LIMIT)}${
    task.outputHint ? `\n\nOUTPUT FORMAT: ${task.outputHint}` : ""
  }`;

  const systemPrompt = await resolveSubAgentSystemPromptScored(task.persona);

  // wave-AO follow-up · audit #438 Tier-2 · was bare aiChat.
  const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
  const aiChat = makeTracedAiChat("multi-agent-orchestrator", "brain");
  const reply = await aiChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    "reason",
  );
  return (reply?.content ?? "").trim();
}

const guardedSubAgent = withGuardian("multi-agent-sub", callSubAgent, {
  timeoutMs: 12_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal sub-step of arsenal.multiAgent
});

// v10.0.529.106 · Wave 59 · routes through aiChat() provider chain
// instead of raw fetch to OpenAI — same fix as callSubAgent above and
// across pretask-fanout.ts / deep-research.ts. The old raw fetch
// hardcoded gpt-4o-mini behind a `process.env.OPENAI_API_KEY` guard
// that returned "" when the key was unset, producing blank synthesis
// and bypassing the provider fallback chain, budget cap, and tracing.
async function callSynthesizer(args: {
  goal: string;
  results: SubAgentResult[];
}): Promise<string> {
  const dossier = args.results
    .map((r) => {
      if (r.failed) return `# ${r.name} (FAILED): ${r.error ?? "unknown error"}`;
      return `# ${r.name}\n${r.output.slice(0, 1500)}`;
    })
    .join("\n\n---\n\n");

  const userPrompt = `OPERATOR GOAL: ${args.goal}\n\nSUB-AGENT OUTPUTS (${args.results.length} agents):\n\n${dossier}\n\nSynthesize into ONE coherent answer.`;

  const { makeTracedAiChat } = await import("@/lib/ai/traced-aichat");
  const aiChat = makeTracedAiChat("multi-agent-orchestrator", "brain");
  const reply = await aiChat(
    [
      { role: "system", content: SYNTHESIZER_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    "reason",
  );
  return (reply?.content ?? "").trim();
}

const guardedSynthesizer = withGuardian("multi-agent-synth", callSynthesizer, {
  timeoutMs: 15_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal synthesis sub-step of arsenal.multiAgent
});

/**
 * Run N sub-agents in parallel + synthesize their outputs.
 *
 * @param args.goal · the overall operator goal · each sub-agent sees this as context
 * @param args.subAgents · array of tasks · max 8 · each sees its specific assignment
 */
export async function runMultiAgent(args: {
  goal: string;
  subAgents: SubAgentTask[];
}): Promise<MultiAgentReport> {
  const startedAt = Date.now();

  if (args.subAgents.length === 0) {
    return {
      goal: args.goal,
      subAgents: [],
      results: [],
      synthesis: "",
      totalDurationMs: 0,
      costEstimateUsd: 0,
    };
  }
  if (args.subAgents.length > MAX_SUB_AGENTS) {
    log.warn("multi_agent_capped", { requested: args.subAgents.length, max: MAX_SUB_AGENTS });
    args.subAgents = args.subAgents.slice(0, MAX_SUB_AGENTS);
  }

  // Fire all sub-agents in parallel
  //
  // Phase R · when `task.persona` is set, the result's `name` becomes
  // the persona key. The synthesizer dossier then reads
  // `# research-analyst` / `# contrarian-critic` instead of generic
  // `# step_1` / `# what` · semantically richer for the synthesizer
  // LLM AND N.6's recordPersonaUsage telemetry sees real persona keys.
  const results = await Promise.all(
    args.subAgents.map(async (task) => {
      const subStart = Date.now();
      const effectiveName = task.persona ?? task.name;
      try {
        const output = await guardedSubAgent(task, args.goal);
        return {
          name: effectiveName,
          output,
          durationMs: Date.now() - subStart,
        };
      } catch (err) {
        return {
          name: effectiveName,
          output: "",
          durationMs: Date.now() - subStart,
          failed: true,
          error: (err as Error).message?.slice(0, 200),
        };
      }
    }),
  );

  // Synthesize
  const successful = results.filter((r) => !r.failed && r.output);
  let synthesis = "";
  if (successful.length > 0) {
    // 2026-05-27 · the bare `.catch(() => "")` returned a blank string
    // on synthesizer failure · operator got a no-content response with
    // zero indication of why. Log + surface a visible error message so
    // the multi-agent UI shows "Synthesis failed — sub-agent output
    // below" instead of an empty pane.
    synthesis = await guardedSynthesizer({ goal: args.goal, results }).catch((err) => {
      console.warn(
        "[multi-agent-orchestrator] synthesis failed:",
        err instanceof Error ? err.message : err,
      );
      return `_Synthesis stage failed (${
        err instanceof Error ? err.message.slice(0, 120) : "unknown error"
      }). Individual sub-agent results are above._`;
    });
  } else {
    synthesis = "All sub-agents failed · no synthesis available. Check the individual results for errors.";
  }

  // Cost estimate · gpt-4o-mini ~$0.0001/1K input + $0.0004/1K output ·
  // Each sub-agent ~600 output tokens · synthesizer ~1500 output tokens ·
  // very rough estimate
  const subAgentCost = args.subAgents.length * 0.0003;
  const synthCost = 0.0008;
  const costEstimateUsd = subAgentCost + synthCost;

  return {
    goal: args.goal,
    subAgents: args.subAgents,
    results,
    synthesis,
    totalDurationMs: Date.now() - startedAt,
    costEstimateUsd: Math.round(costEstimateUsd * 10000) / 10000,
  };
}
