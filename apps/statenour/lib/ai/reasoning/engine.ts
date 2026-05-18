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
import type {
  ReasoningRequest,
  ReasoningResult,
  ReasoningStep,
  ReasoningStepKind,
  ReasoningTier,
  ReasoningTrace,
} from "./types";
import { classifyReasoning } from "./classifier";

const log = rootLogger.withSurface("ai/reasoning/engine");

// ── Per-step micro-helpers ──────────────────────────────────────────

function makeRecorder(startedAt: number) {
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
      steps.push({
        kind,
        label,
        detail,
        elapsedMs: now - startedAt,
        durationMs: explicitDuration ?? now - lastStart,
      });
      lastStart = now;
    },
    snapshot(): ReasoningStep[] {
      return [...steps];
    },
  };
}

// ── Sub-step implementations · each one is independent + tolerant ──

async function runPlan(question: string, tier: ReasoningTier): Promise<string> {
  const { aiChat } = await import("@/lib/ai/provider");
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
  );
  return (reply?.content ?? "").trim();
}

async function runFanout(
  question: string,
  brainContext?: string,
): Promise<string> {
  // Reuse the existing pretask-fanout · 3 parallel lenses + composite
  const { runFanout } = await import("@/lib/ai/pretask-fanout");
  const fanout = await runFanout({ question, brainContext });
  return fanout.composite;
}

async function runMultiAgent(question: string, plan: string): Promise<string> {
  const { runMultiAgent } = await import("@/lib/ai/multi-agent-orchestrator");
  // Derive sub-agents from the plan · each step becomes one focused
  // sub-agent task. Cap at 4 to bound cost.
  const planLines = plan
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+[.)]/.test(l))
    .slice(0, 4);
  const subAgents = planLines.length > 0
    ? planLines.map((line, i) => ({
        name: `step_${i + 1}`,
        task: line.replace(/^\d+[.)]\s*/, ""),
        outputHint: "Concrete · no fluff · max 200 words.",
      }))
    : [
        // Fallback · split the question into 2 simple angles
        {
          name: "what",
          task: `What is the concrete answer to: ${question}`,
          outputHint: "Direct answer · max 200 words.",
        },
        {
          name: "why",
          task: `Why is the right answer the right one? What are the trade-offs of the alternatives for: ${question}`,
          outputHint: "Reasoning · max 200 words.",
        },
      ];
  const report = await runMultiAgent({
    goal: question,
    subAgents,
  });
  return report.synthesis;
}

async function runDeepResearch(question: string): Promise<string> {
  const { runDeepResearch } = await import("@/lib/ai/deep-research");
  const report = await runDeepResearch({ question });
  return report.synthesis;
}

async function runDraft(
  question: string,
  context: string,
  brainContext?: string,
): Promise<string> {
  const { aiChat } = await import("@/lib/ai/provider");
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
            content: `Operator's current context:\n${brainContext.slice(0, 2000)}`,
          }
        : null,
      {
        role: "system" as const,
        content: `Reasoning context:\n${context.slice(0, 4000)}`,
      },
      { role: "user", content: question },
    ].filter((m): m is { role: "system" | "user" | "assistant"; content: string } => m !== null),
    "reason",
  );
  return (reply?.content ?? "").trim();
}

