/**
 * lib/ai/board/consult.ts · the consultation service (task #23).
 *
 * The whole pattern in one function:
 *
 *   1. Resolve board.memberIds → StrategicFramework[] (silently drops
 *      unknown ids so a board still functions if a framework is later
 *      removed)
 *   2. Fan out · one aiChat per resolved member, all in parallel
 *      (Promise.all) · each member is told to stay TRUE to its lens
 *      and NOT blend with others
 *   3. Parse each member's JSON reply into AdvisorTake · degraded
 *      shape on parse failure / provider unavailable / throw — never
 *      crash the whole consultation
 *   4. Synthesize · one more aiChat call passes ALL takes to a
 *      synthesizer that surfaces consensus + divergence + tension +
 *      a leaning recommendation
 *   5. Return the structured BoardConsultation
 *
 * Cost · per consultation = members.length advisor calls + 1
 * synthesizer call. With the default 5-member board that's 6 aiChat
 * calls. taskType: "reason" routes to the cheap-first provider chain
 * (Venice + Ollama Cloud Pro co-1st per `lib/ai/policy.ts`).
 *
 * Tracing · everything goes through makeTracedAiChat("board-consult")
 * so each call shows in /system/agent-traces. The operator can spot
 * a chronically-failing advisor (e.g. "warren-buffett keeps timing
 * out") without ad-hoc logging.
 */

import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { REGISTRY } from "@/lib/ai/strategic-frameworks";
import type { StrategicFramework } from "@/lib/ai/strategic-frameworks/types";
// 2026-05-23 · Wave L · 5th operator-state opt-in. The board is the
// highest per-fire-leverage AI surface · used for major decisions ·
// state-awareness matters MORE here than on chip generators or
// task-creation helpers. Sam Altman pick · /sam-altman skill session.
//
// Two layers of state injection:
//   1. Mood-gated routing · drop advisors whose lens is counter-
//      productive in the operator's current mood (e.g. elon-musk +
//      steve-jobs when mood=depleted · pushing harder is wrong)
//   2. State block injected into both advisor prompts and the
//      synthesizer · LLMs see the same explicit world-model context
//      that the routing decision used.
import { currentOperatorState, formatOperatorStateBlock, type MoodTag, type OperatorState } from "@/lib/services/operator-state";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/board/consult");

import { getBoard } from "./boards";
import type {
  AdvisorTake,
  BoardConsultation,
  BoardId,
  BoardSynthesis,
} from "./types";

const aiChat = makeTracedAiChat("board-consult", "brain");

/** Look up framework definitions for a list of ids · drops unknowns. */
function resolveMembers(memberIds: ReadonlyArray<string>): StrategicFramework[] {
  const members: StrategicFramework[] = [];
  for (const id of memberIds) {
    const framework = REGISTRY.find((f: any) => f.id === id);
    if (framework) members.push(framework);
  }
  return members;
}

/**
 * The advisor-side system prompt. Wraps the framework's own lens
 * block (which already tells the model HOW to think) with a "you are
 * a board member · don't blend · preserve your distinct take" frame
 * + a strict JSON output spec the consult parser can rely on.
 */
function buildAdvisorPrompt(framework: StrategicFramework): string {
  return `You are the ${framework.name} member of a strategic board.

Other members are consulting on the same question through their own lenses · stay TRUE to your lens. Don't try to be comprehensive. Don't blend perspectives with hypothetical other lenses. Surface what YOUR lens uniquely sees that others might miss.

YOUR LENS · use ONLY this:
${framework.lens}

OUTPUT FORMAT · STRICT JSON, no markdown, no commentary, no code fences:
{
  "lensOneLine": "one-sentence summary of what your lens sees here",
  "keyInsight": "2-3 sentences of depth · what your lens reveals others might miss",
  "recommendation": "do X · don't do Y, with specific reasoning · be concrete",
  "confidence": 0.0-1.0,
  "divergenceFlag": "(optional · only if relevant) name another typical board lens that would disagree, and why in one line"
}

If the question is genuinely outside your lens's domain, set lensOneLine to "outside this lens's domain", give a brief one-line keyInsight, set recommendation to "defer to other board members", and confidence to 0.1. Never invent — say so explicitly.`;
}

/** Loose shape from the LLM · validated by `coerceAdvisorTake` below. */
interface RawAdvisorReply {
  lensOneLine?: unknown;
  keyInsight?: unknown;
  recommendation?: unknown;
  confidence?: unknown;
  divergenceFlag?: unknown;
}

