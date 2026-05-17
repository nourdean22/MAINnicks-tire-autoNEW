/**
 * OUTPUT SANITIZER — strips generic-LLM filler from Nick's responses.
 *
 * Nick has a distinct voice (cold, precise, direct). Generic LLM phrases
 * ("Certainly!", "I hope this helps", "As an AI", "It seems like") break
 * the voice. They also waste tokens and pad without adding info.
 *
 * We use a TWO-LAYER defense:
 *   1. The system prompt has a "forbidden phrases" block (prevention)
 *   2. This sanitizer runs on the SAVED assistant message (cure)
 *
 * We do NOT mutate the live stream — once a token is sent to the client,
 * it's visible. Instead, we clean the text before storing it to
 * conversation history, so future prompts don't carry the filler
 * forward, and the saved history reads clean.
 */

// Leading throat-clears — the model's first ~40 chars are most prone
// to filler. These patterns ALL strip anchor from the start of the
// string, so they only fire on genuinely leading filler, not mid-sentence.
//
// Order matters · "sure thing" must come BEFORE "sure" so the longer
// phrase wins (regex walk strips first match). v10.0.335 fix.
const LEAD_FILLER: RegExp[] = [
  /^certainly[!.,]?\s+/i,
  /^of course[!.,]?\s+/i,
  /^absolutely[!.,]?\s+/i,
  /^sure thing[!.,]?\s+/i,
  /^sure[!.,]?\s+/i,
  /^great question[!.,]?\s+/i,
  /^happy to help[!.,]?\s+/i,
  /^I'?d be happy to[^.]*[.,]?\s+/i,
  /^I'?ll (help|explain|walk you through)[^.]*[.,]?\s+/i,
  /^let me (help|explain|clarify)[^.]*[.,]?\s+/i,
  /^here'?s\s+(what|a|the)[^.]{0,80}\.\s*/i, // only strip if short intro paragraph
  /^as an ai[^.]*[.,]?\s+/i,
  /^as a (language model|chatbot)[^.]*[.,]?\s+/i,
];