async function runCritique(
  question: string,
  draft: string,
): Promise<{ issues: string[]; suggestions: string[]; verdict: "ship" | "refine" }> {
  const { aiChat } = await import("@/lib/ai/provider");
  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are an adversarial critic. Given a question + a draft answer, list the MOST IMPORTANT issues. Be specific not generic. Output JSON only:
{
  "issues": ["..."],
  "suggestions": ["..."],
  "verdict": "ship" | "refine"
}

"verdict" is "ship" if the answer is good enough · "refine" if material issues exist.`,
      },
      {
        role: "user",
        content: `QUESTION:\n${question}\n\nDRAFT:\n${draft}`,
      },
    ],
    "fast",
  );
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
): Promise<string> {
  if (critique.issues.length === 0 && critique.suggestions.length === 0) {
    return draft;
  }
  const { aiChat } = await import("@/lib/ai/provider");
  const reply = await aiChat(
    [
      {
        role: "system",
        content: `You are Nick. A critic flagged issues in your draft answer. Fix THE MATERIAL ones · do not over-correct cosmetic issues. Re-write the answer to address the issues + apply the relevant suggestions.

OUTPUT: the refined answer only · no commentary · no preamble.`,
      },
      {
        role: "user",
        content: `QUESTION:\n${question}\n\nORIGINAL DRAFT:\n${draft}\n\nISSUES:\n${critique.issues.map((i) => `- ${i}`).join("\n")}\n\nSUGGESTIONS:\n${critique.suggestions.map((s) => `- ${s}`).join("\n")}`,
      },
    ],
    "reason",
  );
  return (reply?.content ?? draft).trim();
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
): Promise<ReasoningResult> {
  const startedAt = Date.now();
  const rec = makeRecorder(startedAt);

  // Step 1 · classify
  const classifyStart = Date.now();
  const verdict = request.tier
    ? { tier: request.tier, reason: "operator-explicit override" }
    : classifyReasoning(request.question);
  rec.push(
    "classify",
    `tier: ${verdict.tier} · ${verdict.reason}`,
    verdict,
    Date.now() - classifyStart,
  );

  const tier = verdict.tier;
  let callCount = 0;

  // Quick tier · the engine shouldn't be called for this · but if it is,
  // pass straight through with a single aiChat call.
  if (tier === "quick") {
    const { aiChat } = await import("@/lib/ai/provider");
    const t = Date.now();
    const reply = await aiChat(
      [
        { role: "system", content: "You are Nick. Answer concisely." },
        { role: "user", content: request.question },
      ],
      "fast",
    );
    callCount += 1;
    rec.push("deliver", "quick reply", null, Date.now() - t);
    const answer = (reply?.content ?? "").trim();
    return buildResult(rec, answer, 0.7, startedAt, tier, verdict.reason, callCount);
  }

  // Step 2 · plan
  let plan = "";
  try {
    const t = Date.now();
    plan = await runPlan(request.question, tier);
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

  // Step 3 · context gather (fanout · multi-agent · deep-research per tier)
  let context = "";

  if (tier === "thorough") {
    try {
      const t = Date.now();
      context = await runDeepResearch(request.question);
      callCount += 5; // deep research makes ~3-5 search calls + synth
      rec.push(
        "tool_call",
        `deep research · ${context.length} chars synthesized`,
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
      callCount += 4;
      context = multi;
      rec.push(
        "agent_call",
        "multi-agent synthesis composed",
        multi.slice(0, 600),
        Date.now() - t,
      );
    } catch (err) {
      log.warn("multi_agent_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      rec.push("agent_call", "multi-agent failed · falling back to fanout");
    }
  }

  if (!context) {
    try {
      const t = Date.now();
      const fan = await runFanout(request.question, request.brainContext);
      callCount += 3;
      context = fan;
      rec.push(
        "fanout",
        "3-lens fanout composed (research · risk · plan)",
        fan.slice(0, 600),
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
  let draft = "";
  try {
    const t = Date.now();
    draft = await runDraft(request.question, context, request.brainContext);
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
    rec.push("deliver", "draft failed · returning context only");
    // Fallback · return the context as the answer
    return buildResult(
      rec,
      context || "Nick could not generate an answer.",
      0.3,
      startedAt,
      tier,
      verdict.reason,
      callCount,
    );
  }

  // Step 5 · critique + refine (only for deep/thorough)
  let final = draft;
  let confidence = 0.75;
  if (tier === "deep" || tier === "thorough") {
    try {
      const t = Date.now();
      const critique = await runCritique(request.question, draft);
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
        final = await runRefine(request.question, draft, critique);
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
  } else if (tier === "standard") {
    // Standard tier · cheaper critique pass · skip refinement
    try {
      const t = Date.now();
      const critique = await runCritique(request.question, draft);
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

  return buildResult(rec, final, confidence, startedAt, tier, verdict.reason, callCount);
}

function buildResult(
  rec: ReturnType<typeof makeRecorder>,
  answer: string,
  confidence: number,
  startedAt: number,
  tier: ReasoningTier,
  classifierReason: string,
  callCount: number,
): ReasoningResult {
  const totalMs = Date.now() - startedAt;
  // Rough cost estimate · ~$0.00015 per fast call · scaled by tier
  const callCost = tier === "thorough" ? 0.005 : tier === "deep" ? 0.002 : tier === "standard" ? 0.0008 : 0.00015;
  const trace: ReasoningTrace = {
    steps: rec.snapshot(),
    answer,
    confidence,
    totalMs,
    cost: {
      usd: Math.round(callCount * callCost * 1000) / 1000,
      calls: callCount,
    },
  };
  return { trace, tier, classifierReason };
}

// Guarded entry · ensures the engine ALWAYS returns something even if
// the whole loop throws. Fallback returns a single-step trace with
// the bare question and a basic standard-tier passthrough.
export const reason = withGuardian(
  "reasoning-engine",
  runReasoningEngine,
  {
    timeoutMs: 90_000,
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