/** Defensive coercion · returns a fully-typed AdvisorTake. */
function coerceAdvisorTake(
  framework: StrategicFramework,
  raw: RawAdvisorReply,
  provider: string,
): AdvisorTake {
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.6;
  return {
    advisorId: framework.id,
    advisorName: framework.name,
    lensOneLine:
      typeof raw.lensOneLine === "string" && raw.lensOneLine.length > 0
        ? raw.lensOneLine
        : "(missing)",
    keyInsight:
      typeof raw.keyInsight === "string" && raw.keyInsight.length > 0
        ? raw.keyInsight
        : "(missing)",
    recommendation:
      typeof raw.recommendation === "string" && raw.recommendation.length > 0
        ? raw.recommendation
        : "(missing)",
    confidence,
    divergenceFlag:
      typeof raw.divergenceFlag === "string" && raw.divergenceFlag.length > 0
        ? raw.divergenceFlag
        : undefined,
    provider,
  };
}

/** Consult one advisor · returns a degraded take on any failure (never throws). */
async function consultOne(
  framework: StrategicFramework,
  question: string,
  stateBlock: string = "",
): Promise<AdvisorTake> {
  try {
    const result = await aiChat(
      [
        {
          role: "system",
          content:
            buildAdvisorPrompt(framework) +
            (stateBlock ? `\n\n${stateBlock}` : ""),
        },
        { role: "user", content: question.slice(0, 4000) },
      ],
      "reason",
    );
    if (result.provider === "none" || result.provider === "emergency") {
      return {
        advisorId: framework.id,
        advisorName: framework.name,
        lensOneLine: "provider unavailable",
        keyInsight: "",
        recommendation: "",
        confidence: 0,
        provider: result.provider,
        error: "provider unavailable",
      };
    }
    const parsed = extractJsonObject<RawAdvisorReply>(result.content);
    if (!parsed.ok) {
      return {
        advisorId: framework.id,
        advisorName: framework.name,
        lensOneLine: "parse failed",
        keyInsight: result.content.slice(0, 240),
        recommendation: "",
        confidence: 0,
        provider: result.provider,
        error: `parse failed: ${parsed.error.slice(0, 80)}`,
      };
    }
    return coerceAdvisorTake(framework, parsed.value, result.provider);
  } catch (err) {
    return {
      advisorId: framework.id,
      advisorName: framework.name,
      lensOneLine: "advisor errored",
      keyInsight: "",
      recommendation: "",
      confidence: 0,
      provider: "none",
      error: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    };
  }
}

/**
 * The synthesizer's system prompt · explicit about NOT blending and
 * ABOUT surfacing divergence. Lifted as a const so the test can
 * assert its presence.
 */
const SYNTHESIZE_SYSTEM_PROMPT = `You are the SYNTHESIZER of a strategic board consultation.

The board members have each given their take on a question through their own unique lens. Your job is NOT to vote with the majority — your job is to surface the SHAPE of the board's collective view without flattening distinct perspectives.

Do these five things:

1. CONSENSUS · where do all (or most) lenses converge? Bullets.
2. DIVERGENCE · where do lenses disagree? Each bullet names WHO disagreed with WHO and WHY. Don't paper over disagreement — it's the highest-signal information.
3. TENSION · if there's an axis that cleanly splits the board (short-term vs long-term, simplicity vs completeness, risk vs reward, growth vs durability), name it explicitly. Optional · many consultations have no clean axis.
4. RECOMMENDATION · lean one direction with EXPLICIT acknowledgment of which lenses get overridden by your lean. Not a vote count — a judgment about which lens has the most decision-quality grip on THIS specific question.
5. CONFIDENCE · 0-1 · lower when the board is split, higher when all converge.

OUTPUT FORMAT · STRICT JSON, no markdown, no commentary, no code fences:
{
  "consensus": ["bullet 1", "bullet 2"],
  "divergences": ["advisor X says A; advisor Y says B because Z", "..."],
  "tension": "(optional) name the axis that splits the board",
  "recommendation": "lean X · explicitly override lens Y · here's why",
  "confidence": 0.0-1.0
}

Never blend perspectives into mush. The value of this synthesis is preserving the SHARPNESS of distinct lenses while pointing the way forward.`;

interface RawSynthesis {
  consensus?: unknown;
  divergences?: unknown;
  tension?: unknown;
  recommendation?: unknown;
  confidence?: unknown;
}

function coerceSynthesis(raw: RawSynthesis): BoardSynthesis {
  const consensus = Array.isArray(raw.consensus)
    ? raw.consensus.filter((s): s is string => typeof s === "string")
    : [];
  const divergences = Array.isArray(raw.divergences)
    ? raw.divergences.filter((s): s is string => typeof s === "string")
    : [];
  const tension =
    typeof raw.tension === "string" && raw.tension.length > 0
      ? raw.tension
      : undefined;
  const recommendation =
    typeof raw.recommendation === "string" && raw.recommendation.length > 0
      ? raw.recommendation
      : "(no recommendation)";
  const confidence =
    typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
  return { consensus, divergences, tension, recommendation, confidence };
}