// Filler phrases that can appear anywhere — replaced with empty string
// instead of the whole sentence. Keep these tight; we don't want to
// mangle legitimate uses.
const ANYWHERE_FILLER: Array<[RegExp, string]> = [
  // Hope-filled fluff
  [/\bi hope this helps[!.]?/gi, ""],
  [/\blet me know if you (need|have)[^.]{0,80}[!.]/gi, ""],
  [/\bfeel free to (ask|reach out)[^.]{0,80}[!.]/gi, ""],
  [/\bif you have any (other )?questions[^.]{0,80}[!.]/gi, ""],
  [/\bhappy to (help|clarify|dive deeper)[^.]{0,80}[!.]/gi, ""],
  [/\bi'?m here to help[!.]?/gi, ""],

  // Disclaimers that add nothing
  [/\bas an ai[,]?\s*/gi, ""],
  [/\bas a language model[,]?\s*/gi, ""],
  [/\bi don'?t have (real.?time|live) (access|data)[^.]{0,80}[.]?/gi, ""],

  // Hedging
  [/\bit seems like[,]?\s+/gi, ""],
  [/\bit appears that\s+/gi, ""],
  [/\bi think (that )?/gi, ""],
  [/\bbased on (my )?(analysis|understanding)[,]?\s*/gi, ""],

  // Inflated connectors — keep sentences but drop the leading word
  [/^however,?\s+/gim, ""],
  [/^additionally,?\s+/gim, ""],
  [/^furthermore,?\s+/gim, ""],
  [/^moreover,?\s+/gim, ""],
  [/^in conclusion,?\s+/gim, ""],
  [/^to summarize,?\s+/gim, ""],
  [/^in summary,?\s+/gim, ""],

  // "In this [response|answer]" style self-reference
  [/\bin (this|my) (response|answer|reply)[,]?\s*/gi, ""],
];

// Whitespace cleanup patterns run AFTER the strip patterns
const WHITESPACE_FIXES: Array<[RegExp, string]> = [
  [/[ \t]+\n/g, "\n"],          // strip trailing whitespace per line
  [/\n{3,}/g, "\n\n"],           // collapse 3+ blank lines to 2
  [/^[ \t]+/gm, ""],              // strip leading whitespace per line (but preserve markdown leading spaces)
  // v10.0.335 · collapse multiple in-line spaces to one. When ANYWHERE_FILLER
  // strips a phrase between two real words ("Tires fit. I hope this helps.
  // Want a quote?" → "Tires fit.  Want a quote?") the surrounding spaces
  // double up. Without this rule the user reads doubled spaces in the chat.
  [/ {2,}/g, " "],
  [/\s+([.,!?;:])/g, "$1"],      // fix " ." → "."
  [/^\s+|\s+$/g, ""],              // final trim
];

// v10.0.332 · XML pseudo-template stripper. Venice/Anthropic models
// occasionally leak instruction-template tags ("<request><instruction>X
// </instruction></request>") into chat output instead of calling the
// image-gen tool or just answering. Seen in turn 10 of conversation
// cmou6xugm — the user asked "How about just a nice informational
// graphic" and Nick output the raw template wrapper. We strip the
// wrappers but PRESERVE the inner instruction text so the operator
// still sees Nick's actual thought · the wrappers are pure leakage.
function stripXmlPseudoTemplate(text: string): string {
  let result = text;

  // Pattern 1 · markdown-fenced XML wrapper (```xml\n<request>...</request>\n```)
  // The template wrapper starts the message and is the only content.
  // Strip the fence + outer tag, keep the <instruction> inner text.
  result = result.replace(
    /```\s*xml\s*\n?\s*<request>\s*\n?\s*<instruction>([\s\S]*?)<\/instruction>\s*\n?\s*<\/request>\s*\n?\s*```/gi,
    (_, inner: string) => inner.trim(),
  );

  // Pattern 2 · bare <request><instruction>...</instruction></request> with
  // no markdown fence. Same strip behavior.
  result = result.replace(
    /<request>\s*\n?\s*<instruction>([\s\S]*?)<\/instruction>\s*\n?\s*<\/request>/gi,
    (_, inner: string) => inner.trim(),
  );

  // Pattern 3 · standalone <instruction>...</instruction> (model emitted
  // just the inner tag without a request wrapper).
  result = result.replace(
    /<instruction>([\s\S]*?)<\/instruction>/gi,
    (_, inner: string) => inner.trim(),
  );

  return result;
}

/**
 * Sanitize a raw assistant response. Returns the cleaned text + the
 * number of characters trimmed (useful for stats/debugging).
 */
export function sanitizeResponse(text: string): { cleaned: string; trimmed: number } {
  if (!text || typeof text !== "string") {
    return { cleaned: "", trimmed: 0 };
  }
  const original = text;
  let result = text;

  // 0. Strip XML pseudo-template wrappers (v10.0.332). Runs FIRST so the
  //    inner instruction text flows through the rest of the sanitizer.
  result = stripXmlPseudoTemplate(result);

  // 1. Strip leading filler (walk the list until nothing matches)
  let keepStripping = true;
  while (keepStripping) {
    keepStripping = false;
    for (const pat of LEAD_FILLER) {
      if (pat.test(result)) {
        result = result.replace(pat, "");
        keepStripping = true;
        break;
      }
    }
  }

  // 2. Strip anywhere-filler
  for (const [pat, replacement] of ANYWHERE_FILLER) {
    result = result.replace(pat, replacement);
  }

  // 3. Normalize whitespace
  for (const [pat, replacement] of WHITESPACE_FIXES) {
    result = result.replace(pat, replacement);
  }

  return {
    cleaned: result,
    trimmed: Math.max(0, original.length - result.length),
  };
}

/**
 * Quick sanity check: is this response likely filler-free? Returns TRUE
 * if no matching patterns fire. Used by tests + observability.
 */
export function hasFiller(text: string): boolean {
  if (!text) return false;
  for (const pat of LEAD_FILLER) if (pat.test(text)) return true;
  for (const [pat] of ANYWHERE_FILLER) if (pat.test(text)) return true;
  return false;
}
