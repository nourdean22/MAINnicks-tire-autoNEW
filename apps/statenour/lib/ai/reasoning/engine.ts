/**
 * lib/ai/reasoning/engine.ts · Phase H (2026-05-18 PM)
 *
 * The Nick Reasoning Engine · Charizard's bigger brain.
 *
 * What this evolves:
 *   Before · Nick did 1 LLM call per turn · pretask-fanout and
 *           multi-agent existed as separate opt-in tools the operator
 *           had to ask for. Critique stack existed but ran on demand.
 *
 *   After  · For any question that warrants it, Nick runs a unified
 *           reasoning loop · classify → (decompose) → plan → execute →
 *           critique → refine → deliver · with a visible step-by-step
 *           trace the operator can watch unfold. Reuses every existing
 *           piece (pretask-fanout · multi-agent-orchestrator ·
 *           deep-research · adversarial-critic).
 *
 * Tier ladder · the classifier picks the cheapest tier that fits:
 *
 *   quick    · skip the engine · pass through to standard chat
 *   standard · pretask fanout (3 lenses) + draft + critique + final
 *              · ~3-5s · ~$0.005
 *   deep     · decomposition + multi-agent + fanout + critique + refine
 *              · ~8-15s · ~$0.02
 *   thorough · deep-research worker + multi-agent + critique + refine
 *              · ~30-60s · ~$0.10
 *
 * Each step writes a ReasoningStep to the trace · the engine returns
 * the full ReasoningTrace + final answer + confidence.
 *
 * Failure mode · the engine ALWAYS returns something. If a step fails,
 * the trace records the failure but the next step takes the best signal
 * available. Worst case (everything fails) the engine falls back to a
 * standard aiChat() call.
 */

import { withGuardian } from "@/lib/tools/guardian";
import { logger as rootLogger } from "@/lib/logger";
import { getFlag } from "@/lib/feature-flags";
import type {
  ReasoningRequest,
  ReasoningResult,
  ReasoningStep,
  ReasoningStepKind,
  ReasoningTier,
  ReasoningTrace,
} from "./types";
import type { SubAgentTask } from "@/lib/ai/multi-agent-orchestrator";
import { classifyReasoning } from "./classifier";
import { TIER_CONFIG } from "./tier-config";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";

const log = rootLogger.withSurface("ai/reasoning/engine");

// wave-AO audit #438 · every reasoning sub-call routes through the
// budget-gated traced aiChat so it inherits the daily-budget cap. One
// shared instance (was dynamically re-imported + re-constructed in each
// sub-function · the engine is server-only, so a static import is safe).
const tracedAiChat = makeTracedAiChat("reasoning-engine", "brain");

// ── Per-step micro-helpers ──────────────────────────────────────────

function makeRecorder(
  startedAt: number,
  onStep?: (step: ReasoningStep) => void,
) {
  const steps: ReasoningStep[] = [];
  let lastStart = startedAt;
  return {
    push(
      kind: ReasoningStepKind,
      label: string,
      detail?: unknown,
      explicitDuration?: number,
    ): void {
      const now = Date.now();
      const step: ReasoningStep = {
        kind,
        label,
        detail,
        elapsedMs: now - startedAt,
        durationMs: explicitDuration ?? now - lastStart,
      };
      steps.push(step);
      lastStart = now;
      if (onStep) {
        try {
          onStep(step);
        } catch {
          // Streaming callbacks must never block the engine.
        }
      }
    },
    snapshot(): ReasoningStep[] {
      return [...steps];
    },
  };
}

// ── Sub-step implementations · each one is independent + tolerant ──

/** H.5.1 · per-run cost accumulator · pushed into by each engine
 *  sub-fn after aiChat returns. AiResponse.costUsd was added in H.4.7
 *  · this is the engine-side consumer that aggregates real cost. When
 *  any aiChat returns no costUsd (e.g. local Ollama with no rate),
 *  the accumulator still increments the call count but the usd stays
 *  at the sum-of-known-only. buildResult prefers acc.usd when non-zero,
 *  otherwise falls back to per-tier estimate. */
interface CostAccumulator {
  usd: number;
  calls: number;
  /** Count of calls that did NOT return a costUsd (local providers,
   *  providers not in the rate table). Used to detect "no real cost
   *  data" scenarios. */
  callsWithoutCost: number;
}

function makeAccumulator(): CostAccumulator {
  return { usd: 0, calls: 0, callsWithoutCost: 0 };
}

function recordReply(
  acc: CostAccumulator | undefined,
  reply: { costUsd?: number } | null | undefined,
): void {
  if (!acc) return;
  acc.calls += 1;
  if (reply && typeof reply.costUsd === "number" && Number.isFinite(reply.costUsd)) {
    acc.usd += reply.costUsd;
  } else {
    acc.callsWithoutCost += 1;
  }
}

