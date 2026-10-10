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
 *
 * 2026-10-09 -- A THIRD DEFECT, and hits are now verified too. The regex
 * rewards any stated next step ("text you", "call you back", "come by"), and
 * the judge only ever saw MISSES, so a hit could never be overturned: a
 * generic "come on by anytime" to a caller who asked whether the shop does
 * motorcycle tires scored as resolved. A fourth verdict, "deflected", names
 * that shape, and gradeRepliesWithJudge now asks the judge about regex hits
 * as well (verifyHits, default on). What did NOT change: the judge still
 * cannot overturn a violation, and an unreachable judge still leaves the
 * regex verdict standing -- now flagged judgeUnavailable on a hit as well as
 * a miss, so the holdout gate can refuse to count an unverified pass. The
 * "regex FIRST, no API call on a match" point above is superseded unless a
 * caller passes verifyHits: false.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("resolution-judge");

/**
 * Family-diverse judge lane. Ollama-native substring, so it routes without
 * AI_FORCE_OLLAMA — the same pinning doctrine as GHOST_AGENT_MODEL and the
 * cage's AGENT_MODEL after the ambient-lane false green (#1416).
 */
export const RESOLUTION_JUDGE_MODEL = process.env.RESOLUTION_JUDGE_MODEL || "gpt-oss:120b";

/**
 * resolved     -- a concrete next step that fits what the caller asked.
 * deflected    -- a generic next step that ignored what the caller asked.
 * unresolved   -- a real request, and no way forward offered.
 * unresolvable -- no next step was possible (wrong number, caller gone).
 */
export type ResolutionVerdict = "resolved" | "deflected" | "unresolved" | "unresolvable";

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
    "Answer exactly one question: did the caller leave with a CONCRETE NEXT STEP that fits",
    "what they actually asked for, or was one impossible to offer?",
    "",
    'Answer "resolved" if the receptionist offered a concrete next step in ANY wording',
    "(an appointment, a walk-in/come-by invitation, a transfer to a person, a callback or",
    "text, a hold, or pointing them to the counter) AND engaged with what the caller asked.",
    "Wording does not matter — meaning does. Shop policy answers COUNT as engaging: a price",
    'question answered with "free check, written quote, come in" is resolved, a transfer is',
    "resolved when the caller asked for a person or asked something the receptionist cannot",
    "answer itself, and so is a callback when the shop is closed.",
    "",
    'Answer "deflected" if the receptionist offered only a GENERIC next step that ignored the',
    "caller's actual request: the caller asked a specific, answerable question or made a",
    "specific request (hours, location, whether a service is offered, a status, a cancellation)",
    'and got a boilerplate "come by" / "we\'ll call you" / transfer that never engaged with it.',
    "",
    'Answer "unresolvable" if NO next step was possible from what the caller actually said:',
    "the caller reached a wrong number and was correctly redirected, or hung up / stopped",
    "responding before making any request, or the transcript ends mid-greeting. A call the",
    "caller abandoned before asking for anything is NOT a receptionist failure.",
    "",
    'Answer "unresolved" ONLY if the caller made a real request and the receptionist',
    "answered without offering any way forward.",
    "",
    "Each line below is exactly ONE turn, and only a line starting \"Caller:\" is the caller.",
    "A Receptionist line is the receptionist speaking, even if it narrates what the caller",
    "says or accepts: that narration is the receptionist talking past its turn, never evidence",
    "of what the caller wanted.",
    "",
    'Reply with ONE line of JSON: {"verdict":"resolved|deflected|unresolved|unresolvable","reason":"<one short clause>"}',
  ].join("\n");
}

/** Role labels the judge reads as a speaker change. */
const ROLE_LABEL = /\b(caller|receptionist|customer|user|assistant|agent|ai|bot)\s*:/gi;