async function synthesize(
  question: string,
  takes: AdvisorTake[],
  stateBlock: string = "",
  droppedAdvisorIds: string[] = [],
): Promise<BoardSynthesis> {
  // Format the advisor takes into a structured input for the synthesizer.
  const advisorBlock = takes
    .map(
      (t, i) =>
        `[${i + 1}] ${t.advisorName} (id=${t.advisorId} · confidence ${t.confidence.toFixed(2)}${t.error ? ` · ERROR: ${t.error}` : ""})\n` +
        `   lens: ${t.lensOneLine}\n` +
        `   insight: ${t.keyInsight}\n` +
        `   recommendation: ${t.recommendation}` +
        (t.divergenceFlag ? `\n   divergence flag: ${t.divergenceFlag}` : ""),
    )
    .join("\n\n");
  // Wave L · tell the synthesizer which advisors were gated out so it
  // doesn't ask "where's X?" or hallucinate a missing take. Empty list
  // == mood-blind run (no gating happened).
  const gateNote =
    droppedAdvisorIds.length > 0
      ? `\n\nNote · the following advisors were gated out for this consultation due to the operator's current state: ${droppedAdvisorIds.join(", ")}. Do not synthesize what they would have said · their lenses are deliberately absent.`
      : "";
  const userPrompt = `Operator's question:
${question}

Board members' takes (${takes.length} advisors):

${advisorBlock}${gateNote}

Synthesize per the format above. Be honest about divergence — flattening it loses the whole point of consulting multiple lenses.`;

  try {
    const result = await aiChat(
      [
        {
          role: "system",
          content:
            SYNTHESIZE_SYSTEM_PROMPT +
            (stateBlock ? `\n\n${stateBlock}` : ""),
        },
        { role: "user", content: userPrompt },
      ],
      "reason",
    );
    if (result.provider === "none" || result.provider === "emergency") {
      return {
        consensus: [],
        divergences: [],
        recommendation: "synthesizer unavailable · board takes above",
        confidence: 0,
      };
    }
    const parsed = extractJsonObject<RawSynthesis>(result.content);
    if (!parsed.ok) {
      return {
        consensus: [],
        divergences: [],
        recommendation: "synthesizer parse failed · board takes above",
        confidence: 0,
      };
    }
    return coerceSynthesis(parsed.value);
  } catch (err) {
    return {
      consensus: [],
      divergences: [],
      recommendation: `synthesizer threw: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
      confidence: 0,
    };
  }
}

/**
 * 2026-05-23 · Wave L · mood-gated routing.
 *
 * Per-mood advisor DROP lists · the rules below encode "this lens is
 * counter-productive in this mood." Conservative · we ONLY drop · we
 * NEVER add (the operator curated the board's memberIds intentionally
 * · we respect that). When the drop list would empty the board, we
 * fall back to the full member list (operator's curation wins).
 *
 * Mood→drop rationale:
 *   energized · no drops · operator can handle every lens at full strength
 *   neutral   · no drops · default behavior preserved
 *   depleted  · drop push-harder lenses · they tell you to do more when
 *               you can't · counterproductive · ADD friction not insight
 *   scattered · drop complexity-adding lenses · they multiply the
 *               cognitive load when the operator already can't focus
 */
const MOOD_DROP_RULES: Record<MoodTag, ReadonlySet<string>> = {
  energized: new Set<string>(),
  neutral: new Set<string>(),
  depleted: new Set<string>([
    "elon-musk", // 10x not 10% · push harder · counterproductive when depleted
    "steve-jobs", // perfectionism · costs energy you don't have
    "growth-engine", // scale focus · wrong frame when capacity is low
  ]),
  scattered: new Set<string>([
    "osterwalder-canvas", // 9-cell business model · multiplies the surface area
    "lean-canvas", // similar · adds structure when you can't focus
    "porters-five-forces", // 5-force analysis · too many threads to hold
    "kotler-macro", // PESTEL / macro · widens the field when narrowing is needed
  ]),
};

/**
 * Filter board members by the operator's current mood · returns the
 * effective member list + the set of advisorIds that were dropped (for
 * traceability + so the synthesizer can be told which lenses were
 * gated out · prevents the synthesizer from asking "where's elon").
 *
 * Exported for unit tests.
 */
export function gateMembersByMood(
  members: StrategicFramework[],
  mood: MoodTag,
): { effective: StrategicFramework[]; droppedIds: string[] } {
  const dropSet = MOOD_DROP_RULES[mood];
  if (dropSet.size === 0) {
    return { effective: members, droppedIds: [] };
  }
  const dropped: string[] = [];
  const kept: StrategicFramework[] = [];
  for (const m of members) {
    if (dropSet.has(m.id)) {
      dropped.push(m.id);
    } else {
      kept.push(m);
    }
  }
  // Safety net · if mood-gating would empty the board, fall back to
  // the full member list. Operator's board curation wins over mood
  // heuristics · we'd rather over-deliver advisor takes than starve
  // the consultation of input.
  if (kept.length === 0) {
    return { effective: members, droppedIds: [] };
  }
  return { effective: kept, droppedIds: dropped };
}

/**
 * Consult a board on a question · fans out to all members in
 * parallel, then synthesizes. Returns a structured BoardConsultation
 * the caller can persist + render.
 *
 * 2026-05-23 · Wave L · operator-state aware. Reads the operator-state
 * snapshot at consult time · applies mood-gated routing (drops
 * advisors whose lens is counterproductive in the current mood) ·
 * injects the state block into both advisor prompts and the
 * synthesizer system prompt. Best-effort · degrades to mood-blind
 * behavior on operator-state read failure.
 *
 * Throws only on:
 *   · unknown boardId
 *   · board with zero resolvable members (registry drift)
 * All other failures (advisor errors, provider unavailable, parse
 * failures, synthesizer errors) degrade gracefully into the
 * structured result with `error` fields filled in.
 */
export async function consultBoard(
  boardId: BoardId,
  question: string,
): Promise<BoardConsultation> {
  const board = getBoard(boardId);
  if (!board) throw new Error(`Unknown board: ${boardId}`);
  const baseMembers = resolveMembers(board.memberIds);
  if (baseMembers.length === 0) {
    throw new Error(`Board ${boardId} has no resolvable members in REGISTRY`);
  }

  // Wave L · operator-state capture + routing. Best-effort · if
  // state read fails, fall back to mood-blind behavior (use all
  // members · no state block).
  let stateSnapshot: OperatorState | null = null;
  let effectiveMembers: StrategicFramework[] = baseMembers;
  let droppedAdvisorIds: string[] = [];
  let stateBlock = "";
  try {
    const snap = await currentOperatorState();
    // 2026-05-23 · Wave M · audit follow-up. Pre-fix #1: bare catch
    // swallowed currentOperatorState() failures with no logging · DB
    // outage or schema drift would silently disable Wave L routing
    // for EVERY consultation. Pre-fix #2: `if (snap.confidence > 0)`
    // conflated "no signal yet" with "low confidence" · the
    // synthesizer trace never saw the computed snapshot. Now: always
    // record the snapshot so /system/agent-traces shows what was
    // computed · gate only the routing/drop-list on confidence > 0
    // (low-confidence snapshots shouldn't drive mood routing).
    stateSnapshot = snap;
    if (snap.confidence > 0) {
      stateBlock = formatOperatorStateBlock(snap);
      const gated = gateMembersByMood(baseMembers, snap.mood);
      effectiveMembers = gated.effective;
      droppedAdvisorIds = gated.droppedIds;
    }
  } catch (err) {
    log.warn("board_state_read_failed", {
      boardId,
      err: err instanceof Error ? err.message : String(err),
    });
    // mood-blind fall-back · use base members + no state block
  }

  const t0 = Date.now();
  // Fan-out · all advisors consulted in PARALLEL. This is THE feature
  // — serial reasoning + lens fusion is what the existing strategic-
  // frameworks lens-injection already does in Nick. The board exists
  // precisely BECAUSE it parallelizes the perspectives.
  const takes = await Promise.all(
    effectiveMembers.map((member) => consultOne(member, question, stateBlock)),
  );
  // Sequential after fan-out · synthesizer reads ALL takes.
  const synthesis = await synthesize(question, takes, stateBlock, droppedAdvisorIds);
  const durationMs = Date.now() - t0;

  return {
    boardId,
    boardName: board.name,
    question,
    takes,
    synthesis,
    durationMs,
    ranAt: new Date().toISOString(),
    // Wave L · trace fields · operator can see WHICH state drove the
    // routing + which advisors got gated out. Helps debug "why didn't
    // elon-musk show up?" and feeds the M1 calibration loop.
    operatorState: stateSnapshot
      ? {
          mood: stateSnapshot.mood,
          focus: stateSnapshot.focus,
          capacity: stateSnapshot.capacity,
          drift: stateSnapshot.drift,
          momentum: stateSnapshot.momentum,
          confidence: stateSnapshot.confidence,
        }
      : null,
    droppedAdvisorIds,
  };
}

/** Exported for tests · do NOT consume from app code. */
export const __testInternals = {
  buildAdvisorPrompt,
  SYNTHESIZE_SYSTEM_PROMPT,
  resolveMembers,
  coerceAdvisorTake,
  coerceSynthesis,
  MOOD_DROP_RULES,
};