async function runPlan(
  question: string,
  tier: ReasoningTier,
  acc?: CostAccumulator,
  signal?: AbortSignal,
): Promise<string> {
  // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
  // Routed via makeTracedAiChat factory · inherits the daily-budget gate
  // installed in traced-aichat.ts. Drop-in: call signature unchanged.
  const aiChat = tracedAiChat;
  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are a problem-decomposition planner. Given a question, write a 2-4 step plan to ANSWER it (not to ACT on it). Each step says what information or analysis is needed. Output plain text, numbered list, max 120 words. Mode: ${tier}.

NO MARKDOWN HEADERS. Be terse and concrete.`,
      },
      { role: "user", content: question },
    ],
    "fast",
    { signal },
  );
  recordReply(acc, reply);
  return (reply?.content ?? "").trim();
}

/** H.8 · sub-pipeline runner return type · carries actual call count
 *  + actual cost (when the pipeline reports it) so the engine
 *  accumulator gets real numbers instead of magic constants. */
interface SubPipelineResult {
  content: string;
  /** Best-known call count from this sub-pipeline · used for the
   *  engine's callCount tally + fallback estimate when usd is 0. */
  callCount: number;
  /** Real USD cost when the sub-pipeline reports it (multi-agent
   *  does · deep-research + fanout don't yet). 0 when unknown. */
  usd: number;
}

async function runFanout(
  question: string,
  brainContext?: string,
): Promise<SubPipelineResult> {
  // Reuse the existing pretask-fanout · 3 parallel lenses + composite.
  // H.8 · always 4 calls (3 lens + 1 composite) · count is deterministic
  // even though the per-lens cost isn't reported back.
  const { runFanout } = await import("@/lib/ai/pretask-fanout");
  const fanout = await runFanout({ question, brainContext });
  return { content: fanout.composite, callCount: 4, usd: 0 };
}

/**
 * Phase S.1 · classify a single plan line as a research task (find
 * information) vs an execution task (do something concrete) so the
 * orchestrator picks the right persona per step.
 *
 *   · execution → execution-planner (operator's chief of staff · turns
 *     decisions into Monday-morning to-do steps · banned vague verbs)
 *   · research → research-analyst (terse · factual · prefers numbers
 *     and named sources)
 *
 * Heuristic: leading verb wins. Default = research-analyst (safer ·
 * the analyst persona is also fine on action-shaped tasks; the planner
 * is only better when the task IS clearly action).
 *
 * Exported for unit-testability · the per-line routing decision is
 * the only behavior in this file worth testing in isolation.
 */
export function classifyStepIntent(
  line: string,
): "research-analyst" | "execution-planner" {
  const stripped = line.replace(/^\d+[.)]\s*/, "").trim().toLowerCase();
  if (!stripped) return "research-analyst";
  // Take the first word (handle bullets, hyphens that already got
  // stripped by the regex above).
  const firstWord = stripped.split(/\s+/)[0] ?? "";

  // Action verbs — operator-grade "do this" steps. Conjugations
  // (present / present-progressive / past) all included because plan
  // lines come from an LLM that mixes tenses freely (some models
  // narrate a plan in past tense as if it's already done).
  const EXECUTE_VERBS = new Set([
    "build", "builds", "building", "built",
    "create", "creates", "creating", "created",
    "ship", "ships", "shipping", "shipped",
    "send", "sends", "sending", "sent",
    "post", "posts", "posting", "posted",
    "publish", "publishes", "publishing", "published",
    "deploy", "deploys", "deploying", "deployed",
    "launch", "launches", "launching", "launched",
    "schedule", "schedules", "scheduling", "scheduled",
    "draft", "drafts", "drafting", "drafted",
    "write", "writes", "writing", "wrote", "written",
    "update", "updates", "updating", "updated",
    "refactor", "refactors", "refactoring", "refactored",
    "fix", "fixes", "fixing", "fixed",
    "remove", "removes", "removing", "removed",
    "delete", "deletes", "deleting", "deleted",
    "install", "installs", "installing", "installed",
    "configure", "configures", "configuring", "configured",
    "run", "runs", "running", "ran",
    "execute", "executes", "executing", "executed",
    "implement", "implements", "implementing", "implemented",
    "wire", "wires", "wiring", "wired",
    "set", "sets", "setting",
    "add", "adds", "adding", "added",
    "open", "opens", "opening", "opened",
    "close", "closes", "closing", "closed",
    "merge", "merges", "merging", "merged",
    "push", "pushes", "pushing", "pushed",
    "commit", "commits", "committing", "committed",
    "migrate", "migrates", "migrating", "migrated",
    "rollback", "rolls", "rolled",
    "call", "calls", "calling", "called",
    "test", "tests", "testing", "tested",
    "do", "did", "done",
  ]);
  if (EXECUTE_VERBS.has(firstWord)) return "execution-planner";

  return "research-analyst";
}

async function runMultiAgent(
  question: string,
  plan: string,
): Promise<SubPipelineResult> {
  const { runMultiAgent } = await import("@/lib/ai/multi-agent-orchestrator");

  // Derive sub-agents from the plan · each step becomes one focused
  // sub-agent task. Cap at 4 to bound cost.
  //
  // Phase R + S.1 · M.2 wiring · each sub-agent now carries a typed
  // persona picked per-step:
  //   · plan-derived steps → classifyStepIntent(line) picks
  //     research-analyst OR execution-planner based on the leading
  //     verb · "find X" stays analyst, "create Y" goes to planner
  //   · fallback 2-angle split → research-analyst + contrarian-critic
  // The orchestrator uses persona's role/goal/backstory as the system
  // prompt instead of the generic SUB_AGENT_SYSTEM, and N.6's scorer
  // (recordPersonaUsage) now sees real persona keys instead of
  // `step_1`/`what`/`why` placeholders.
  const planLines = plan
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]/.test(l))
    .slice(0, 4);
  const subAgents: SubAgentTask[] = planLines.length > 0
    ? planLines.map((line, i) => ({
        name: `step_${i + 1}`,
        task: line.replace(/^\d+[.)]\s*/, ""),
        outputHint: "Concrete · no fluff · max 200 words.",
        persona: classifyStepIntent(line),
      }))
    : [
        // Fallback · split the question into "what's the concrete
        // answer" + "what could go wrong with that answer". This
        // pairs the research-analyst (find facts) with the
        // contrarian-critic (surface failure modes) · the same
        // 2-lens setup CrewAI uses for cheap fact-vs-risk fan-out.
        {
          name: "what",
          task: `What is the concrete answer to: ${question}`,
          outputHint: "Direct answer · max 200 words.",
          persona: "research-analyst",
        },
        {
          name: "why",
          task: `What could go wrong with the obvious answer to: ${question} · which failure modes are being missed?`,
          outputHint: "Risks + missed angles · max 200 words.",
          persona: "contrarian-critic",
        },
      ];

  const report = await runMultiAgent({
    goal: question,
    subAgents,
  });
  // N.6 · record persona usage per sub-agent · scorer reads these
  // rows to compute "which personas reliably produce high-confidence
  // answers". Best-effort · failure here never blocks the engine.
  //
  // Phase R · post-M.2 wiring · `r.name` is now the persona key when
  // a persona was passed (the orchestrator sets `effectiveName =
  // task.persona ?? task.name`). For plan-derived runs that means
  // we always record `research-analyst`. For the fallback 2-angle
  // split we record `research-analyst` + `contrarian-critic`. N.6's
  // scorer can finally compute per-persona avgConfidence + fallbackRate
  // verdicts off real persona keys instead of `step_N` placeholders.
  void (async () => {
    try {
      const { recordPersonaUsage } = await import("@/lib/ai/personas/scorer");
      for (const r of report.results) {
        await recordPersonaUsage({
          personaKey: r.name,
          parentTier: "multi-agent",
          parentConfidence: r.failed ? 0.2 : 0.7, // placeholder · refined when buildResult lands
          durationMs: r.durationMs ?? 0,
        });
      }
    } catch {
      /* best-effort */
    }
  })();
  return {
    content: report.synthesis,
    callCount: report.results.length + 1,
    usd: report.costEstimateUsd ?? 0,
  };
}

async function runDeepResearch(question: string): Promise<SubPipelineResult> {
  const { runDeepResearch } = await import("@/lib/ai/deep-research");
  const report = await runDeepResearch({ question });
  // H.8 · real call count = 1 planner + N rounds + 1 synthesizer.
  // Each round is one Perplexity search call. Cost not exposed by
  // deep-research today · fall back to 0 (engine estimate covers it).
  const calls = 1 + (report.rounds?.length ?? 0) + 1;
  return { content: report.synthesis, callCount: calls, usd: 0 };
}

// Phase M.1 · smart-tier router · cheap classifier picks sub-pipelines
//
// CrewAI's hierarchical-process insight applied to our parallel
// orchestrator · a router LLM looks at the question + plan and picks
// which 1-2 sub-pipelines to run instead of mega's fire-all-5 pattern.
// Typical mega cost ~$0.20 · smart routes to 1-2 sources for ~$0.015.
//
// Returns a JSON list of source names to invoke. Falls back to fanout
// only on parse failure (cheapest safe default).
//
// Phase S.3 · smart-tier inherits R + S.1 persona wiring automatically:
// when the router picks "multi", it calls runMultiAgent(question, plan)
// (the wrapper above), which now passes typed personas per plan line
// via classifyStepIntent(). No separate wiring needed here · the
// router's selection mechanism is orthogonal to persona steering.
export type SmartSource = "research" | "multi" | "fan" | "ghost" | "wisdom";

interface RouterDecision {
  use: SmartSource[];
  reason: string;
}

