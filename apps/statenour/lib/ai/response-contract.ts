/**
 * RESPONSE CONTRACT — 2026-06-09.
 *
 * Nick's recurring failure isn't *quality* (output-critic already scores
 * specificity/cliché/length) — it's *compliance*: Nour asks for a concise
 * copy-paste prompt and gets three paragraphs of preamble; asks for "top 5"
 * and gets four; says "don't ask questions" and gets a clarifying question;
 * pastes a status update and Nick treats it as a fresh task.
 *
 * This module derives, from the user's message, an explicit CONTRACT for
 * what the reply must (and must not) do. It is the missing layer between
 * "what shape is this turn" (turn-intelligence / query-shape) and "did the
 * reply honor the request" (reply-gate, extended). The contract feeds both
 * the system prompt (so Nick aims right) and the reply gate (so a miss is
 * caught post-stream).
 *
 * Pure · heuristic-only · zero IO · <1ms. Consumes the existing TurnSignal
 * and QueryShape rather than re-detecting intent/shape. Same input → same
 * contract.
 */

import type { TurnSignal } from "./turn-intelligence";
import type { QueryShape } from "./query-shape";

export type AnswerMode =
  | "direct_answer"
  | "ranked_recommendation"
  | "copy_paste_prompt"
  | "operator_command"
  | "audit"
  | "digest"
  | "brainstorm"
  | "decision"
  | "correction"
  | "wait_mode"
  | "session_update";

export type ResponseLength = "ultra_concise" | "concise" | "normal" | "detailed";

export type OutputFormat = "prose" | "bullets" | "prompt" | "table" | "checklist";

export interface ResponseContract {
  answerMode: AnswerMode;
  length: ResponseLength;
  outputFormat: OutputFormat;
  /** Is Nick allowed to ask a clarifying question this turn? */
  shouldAskClarifying: boolean;
  /** Must the answer be grounded in the actual repo/codebase (not generic)? */
  mustBeRepoGrounded: boolean;
  /** Must claims be backed by evidence (citations, files, receipts)? */
  mustIncludeEvidence: boolean;
  /** Must Nick NOT assert it performed actions (this is a question/plan turn)? */
  mustNotClaimActions: boolean;
  /** Did the user request a ranked / top-N list? */
  mustRankOptions: boolean;
  /** The N in "top N" / "give me 5", if stated. */
  rankCount: number | null;
  /** Must the reply end with a concrete next move / recommendation? */
  mustGiveNextMove: boolean;
  userIsCorrectingDirection: boolean;
  userIsAskingForCoderPrompt: boolean;
  userIsManagingConcurrentSessions: boolean;
  /** The user PASTED a status report (don't treat reported status as verified). */
  isStatusUpdate: boolean;
  /** The user issued a COMMAND or FINALIZED a decision ("do it", "my decision is
   *  final", "stop arguing"). Execute it — do NOT re-open with unsolicited
   *  counter-views. Gates the adversarial critic + objection injector. An
   *  explicit /spar or brainstorm turn overrides (that IS a request to challenge). */
  executeFinalized: boolean;
  forbiddenMoves: string[];
  requiredMoves: string[];
  reasons: string[];
}

// ── Detection libraries ──────────────────────────────────────────────

