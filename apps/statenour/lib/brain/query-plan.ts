/**
 * lib/brain/query-plan.ts · 2026-09-08 (Brain plan, Wave 3 — the deterministic query planner)
 *
 * Decides how the recall lanes should treat a user message WITHOUT an LLM call.
 * The 2026-08-27 baseline removed the LLM topic extraction from the chat hot path
 * (p50 4.2 s lost the whole block to its own timeout); the external evidence says
 * query rewriting hurts a strong retriever and decomposition helps only multi-hop.
 * So: the original query is always a lane; a transformation is an EXTRA lane for
 * its class only; `asOf` is parsed here and handed to the as-of recall.
 *
 * Pure. Deterministic. Never throws on garbage input.
 */
export type QueryClass =
  | "exact_identifier"
  | "semantic_lookup"
  | "durable_personal"
  | "temporal"
  | "correction"
  | "anaphoric_followup"
  | "multi_entity"
  | "multi_hop"
  | "broad_synthesis";

export interface QueryPlan {
  /** One or more classes, primary first. */
  classes: QueryClass[];
  /** Always present, never rewritten. */
  original: string;
  /** temporal: the instant the message refers to (UTC). */
  asOf?: Date;
  /** anaphoric_followup: the prior turn text a lane may append. */
  referent?: string;
  /** multi_hop only: at most two clauses, never the original. */
  subQueries: string[];
  /** exact_identifier: quoted phrases / ticket tokens / identifiers found. */
  exactTerms: string[];
  /** One line: why these classes. */
  reason: string;
}

const CLASS_ORDER: QueryClass[] = [
  "exact_identifier",
  "temporal",
  "correction",
  "anaphoric_followup",
  "multi_hop",
  "multi_entity",
  "durable_personal",
  "broad_synthesis",
  "semantic_lookup",
];

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = new RegExp(`\\b(${MONTHS.join("|")}|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\\b`, "i");
const ISO_RE = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const DURABLE_NOUNS = /\b(name|birthday|address|doctor|medication|meds|wife|husband|daughter|son|kid|car|plate|license|insurance|rent|mortgage|salary|passport|allerg\w*|blood type|routine|preference|prefer|always|never)\b/i;
/**
 * 2026-09-17 · MEASURED and retuned. The first cut carried bare `updated?`,
 * `corrected?` and `instead of`, which are ordinary verbs and a preposition,
 * not premise checks: on a 36-case fixture set it classified 10 of 19 ordinary
 * turns as corrections ("update the shop hours to 8am", "send Moe an updated
 * invoice", "book the oil change instead of the rotation") while MISSING 10 of
 * 17 real ones ("has that changed?", "am i still paying 1900", "is that out of
 * date now") — 41% recall at a 53% false-positive rate. It cost nothing while
 * the class had no consumer; it gained one (NICK_CORRECTION_THRESHOLD_BOOST)
 * in this same PR, and a false correction there loosens contradiction
 * surfacing on an ordinary turn — the trust-killer contradiction-injector.ts's
 * own header warns about. Retuned to 17/17 recall at 0/19 false positives on
 * the same fixtures; both sets are pinned in tests/brain/query-plan.test.ts so
 * a future widening has to beat them, not just look reasonable.
 */
