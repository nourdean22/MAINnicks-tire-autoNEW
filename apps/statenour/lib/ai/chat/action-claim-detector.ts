/**
 * Action-claim detector · v10.0.177 · vocab-driven
 *
 * Diagnosed live via the v10.0.156 envelope wiring: messageId
 * cmopt9mkl000404l5qfz1g4rj said "Yes, added the suggested tasks to
 * Bay 5 Revive · Total tasks now: 15" but envelope.toolsCalled was
 * empty. Nick wrote text describing an action he never executed —
 * the user trusted the claim, opened Bay 5 Revive, found 0 tasks.
 *
 * This module is the guard. After streamText finishes, the chat
 * post-stream walker calls detectActionClaimsWithoutTools(text,
 * capturedToolCalls). When the helper returns claims, the caller
 * logs a structured warning that the chat surface renders as a
 * correction chip below the bubble.
 *
 * v10.0.177 · primary verb-object patterns now derive from the
 * shared vocab in `lib/ai/action-vocab.ts` (same module the input-
 * side intent detector uses). Adding a verb to vocab fixes BOTH
 * detectors atomically — eliminates the input/output drift that
 * caused the v10.0.176 Pitch Cleveland fab. Edge patterns that
 * don't fit verb+object structure (e.g. "I've added", "task(s)
 * added", "email sent") stay here as the long tail.
 *
 * Pure function — zero deps, trivial to unit-test.
 */

import { claimEntries, type ClaimEntry } from "@/lib/ai/action-vocab";
import { stripCitations } from "@/lib/ai/memory-citations";

/**
 * Edge-case patterns that don't decompose into past-verb+object.
 * The vocab handles ~80% of fab claims via verb+object regexes;
 * these are structural variants the vocab doesn't cover.
 *
 * Mirrors the EDGE_INTENT_PATTERNS list in action-intent-detector.ts.
 */