const RE = {
  // length
  ultraConcise: /\b(one word|in a word|yes or no|just (the )?(answer|number)|tl;?dr it)\b/i,
  concise: /\b(concise|be brief|keep it (short|brief|tight)|short( answer)?|quick(ly)?|no (fluff|preamble|filler)|don'?t ramble|tldr|few words|bullet(s| me)?)\b/i,
  detailed: /\b(detailed|in[- ]depth|thorough(ly)?|comprehensive|long( ?ass)?|deep[- ]dive|full (breakdown|writeup|rundown)|walk me through everything|as much detail|exhaustive)\b/i,

  // answer modes (priority order applied in code)
  coderPrompt: /\b(prompt for (the )?(coder|claude|agent|cursor|codex)|(give|write|create|draft|make) (me )?(a|an|one|the)? ?(long ?ass )?prompt|prompt (i|you) can (paste|copy|give)|copy[- ]?paste(able)? prompt|prompt to (give|hand|send)|spin up a prompt)\b/i,
  operatorCommand: /\b(what should (the )?(coder|claude|other session|agent|he|they) do|instructions? for (the )?(coder|agent|session)|tell (the )?(coder|agent|session)|what do i (tell|give|send)|next (move|step) for (the )?(coder|session|agent)|hand (the )?(coder|agent) )\b/i,
  correction: /\b(no,?\s|nope,?\s|actually,?\s|instead( of)?|that'?s not (what|it|right)|stop (doing|with)|don'?t (do|build|add) (that|this)|scrap (that|this|it)|replace .{0,40} with|more useful (functions|features|things)|no more (internal|busy ?work|cleanup)|not (internal|busywork))\b/i,
  waitMode: /\b(while we wait|in the meantime|meanwhile|while (that|it|the build|the deploy) (runs?|builds?|finishes?|deploys?)|until (it'?s|that'?s) done|as we wait|whilst we wait)\b/i,
  audit: /\b(audit|review (the|my|this)|go through (the|my|all)|check (the|my|all|every) .{0,30}(file|code|page|surface|module)|find (the )?(gaps?|issues?|bugs?|problems?))\b/i,
  digest: /\b(recap|digest|what changed|summari[sz]e (the|this|my|what)|tl;?dr of|catch me up|bring me up to speed)\b/i,
  brainstorm: /\b(brainstorm|come up with|ideas? for|what could we|spitball|riff on)\b/i,

  // execute / finalized posture — the user issued a command or closed the
  // decision. Signal to DO the thing and stop re-opening it. Kept phrase-based
  // (low false-positive) — an explicit /spar or brainstorm still overrides.
  executeFinalized:
    /\b(?:just|go|please) do it\b|\bdo it (?:now|already|then)\b|\b(make it happen|get it done|(?:just )?ship it|just (?:answer|tell me|give me the answer)|my (?:decision|call|mind) is (?:final|made up)|i(?:'ve| have) (?:decided|made up my mind)|stop (?:arguing|debating|pushing back|second[- ]guessing)|no more (?:objections?|debate|pushback|counter[- ]?views?)|don'?t (?:argue|debate|push back|second[- ]guess)|final decision|it'?s decided|decision'?s final|(?:just )?execute (?:it|this|the plan))\b/i,

  // ranking / top-N
  rank: /\b(top|best|first)\s+(\d+)\b|\b(rank|prioriti[sz]e|order)\b|\b(give|show|list) me (\d+)\b/i,
  rankCountTop: /\b(?:top|best|first|give me|show me|list)\s+(\d{1,3})\b/i,

  // clarification suppression
  dontAsk: /\b(don'?t ask|no (clarifying )?questions?|stop asking|without asking|just (do|answer|give|build) it|don'?t ask me|quit asking|no need to ask)\b/i,

  // repo grounding
  repoGrounded: /\b(look at (the )?(repo|code|codebase|files?)|check (the )?(repo|code|codebase|actual (code|files?))|double[- ]?check (the )?(repo|code)|in the (repo|codebase|code)|read (the )?(file|code|source)|grep (the|for)|based on (the )?actual|verify (against|in) (the )?(repo|code)|first (look|check|read)|don'?t (guess|assume).{0,20}(repo|code|file))\b/i,

  // evidence
  evidence: /\b(show me where|cite|citation|with (evidence|proof|sources?)|prove it|back (it|that) up|reference the|point to the)\b/i,

  // multi-session
  multiSession: /\b(\d+ sessions?|other session|another (claude|session|agent)|concurrent sessions?|multiple sessions?|sessions? (going|running|active)|parallel sessions?|3 (claudes?|agents?|windows?))\b/i,

  // status-update paste (reported, not verified)
  statusVerb: /\b(deployed?|deploying|pushed|committed?|build (passed|verified|green|succeeded|failed)|tests? (pass|passed|green|fail)|migration (applied|live)|shipped|merged|landed on (main|origin)|railway|commit `?[0-9a-f]{7}|verified live)\b/i,
  reportedFraming: /\b(here'?s (an |the )?(update|status)|status (update|from)|update from (the )?(other )?session|the other session (says|reports|did|finished)|session reports?|fyi|for context|reporting that|per the (other )?session)\b/i,

  // next-move
  nextMove: /\b(what (should i|do i|now)|next (step|move)|what'?s next|your call|recommend|decide for me|should i)\b/i,

  // imperative action (forces action, vs a question about an action)
  imperativeAction: /^(add|create|send|schedule|set|text|email|message|book|log|delete|remove|pin|move|update|mark)\b|:\s*(call|email|text|buy|do|finish)\b/i,
  // question framing about an action ("should I add", "can you add")
  actionQuestion: /\b(should i|can you|could you|would you|do you think i should|is it worth)\b.{0,30}\b(add|create|send|schedule|do|build|make)\b/i,
};

function detectLength(text: string, turn?: TurnSignal): ResponseLength {
  if (RE.ultraConcise.test(text)) return "ultra_concise";
  // detailed + a prompt request ("one long ass prompt") → detailed wins for length
  if (RE.detailed.test(text)) return "detailed";
  if (RE.concise.test(text)) return "concise";
  // casual one-liners stay short even without an explicit cue
  if (turn?.intent === "casual") return "concise";
  return "normal";
}

function extractRankCount(text: string): number | null {
  const m = text.match(RE.rankCountTop);
  if (m && m[1]) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 100) return n;
  }
  return null;
}

function detectAnswerMode(
  text: string,
  turn: TurnSignal | undefined,
  isStatusUpdate: boolean,
  rankCount: number | null,
): AnswerMode {
  // Priority: most distinctive intent first.
  if (isStatusUpdate) return "session_update";
  if (RE.coderPrompt.test(text)) return "copy_paste_prompt";
  if (RE.operatorCommand.test(text)) return "operator_command";
  if (RE.correction.test(text)) return "correction";
  if (RE.waitMode.test(text)) return "wait_mode";
  if (RE.audit.test(text)) return "audit";
  if (RE.digest.test(text)) return "digest";
  if (RE.brainstorm.test(text)) return "brainstorm";
  if ((rankCount !== null && rankCount > 1) || /\b(rank|prioriti[sz]e)\b/i.test(text)) return "ranked_recommendation";
  if (turn?.intent === "decision" || /\bshould i\b/i.test(text)) return "decision";
  return "direct_answer";
}

function detectOutputFormat(
  text: string,
  mode: AnswerMode,
  turn?: TurnSignal,
  shape?: QueryShape,
): OutputFormat {
  if (mode === "copy_paste_prompt") return "prompt";
  if (/\b(checklist|step[- ]?by[- ]?step|steps to)\b/i.test(text)) return "checklist";
  if (turn?.outputShape === "table" || /\b(table|tabular|columns?)\b/i.test(text)) return "table";
  if (
    mode === "ranked_recommendation" ||
    shape === "list" ||
    /\b(bullets?|list|points?)\b/i.test(text)
  )
    return "bullets";
  return "prose";
}

/**
 * Build the response contract for a turn. `turn` and `shape` are the
 * existing classifier outputs — pass them when available so the contract
 * reuses their work; the function still works standalone for testing.
 */
/** True when the user issued a command or finalized a decision — the signal to
 *  EXECUTE and stop re-opening the question. Pure + phrase-based. Exported so the
 *  brain-context (objection injector) and persist-turn (adversarial critic) gate
 *  sites can suppress unsolicited opposition without rebuilding the full contract. */
export function detectExecuteFinalized(text: string): boolean {
  return RE.executeFinalized.test((text || "").trim());
}

export function buildResponseContract(
  userText: string,
  turn?: TurnSignal,
  shape?: QueryShape,
): ResponseContract {
  const text = (userText || "").trim();
  const reasons: string[] = [];
  const forbiddenMoves: string[] = [];
  const requiredMoves: string[] = [];

  // ── flags ──
  const isStatusUpdate = RE.reportedFraming.test(text) && RE.statusVerb.test(text);
  const userIsManagingConcurrentSessions = RE.multiSession.test(text);
  const userIsAskingForCoderPrompt = RE.coderPrompt.test(text);
  const userIsCorrectingDirection = RE.correction.test(text);
  const mustBeRepoGrounded = RE.repoGrounded.test(text);
  const dontAsk = RE.dontAsk.test(text);
  const executeFinalized = detectExecuteFinalized(text);

  const rankCount = extractRankCount(text);
  const mode = detectAnswerMode(text, turn, isStatusUpdate, rankCount);
  const length = detectLength(text, turn);
  const outputFormat = detectOutputFormat(text, mode, turn, shape);

  const mustRankOptions =
    mode === "ranked_recommendation" ||
    (rankCount !== null && rankCount > 1) ||
    /\b(rank|prioriti[sz]e)\b/i.test(text);

  // Don't claim actions when this is a question/plan turn rather than an
  // imperative command. An explicit imperative ("add: call John") may act;
  // a question ("should I add this task?") must not.
  const isImperativeAction = RE.imperativeAction.test(text);
  const isActionQuestion = RE.actionQuestion.test(text);
  const mustNotClaimActions =
    !isImperativeAction &&
    (isActionQuestion ||
      mode === "brainstorm" ||
      mode === "decision" ||
      mode === "audit" ||
      mode === "digest" ||
      mode === "copy_paste_prompt" ||
      mode === "operator_command" ||
      mode === "ranked_recommendation" ||
      mode === "session_update");

  const mustGiveNextMove =
    mode === "decision" ||
    mode === "operator_command" ||
    mode === "audit" ||
    RE.nextMove.test(text);

  const mustIncludeEvidence =
    mustBeRepoGrounded || mode === "audit" || RE.evidence.test(text);

  // Clarification: default allowed, but suppressed when the user said so,
  // or when the turn is a produce-this-now mode where asking is friction.
  const shouldAskClarifying =
    !dontAsk &&
    mode !== "copy_paste_prompt" &&
    mode !== "operator_command" &&
    mode !== "session_update" &&
    mode !== "wait_mode";

  // ── reasons + required/forbidden moves ──
  reasons.push(`mode:${mode}`, `length:${length}`, `format:${outputFormat}`);

  if (length === "ultra_concise" || length === "concise") {
    forbiddenMoves.push("preamble / filler / throat-clearing");
    requiredMoves.push("lead with the answer");
  }
  if (length === "detailed") requiredMoves.push("be thorough — cover all parts");
  if (mode === "copy_paste_prompt") {
    requiredMoves.push("output a ready-to-paste prompt in a fenced block");
    forbiddenMoves.push("explain instead of producing the prompt", "ask clarifying questions");
  }
  if (mode === "operator_command") {
    requiredMoves.push("give concrete instructions the coder can execute");
    forbiddenMoves.push("vague 'I can help with that'");
  }
  if (mode === "correction") {
    requiredMoves.push("acknowledge the redirect + apply it immediately");
    forbiddenMoves.push("repeat the corrected-away approach");
    reasons.push("user is correcting direction");
  }
  if (mode === "wait_mode") requiredMoves.push("do useful interim work; don't re-ask for the goal");
  if (mustRankOptions) {
    requiredMoves.push(rankCount ? `return exactly ${rankCount} ranked items` : "return a ranked list");
  }
  if (mustBeRepoGrounded) {
    requiredMoves.push("cite specific files/functions from the repo");
    forbiddenMoves.push("generic answer with no repo references");
  }
  if (mustIncludeEvidence) requiredMoves.push("back claims with evidence (files, citations, receipts)");
  if (mustNotClaimActions) forbiddenMoves.push("claim you performed an action you did not execute");
  if (mustGiveNextMove) requiredMoves.push("end with one concrete next move");
  if (!shouldAskClarifying && dontAsk) {
    forbiddenMoves.push("ask a clarifying question");
    reasons.push("clarification suppressed (user said don't ask)");
  }
  if (isStatusUpdate) {
    requiredMoves.push("treat pasted status as REPORTED, not verified — don't upgrade it to fact");
    reasons.push("status-update paste detected");
  }
  if (executeFinalized) {
    forbiddenMoves.push(
      "re-open or re-litigate the finalized decision",
      "add an unsolicited counter-view / objection / 'have you considered'",
    );
    requiredMoves.push("execute the command / honor the decision directly");
    reasons.push("execute-finalized posture (no unsolicited opposition)");
  }
  if (userIsManagingConcurrentSessions) reasons.push("multi-session context");
  // Direction-correction forbidden specifics
  if (/\bno more (internal|busy ?work|cleanup)\b|\bnot (internal|busywork)\b/i.test(text)) {
    forbiddenMoves.push("internal-only / cleanup work");
  }
  if (/\bmore useful (functions|features|things)\b|\breplace .{0,40} with\b/i.test(text)) {
    requiredMoves.push("propose concrete, useful functions — not abstract ideas");
    forbiddenMoves.push("abstract / vague suggestions");
  }

  return {
    answerMode: mode,
    length,
    outputFormat,
    shouldAskClarifying,
    mustBeRepoGrounded,
    mustIncludeEvidence,
    mustNotClaimActions,
    mustRankOptions,
    rankCount,
    mustGiveNextMove,
    userIsCorrectingDirection,
    userIsAskingForCoderPrompt,
    userIsManagingConcurrentSessions,
    isStatusUpdate,
    executeFinalized,
    forbiddenMoves,
    requiredMoves,
    reasons,
  };
}

/**
 * Render the contract as a compact system-prompt directive. Kept tiny —
 * Nick already has a large prompt; this is a per-turn nudge, not a lecture.
 */
export function buildContractDirective(c: ResponseContract): string {
  const bits: string[] = [];
  const lengthHint: Record<ResponseLength, string> = {
    ultra_concise: "Answer in one line.",
    concise: "Be concise — no preamble.",
    normal: "",
    detailed: "Be thorough — cover every part.",
  };
  if (lengthHint[c.length]) bits.push(lengthHint[c.length]);
  if (c.answerMode === "copy_paste_prompt") bits.push("Output a ready-to-paste prompt in a fenced code block — nothing else.");
  if (c.answerMode === "operator_command") bits.push("Give concrete, executable instructions.");
  if (c.answerMode === "session_update") bits.push("This is a REPORTED status from the user — do not restate it as verified fact.");
  if (c.answerMode === "wait_mode") bits.push("Do useful interim work; don't re-ask for the goal.");
  if (c.mustRankOptions) bits.push(c.rankCount ? `Return exactly ${c.rankCount} ranked items.` : "Return a ranked list.");
  if (c.mustBeRepoGrounded) bits.push("Ground every claim in specific repo files — no generic answers.");
  if (!c.shouldAskClarifying) bits.push("Do NOT ask clarifying questions — make a reasonable assumption and proceed.");
  if (c.mustGiveNextMove) bits.push("End with one concrete next move.");
  if (c.forbiddenMoves.length) bits.push(`Avoid: ${c.forbiddenMoves.join("; ")}.`);
  if (bits.length === 0) return "";
  return `## This turn\n${bits.join(" ")}`;
}