const CORRECTION_RE =
  /\b(what('?s| has)? changed|(has|have) (that|it|this|they|things) changed|which (one )?is (current|right|correct)|did (i|that|it|we) change|now vs|still (true|current|accurate|right|correct|the case|valid)|(am|are|is|do|does) (i|we|that|it|they) still|no longer|up[- ]to[- ]date|out of date|changed since|superseded)\b/i;
const PRONOUN_RE = /\b(it|that|this|those|these|the same|again|there|them)\b/i;
const HOP_RE = /\b(and then|because of|which led to|compare|difference between)\b/i;
const SYNTH_RE = /^(summari[sz]e|overview|everything about|what do you know about)\b/i;

function monthIndex(name: string): number {
  const n = name.toLowerCase();
  const full = MONTHS.findIndex((m) => m === n);
  if (full >= 0) return full;
  return MONTHS.findIndex((m) => m.startsWith(n.slice(0, 3)));
}

function extractExactTerms(msg: string): string[] {
  const terms = new Set<string>();
  for (const m of msg.matchAll(/"([^"]{2,80})"/g)) terms.add(m[1].trim());
  for (const m of msg.matchAll(/\b([A-Z]{2,6}-\d{1,6})\b/g)) terms.add(m[1]);
  for (const m of msg.matchAll(/(?:^|\s)(#\d{2,6})\b/g)) terms.add(m[1]);
  for (const m of msg.matchAll(/\b([0-9a-f]{7,40})\b/g)) if (/\d/.test(m[1]) && /[a-f]/.test(m[1])) terms.add(m[1]);
  for (const m of msg.matchAll(/\b([\w-]+(?:\/[\w.-]+)+|[\w-]+\.(?:ts|tsx|js|mjs|json|md|css|sql))\b/g)) terms.add(m[1]);
  for (const m of msg.matchAll(/\b([A-Z][A-Z0-9_]{2,}[A-Z0-9]|[a-z]+_[a-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]+)\b/g)) {
    const t = m[1];
    if (/\d/.test(t) || t.includes("_") || /[a-z][A-Z]/.test(t)) terms.add(t);
  }
  return [...terms];
}

function parseAsOf(msg: string, now: Date): Date | undefined {
  const lower = msg.toLowerCase();
  const iso = ISO_RE.exec(msg);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const rel = /\b(\d+|a|an|one|two|three|four|five|six)\s+(day|week|month|year)s?\s+ago\b/i.exec(lower);
  if (rel) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    const n = words[rel[1]] ?? Number(rel[1]);
    const d = new Date(now.getTime());
    if (rel[2] === "day") d.setUTCDate(d.getUTCDate() - n);
    if (rel[2] === "week") d.setUTCDate(d.getUTCDate() - 7 * n);
    if (rel[2] === "month") d.setUTCMonth(d.getUTCMonth() - n);
    if (rel[2] === "year") d.setUTCFullYear(d.getUTCFullYear() - n);
    return d;
  }
  if (/\byesterday\b/.test(lower)) { const d = new Date(now.getTime()); d.setUTCDate(d.getUTCDate() - 1); return d; }
  if (/\blast (week|month|year)\b/.test(lower)) {
    const d = new Date(now.getTime());
    if (/last week/.test(lower)) d.setUTCDate(d.getUTCDate() - 7);
    else if (/last month/.test(lower)) d.setUTCMonth(d.getUTCMonth() - 1);
    else d.setUTCFullYear(d.getUTCFullYear() - 1);
    return d;
  }
  const mm = MONTH_RE.exec(msg);
  if (mm) {
    const mi = monthIndex(mm[1]);
    if (mi >= 0) {
      const yearMatch = /\b(20\d{2})\b/.exec(msg);
      let year = yearMatch ? Number(yearMatch[1]) : now.getUTCFullYear();
      // a month later than now with no year means last year's
      if (!yearMatch && mi > now.getUTCMonth()) year -= 1;
      const before = new RegExp(`\\b(before|until|up to)\\s+${mm[1]}`, "i").test(msg);
      const after = new RegExp(`\\b(after|since)\\s+${mm[1]}`, "i").test(msg);
      if (after) return new Date(Date.UTC(year, mi + 1, 1)); // the boundary: the month's end
      if (before) return new Date(Date.UTC(year, mi, 1)); // the boundary: the month's start
      return new Date(Date.UTC(year, mi, 1)); // "in July" / "back in July": the start of the period
    }
  }
  if (/\bas of\b/.test(lower) || /\bback in\b/.test(lower) || /\b(before|after|since|until)\b/.test(lower)) return undefined;
  return undefined;
}

function isTemporal(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    ISO_RE.test(msg) ||
    MONTH_RE.test(msg) ||
    /\b(last (week|month|year)|yesterday|\d+\s+(day|week|month|year)s?\s+ago|(a|an|one|two|three)\s+(day|week|month|year)s?\s+ago|as of|back in)\b/.test(lower) ||
    /\b(before|after|since|until)\s+(\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|last|the)/i.test(msg)
  );
}

function capitalisedNames(msg: string): string[] {
  // Proper nouns not at sentence start: capitalised words / @handles, excluding the pronoun "I".
  const out: string[] = [];
  for (const m of msg.matchAll(/(?:^|[\s,;(])(@[A-Za-z0-9_]+|[A-Z][a-z]{2,})\b/g)) {
    const t = m[1];
    if (["The", "What", "Which", "When", "Where", "Who", "Why", "How", "Did", "Does", "Is", "Are", "Was", "Compare", "Summarize", "Summarise", "Overview", "Everything"].includes(t)) continue;
    out.push(t);
  }
  return [...new Set(out)];
}

function splitHops(msg: string): string[] {
  const parts = msg
    .split(/\band then\b|\bbecause of\b|\bwhich led to\b|\?\s+(?=\S)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (parts.length >= 2) return parts.slice(0, 2).map((s) => s.slice(0, 120));
  const cmp = /\b(?:compare|difference between)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+)$/i.exec(msg);
  if (cmp) return [cmp[1].trim().slice(0, 120), cmp[2].trim().slice(0, 120)];
  return [];
}

export function planQuery(message: string, opts?: { recentTurns?: string[]; now?: Date }): QueryPlan {
  const original = typeof message === "string" ? message : "";
  const now = opts?.now ?? new Date();
  const trimmed = original.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const matched = new Set<QueryClass>();
  const reasons: string[] = [];

  const exactTerms = extractExactTerms(trimmed);
  if (exactTerms.length > 0) { matched.add("exact_identifier"); reasons.push(`identifiers: ${exactTerms.slice(0, 3).join(", ")}`); }

  let asOf: Date | undefined;
  if (isTemporal(trimmed)) { matched.add("temporal"); asOf = parseAsOf(trimmed, now); reasons.push(asOf ? `temporal, asOf ${asOf.toISOString().slice(0, 10)}` : "temporal phrase without a resolvable instant"); }

  if (CORRECTION_RE.test(trimmed)) { matched.add("correction"); reasons.push("asks what is current / what changed"); }

  let referent: string | undefined;
  const recent = (opts?.recentTurns ?? []).filter((t) => typeof t === "string" && t.trim().length > 0);
  if (trimmed.length < 60 && PRONOUN_RE.test(trimmed) && recent.length > 0) {
    matched.add("anaphoric_followup");
    referent = recent[recent.length - 1].trim().slice(-200);
    reasons.push("short follow-up with a pronoun; referent from the last turn");
  }

  const subQueries = HOP_RE.test(trimmed) || /\?\s+\S.*\?/.test(trimmed) ? splitHops(trimmed) : [];
  if (subQueries.length === 2) { matched.add("multi_hop"); reasons.push("two clauses that need two lookups"); }

  const names = capitalisedNames(trimmed);
  if (names.length >= 2 && /\b(and|vs\.?|versus|or)\b|,/.test(trimmed)) { matched.add("multi_entity"); reasons.push(`entities: ${names.slice(0, 3).join(", ")}`); }

  if (/\bmy\b/i.test(trimmed) && DURABLE_NOUNS.test(trimmed)) { matched.add("durable_personal"); reasons.push("a durable personal fact"); }

  if (matched.size === 0 && (words.length >= 25 || SYNTH_RE.test(trimmed))) { matched.add("broad_synthesis"); reasons.push("broad, needs synthesis"); }
  if (matched.size === 0) { matched.add("semantic_lookup"); reasons.push("plain lookup"); }

  const classes = CLASS_ORDER.filter((c) => matched.has(c));
  return {
    classes,
    original,
    ...(asOf ? { asOf } : {}),
    ...(referent ? { referent } : {}),
    subQueries,
    exactTerms,
    reason: reasons.join("; "),
  };
}
