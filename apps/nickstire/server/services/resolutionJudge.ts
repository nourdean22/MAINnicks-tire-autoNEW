/**
 * Semantic resolution judge (2026-08-07) — the backstop the enumerated
 * RESOLUTION_RX could never be.
 *
 * TWO defects made this necessary, and they are different problems:
 *
 * 1. VOCABULARY DRIFT. The regex was grown through three rounds as MoE
 *    re-phrasings escaped it ("let me get him for you" → "get you someone"
 *    → "someone on the floor" / "swing by"). Each round graded a WORKING
 *    transfer as a failure. Enumerating a natural-language behavior is a
 *    losing race; the regex is a fast path, not a definition.
 *
 * 2. UNRESOLVABLE SEEDS — found 2026-08-07 by reading the parts seed's
 *    graded dialogue, and the more damaging of the two. Seed 019fd32f is
 *    TWO caller turns: "Hello?" then "Is this Nick's Auto Parts?" — a wrong
 *    number, correctly redirected, caller gone. No prompt can offer a
 *    concrete next step to a caller who never made an ask. Grading it as a
 *    prompt failure puts an impossible case in the denominator: the pass
 *    rate reads low for a reason that has nothing to do with the prompt,
 *    and the optimizer trains on an unwinnable failure. Same disease as the
 *    revenue-truth seeds (#1410, mislabeled WINS) one level deeper —
 *    mislabeled LOSSES.
 *
 * DESIGN — the judge is a backstop, never a softener:
 *   · Regex FIRST. A match is a resolution, no API call, fully
 *     deterministic. The judge is consulted ONLY on a regex miss, so the
 *     common path keeps its zero-cost determinism.
 *   · The judge may only ESCALATE a miss into "resolved" or
 *     "unresolvable". It can never overturn a violation — price leaks,
 *     guarantees and empty turns stay deterministic and disqualifying
 *     (pinned by test). A grader the prompt under test could sweet-talk is
 *     not a grader.
 *   · Different model family from the receptionist lane under test
 *     (gpt-oss:120b by tournament evidence, same lane the cage adversary
 *     and the optimizer ride) — a model grading its own family's phrasing
 *     is the self-eval defect this whole arc exists to remove.
 *   · Judge failure is LOUD and CONSERVATIVE: the regex verdict stands and
 *     the grade is marked judge-unavailable. A dead judge must never
 *     manufacture passes.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("resolution-judge");

/**
 * Family-diverse judge lane. Ollama-native substring, so it routes without
 * AI_FORCE_OLLAMA — the same pinning doctrine as GHOST_AGENT_MODEL and the
 * cage's AGENT_MODEL after the ambient-lane false green (#1416).
 */
export const RESOLUTION_JUDGE_MODEL = process.env.RESOLUTION_JUDGE_MODEL || "gpt-oss:120b";

export type ResolutionVerdict = "resolved" | "unresolved" | "unresolvable";

export interface JudgeResult {
  verdict: ResolutionVerdict;
  reason: string;
  /** true when the judge lane could not be reached — the regex verdict stands. */
  judgeUnavailable?: boolean;
}

/** Pure: the judge's instruction. Exported so a test can pin its contract. */
export function buildJudgePrompt(): string {
  return [
    "You grade ONE phone call handled by an auto shop's AI receptionist.",
    "",
    "Answer exactly one question: did the caller leave with a CONCRETE NEXT STEP,",
    "or was one impossible to offer?",
    "",
    'Answer "resolved" if the receptionist offered any concrete next step in ANY wording:',
    "an appointment, a walk-in/come-by invitation, a transfer to a person, a callback or",
    "text, a hold, or pointing them to the counter. Wording does not matter — meaning does.",
    "",
    'Answer "unresolvable" if NO next step was possible from what the caller actually said:',
    "the caller reached a wrong number and was correctly redirected, or hung up / stopped",
    "responding before making any request, or the transcript ends mid-greeting. A call the",
    "caller abandoned before asking for anything is NOT a receptionist failure.",
    "",
    'Answer "unresolved" ONLY if the caller made a real request and the receptionist',
    "answered without offering any way forward.",
    "",
    'Reply with ONE line of JSON: {"verdict":"resolved|unresolved|unresolvable","reason":"<one short clause>"}',
  ].join("\n");
}

/** Pure: render the dialogue the judge sees. Caller turns and replies interleave. */
export function renderDialogue(callerTurns: string[], replies: string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < callerTurns.length; i++) {
    lines.push(`Caller: ${callerTurns[i]}`);
    lines.push(`Receptionist: ${replies[i] ?? "(no reply)"}`);
  }
  return lines.join("\n");
}

/** Pure: extract the verdict from the judge's reply. Unknown shapes throw — never default to a pass. */
export function parseJudgeVerdict(raw: string): { verdict: ResolutionVerdict; reason: string } {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error(`judge returned no JSON object: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]) as { verdict?: unknown; reason?: unknown };
  const v = String(parsed.verdict ?? "").toLowerCase();
  if (v !== "resolved" && v !== "unresolved" && v !== "unresolvable") {
    throw new Error(`judge returned unknown verdict "${v}"`);
  }
  return { verdict: v, reason: String(parsed.reason ?? "").slice(0, 200) };
}

/**
 * Ask the family-diverse judge whether this call reached a concrete next
 * step — or whether one was impossible. Only called on a regex MISS.
 */
export async function judgeResolution(callerTurns: string[], replies: string[]): Promise<JudgeResult> {
  const { invokeLLM } = await import("../_core/llm");
  try {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: buildJudgePrompt() },
        { role: "user", content: `${renderDialogue(callerTurns, replies)}\n\nYour verdict JSON:` },
      ],
      model: RESOLUTION_JUDGE_MODEL,
      maxTokens: 900,
      timeoutMs: 60000,
      // Evaluation measures the dialogue, not the dice.
      temperature: 0,
      // P1 shadow evaluation: grading is background work and must yield to
      // live lanes, unlike the publish-gating judge (P0).
      priority: 1,
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    const { verdict, reason } = parseJudgeVerdict(text);
    return { verdict, reason };
  } catch (err) {
    // LOUD and conservative: the regex already said "no resolution", and a
    // dead judge must never manufacture a pass.
    const message = err instanceof Error ? err.message : String(err);
    log.warn("resolution judge unavailable — regex verdict stands", { err: message.slice(0, 200) });
    return { verdict: "unresolved", reason: `judge unavailable: ${message.slice(0, 120)}`, judgeUnavailable: true };
  }
}