async function runRouter(
  question: string,
  plan: string,
  acc?: CostAccumulator,
  signal?: AbortSignal,
): Promise<RouterDecision> {
  // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
  // Routed via makeTracedAiChat factory · inherits the daily-budget gate
  // installed in traced-aichat.ts. Drop-in: call signature unchanged.
  const aiChat = tracedAiChat;
  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are a sub-pipeline ROUTER for Nick's reasoning engine. Given a question and its plan, pick which 1-3 sources to invoke.

SOURCES:
- "fan"      · 3-lens pretask fanout (research/risk/plan) · best for: decisions, trade-offs, multi-faceted analysis
- "research" · multi-round deep web research (Perplexity) · best for: facts, news, market data, anything time-sensitive
- "multi"    · multi-agent parallel sub-agents · best for: decomposable tasks, compare-N, synthesis
- "ghost"    · operator-state predictions · best for: questions about the operator's own patterns/goals
- "wisdom"   · related Buffett/Naval/Munger/etc quotes · best for: principle/philosophy/strategy framing

PICK SPARINGLY. The default is "fan" if you're unsure. Add more only when each truly helps. Output JSON:
{
  "use": ["fan", "research"],
  "reason": "decision question · needs web data + risk analysis"
}

NO COMMENTARY. NO MARKDOWN. Max 3 sources.`,
      },
      // SAFE: question + plan are operator-owned · plan came from our
      // own runPlan call · the router is a sub-LLM deciding which
      // pipelines to invoke · PI-001 false positive.
      { role: "user", content: `QUESTION:\n${question}\n\nPLAN:\n${plan}` },
    ],
    "fast",
    { signal },
  );
  recordReply(acc, reply);
  const text = (reply?.content ?? "").trim();
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned);
    const VALID: SmartSource[] = ["research", "multi", "fan", "ghost", "wisdom"];
    const use = (Array.isArray(parsed.use) ? parsed.use : [])
      .filter((s: unknown): s is SmartSource => typeof s === "string" && VALID.includes(s as SmartSource))
      .slice(0, 3);
    return {
      use: use.length > 0 ? use : ["fan"],
      reason: typeof parsed.reason === "string" ? parsed.reason : "router default",
    };
  } catch {
    // Parse failure · safe default · just fanout
    return { use: ["fan"], reason: "router parse failed · defaulted to fanout" };
  }
}

// Phase H.2 · mega-tier helpers · ghost-nick predictions + wisdom

async function runGhostContext(): Promise<string> {
  try {
    const { buildGhostContextBlock } = await import("@/lib/brain/ghost-nick");
    const block = await buildGhostContextBlock();
    return (block ?? "").trim();
  } catch {
    return "";
  }
}

async function runWisdomContext(question: string): Promise<string> {
  try {
    const { findRelatedWisdom } = await import("@/lib/brain/wisdom-suggest");
    const suggestions = await findRelatedWisdom(question, 3);
    if (suggestions.length === 0) return "";
    return suggestions
      .map((s, i) => `[${i + 1}] ${s.source}: ${s.text}`)
      .join("\n\n");
  } catch {
    return "";
  }
}

async function runDraft(
  question: string,
  context: string,
  brainContext?: string,
  acc?: CostAccumulator,
  signal?: AbortSignal,
): Promise<string> {
  // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
  // Routed via makeTracedAiChat factory · inherits the daily-budget gate
  // installed in traced-aichat.ts. Drop-in: call signature unchanged.
  const aiChat = tracedAiChat;

  // Greene + dark-psychology tactical context injection (2026-06-20).
  // Deterministic keyword match · sub-millisecond · self-gating (returns ""
  // when nothing matches). Prepended to the reasoning context so the draft
  // step sees relevant tactical patterns alongside fanout/tool data.
  let tacticalContext = "";
  try {
    const [greeneBlock, darkPsychBlock] = await Promise.all([
      (async () => {
        const { pickContextualLawsForMessage, renderGreeneBlock } =
          await import("@/lib/ai/greene-message-matcher");
        const picks = await pickContextualLawsForMessage(question);
        return renderGreeneBlock(picks);
      })(),
      (async () => {
        const { pickDarkPsychologyForMessage, renderDarkPsychologyBlock } =
          await import("@/lib/ai/dark-psychology-matcher");
        const picks = await pickDarkPsychologyForMessage(question);
        return renderDarkPsychologyBlock(picks);
      })(),
    ]);
    const blocks = [greeneBlock, darkPsychBlock].filter(Boolean);
    if (blocks.length > 0) {
      tacticalContext = blocks.join("\n\n") + "\n\n---\n\n";
    }
  } catch {
    // Best-effort · tactical context failures must never block the draft.
  }

  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are Nick · the operator's strategic AI co-pilot.

You have CONTEXT below (fanout lenses, multi-agent analysis, or deep research). Use it to write a clear, direct, useful answer to the question. Cite specific items from the context when relevant. Prefer concrete over vague. No filler. No hedging.

If the context is empty or contradicts itself, say so explicitly and proceed with your best judgment.`,
      },
      brainContext
        ? {
            role: "system" as const,
            content: `Operator's current context:\n${brainContext.slice(0, 16000)}`,
          }
        : null,
      {
        role: "system" as const,
        content: `Reasoning context:\n${(tacticalContext + context).slice(0, 4000)}`,
      },
      { role: "user", content: question },
    ].filter((m): m is { role: "system" | "user" | "assistant"; content: string } => m !== null),
    "reason",
    { signal },
  );
  recordReply(acc, reply);
  return (reply?.content ?? "").trim();
}

async function runCritique(
  question: string,
  draft: string,
  brainContext?: string,
  acc?: CostAccumulator,
  signal?: AbortSignal,
): Promise<{ issues: string[]; suggestions: string[]; verdict: "ship" | "refine" }> {
  // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
  // Routed via makeTracedAiChat factory · inherits the daily-budget gate
  // installed in traced-aichat.ts. Drop-in: call signature unchanged.
  const aiChat = tracedAiChat;
  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are an adversarial critic. Given a question + a draft answer, list the MOST IMPORTANT issues. Be specific not generic.

CRITIQUE RULES:
1. No sycophancy: Ensure Nick doesn't just agree or flatter the operator.
2. Brevity & Punch: Check if the response is too verbose or contains fluff.
3. Truth Rule: Nick must not fabricate tools or action blocks he cannot run, and must only mention tools/actions that are real.
4. Willpower vs. Environment: If the draft accepts or agrees with the operator simply "trying harder next time" or relying on discipline/willpower, issue a "refine" verdict and suggest recommending a system/environment change instead (e.g. SOP, calendar block, physical constraints).

Output JSON only:
{
  "issues": ["..."],
  "suggestions": ["..."],
  "verdict": "ship" | "refine"
}

"verdict" is "ship" if the answer is good enough · "refine" if material issues exist.`,
      },
      brainContext
        ? {
            role: "system" as const,
            content: `Operator's context & rules:\n${brainContext.slice(0, 4000)}`,
          }
        : null,
      {
        role: "user",
        content: `QUESTION:\n${sanitizeForPrompt(question)}\n\nDRAFT:\n${sanitizeForPrompt(draft)}`,
      },
    ].filter((m): m is { role: "system" | "user" | "assistant"; content: string } => m !== null),
    "fast",
    { signal },
  );
  recordReply(acc, reply);
  const text = (reply?.content ?? "").trim();
  try {
    // Tolerant JSON parse · the model sometimes wraps in ```json
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(cleaned);
    return {
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 5).map(String) : [],
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.slice(0, 5).map(String)
        : [],
      verdict: parsed.verdict === "refine" ? "refine" : "ship",
    };
  } catch {
    // If the critic returns malformed JSON, default to ship · we'd
    // rather deliver the draft than block.
    return { issues: [], suggestions: [], verdict: "ship" };
  }
}

