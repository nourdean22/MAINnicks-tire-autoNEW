/**
 * Edit classification for the SMS training loop (NCSOS).
 *
 * When an operator edits the AI's draft before sending, we already capture the
 * (draft, final) pair — but not WHY it was changed. This turns that diff into
 * graded signal: which failure modes the operator keeps correcting. The digest
 * aggregates these so a prompt/fine-tune decision is evidence-based — the
 * operator sees "40% of edits this week were too_long", not just a raw corpus.
 *
 * Rule-based and PURE (no LLM, no DB) so it is deterministic and unit-testable.
 * Precision-biased: it reports categories it can detect with confidence and
 * falls back to minor_edit / full_rewrite rather than guessing subjective tone.
 */

export type EditCategory =
  | "too_long"
  | "too_robotic"
  | "unnecessary_price"
  | "price_changed"
  | "added_invitation"
  | "too_aggressive"
  | "full_rewrite"
  | "minor_edit";

const ROBOTIC: RegExp[] = [
  /thank you for (reaching out|contacting|your (message|inquiry))/i,
  /i apologi[sz]e/i,
  /please don'?t hesitate/i,
  /\bas an ai\b/i,
  /i'?m here to (help|assist)/i,
  /how may i assist/i,
  /we appreciate your/i,
  /rest assured/i,
  /at your earliest convenience/i,
];

const AGGRESSIVE: RegExp[] = [
  /you (need to|must|have to|should really)\b/i,
  /\bact (now|fast|today)\b/i,
  /don'?t (wait|delay|miss)/i,
  /limited time/i,
  /\bhurry\b/i,
  /before it'?s too late/i,
];

const INVITATION: RegExp[] = [
  /\b(come by|drop it off|drop off|pull up|swing by|bring it (in|by)|stop by|walk in)\b/i,
  /\b(text|send)( me| us)? (the |your )?(size|year|make|model|photo|pic)\b/i,
];

const PRICE_RE = /\$\s?\d[\d.,]*/g;

function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean));
}

/** Jaccard overlap of word sets — 1 = identical wording, 0 = nothing in common. */
function jaccard(a: string, b: string): number {
  const sa = tokenSet(a), sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * Classify how an operator changed the AI's draft. Returns the detected
 * categories (possibly several). Empty draft/final → no categories.
 */
export function classifyEdit(draft: string, final: string): EditCategory[] {
  const d = (draft || "").trim();
  const f = (final || "").trim();
  if (!d || !f) return [];
  // No real change → nothing to learn.
  if (d === f) return [];

  const cats: EditCategory[] = [];
  const overlap = jaccard(d, f);

  if (overlap < 0.25) cats.push("full_rewrite");
  if (d.length > 160 && f.length <= d.length * 0.65) cats.push("too_long");
  if (ROBOTIC.some((r) => r.test(d) && !r.test(f))) cats.push("too_robotic");
  if (AGGRESSIVE.some((r) => r.test(d) && !r.test(f))) cats.push("too_aggressive");

  const dPrices = d.match(PRICE_RE) ?? [];
  const fPrices = f.match(PRICE_RE) ?? [];
  if (dPrices.length > 0 && fPrices.length === 0) cats.push("unnecessary_price");
  else if (dPrices.length > 0 && fPrices.length > 0 && dPrices.join("|") !== fPrices.join("|")) cats.push("price_changed");

  if (INVITATION.some((r) => r.test(f) && !r.test(d))) cats.push("added_invitation");

  if (cats.length === 0) cats.push("minor_edit");
  return cats;
}

/** Aggregate edit categories into a {category: count} tally for the digest. */
export function tallyEditCategories(rows: Array<string[] | null | undefined>): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const cats of rows) {
    if (!Array.isArray(cats)) continue;
    for (const c of cats) tally[c] = (tally[c] ?? 0) + 1;
  }
  return tally;
}
