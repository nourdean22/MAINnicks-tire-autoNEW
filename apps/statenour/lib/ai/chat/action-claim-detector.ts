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

/**
 * Edge-case patterns that don't decompose into past-verb+object.
 * The vocab handles ~80% of fab claims via verb+object regexes;
 * these are structural variants the vocab doesn't cover.
 *
 * Mirrors the EDGE_INTENT_PATTERNS list in action-intent-detector.ts.
 */
const EDGE_CLAIM_PATTERNS: ClaimEntry[] = [
  // Subject-prefix forms ("I've added the tasks") — verb is buried
  // and the object may not follow within 40 chars.
  { regex: /\bI'?ve?\s+added\b/i, verb: "I've added", mapsToTool: "createTask" },
  // Object-leads forms ("tasks added", "task created") — past-tense
  // verb after a noun-phrase, no subject. Common in terse summaries.
  { regex: /\btask(?:s)?\s+(?:added|created)\b/i, verb: "task(s) added", mapsToTool: "createTask" },
  // Set reminder — atypical verb→object pair
  { regex: /\bset\b.{0,40}\breminder\b/i, verb: "set reminder", mapsToTool: "scheduleFollowUp" },
  // Email-specific terse claim
  { regex: /\bemail\s+sent\b/i, verb: "email sent", mapsToTool: "sendEmail" },
  // Bare-verb send claim ("Sent it.") — output-side accepts any of
  // composeEmail / sendEmail / sendTelegram. Vocab forces composeEmail
  // on input but model may have legitimately routed via sendTelegram.
  {
    regex: /\b(?:sent|emailed|messaged|texted)\b(?!\s+(?:via|on|by|to\s+(?:say|let)))/i,
    verb: "sent (bare)",
    mapsToTool: "composeEmail|sendEmail|sendTelegram",
  },
  // Pinned — bare past-participle, no object required
  { regex: /\bpinned\b/i, verb: "pinned", mapsToTool: "updatePinnedMemory" },
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
  /\bi(?:'ll|\s+will)\s+(?:add|create|send|schedule|set)/i,
  /\bi\s+(?:recommend|suggest)\b/i,
  /\bdo\s+you\s+want\s+me\s+to\b/i,
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

/** True if a single sentence contains a hedge phrase. */
function sentenceIsHedged(sentence: string): boolean {
  return HEDGE_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(sentence);
  });
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
  const sentences = splitSentences(text);
  const hedgedFlags = sentences.map(sentenceIsHedged);
  const liveSentences = sentences.filter((_, i) => !hedgedFlags[i]);

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