async function runRefine(
  question: string,
  draft: string,
  critique: { issues: string[]; suggestions: string[] },
  brainContext?: string,
  acc?: CostAccumulator,
  signal?: AbortSignal,
): Promise<string> {
  if (critique.issues.length === 0 && critique.suggestions.length === 0) {
    return draft;
  }
  // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
  // Routed via makeTracedAiChat factory · inherits the daily-budget gate
  // installed in traced-aichat.ts. Drop-in: call signature unchanged.
  const aiChat = tracedAiChat;
  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are Nick. A critic flagged issues in your draft answer. Fix THE MATERIAL ones · do not over-correct cosmetic issues. Re-write the answer to address the issues + apply the relevant suggestions.

Preserve Nick's character and strict guidelines (no sycophancy, default brevity, truth rule, willpower-vs-environment check).

OUTPUT: the refined answer only · no commentary · no preamble.`,
      },
      brainContext
        ? {
            role: "system" as const,
            content: `Operator's context & rules:\n${brainContext.slice(0, 4000)}`,
          }
        : null,
      {
        role: "user",
        content: `QUESTION:\n${sanitizeForPrompt(question)}\n\nORIGINAL DRAFT:\n${sanitizeForPrompt(draft)}\n\nISSUES:\n${critique.issues.map((i) => `- ${sanitizeForPrompt(i)}`).join("\n")}\n\nSUGGESTIONS:\n${critique.suggestions.map((s) => `- ${sanitizeForPrompt(s)}`).join("\n")}`,
      },
    ].filter((m): m is { role: "system" | "user" | "assistant"; content: string } => m !== null),
    "reason",
    { signal },
  );
  recordReply(acc, reply);
  return (reply?.content ?? draft).trim();
}

// ── Tool-gather step · NICK_DEEP_REASONING feature ─────────────────
//
// When the NICK_DEEP_REASONING flag is on, the engine can call a curated
// set of read-only tools (getDashboardSummary, getRevenueStats, etc.)
// during its gather phase. This grounds the reasoning in REAL business
// data instead of the model inventing figures.
//
// Uses `generateText` from the Vercel AI SDK with tools enabled,
// bypassing the tool-less `aiChat` path. The LLM decides which tools
// to call based on the question + plan — no hardcoded pre-fetch.
//
// Safety: only READ tools are exposed via getReasoningTools() whitelist.
// The engine OBSERVES, never ACTS.

async function runToolGather(
  question: string,
  plan: string,
  acc?: CostAccumulator,
): Promise<{ toolContext: string; toolsCalled: string[]; durationMs: number }> {
  const t = Date.now();
  const empty = { toolContext: "", toolsCalled: [], durationMs: 0 };

  // Gate: only run when the deep-reasoning flag is on
  const flagOn = getFlag("NICK_DEEP_REASONING")?.isOn ?? false;
  if (!flagOn) return empty;

  try {
    const { generateText, stepCountIs } = await import("ai");
    const { getModel } = await import("@/lib/ai/provider");
    const { getReasoningTools } = await import("./reasoning-tools");

    const tools = getReasoningTools();
    if (Object.keys(tools).length === 0) return empty;

    const model = getModel("fast");

    const result = await generateText({
      model,
      system: `You are a data-gathering assistant for Nick's reasoning engine. Your ONLY job is to call the available tools to fetch real business data that is relevant to the question and plan below. Call 1-3 tools max. Do NOT answer the question — just gather data. If no tools are relevant, output "NO_TOOLS_NEEDED".

QUESTION: ${question}

PLAN: ${plan || "(no plan)"}`,
      messages: [
        { role: "user", content: "Gather the relevant data now." },
      ],
      tools: tools as Parameters<typeof generateText>["0"]["tools"],
      stopWhen: stepCountIs(3),
    });

    // Extract tool results from the steps
    const toolsCalled: string[] = [];
    const toolOutputs: string[] = [];

    for (const step of result.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        toolsCalled.push(call.toolName);
      }
      // forensic-audit HIGH · AI SDK v6 (StaticToolResult) exposes the tool
      // return value as `output`, NOT `result` (verified against installed
      // ai@6.0.162 index.d.ts). Reading `.result` yielded undefined →
      // JSON.stringify(undefined) is undefined → .slice() threw → the outer
      // catch swallowed it → NICK_DEEP_REASONING drafted with ZERO live data
      // (fabricated figures — the exact failure the feature prevents).
      for (const res of step.toolResults ?? []) {
        const entry = res as unknown as { toolName: string; output: unknown };
        const resultStr = typeof entry.output === "string"
          ? entry.output
          : JSON.stringify(entry.output, null, 2);
        toolOutputs.push(
          `## ${entry.toolName} result\n${(resultStr ?? "").slice(0, 2000)}`,
        );
      }
    }

    // Track cost
    if (acc) {
      acc.calls += 1;
      acc.callsWithoutCost += 1; // generateText doesn't report costUsd
    }

    const toolContext = toolOutputs.length > 0
      ? `# LIVE DATA (from tool calls)\n\n${toolOutputs.join("\n\n")}`
      : "";

    log.info("tool_gather_completed", {
      toolsCalled,
      toolCount: toolsCalled.length,
      contextLength: toolContext.length,
      durationMs: Date.now() - t,
    });

    return {
      toolContext,
      toolsCalled,
      durationMs: Date.now() - t,
    };
  } catch (err) {
    log.warn("tool_gather_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { ...empty, durationMs: Date.now() - t };
  }
}

// ── The main engine ────────────────────────────────────────────────

/**
 * Run the Nick reasoning engine for a given question.
 *
 * Steps depend on tier:
 *   · quick    · this function shouldn't be called · return passthrough trace
 *   · standard · plan → fanout → draft → critique → (refine?) → deliver
 *   · deep     · plan → fanout → multi-agent → draft → critique → refine → deliver
 *   · thorough · plan → deep-research → multi-agent → draft → critique → refine → deliver
 */
