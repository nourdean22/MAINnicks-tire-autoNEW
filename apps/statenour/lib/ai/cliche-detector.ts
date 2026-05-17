/**
 * CLICHE DETECTOR — Apr 19.
 *
 * Complement to output-sanitizer.ts. Sanitizer strips filler ("Certainly!",
 * "I hope this helps"). This detector catches a DIFFERENT class of weak
 * writing: stock phrases that sound like every other LLM output.
 *
 * Examples the sanitizer doesn't catch:
 *   - "navigating the complexities of..."
 *   - "a wealth of information"
 *   - "at the end of the day"
 *   - "when it comes to..."
 *   - "game-changer" / "paradigm shift" / "low-hanging fruit"
 *
 * We don't mutate these mid-stream (would mangle valid usage). Instead,
 * we COUNT them so output-critic can flag low-quality replies and the
 * learning loop can steer future turns away from stock phrasing.
 *
 * Nour's voice is concrete, specific, numerical. Clichés are the opposite
 * of that — abstract, generic, interchangeable. Detecting them is a proxy
 * for "this reply could have been written about anyone's business."
 */

// Phrases that should almost never appear in Nick's output. Each is a
// generic LLM tell — rare in human writing, common in model output.
const CLICHES: RegExp[] = [
  // Corporate-speak
  /\bnavigating the (complex|complexities|landscape)\b/i,
  /\ba wealth of (information|knowledge|data|experience)\b/i,
  /\bat the end of the day\b/i,
  /\bwhen it comes to\b/i,
  /\bin today'?s (fast-paced|dynamic|competitive|digital) (world|landscape|environment|market)\b/i,
  /\bleverage (the|this|these|your)\b/i,
  /\bsynergy\b/i,
  /\bparadigm shift\b/i,
  /\bgame.?changer\b/i,
  /\blow.?hanging fruit\b/i,
  /\bmove the needle\b/i,
  /\bcircle back\b/i,
  /\bdeep dive\b/i,
  /\bboil (it|this|that) down\b/i,
  /\bunpack this\b/i,

  // Generic pivots
  /\bthat being said\b/i,
  /\bwith that in mind\b/i,
  /\bkeep in mind (that)?\b/i,
  /\bit'?s worth (noting|mentioning)\b/i,
  /\bit goes without saying\b/i,
  /\bnot to mention\b/i,
  /\blast but not least\b/i,

  // LLM stock phrases
  /\bplays? a (crucial|critical|vital|significant|important) role\b/i,
  /\bunderstanding the nuances\b/i,
  /\ba testament to\b/i,
  /\bthe intricacies of\b/i,
  /\btapestry of\b/i,
  /\bdelve into\b/i,
  /\brobust (solution|framework|approach|system)\b/i,
  /\bcutting.?edge\b/i,
  /\bstate.?of.?the.?art\b/i,
  /\bseamless (integration|experience|workflow)\b/i,

  // Vague quantifiers where specifics belong
  /\bnumerous (ways|options|benefits|factors)\b/i,
  /\bvarious (ways|options|benefits|factors|types)\b/i,
  /\ba myriad of\b/i,
  /\ba plethora of\b/i,

  // Performative emphasis
  /\bit'?s important to (note|mention|remember|understand)\b/i,
  /\bit'?s crucial to\b/i,
  /\bit'?s essential to\b/i,

  // Wrap-up filler
  /\bin today'?s ever.?changing\b/i,
  /\bunlock the (power|potential|secrets) of\b/i,
  /\bstreamline your (workflow|process|operations)\b/i,
];

/**
 * Scan a reply for cliché phrases. Returns count + array of the specific
 * phrases caught, so the critic can surface the worst offender.
 */
export function detectCliches(text: string): { count: number; matches: string[] } {
  if (!text || typeof text !== "string") return { count: 0, matches: [] };
  const matches: string[] = [];
  for (const pat of CLICHES) {
    const m = text.match(pat);
    if (m) matches.push(m[0]);
  }
  return { count: matches.length, matches };
}

/**
 * Density: cliché count per 100 words. Above 1.0 means the reply leans
 * on stock phrasing; above 2.0 is a regen candidate.
 */
export function clicheDensity(text: string): number {
  const { count } = detectCliches(text);
  const words = text.trim().split(/\s+/).length;
  if (words === 0) return 0;
  return (count / words) * 100;
}