// Exported so the tool-existence CI guard (action-claim-detector
// .test.ts) can assert every mapsToTool resolves to a REAL nourTools
// entry — the drift that let `saveToBrain`/`updatePinnedMemory`/
// `sendEmail` linger as permanently-unsatisfiable expected tools.
export const EDGE_CLAIM_PATTERNS: ClaimEntry[] = [
  // Subject-prefix forms ("I've added the tasks") — verb is buried
  // and the object may not follow within 40 chars.
  { regex: /\bI'?ve?\s+added\b/i, verb: "I've added", mapsToTool: "createTask" },
  // Object-leads forms ("tasks added", "task created") — past-tense
  // verb after a noun-phrase, no subject. Common in terse summaries.
  { regex: /\btask(?:s)?\s+(?:added|created)\b/i, verb: "task(s) added", mapsToTool: "createTask" },
  // Set reminder — atypical verb→object pair
  { regex: /\bset\b.{0,40}\breminder\b/i, verb: "set reminder", mapsToTool: "scheduleFollowUp" },
  // Email-specific terse claim. The chat tool is `composeEmail` (there
  // is no `sendEmail` chat tool — that's a service), so map there.
  { regex: /\bemail\s+sent\b/i, verb: "email sent", mapsToTool: "composeEmail" },
  // Bare-verb send claim ("Sent it.") — accept either real send tool.
  // `sendEmail` dropped (never a chat tool); the model routes a send
  // via composeEmail or sendTelegram.
  // 2026-09-22 banner audit · the bare form fired on recaps of OTHER people's
  // sends ("Mo sent a text", "the coach texted me", "3 DMs sent") and of the
  // user's own ("Sent $1,000 to Hamda"): 10 of 10 production banners from this
  // pattern in 60 days were false, and a false banner is not cosmetic — L3
  // replaces the turn in history. A send is NICK'S claim in two shapes only:
  // first person with at most two adverbs between ("I sent it", "I've already
  // texted him"), or the terse confirmation that OPENS the sentence ("Sent
  // it.", "Done — sent the email", "Texted her.") and runs into a message-like
  // object or a terminator — so "Sent $400" (money) and "text sent," (passive)
  // stay quiet. `^` is the sentence start: detectActionClaims runs per sentence.
  {
    regex:
      /(?:\bI(?:'ve)?\s+(?:(?:just|already|also|now|then|finally|actually)\s+){0,2}|^\W*(?:(?:done|ok|okay|alright|yes|yep|just|and|so|also)\W+)?)(?:sent|emailed|messaged|texted)\b(?!\s+(?:via|on|by|to\s+(?:say|let)))(?=\s*(?:[.!?,;:)\]—–-]|$)|\s+(?:it|that|them|him|her|you|the|a|an|your|my|this|those|these|over|off|out|both|everything|already|now|to)\b)/i,
    verb: "sent (bare)",
    mapsToTool: "composeEmail|sendTelegram",
  },
  // Pinned — past participle used as a VERB, no object required. Real tool is
  // `pinMemory` (there is no `updatePinnedMemory`). 2026-09-22 banner audit:
  // the bare word fired 15 times in 60 days, 12 of them on adjectives, labels
  // and metaphors ("pinned tab", "pinned posts", "[Pinned by Nour]", "pinned
  // between"). The claim shapes — "Pinned.", "All entries pinned.", "the
  // pattern is pinned so it surfaces", "Pinned that to the brain" — are
  // followed by a terminator, a pronoun or a verb continuation, never a noun.
  // 2026-09-22 (sibling audit of all 41 banners, trace t_msuu1c9w): "pinned
  // to the shop / profile / page / top / board / channel / feed / story /
  // highlights / tab / post" describes a UI surface, not a pinMemory call —
  // the one residual the audit left. A pin INTO the brain still fires.
  {
    regex:
      // 2026-09-22 (review on #2522) · `top` is a UI surface EXCEPT "the top of
      // the brain / of long-term memory / of your memory" - that is the brain
      // pin itself, phrased through the top.
      /(?<!\bnot\s)\bpinned\b(?!\s+to\s+(?:the\s+|your\s+|my\s+|a\s+)?(?:shop|profile|page|top(?!\s+of\s+(?:the\s+|your\s+|my\s+)?(?:brain|memor|long-term))|board|channel|feed|story|stories|highlights?|tab|posts?|comments?|tweet)\b)(?=\s*(?:[.!?,;:)\]—–-]|$)|\s+(?:it|that|this|them|those|these|to|so|in|into|for|and|now|as|under)\b)/i,
    verb: "pinned",
    mapsToTool: "pinMemory",
  },
];

/**
 * Cache materialized vocab entries (build once per process).
 */
const VOCAB_ENTRIES = claimEntries();
const ACTION_VERB_PATTERNS: ClaimEntry[] = [...VOCAB_ENTRIES, ...EDGE_CLAIM_PATTERNS];

/**
 * Hedge phrases — when present in the text, they neutralize a claim
 * because the model is being honest about uncertainty. E.g. "I would
 * have added the tasks if I had access" is NOT a fabricated claim.
 */
const HEDGE_PATTERNS: RegExp[] = [
  /\b(?:would|could|should|might)\s+(?:add|create|send|schedule)/i,
  /\bif\s+(?:you|i)\s+(?:want|need|approve)\b/i,
  /\b(?:can|able\s+to)\b.{0,20}\b(?:add|create|send|schedule)\b/i,
  /\bI\s+(?:can'?t|cannot|don'?t\s+have)\b/i,
  /\bplease\s+(?:add|create|send|schedule)\b/i,
  // "I'll" (contraction, no space) OR "I will" (with space)
  // 2026-09-22 · up to three words between the auxiliary and the verb, so
  // "I'll log it and set the reminder" reads as the promise it is.
  /\bi(?:'ll|\s+will)\s+(?:\w+\s+){0,3}(?:add|create|send|schedule|set)\b/i,
  /\bi\s+(?:recommend|suggest)\b/i,
  // 2026-09-22 · the bare offer too ("Want me to set a 6pm reminder?") — three
  // of three `set reminder` banners in 60 days were offers or promises.
  /\bwant\s+me\s+to\b/i,
  // 2026-09-22 · a NEGATED past participle is not a claim ("isn't marked
  // done", "haven't been ingested", "nothing was pulled", "I haven't synced
  // it yet"). Verb list = the claim verbs the vocab and edge patterns use.
  /\b(?:haven'?t|hasn'?t|hadn'?t|isn'?t|wasn'?t|weren'?t|aren'?t|didn'?t|never|not|nothing)\s+(?:\w+\s+){0,2}(?:been\s+)?(?:added|created|sent|texted|emailed|messaged|linked|finished|completed|closed|marked|scheduled|posted|published|saved|noted|pinned|moved|bumped|synced|pulled|ingested|refreshed|logged)\b/i,
  // Second-person reflection — Nick describing what the USER did
  // ("you texted Dania", "you finished the task", "you've added X").
  // That is not a self-claim, so it must not count as fabrication.
  // Tight adjacency (you + ≤1 word + past verb) so it doesn't eat
  // "you wanted me to add…" where the action is actually Nick's.
  /\byou(?:'ve| have| had| never| also| still)?\s+(?:\w+\s+)?(?:added|created|sent|texted|emailed|messaged|linked|finished|completed|scheduled|posted|published|saved|noted|pinned|moved|bumped)\b/i,
];

export interface ActionClaim {
  /** The matched verb phrase (e.g. "added/created task") */
  verb: string;
  /** Approximate snippet from the assistant text containing the claim */
  snippet: string;
  /** Tool the claim implies should have fired */
  expectedTool: string;
}

export interface ActionClaimReport {
  /** Claims detected in the text */
  claims: ActionClaim[];
  /** Whether the response is hedged (claims may still appear but the
   *  text itself signals uncertainty — caller may want to weight the
   *  warning lower or suppress entirely). */
  hedged: boolean;
}

// ── Sentence-level hedge isolation ───────────────────────────────────
/**
 * Split text into rough sentences. A claim is only a fabrication if ITS
 * sentence isn't hedged — so a hedge in one sentence must not suppress a
 * real claim in another. The split is loose (terminators + newlines) but
 * guards "i.e." / "e.g." — splitting mid-abbreviation can strand a
 * claim's verb and object in different fragments, hiding it from both.
 */
function splitSentences(text: string): string[] {
  return text
    // Sentence terminator + whitespace, OR a newline run. The negative
    // lookbehinds keep "i.e." / "e.g." together — their internal period
    // is not a sentence end.
    .split(/(?:(?<!\bi\.e\.)(?<!\be\.g\.)(?<=[.!?])\s+)|\n+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** True if a single sentence (or clause) contains a hedge phrase. */
function sentenceIsHedged(sentence: string): boolean {
  return HEDGE_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(sentence);
  });
}

/**
 * 2026-09-22 (review on #2513) · a hedge is scoped to its CLAUSE. "I haven't
 * synced the calendar, but I completed both tasks" hedges the first clause
 * only; dropping the whole sentence let the completion claim walk past the
 * verifier. Clauses split at a contrast conjunction after a comma or
 * semicolon; the live text is the non-hedged clauses joined back together,
 * so the claim regexes (whose `^` arm sees the sentence start) run on what
 * the model actually asserted.
 */
const CLAUSE_SPLIT = /(?:,|;)\s+(?:but|yet|however|though|although|whereas)\s+/i;

function liveClauses(sentence: string): { live: string; hedged: boolean } {
  const clauses = sentence.split(CLAUSE_SPLIT).map((c) => c.trim()).filter(Boolean);
  if (clauses.length <= 1) {
    const h = sentenceIsHedged(sentence);
    return { live: h ? "" : sentence, hedged: h };
  }
  const flags = clauses.map(sentenceIsHedged);
  return { live: clauses.filter((_, i) => !flags[i]).join(" "), hedged: flags.some(Boolean) };
}

/**
 * Scan an assistant message for action-claim verbs. Returns a report
 * of detected claims; the caller decides what to do with it (warn,
 * suppress, log).
 *
 * Hedge handling is PER-SENTENCE: a claim is collected only from a
 * sentence that is not itself hedged. Pre-fix `hedged` was computed over
 * the whole message and detectActionClaimsWithoutTools dropped EVERY
 * claim when it was true — so "Added the tasks. I'll send a recap."
 * had its real "added" fabrication suppressed by the unrelated
 * future-tense second sentence. `report.hedged` stays document-wide
 * (any sentence hedged) for telemetry.
 *
 * Pure — no IO. Safe to call from inside a hot path.
 */
export function detectActionClaims(text: string): ActionClaimReport {
  // Strip [brain:TAG] citation markers FIRST. They are sanctioned by
  // the citation protocol (memory-citations.ts) and assert no action —
  // but their surrounding prose ("Linked to: [brain:recall]") used to
  // trip the link/send claim patterns. Stripping the tag removes the
  // marker; the first-person anchor on relational verbs handles the
  // residual editorial prose. Single strip point covers every caller.
  const cleaned = stripCitations(text);
  const sentences = splitSentences(cleaned);
  const scoped = sentences.map(liveClauses);
  const hedgedFlags = scoped.map((s) => s.hedged);
  const liveSentences = scoped.map((s) => s.live).filter(Boolean);

  const claims: ActionClaim[] = [];
  for (const { regex, verb, mapsToTool } of ACTION_VERB_PATTERNS) {
    for (const sentence of liveSentences) {
      // Reset lastIndex defensively — a /g pattern in the vocab would
      // otherwise carry state across sentences and across calls.
      regex.lastIndex = 0;
      const m = regex.exec(sentence);
      if (m) {
        // Snippet = the matched verb + ~30 chars of surrounding context,
        // from the sentence the claim was found in.
        const start = Math.max(0, m.index - 30);
        const end = Math.min(sentence.length, m.index + m[0].length + 30);
        claims.push({
          verb,
          snippet: sentence.slice(start, end).trim(),
          expectedTool: mapsToTool,
        });
        break; // one claim per pattern — matches the prior single-exec
      }
    }
  }
  const hedged = hedgedFlags.some(Boolean);
  return { claims, hedged };
}

/**
 * Check if any of the detected claims map to a tool that actually
 * fired during the turn. Returns claims that DON'T have a matching
 * tool call — these are the fabricated ones.
 *
 * `mapsToTool` may be a pipe-separated alternation (e.g. "sendEmail|
 * sendTelegram") to allow multiple acceptable tools per claim.
 */
export function detectActionClaimsWithoutTools(
  text: string,
  toolCalls: ReadonlyArray<{ name: string }>,
): ActionClaim[] {
  // detectActionClaims already drops claims from hedged sentences, so
  // there is no document-wide `hedged` short-circuit here anymore — a
  // hedge in one sentence no longer suppresses a fabrication in another.
  const report = detectActionClaims(text);
  if (report.claims.length === 0) return [];

  const firedTools = new Set(toolCalls.map((t) => t.name.toLowerCase()));
  return report.claims.filter((c) => {
    const candidates = c.expectedTool.toLowerCase().split("|");
    return !candidates.some((tool) => firedTools.has(tool));
  });
}

/**
 * Slice 1: Telemetry · Behavioral Probability Analysis
 * Calculate the Tool-to-Verb ratio for the calibration engine.
 * Ratio = Fired Tools / Claimed Verbs.
 * If 1.0, perfect alignment. < 1.0 means missing tools (fabrication).
 * > 1.0 means tools fired silently without explicit chat claims.
 */
export function calculateToolVerbRatio(
  text: string,
  toolCalls: ReadonlyArray<{ name: string }>,
): { ratio: number; claimsCount: number; toolsCount: number; hedged: boolean } {
  const report = detectActionClaims(text);
  const claimsCount = report.claims.length;
  const toolsCount = toolCalls.length;
  
  // If there are no claims, ratio is effectively 1 if no tools, or Infinity if tools fired silently.
  // We represent "no claims, no tools" as 1.0 (baseline).
  let ratio = 1.0;
  if (claimsCount > 0) {
    ratio = toolsCount / claimsCount;
  } else if (toolsCount > 0) {
    ratio = toolsCount; // Unclaimed tools (silent work)
  }

  return {
    ratio,
    claimsCount,
    toolsCount,
    hedged: report.hedged,
  };
}