async function runReasoningEngine(
  request: ReasoningRequest,
  onStep?: (step: ReasoningStep) => void,
): Promise<ReasoningResult> {
  const startedAt = Date.now();
  const rec = makeRecorder(startedAt, onStep);
  // H.5.1 · per-run cost accumulator · sub-fns push into this · buildResult
  // prefers acc.usd over the per-tier estimate when non-zero.
  const acc = makeAccumulator();

  // Step 1 · classify
  const classifyStart = Date.now();
  const baseVerdict = request.tier
    ? { tier: request.tier, reason: "operator-explicit override" }
    : classifyReasoning(request.question);
  // N.2 · classifier tuner · adjusts the verdict based on learned
  // marker-quality (H.5.3) data. Only DEMOTES · never promotes. Skips
  // entirely for operator-explicit tier overrides. Refreshes from
  // BrainMemory every 30min · in-memory cache otherwise.
  let verdict = baseVerdict;
  let adjusted = false;
  if (!request.tier) {
    try {
      const { maybeAdjustTier } = await import("./classifier-tuner");
      const tunerResult = await maybeAdjustTier(baseVerdict.reason, baseVerdict.tier);
      if (tunerResult.adjusted) {
        verdict = {
          tier: tunerResult.tier,
          reason: `${baseVerdict.reason} · tuned-down from ${baseVerdict.tier} (marker history: ${tunerResult.verdict?.verdict}, avg-conf ${tunerResult.verdict?.avgConfidence.toFixed(2)})`,
        };
        adjusted = true;
      }
    } catch {
      // Tuner failed · proceed with base verdict (no degradation)
    }
  }
  rec.push(
    "classify",
    adjusted
      ? `tier: ${verdict.tier} (tuned from ${baseVerdict.tier}) · ${verdict.reason.slice(0, 120)}`
      : `tier: ${verdict.tier} · ${verdict.reason}`,
    verdict,
    Date.now() - classifyStart,
  );

  const tier = verdict.tier;
  let callCount = 0;

  // Quick tier · the engine shouldn't be called for this · but if it is,
  // pass straight through with a single aiChat call.
  if (tier === "quick") {
    // wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
  // Routed via makeTracedAiChat factory · inherits the daily-budget gate
  // installed in traced-aichat.ts. Drop-in: call signature unchanged.
  const aiChat = tracedAiChat;
    const t = Date.now();
    const reply = await aiChat(
      [
        { role: "system", content: "You are Nick. Answer concisely." },
        { role: "user", content: request.question },
      ],
      "fast",
    );
    recordReply(acc, reply);
    callCount += 1;
    rec.push("deliver", "quick reply", null, Date.now() - t);
    const answer = (reply?.content ?? "").trim();
    return buildResult(rec, answer, 0.7, startedAt, tier, verdict.reason, callCount, acc);
  }

  // Step 2 · plan
  let plan = "";
  try {
    const t = Date.now();
    plan = await runPlan(request.question, tier, acc);
    callCount += 1;
    rec.push(
      "plan",
      plan ? "drafted execution plan" : "plan call returned empty",
      plan ? plan.slice(0, 400) : null,
      Date.now() - t,
    );
  } catch (err) {
    log.warn("plan_failed", { err: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    rec.push("plan", "plan step failed · continuing with empty plan");
  }

  // Step 2.5 · tool gather (NICK_DEEP_REASONING gated)
  // When the flag is on, the engine calls read-only tools to fetch
  // real business data. The tool context is prepended to the main
  // context so the draft step sees real numbers.
  let toolContext = "";
  try {
    const tg = await runToolGather(request.question, plan, acc);
    if (tg.toolContext) {
      toolContext = tg.toolContext;
      callCount += 1;
      rec.push(
        "tool_call",
        `tool gather · ${tg.toolsCalled.length} tool${tg.toolsCalled.length === 1 ? "" : "s"} called: ${tg.toolsCalled.join(", ") || "none"}`,
        { toolsCalled: tg.toolsCalled, contextLength: tg.toolContext.length },
        tg.durationMs,
      );
    }
  } catch (err) {
    log.warn("tool_gather_step_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    rec.push("tool_call", "tool gather failed · continuing without live data");
  }

  // Step 3 · context gather (fanout · multi-agent · deep-research · mega)
  let context = "";

  // H.8 · helper to ingest a sub-pipeline result into the accumulator.
  // Hoisted above the smart/mega/sequential blocks so all three share
  // the one definition (the acc-update logic was previously copy-pasted
  // inline in smart + mega). Closes over the mutable `callCount` + `acc`.
  const ingestSubPipeline = (res: SubPipelineResult) => {
    callCount += res.callCount;
    if (res.usd > 0) {
      acc.usd += res.usd;
      acc.calls += res.callCount;
    } else {
      acc.calls += res.callCount;
      acc.callsWithoutCost += res.callCount;
    }
  };

  // M.1 · smart tier · CrewAI-inspired hierarchical router
  // A cheap router LLM (~$0.001) looks at the question + plan and
  // picks 1-3 of the 5 mega-tier sources to invoke. Saves ~85% of
  // mega's cost on questions that don't need everything.
  if (tier === "smart") {
    const t = Date.now();
    const decision = await runRouter(request.question, plan, acc).catch(() => ({
      use: ["fan"] as SmartSource[],
      reason: "router threw · defaulted to fanout",
    }));
    rec.push(
      "agent_call",
      `router · picked ${decision.use.length} source${decision.use.length === 1 ? "" : "s"}: ${decision.use.join(", ")} · ${decision.reason.slice(0, 100)}`,
      decision,
      Date.now() - t,
    );
    const SOURCE_BUDGETS_SMART = {
      research: 45_000,
      multi: 20_000,
      fan: 15_000,
      ghost: 5_000,
      wisdom: 5_000,
    };
    const tt = Date.now();
    const pickedPromises = decision.use.map((src) => {
      const timeoutSignal = AbortSignal.timeout(SOURCE_BUDGETS_SMART[src]);
      const startedAt = Date.now();
      const builder: () => Promise<{ name: SmartSource; content: string; callCount: number; usd: number }> = async () => {
        try {
          if (src === "research") {
            const r = await runDeepResearch(request.question);
            return { name: src, content: r.content, callCount: r.callCount, usd: r.usd };
          }
          if (src === "multi") {
            const r = await runMultiAgent(request.question, plan);
            return { name: src, content: r.content, callCount: r.callCount, usd: r.usd };
          }
          if (src === "fan") {
            const r = await runFanout(request.question, request.brainContext);
            return { name: src, content: r.content, callCount: r.callCount, usd: r.usd };
          }
          if (src === "ghost") {
            const s = await runGhostContext();
            return { name: src, content: s, callCount: 0, usd: 0 };
          }
          const s = await runWisdomContext(request.question);
          return { name: src, content: s, callCount: 0, usd: 0 };
        } catch {
          return { name: src, content: "", callCount: 0, usd: 0 };
        }
      };
      const { promise, resolve } = Promise.withResolvers<{
        name: SmartSource;
        content: string;
        callCount: number;
        usd: number;
      }>();
      const fallback = { name: src, content: "", callCount: 0, usd: 0 };
      timeoutSignal.addEventListener(
        "abort",
        () => {
          const wastedMs = Date.now() - startedAt;
          void recordOrphan(`smart:${src}`, wastedMs).catch(() => {});
          resolve(fallback);
        },
        { once: true },
      );
      builder().then((v) => {
        if (!timeoutSignal.aborted) resolve(v);
      });
      return promise;
    });
    const results = await Promise.all(pickedPromises);
    // H.8 · ingestSubPipeline does `callCount += r.callCount` per result,
    // summing to the same total the prior `results.reduce(... callCount)`
    // produced · plus the identical acc.usd/calls/callsWithoutCost update.
    for (const r of results) ingestSubPipeline(r);
    const parts: string[] = [];
    const labels: Record<SmartSource, string> = {
      research: "# DEEP RESEARCH",
      multi: "# MULTI-AGENT SYNTHESIS",
      fan: "# FANOUT (research / risk / plan)",
      ghost: "# GHOST NICK PREDICTIONS",
      wisdom: "# RELATED WISDOM",
    };
    for (const r of results) {
      if (r.content) parts.push(`${labels[r.name]}\n${r.content}`);
    }
    context = parts.join("\n\n---\n\n");
    rec.push(
      "tool_call",
      `smart composite · ${parts.length}/${decision.use.length} picked sources landed`,
      {
        picked: decision.use,
        reason: decision.reason,
        landed: results.filter((r) => r.content).map((r) => r.name),
      },
      Date.now() - tt,
    );
  }

  // Mega tier · run EVERYTHING in parallel and compose · deep-research +
  // multi-agent + fanout + ghost-nick + wisdom. The biggest hammer for
  // the hardest questions. ~60-120s wall · ~$0.20+. Each piece tolerant
  // of failure · we synthesize whatever lands.
  //
  // H.4.3 · per-source max-wait budget. Pre-fix, a slow deep-research
  // call could block the whole composition for 90s. Now each source
  // races against its own timeout · whatever lands in time gets
  // composed · the others return empty strings.
  //
  // H.6.1 · AbortController + orphan-cost telemetry. Pre-H.6 the
  // timed-out promises kept running, burning LLM tokens whose results
  // were discarded. Now:
  //   · each source gets its own AbortController · timeout fires abort
  //     (sub-pipelines that honor signal cancel · ones that don't, the
  //     fix is a future plumb-through)
  //   · we track the eventual resolution of timed-out promises in a
  //     wasted-spend counter visible in /reason/telemetry
  if (tier === "mega") {
    const t = Date.now();
    const SOURCE_BUDGETS = {
      research: 60_000, // deep-research is the slowest · biggest budget
      multi: 25_000,
      fan: 15_000,
      ghost: 5_000,
      wisdom: 5_000,
    };
    // L.1 + L.5 · AbortSignal.timeout for cancellation + Promise.withResolvers
    // for the race. Sub-pipelines that honor signal (engine sub-fns
    // via aiChat) get their fetch aborted on budget timeout · the
    // orphan-promise spend leak from H.6.1 is closed at the
    // architectural level for any path that wires the signal through.
    const withBudget = <T,>(
      sourceName: string,
      buildPromise: (signal: AbortSignal) => Promise<T>,
      ms: number,
      fallback: T,
    ): Promise<T> => {
      const timeoutSignal = AbortSignal.timeout(ms);
      const startedAt = Date.now();
      const { promise, resolve } = Promise.withResolvers<T>();
      // When timeout fires, resolve with fallback · the original promise
      // is allowed to either complete (and be recorded as orphan) OR
      // honor the signal and reject with AbortError (preferred · no
      // wasted spend).
      timeoutSignal.addEventListener(
        "abort",
        () => resolve(fallback),
        { once: true },
      );
      buildPromise(timeoutSignal)
        .then((v) => {
          if (timeoutSignal.aborted) {
            // We lost the race AND the sub-pipeline didn't honor abort
            // (legacy code path). Log orphan + drop result.
            const wastedMs = Date.now() - startedAt;
            void recordOrphan(sourceName, wastedMs).catch(() => {
              /* best-effort */
            });
          } else {
            resolve(v);
          }
        })
        .catch((err) => {
          // AbortError means cancellation worked · NOT an orphan
          if (
            err &&
            ((err as { name?: string }).name === "AbortError" ||
              /abort/i.test(String((err as { message?: string }).message ?? "")))
          ) {
            // Race already resolved with fallback · no-op
            return;
          }
          if (!timeoutSignal.aborted) resolve(fallback);
        });
      return promise;
    };
    // H.8 · sub-pipelines now return { content, callCount, usd } · we
    // accumulate real counts + costs (when known) instead of the
    // pre-H.8 magic `callCount += 5 + 4 + 3`. Empty-fallback shape
    // matches so the timeout path doesn't crash on .content access.
    const emptyPipe: SubPipelineResult = { content: "", callCount: 0, usd: 0 };
    // L.1 · build-on-demand pattern · withBudget passes the timeout
    // signal into the builder so sub-pipelines that honor it (engine
    // sub-fns) can abort their underlying fetch on timeout. Sub-
    // pipelines that don't yet honor signal (runMultiAgent ·
    // runDeepResearch · runFanout · runGhostContext · runWisdomContext)
    // continue to leak orphans until their internal aiChat calls are
    // wired through · future scope L+ wave.
    const [research, multi, fan, ghost, wisdom] = await Promise.all([
      withBudget(
        "research",
        () => runDeepResearch(request.question).catch(() => emptyPipe),
        SOURCE_BUDGETS.research,
        emptyPipe,
      ),
      withBudget(
        "multi",
        () => runMultiAgent(request.question, plan).catch(() => emptyPipe),
        SOURCE_BUDGETS.multi,
        emptyPipe,
      ),
      withBudget(
        "fan",
        () => runFanout(request.question, request.brainContext).catch(() => emptyPipe),
        SOURCE_BUDGETS.fan,
        emptyPipe,
      ),
      withBudget(
        "ghost",
        () => runGhostContext().then((s) => ({ content: s, callCount: 0, usd: 0 })),
        SOURCE_BUDGETS.ghost,
        emptyPipe,
      ),
      withBudget(
        "wisdom",
        () => runWisdomContext(request.question).then((s) => ({
          content: s,
          callCount: 0,
          usd: 0,
        })),
        SOURCE_BUDGETS.wisdom,
        emptyPipe,
      ),
    ]);
    // H.8 · real callCount + cost from sub-pipelines, replacing magic
    // constants. ingestSubPipeline does the identical `callCount +=` plus
    // acc.usd/calls/callsWithoutCost update the three inline blocks did;
    // ghost + wisdom report callCount:0 so they're intentionally skipped
    // (the prior code only ingested research/multi/fan — preserved).
    ingestSubPipeline(research);
    ingestSubPipeline(multi);
    ingestSubPipeline(fan);
    const parts: string[] = [];
    if (research.content) parts.push(`# DEEP RESEARCH\n${research.content}`);
    if (multi.content) parts.push(`# MULTI-AGENT SYNTHESIS\n${multi.content}`);
    if (fan.content) parts.push(`# FANOUT (research / risk / plan)\n${fan.content}`);
    if (ghost.content) parts.push(`# GHOST NICK PREDICTIONS\n${ghost.content}`);
    if (wisdom.content) parts.push(`# RELATED WISDOM\n${wisdom.content}`);
    context = parts.join("\n\n---\n\n");
    const dropped = 5 - parts.length;
    rec.push(
      "tool_call",
      `mega composite · ${parts.length}/5 sources landed${dropped > 0 ? ` · ${dropped} timed out` : ""} · ${research.callCount + multi.callCount + fan.callCount} real calls`,
      {
        research: research.content ? research.content.slice(0, 200) : "(timed out or empty)",
        multi: multi.content ? multi.content.slice(0, 200) : "(timed out or empty)",
        fan: fan.content ? fan.content.slice(0, 200) : "(timed out or empty)",
        ghost: ghost.content ? ghost.content.slice(0, 200) : "(timed out or empty)",
        wisdom: wisdom.content ? wisdom.content.slice(0, 200) : "(timed out or empty)",
        budgets: SOURCE_BUDGETS,
        realCallCount: {
          research: research.callCount,
          multi: multi.callCount,
          fan: fan.callCount,
          realUsd: Math.round((research.usd + multi.usd + fan.usd) * 1000) / 1000,
        },
      },
      Date.now() - t,
    );
  }

  if (!context && tier === "thorough") {
    try {
      const t = Date.now();
      const dr = await runDeepResearch(request.question);
      ingestSubPipeline(dr);
      context = dr.content;
      rec.push(
        "tool_call",
        `deep research · ${context.length} chars synthesized · ${dr.callCount} real calls`,
        context.slice(0, 600),
        Date.now() - t,
      );
    } catch (err) {
      log.warn("deep_research_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      rec.push("tool_call", "deep research failed · falling back to fanout");
    }
  }

  if (!context && (tier === "deep" || tier === "thorough")) {
    try {
      const t = Date.now();
      const multi = await runMultiAgent(request.question, plan);
      ingestSubPipeline(multi);
      context = multi.content;
      rec.push(
        "agent_call",
        `multi-agent synthesis composed · ${multi.callCount} sub-agents${multi.usd > 0 ? ` · $${multi.usd.toFixed(4)}` : ""}`,
        multi.content.slice(0, 600),
        Date.now() - t,
      );
    } catch (err) {
      log.warn("multi_agent_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      rec.push("agent_call", "multi-agent failed · falling back to fanout");
    }
  }

  // Universal context fallback: ANY tier still without context (smart /
  // quick / mega included) drops to a 3-lens fanout here. thorough/deep get
  // richer pre-fallbacks above (@deep-research, @multi-agent); smart relies
  // on THIS catch-all by design — its router already samples the same
  // sources, so a tier-specific guard would be redundant. (2026-06-04 · M6
  // reviewed: smart is NOT unguarded — empty smart context lands here.)
  if (!context) {
    try {
      const t = Date.now();
      const fan = await runFanout(request.question, request.brainContext);
      ingestSubPipeline(fan);
      context = fan.content;
      rec.push(
        "fanout",
        `3-lens fanout composed (research · risk · plan) · ${fan.callCount} calls`,
        fan.content.slice(0, 600),
        Date.now() - t,
      );
    } catch (err) {
      log.warn("fanout_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      rec.push("fanout", "fanout failed · drafting without context");
    }
  }

  // Step 4 · draft
  // Prepend tool-gathered live data to the context so the draft step
  // sees real business numbers alongside fanout/multi-agent context.
  const fullContext = toolContext
    ? `${toolContext}\n\n---\n\n${context}`
    : context;
  let draft = "";
  try {
    const t = Date.now();
    draft = await runDraft(request.question, fullContext, request.brainContext, acc);
    callCount += 1;
    rec.push(
      "deliver",
      "draft answer written",
      draft.slice(0, 400),
      Date.now() - t,
    );
  } catch (err) {
    log.warn("draft_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    rec.push("deliver", "draft failed · returning Nick-voiced fallback");
    // H.4.4 · Nick-voiced fallback, not raw context. Pre-fix we returned
    // the composed fanout/multi-agent context as the answer, which is
    // unstructured reasoning notes the operator never asked to see.
    // Now we acknowledge the failure in Nick's voice and surface a
    // truncated context preview as a footnote so the operator can
    // still extract value if they want to.
    const contextPreview = context
      ? `\n\n---\n\nRaw reasoning notes (engine couldn't compose them into prose):\n${context.slice(0, 800)}${context.length > 800 ? "…" : ""}`
      : "";
    const fallback = `I gathered context for this but the synthesis step failed — likely a provider hiccup. Try re-asking (the engine cached nothing, so this is a fresh shot). If it fails again, drop the tier from "${tier}" to "standard" — it routes through different providers.${contextPreview}`;
    return buildResult(
      rec,
      fallback,
      0.2, // honest low confidence
      startedAt,
      tier,
      verdict.reason,
      callCount,
      acc,
    );
  }

  // Step 5 · critique + refine · O.1 reads from TIER_CONFIG instead of
  // hardcoded tier list · adding a new tier with `hasCritique: true`
  // automatically opts it in.
  let final = draft;
  let confidence = 0.75;
  if (TIER_CONFIG[tier].hasCritique && TIER_CONFIG[tier].hasRefine) {
    try {
      const t = Date.now();
      const critique = await runCritique(request.question, draft, request.brainContext, acc);
      callCount += 1;
      rec.push(
        "critique",
        critique.verdict === "ship"
          ? "critique · ship as-is"
          : `critique · ${critique.issues.length} issue${critique.issues.length === 1 ? "" : "s"} · refining`,
        critique,
        Date.now() - t,
      );
      if (critique.verdict === "refine") {
        const tr = Date.now();
        final = await runRefine(request.question, draft, critique, request.brainContext, acc);
        callCount += 1;
        rec.push(
          "refine",
          "answer refined to address critique",
          final.slice(0, 400),
          Date.now() - tr,
        );
        confidence = 0.85;
      } else {
        confidence = 0.9;
      }
    } catch (err) {
      log.warn("critique_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      rec.push("critique", "critique failed · shipping draft as-is");
    }
  } else if (TIER_CONFIG[tier].hasCritique && !TIER_CONFIG[tier].hasRefine) {
    // Critique-only tiers (currently `standard`) · cheaper critique pass,
    // ships the draft regardless of verdict · skip refinement. Config-gated
    // (was `tier === "standard"`) so a future critique-only tier opts in
    // automatically. Behavior here is DELIBERATELY distinct from the
    // refine-tiers block above (lower confidence, quieter trace, silent
    // catch) — do not merge them.
    try {
      const t = Date.now();
      const critique = await runCritique(request.question, draft, request.brainContext, acc);
      callCount += 1;
      rec.push(
        "critique",
        critique.verdict === "ship"
          ? "critique · ship"
          : `critique · ${critique.issues.length} issue${critique.issues.length === 1 ? "" : "s"} noted (standard tier ships anyway)`,
        critique,
        Date.now() - t,
      );
      confidence = critique.verdict === "ship" ? 0.85 : 0.75;
    } catch {
      // ignore · standard tier doesn't require critique
    }
  }

  return buildResult(rec, final, confidence, startedAt, tier, verdict.reason, callCount, acc);
}

/** Phase H.2 · persist a completed reasoning run to BrainMemory so
 *  the system has a history of what Nick reasoned about + which tier
 *  + how long + what answer landed. Fire-and-forget · failure here
 *  must never block the result. Future engines can read this to learn
 *  which classifier verdicts produced wasted vs valuable runs.
 *
 *  H.4.2 · also opportunistically trims old rows · keeps the table
 *  bounded so reads stay fast and the operator's BrainMemory doesn't
 *  bloat with thousands of stale traces. */
async function persistTrace(
  question: string,
  result: ReasoningResult,
): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    // H.7.7 · crypto.randomUUID instead of Math.random · stronger
    // uniqueness · negligible cost difference · removes the birthday-
    // paradox risk on busy days.
    const key = `reasoning_${result.tier}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const summary = result.trace.answer.length > 240
      ? result.trace.answer.slice(0, 237) + "…"
      : result.trace.answer;
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.REASONING_TRACE,
        key,
        content: `[${result.tier}] ${question.slice(0, 120)} → ${summary}`,
        confidence: result.trace.confidence,
        source: "reasoning-engine",
        createdBy: "system",
        metadata: {
          tier: result.tier,
          classifierReason: result.classifierReason,
          totalMs: result.trace.totalMs,
          calls: result.trace.cost.calls,
          usd: result.trace.cost.usd,
          stepCount: result.trace.steps.length,
          stepKinds: result.trace.steps.map((s) => s.kind),
          questionLength: question.length,
          answerLength: result.trace.answer.length,
        },
      },
    });

    // H.4.2 + H.7.4 · DETERMINISTIC rotation · every 10th write since
    // module load triggers a prune. Pre-H.7 was Math.random() < 0.1
    // which under burst writes could either over-prune (3 rotates in
    // a minute) or under-prune (no rotate for 50 writes). Deterministic
    // counter gives predictable cadence: exactly 1 prune per 10 writes.
    persistWriteCounter += 1;
    if (persistWriteCounter % ROTATION_EVERY_N === 0) {
      void rotateReasoningTraces();
    }
  } catch {
    // Best-effort · never let bookkeeping block the engine.
  }
}

/** H.7.4 · deterministic-rotation counter · module-scope so all
 *  persistTrace calls in the same process increment a shared counter.
 *  Resets to 0 on serverless cold start (acceptable · rotation will
 *  still fire periodically). */
let persistWriteCounter = 0;
const ROTATION_EVERY_N = 10;

/** H.6.1 · record a mega-tier source that exceeded its budget but
 *  eventually completed. The completed LLM work was discarded · the
 *  cost is real but unattributed to any run. Telemetry surfaces this
 *  so the operator can see how much spend is wasted on slow sources.
 *
 *  Stored as BrainMemory(category="reasoning_orphan") with metadata
 *  carrying the source name + wasted ms. /api/nick/reason/telemetry
 *  reads this category to compute a "wasted spend (last 24h)" stat.
 *
 *  Fire-and-forget · best-effort · failure here never blocks the
 *  engine which has already returned to the operator. */
async function recordOrphan(source: string, wastedMs: number): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.brainMemory.create({
      data: {
        category: BRAIN_CATEGORIES.REASONING_ORPHAN,
        // H.7.7 · same crypto.randomUUID upgrade
        key: `orphan_${source}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        content: `mega tier source "${source}" landed ${wastedMs}ms after budget timeout · cost wasted`,
        confidence: 0.5,
        source: "reasoning-engine",
        createdBy: "system",
        metadata: {
          sourceName: source,
          wastedMs,
          // Rough wasted-cost estimate based on which source it was.
          // The actual LLM call cost isn't known here (the source result
          // was discarded). Best-effort numbers · matches our per-tier
          // cost table proportions.
          estimatedWastedUsd:
            source === "research" ? 0.08 : source === "multi" ? 0.025 : source === "fan" ? 0.005 : 0.002,
        },
      },
    });
  } catch {
    // best-effort
  }
}

/** H.4.2 · trim the reasoning_trace table · keeps storage + read perf
 *  predictable. Called opportunistically from persistTrace. Public for
 *  the optional cron route at /api/cron/prune-reasoning-traces. */
export async function rotateReasoningTraces(): Promise<{
  deletedByAge: number;
  deletedByCap: number;
}> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const ageDel = await prisma.brainMemory.deleteMany({
      where: {
        category: BRAIN_CATEGORIES.REASONING_TRACE,
        createdAt: { lt: cutoff },
      },
    });
    // After age-pruning, enforce 500-row cap. Cheap because the index
    // on (category, createdAt) makes the offset query bounded.
    const count = await prisma.brainMemory.count({
      where: { category: BRAIN_CATEGORIES.REASONING_TRACE, deletedAt: null },
    });
    let capDel = 0;
    if (count > 500) {
      const excess = count - 500;
      const oldRows = await prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.REASONING_TRACE, deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: excess,
        select: { id: true },
      });
      const result = await prisma.brainMemory.deleteMany({
        where: { id: { in: oldRows.map((r) => r.id) } },
      });
      capDel = result.count;
    }
    return { deletedByAge: ageDel.count, deletedByCap: capDel };
  } catch (err) {
    log.warn("rotate_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return { deletedByAge: 0, deletedByCap: 0 };
  }
}

