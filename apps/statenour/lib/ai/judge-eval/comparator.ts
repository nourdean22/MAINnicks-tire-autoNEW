/**
 * lib/ai/judge-eval/comparator.ts · Phase V (2026-05-18 PM)
 *
 * LLM-as-judge for the AGENT_V1 → AGENT_V2 migration. The doc at
 * `docs/migrations/agent-v1-to-v2.md` lists this as the Phase 0
 * prerequisite that's been blocking the canary rollout:
 *
 *   > Currently running V2 default with no automated regression
 *   > detection. Operator catches regressions manually via /chat
 *   > experience. If V2 silently degrades on a specific intent class,
 *   > no alert fires.
 *
 * This module is the regression detector. Given two replies to the
 * same prompt, a cheap judge model picks the winner across 4
 * dimensions (accuracy · clarity · conciseness · operator-fit) and
 * returns a structured judgment the dashboard + alert layer consume.
 *
 * The judging logic is PURE-input-output: pass in the two replies,
 * get back a `Judgment`. No DB writes here · persistence lives in
 * `./persistence.ts`. This split lets the unit tests exercise the
 * parser without mocking Prisma.
 */

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/judge-eval/comparator");

export type Winner = "v1" | "v2" | "tie";
export type Dimension = "accuracy" | "clarity" | "conciseness" | "operator-fit";

export interface DimensionScore {
  dimension: Dimension;
  /** Per-dimension winner · "tie" allowed when truly equivalent. */
  winner: Winner;
  /** 1-sentence reason · no fluff. */
  reason: string;
}

export interface Judgment {
  /** Overall winner · majority across dimensions · tie when 2-2. */
  winner: Winner;
  /** Score 0-100 · 50 = tie · >50 = v2 wins · <50 = v1 wins. */
  v2Score: number;
  /** Per-dimension breakdown · always 4 entries. */
  dimensions: DimensionScore[];
  /** 1-2 sentence overall summary · operator-readable. */
  summary: string;
  /** True iff the judge LLM returned a parseable JSON object · false
   *  on parse failures (caller decides whether to retry / fall back). */
  parsed: boolean;
}

export interface CompareArgs {
  prompt: string;
  v1Reply: string;
  v2Reply: string;
  /** Optional · gives the judge richer context about what "operator-
   *  fit" means for this particular query. */
  intentClass?: string;
}

const JUDGE_SYSTEM = `You are an EXPERT EVALUATOR comparing two AI replies to the same prompt. The prompts come from an operator who runs a tire shop in Cleveland OH and uses these AI replies for real decisions.

Your job: pick the winner across 4 dimensions, then call the overall winner.

DIMENSIONS
- accuracy · facts right · no hallucinated numbers/names/dates
- clarity · easy to extract the answer · no fluff or hedging
- conciseness · respects operator's time · doesn't pad
- operator-fit · grounded in operator-grade context (tire shop · ops · revenue) when relevant

WINNER VALUES per dimension: "v1" | "v2" | "tie"
OVERALL WINNER: majority across dimensions. Tie when 2-2 or all-4-tie.
V2 SCORE: 0-100 · 50 = pure tie · 100 = v2 dominant · 0 = v1 dominant.

OUTPUT JSON ONLY · no markdown · no commentary:
{
  "winner": "v1" | "v2" | "tie",
  "v2Score": 0-100,
  "dimensions": [
    { "dimension": "accuracy", "winner": "...", "reason": "1 sentence" },
    { "dimension": "clarity", "winner": "...", "reason": "1 sentence" },
    { "dimension": "conciseness", "winner": "...", "reason": "1 sentence" },
    { "dimension": "operator-fit", "winner": "...", "reason": "1 sentence" }
  ],
  "summary": "1-2 sentences explaining the overall call"
}

BE TERSE. NO HEDGING. NO PREAMBLE.`;

const ALL_DIMENSIONS: Dimension[] = ["accuracy", "clarity", "conciseness", "operator-fit"];

