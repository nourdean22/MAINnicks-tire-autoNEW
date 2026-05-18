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
): Promise<string> {
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
  recordReply(acc, reply);
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
  recordReply(acc, reply);
  return (reply?.content ?? "").trim();
}

async function runCritique(
  question: string,
  draft: string,
  acc?: CostAccumulator,
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
  acc?: CostAccumulator,
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
  recordReply(acc, reply);
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
  onStep?: (step: ReasoningStep) => void,
): Promise<ReasoningResult> {
  const startedAt = Date.now();
  const rec = makeRecorder(startedAt, onStep);
  // H.5.1 · per-run cost accumulator · sub-fns push into this · buildResult
  // prefers acc.usd over the per-tier estimate when non-zero.
  const acc = makeAccumulator();

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

  // Step 3 · context gather (fanout · multi-agent · deep-research · mega)
  let context = "";

  // Mega tier · run EVERYTHING in parallel and compose · deep-research +
  // multi-agent + fanout + ghost-nick + wisdom. The biggest hammer for
  // the hardest questions. ~60-120s wall · ~$0.20+. Each piece tolerant
  // of failure · we synthesize whatever lands.
  //
  // H.4.3 · per-source max-wait budget. Pre-fix, a slow deep-research
  // call could block the whole composition for 90s. Now each source
  // races against its own timeout · whatever lands in time gets
  // composed · the others return empty strings.
  if (tier === "mega") {
    const t = Date.now();
    const SOURCE_BUDGETS = {
      research: 60_000, // deep-research is the slowest · biggest budget
      multi: 25_000,
      fan: 15_000,
      ghost: 5_000,
      wisdom: 5_000,
    };
    const withBudget = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race<T>([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
      ]).catch(() => fallback);
    const [research, multi, fan, ghost, wisdom] = await Promise.all([
      withBudget(
        runDeepResearch(request.question).catch(() => ""),
        SOURCE_BUDGETS.research,
        "",
      ),
      withBudget(
        runMultiAgent(request.question, plan).catch(() => ""),
        SOURCE_BUDGETS.multi,
        "",
      ),
      withBudget(
        runFanout(request.question, request.brainContext).catch(() => ""),
        SOURCE_BUDGETS.fan,
        "",
      ),
      withBudget(runGhostContext(), SOURCE_BUDGETS.ghost, ""),
      withBudget(runWisdomContext(request.question), SOURCE_BUDGETS.wisdom, ""),
    ]);
    callCount += 5 + 4 + 3; // approx · DR + multi-agent + fanout
    const parts: string[] = [];
    if (research) parts.push(`# DEEP RESEARCH\n${research}`);
    if (multi) parts.push(`# MULTI-AGENT SYNTHESIS\n${multi}`);
    if (fan) parts.push(`# FANOUT (research / risk / plan)\n${fan}`);
    if (ghost) parts.push(`# GHOST NICK PREDICTIONS\n${ghost}`);
    if (wisdom) parts.push(`# RELATED WISDOM\n${wisdom}`);
    context = parts.join("\n\n---\n\n");
    const dropped = 5 - parts.length;
    rec.push(
      "tool_call",
      `mega composite · ${parts.length}/5 sources landed${dropped > 0 ? ` · ${dropped} timed out` : ""}`,
      {
        research: research ? research.slice(0, 200) : "(timed out or empty)",
        multi: multi ? multi.slice(0, 200) : "(timed out or empty)",
        fan: fan ? fan.slice(0, 200) : "(timed out or empty)",
        ghost: ghost ? ghost.slice(0, 200) : "(timed out or empty)",
        wisdom: wisdom ? wisdom.slice(0, 200) : "(timed out or empty)",
        budgets: SOURCE_BUDGETS,
      },
      Date.now() - t,
    );
  }

  if (!context && tier === "thorough") {
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
    draft = await runDraft(request.question, context, request.brainContext, acc);
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

  // Step 5 · critique + refine (deep, thorough, mega)
  let final = draft;
  let confidence = 0.75;
  if (tier === "deep" || tier === "thorough" || tier === "mega") {
    try {
      const t = Date.now();
      const critique = await runCritique(request.question, draft, acc);
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
        final = await runRefine(request.question, draft, critique, acc);
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
      const critique = await runCritique(request.question, draft, acc);
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
    const key = `reasoning_${result.tier}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const summary = result.trace.answer.length > 240
      ? result.trace.answer.slice(0, 237) + "…"
      : result.trace.answer;
    await prisma.brainMemory.create({
      data: {
        category: "reasoning_trace",
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

    // H.4.2 · opportunistic rotation · once every ~10 writes, prune.
    // Sampling means we don't run a delete on every write but keep
    // the table bounded over time. Rules:
    //   · delete rows older than 30 days unconditionally
    //   · if still >500 rows, delete the oldest down to 500
    if (Math.random() < 0.1) {
      void rotateReasoningTraces();
    }
  } catch {
    // Best-effort · never let bookkeeping block the engine.
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
        category: "reasoning_trace",
        createdAt: { lt: cutoff },
      },
    });
    // After age-pruning, enforce 500-row cap. Cheap because the index
    // on (category, createdAt) makes the offset query bounded.
    const count = await prisma.brainMemory.count({
      where: { category: "reasoning_trace", deletedAt: null },
    });
    let capDel = 0;
    if (count > 500) {
      const excess = count - 500;
      const oldRows = await prisma.brainMemory.findMany({
        where: { category: "reasoning_trace", deletedAt: null },
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
  const callCost =
    tier === "mega"
      ? 0.008
      : tier === "thorough"
        ? 0.005
        : tier === "deep"
          ? 0.002
          : tier === "standard"
            ? 0.0008
            : 0.00015;
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
  void persistTrace(request.question, result);
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
  void persistTrace(request.question, result);
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