function buildResult(
  rec: ReturnType<typeof makeRecorder>,
  answer: string,
  confidence: number,
  startedAt: number,
  tier: ReasoningTier,
  classifierReason: string,
  callCount: number,
  acc?: CostAccumulator,
): ReasoningResult {
  const totalMs = Date.now() - startedAt;
  // H.5.1 · prefer real cost from the accumulator when present.
  // The accumulator captures aiChat() costUsd from every engine
  // sub-fn (plan / draft / critique / refine + quick-tier passthrough).
  // Sub-pipelines that have their own internal LLM calls (pretask-
  // fanout · multi-agent-orchestrator · deep-research) are not yet
  // threaded — their cost still leaks to the per-tier estimate. When
  // the accumulator's known portion is non-trivial we use it · else
  // we fall back to the estimate so cost is never reported as 0
  // (which would lie about spend).
  const accUsd = acc?.usd ?? 0;
  const accCalls = acc?.calls ?? 0;
  const callsWithoutCost = acc?.callsWithoutCost ?? 0;

  // Fall back to estimate when ANY of the following is true:
  //   · no accumulator passed (legacy callers)
  //   · accumulator reports zero (all calls were ollama-local or
  //     similar non-rated providers)
  //   · sub-pipeline calls dominate · we knew about <30% of the calls
  //     so the accumulator under-represents real spend
  // O.1 · reads from TIER_CONFIG single source of truth
  const callCost = TIER_CONFIG[tier].callCostEstimate;
  const estimateUsd = Math.round(callCount * callCost * 1000) / 1000;
  const knownRatio = accCalls > 0 ? (accCalls - callsWithoutCost) / Math.max(1, callCount) : 0;
  // If we know the cost of ≥30% of the calls AND the accumulator's
  // known portion is non-zero, trust it. Else fall back to estimate.
  const useReal = accUsd > 0 && knownRatio >= 0.3;
  const finalUsd = useReal ? Math.round(accUsd * 1000) / 1000 : estimateUsd;

  const trace: ReasoningTrace = {
    steps: rec.snapshot(),
    answer,
    confidence,
    totalMs,
    cost: {
      usd: finalUsd,
      calls: callCount,
    },
  };
  return { trace, tier, classifierReason };
}