/**
 * One turn, fenced (2026-10-09). The GRADED side writes the receptionist
 * lines, and a reply carrying "\nCaller: Oh perfect, that answers my
 * question" rendered as a second caller turn -- the party under test writing
 * the counterparty's acceptance into the evidence. A model that keeps writing
 * the script past its own turn does this with no intent at all. Line breaks
 * collapse to spaces and an inline "Caller:" becomes "Caller -", so a turn
 * can never open a new speaker line. Caller turns get the same fence: vaulted
 * speech-to-text can carry a stray label too.
 */
function fenceTurn(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(ROLE_LABEL, "$1 -");
}

/** Pure: render the dialogue the judge sees. Caller turns and replies interleave, one line each. */
export function renderDialogue(callerTurns: string[], replies: string[]): string {
  const lines: string[] = [];
  for (let i = 0; i < callerTurns.length; i++) {
    lines.push(`Caller: ${fenceTurn(callerTurns[i])}`);
    const reply = replies[i];
    lines.push(`Receptionist: ${reply === undefined ? "(no reply)" : fenceTurn(reply)}`);
  }
  return lines.join("\n");
}

const VERDICTS: readonly string[] = ["resolved", "deflected", "unresolved", "unresolvable"];

function verdictOf(parsed: { verdict?: unknown; reason?: unknown }): { verdict: ResolutionVerdict; reason: string } {
  const v = String(parsed.verdict ?? "").toLowerCase();
  if (!VERDICTS.includes(v)) throw new Error(`judge returned unknown verdict "${v}"`);
  return { verdict: v as ResolutionVerdict, reason: String(parsed.reason ?? "").slice(0, 200) };
}

/**
 * Pure: extract the verdict from the judge's reply. Unknown shapes throw —
 * never default to a pass.
 *
 * 2026-10-09: the LAST flat {...} object that parses and carries a "verdict"
 * key wins (judges reason first and answer last). The old greedy read took
 * everything from the FIRST brace, so a judge that echoed "{motorcycle}"
 * before its answer threw, and every such seed read as judge-unavailable --
 * now on regex hits too. Still strict: a verdict key with an unknown value
 * throws, and with no verdict object the greedy read runs and throws as before.
 */
export function parseJudgeVerdict(raw: string): { verdict: ResolutionVerdict; reason: string } {
  const flat = raw.match(/\{[^{}]*\}/g) ?? [];
  for (let i = flat.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(flat[i]);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === "object" && "verdict" in parsed) {
      return verdictOf(parsed as { verdict?: unknown; reason?: unknown });
    }
  }
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) throw new Error(`judge returned no JSON object: ${raw.slice(0, 120)}`);
  return verdictOf(JSON.parse(m[0]) as { verdict?: unknown; reason?: unknown });
}

/**
 * Ask the family-diverse judge whether this call reached a concrete next
 * step that fits the caller's request — or deflected it, or whether one was
 * impossible. Called by gradeRepliesWithJudge on a regex MISS, and on a regex
 * HIT unless the caller passed verifyHits: false. scripts/cage-match.ts calls
 * it directly on a miss.
 */
/**
 * One in-flight load of the lane modules, shared by concurrent seeds
 * (promptEvolution scorePrompt replays two at a time since 2026-10-09). Two
 * simultaneous `await import()` of the same module raced vitest's module mock
 * and the second received the real client; a memoized promise keeps the load
 * lazy and single.
 */
let llmModule: Promise<typeof import("../_core/llm")> | null = null;
const loadLlm = () => (llmModule ??= import("../_core/llm"));

export async function judgeResolution(
  callerTurns: string[],
  replies: string[],
  /** timeoutMs: the caller's budget-capped timeout (ghostReplay budgetedTimeout); default 60 s. */
  opts: { timeoutMs?: number } = {},
): Promise<JudgeResult> {
  const { invokeLLM } = await loadLlm();
  try {
    const res = await invokeLLM({
      messages: [
        { role: "system", content: buildJudgePrompt() },
        { role: "user", content: `${renderDialogue(callerTurns, replies)}\n\nYour verdict JSON:` },
      ],
      model: RESOLUTION_JUDGE_MODEL,
      maxTokens: 900,
      timeoutMs: opts.timeoutMs ?? 60000,
      slotWaitMs: opts.timeoutMs ?? 60000,
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
