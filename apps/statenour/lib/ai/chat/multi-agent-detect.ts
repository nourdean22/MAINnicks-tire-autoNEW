/**
 * Multi-Agent Auto-Decompose Detector · v-truth
 *
 * Today the multi-agent orchestrator (lib/ai/multi-agent-orchestrator.ts
 * `runMultiAgent`) only fires when the model deliberately picks the
 * `arsenal.multiAgent` tool — which is near-never. This module lets the
 * chat route AUTO-fan-out the orchestrator when a turn is *clearly* a
 * multi-part / comparison / multi-entity question.
 *
 * Cost-aware (kaizen · karpathy): the orchestrator costs ~$0.001-0.002
 * and adds one parallel sub-agent round + a synth pass (~3-6s) of latency.
 * So `isMultiPartQuestion` is deliberately CONSERVATIVE — it returns true
 * only on unambiguous multi-part shapes, never on a plain single question.
 *
 * Flag-gated by the caller (`NICK_MULTI_AGENT_AUTO`, already registered in
 * lib/feature-flags.ts — not touched here). `runAutoDecompose` degrades to
 * "" on ANY failure so the route falls through to the normal stream.
 */

import type { SubAgentTask } from "@/lib/ai/multi-agent-orchestrator";

const MAX_AUTO_AGENTS = 4; // bound cost · cap below the orchestrator's hard 8

/**
 * Heuristic · is this a clear multi-part / comparison / multi-entity
 * question worth fanning out? Conservative by design — only TRUE when
 * the structure is unambiguous, so we don't pay the orchestrator tax on
 * ordinary single-answer turns.
 */
export function isMultiPartQuestion(userContent: string): boolean {
  const q = (userContent ?? "").trim();
  if (q.length < 40) return false; // too short to be a genuine multi-part ask
  if (q.length > 4000) return false; // pasted dumps → not a clean fan-out target
  const lc = q.toLowerCase();

  // Signal 1 · explicit comparison verbs over multiple entities.
  // "compare X, Y and Z" / "X vs Y vs Z" / "which is better, A or B".
  const hasCompareVerb = /\b(compare|comparison|versus|vs\.?|contrast|stack up|head[- ]to[- ]head)\b/.test(lc);
  const hasVsSeparators = (lc.match(/\bvs\.?\b/g)?.length ?? 0) >= 1;

  // Signal 2 · "across X and Y (and Z)" — audit/spread over multiple targets.
  const hasAcross = /\bacross\b/.test(lc) && /\band\b/.test(lc);

  // Signal 3 · enumerated list "1) ... 2) ... 3)" or "1. ... 2. ...".
  const enumMarkers = lc.match(/(?:^|\s)\d[.)]\s/g)?.length ?? 0;
  const hasEnumeration = enumMarkers >= 2;

  // Signal 4 · multiple distinct questions in one turn ("?" x2+).
  const questionMarks = (q.match(/\?/g)?.length ?? 0);
  const hasMultiQuestion = questionMarks >= 2;

  // Signal 5 · serial "and ... and" coordination of >=3 items, which is
  // the natural-language form of an enumerated multi-entity ask.
  const andCount = (lc.match(/\band\b/g)?.length ?? 0);
  const commaCount = (q.match(/,/g)?.length ?? 0);
  const hasSerialList = andCount >= 2 || (andCount >= 1 && commaCount >= 2);

  // Conservative combine: a bare "and" or a single "?" is NOT enough.
  // Require an explicit comparison/across/enumeration signal, OR the
  // strong combo of a serial list paired with a list-y intent verb.
  if (hasCompareVerb || hasVsSeparators) return true;
  if (hasAcross) return true;
  if (hasEnumeration) return true;
  if (hasMultiQuestion && hasSerialList) return true;
  return false;
}

/**
 * Derive focused sub-agent tasks from a raw multi-part question.
 * Splits on enumerated markers / "vs" / serial "and"/comma coordination,
 * keeps the cleanest >=2 fragments (capped at MAX_AUTO_AGENTS). Falls back
 * to a 2-angle research/critic split (same shape engine.ts uses) when no
 * clean fragments survive — so a TRUE detection always has >=2 agents.
 */
function deriveSubAgents(userContent: string): SubAgentTask[] {
  const q = userContent.trim();

  // Prefer enumerated markers, then vs/versus, then serial and/comma.
  let parts = q.split(/\s*\d[.)]\s+/).map((s) => s.trim());
  if (parts.filter((p) => p.length > 3).length < 2) {
    parts = q.split(/\s*\b(?:vs\.?|versus)\b\s*/i).map((s) => s.trim());
  }
  if (parts.filter((p) => p.length > 3).length < 2) {
    parts = q.split(/\s*(?:,|\band\b)\s*/i).map((s) => s.trim());
  }

  const clean = parts.filter((p) => p.length > 3).slice(0, MAX_AUTO_AGENTS);

  if (clean.length >= 2) {
    return clean.map((task, i) => ({
      name: `part_${i + 1}`,
      task: `Regarding the overall question, focus ONLY on this part: ${task}`,
      outputHint: "Concrete · no fluff · max 200 words.",
      persona: "research-analyst",
    }));
  }

  // Fallback · fact-vs-risk 2-angle split (mirrors engine.ts:283).
  return [
    {
      name: "what",
      task: `What is the concrete answer to: ${q}`,
      outputHint: "Direct answer · max 200 words.",
      persona: "research-analyst",
    },
    {
      name: "why",
      task: `What could go wrong with the obvious answer to: ${q} · which angles are being missed?`,
      outputHint: "Risks + missed angles · max 200 words.",
      persona: "contrarian-critic",
    },
  ];
}

/**
 * Thin wrapper · auto-decompose a multi-part question and run the
 * multi-agent orchestrator, returning its synthesized final answer.
 *
 * Returns "" on empty synthesis OR any failure, so the caller can simply
 * `if (answer) ship-it; else fall-through`. `brainContext` (the route's
 * finalSystemPrompt slice) grounds the run.
 */
export async function runAutoDecompose(
  userContent: string,
  brainContext?: string,
): Promise<string> {
  try {
    const subAgents = deriveSubAgents(userContent);
    if (subAgents.length < 2) return "";

    const { runMultiAgent } = await import("@/lib/ai/multi-agent-orchestrator");
    const goal = brainContext
      ? `${userContent.slice(0, 1500)}\n\n[CONTEXT]\n${brainContext.slice(0, 4000)}`
      : userContent.slice(0, 1500);

    const report = await runMultiAgent({ goal, subAgents });
    const synthesis = (report.synthesis ?? "").trim();
    if (
      synthesis.length === 0 ||
      synthesis.includes("All sub-agents failed") ||
      synthesis.includes("Synthesis stage failed") ||
      synthesis.includes("Sub-agent outcomes are unknown")
    ) {
      return "";
    }
    return synthesis;
  } catch {
    // Graceful · any orchestrator failure → caller falls through to the
    // normal stream. The turn still works.
    return "";
  }
}