/**
 * Compare two replies via LLM-as-judge. Best-effort · failures
 * return a `parsed: false` judgment with a tie winner so callers
 * can decide whether to retry or skip.
 *
 * Cost · ~$0.0005-0.001 per call (gpt-4o-mini · ~1500-2500 tokens
 * total). Safe to run on every V2 reply if needed; current expected
 * cadence is ~10/day sampled.
 */
export async function compareReplies(args: CompareArgs): Promise<Judgment> {
  const userPrompt = buildUserPrompt(args);
  const { aiChat } = await import("@/lib/ai/provider");

  let raw = "";
  try {
    const reply = await aiChat(
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      "fast",
    );
    raw = (reply?.content ?? "").trim();
  } catch (e) {
    log.warn("judge_llm_failed", { err: (e as Error).message?.slice(0, 200) });
    return defaultJudgment("judge call failed");
  }

  return parseJudgeResponse(raw);
}

function buildUserPrompt(args: CompareArgs): string {
  const intentLine = args.intentClass ? `\n\nINTENT CLASS: ${args.intentClass}` : "";
  return `PROMPT:
${args.prompt.slice(0, 2000)}${intentLine}

═══ REPLY V1 ═══
${args.v1Reply.slice(0, 3000)}

═══ REPLY V2 ═══
${args.v2Reply.slice(0, 3000)}

Compare them across the 4 dimensions and return the JSON object.`;
}

/**
 * Parse the judge LLM's response into a typed Judgment. Exported for
 * unit testing · the parser is the only piece worth testing in
 * isolation (LLM calls themselves get integration coverage via the
 * /api/judge-eval/run endpoint).
 *
 * Tolerant of:
 *   · markdown fence wrappers (```json ... ```)
 *   · extra commentary before / after the JSON object
 *   · missing dimensions (filled with `tie` defaults)
 *   · out-of-range v2Score (clamped to 0-100)
 */
export function parseJudgeResponse(raw: string): Judgment {
  if (!raw) return defaultJudgment("empty judge response");

  // Strip markdown fences if the judge model wrapped its output
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Find the first { ... } block · tolerant of leading commentary
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return defaultJudgment("no JSON object in response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return defaultJudgment("JSON parse failed");
  }

  if (!parsed || typeof parsed !== "object") {
    return defaultJudgment("judge response was not an object");
  }

  const obj = parsed as Record<string, unknown>;

  const winner = normalizeWinner(obj.winner);
  const v2Score = clampScore(obj.v2Score);
  const dimensions = normalizeDimensions(obj.dimensions);
  const summary = typeof obj.summary === "string" ? obj.summary.slice(0, 400) : "";

  return { winner, v2Score, dimensions, summary, parsed: true };
}

function normalizeWinner(value: unknown): Winner {
  if (value === "v1" || value === "v2" || value === "tie") return value;
  return "tie";
}

function clampScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeDimensions(value: unknown): DimensionScore[] {
  const provided = new Map<Dimension, DimensionScore>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const dim = e.dimension;
      if (typeof dim !== "string") continue;
      if (!ALL_DIMENSIONS.includes(dim as Dimension)) continue;
      provided.set(dim as Dimension, {
        dimension: dim as Dimension,
        winner: normalizeWinner(e.winner),
        reason: typeof e.reason === "string" ? e.reason.slice(0, 200) : "",
      });
    }
  }

  return ALL_DIMENSIONS.map(
    (dim) =>
      provided.get(dim) ?? {
        dimension: dim,
        winner: "tie" as Winner,
        reason: "(missing from judge response)",
      },
  );
}

function defaultJudgment(reason: string): Judgment {
  return {
    winner: "tie",
    v2Score: 50,
    dimensions: ALL_DIMENSIONS.map((dim) => ({
      dimension: dim,
      winner: "tie" as Winner,
      reason: "(judge unavailable)",
    })),
    summary: reason,
    parsed: false,
  };
}