// Phase H.2 · wrap the engine in a function that also persists the
// trace (fire-and-forget). The persistence is post-result so it
// never adds latency to the operator-facing path.
async function runReasoningWithPersist(
  request: ReasoningRequest,
): Promise<ReasoningResult> {
  const result = await runReasoningEngine(request);
  // H.7.3 · honor persist opt-out · sensitive runs skip the BrainMemory
  // trace write entirely. The run still completes; it's just invisible
  // in /reason/history.
  if (request.persist !== false) {
    void persistTrace(request.question, result);
  }
  return result;
}

/** Phase H.2 · streaming variant · same engine but fires onStep for
 *  every step as it lands. Returns the final result for the caller to
 *  emit a "complete" event. The SSE route uses this. */
export async function reasonStreaming(
  request: ReasoningRequest,
  onStep: (step: ReasoningStep) => void,
): Promise<ReasoningResult> {
  const result = await runReasoningEngine(request, onStep);
  if (request.persist !== false) {
    void persistTrace(request.question, result);
  }
  return result;
}

// Guarded entry · ensures the engine ALWAYS returns something even if
// the whole loop throws. Fallback returns a single-step trace with
// the bare question and a basic standard-tier passthrough.
// H.2 · mega tier gets a 180s timeout · runs DR + multi-agent in
// parallel which can stretch past the 90s budget on bad-network days.
export const reason = withGuardian(
  "reasoning-engine",
  runReasoningWithPersist,
  {
    timeoutMs: 180_000,
    maxRetries: 0, // each step has its own retry budget
  },
);

export const __internals = {
  runReasoningEngine,
  runPlan,
  runFanout,
  runMultiAgent,
  runDeepResearch,
  runDraft,
  runCritique,
  runRefine,
};
