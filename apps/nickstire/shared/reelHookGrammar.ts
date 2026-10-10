/**
 * Hook grammar: the SHAPE of a Reel's opening line, and when one shape has
 * taken over the feed (2026-10-08).
 *
 * The classifier lived in server/services/reelRepetitionHistory.ts, which
 * recorded every Reel's hook grammar since Wave B (2026-10-01) while nothing
 * read it back: the distinctiveness scorer compared topic, keyword, archetype,
 * motion lens and object, and the generator was never told. Measured
 * 2026-09-09 across 166 packs: 99 shared one five-beat shape. Shared here so
 * the scorer (client/src/lib/facelessReelStudio.ts, also run by the server)
 * and the generator steer read one definition.
 *
 * WHY ONLY THE HOOK. The history also records CTA family and Pattern Lab
 * structure. Neither is penalised, on purpose: the CTA is the declared end card
 * (shared/reelAsk.ts, `profile` by default; since 2026-10-10 the caption
 * carries no ask of its own), and the structure is chosen by the Pattern Lab
 * learner, whose job includes repeating what earned distribution. Penalising
 * either would fight a deliberate policy instead of a drift.
 */
export type HookGrammar =
  | "symptom_question"
  | "customer_quote"
  | "number_lead"
  | "command"
  | "direct_statement"
  | "unknown";

/**
 * Deterministic hook-grammar classifier over beat 1's on-screen text. Small
 * on purpose — it names the grammars §R hypothesis 3 compares
 * (customer_quote vs symptom_question) plus the three other shapes the
 * corpus actually uses. Order matters: a quoted question is a quote.
 */
export function classifyHookGrammar(text: string | null | undefined): HookGrammar {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "unknown";
  // A quotation mark, or first-person speech ("My car shakes at 60").
  if (/^["'“‘]/.test(t) || /["“][^"”]{6,}["”]/.test(t) || /^(my|i|we|our)\b/i.test(t)) {
    return "customer_quote";
  }
  if (/\?\s*$/.test(t) || /^(why|what|when|how|is|are|does|do|can|should|ever|did)\b/i.test(t)) {
    return "symptom_question";
  }
  if (/^[$]?\d/.test(t)) return "number_lead";
  if (/^(stop|check|don'?t|never|look|listen|watch|send|grab|pull|push|press|try|turn|open|feel|smell|hear)\b/i.test(t)) {
    return "command";
  }
  return "direct_statement";
}

/** A grammar is saturated when it opened at least half of the last 8+ Reels. */
const SATURATION_SHARE = 0.5;
const SATURATION_MIN_SAMPLES = 8;

export interface HookSaturation {
  grammar: Exclude<HookGrammar, "unknown">;
  count: number;
  of: number;
}

/**
 * The hook grammar that has taken over the recent window, or null. "unknown"
 * (a Reel with no beat-1 text) is never a format, and fewer than 8 readings is
 * too few to call anything a habit.
 */
export function saturatedHookGrammar(recentGrammars: readonly string[] | undefined): HookSaturation | null {
  const known = (recentGrammars ?? []).filter((g) => g && g !== "unknown");
  if (known.length < SATURATION_MIN_SAMPLES) return null;
  const counts = new Map<string, number>();
  for (const g of known) counts.set(g, (counts.get(g) ?? 0) + 1);
  let top: [string, number] = ["", 0];
  for (const entry of counts) if (entry[1] > top[1]) top = entry;
  if (top[1] / known.length < SATURATION_SHARE) return null;
  return { grammar: top[0] as HookSaturation["grammar"], count: top[1], of: known.length };
}

const GRAMMAR_WORDS: Record<HookSaturation["grammar"], string> = {
  symptom_question: "a symptom question (\"Why does...?\")",
  customer_quote: "a customer quote (\"My car...\")",
  number_lead: "a number (\"3 signs...\")",
  command: "a command (\"Stop...\")",
  direct_statement: "a plain statement",
};

/**
 * The generator steer. Soft on purpose: the measured-hook scoreboard appended
 * beside it may show this very shape holding viewers best, and the topic may
 * genuinely call for it, so it asks for a different opener rather than banning
 * one. Empty when nothing is saturated.
 */
export function buildHookFatigueFragment(s: HookSaturation | null): string {
  if (!s) return "";
  const others = (Object.keys(GRAMMAR_WORDS) as Array<HookSaturation["grammar"]>)
    .filter((g) => g !== s.grammar)
    .map((g) => GRAMMAR_WORDS[g]);
  return `HOOK FATIGUE (measured): ${s.count} of the last ${s.of} Reels opened with ${GRAMMAR_WORDS[s.grammar]}. ` +
    `Viewers who follow the account have seen that opening shape most days. Open this one differently: ${others.join(", ")}. ` +
    `Keep that shape only if this topic's strongest first line genuinely is one.`;
}
