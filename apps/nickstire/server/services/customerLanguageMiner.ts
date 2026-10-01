/**
 * Customer-language miner — what customers actually SAY, as symptom phrases
 * with counts (Creative Intelligence OS §F, Wave C slice 1).
 *
 * Reads four first-party text sources for a window and extracts symptom
 * phrases with a deterministic vocabulary bank (shared/topicGraph.ts
 * SYMPTOM_PATTERNS). Feeds `TopicSignals.customerQuestions`, which was defined
 * in the miner from day one and never populated (verified 2026-10-01).
 *
 *   calls    vapi_call_logs.metadata.customerSpeech.turns  (customer-only turns, customerTurns.ts)
 *   sms      communication_log  type='sms' direction='inbound'
 *   reviews  customer_testimonials.text
 *   leads    leads.problem
 *
 * PII POSTURE — three layers, each independently sufficient.
 *   1. Every row is scrubbed BEFORE extraction: phone + email via the ledger's
 *      scrubFreeText (reused, not copied), then VIN, street address, plate,
 *      the row's own known name (customerName / author / lead name) and
 *      "my name is X" introductions. `redactedTokens` counts what fired.
 *   2. Output phrases are regex spans from a FIXED vocabulary bank, so a name
 *      or number cannot be part of one — there is no free-text window.
 *   3. Nothing raw is logged, returned or stored. Counts only.
 *
 * COUNTS ARE CONVERSATIONS, NOT REPEATS. A caller who says "it shakes" four
 * times in one call is one concern, so a (row, phrase) pair counts once.
 *
 * EMPTY vs ERROR. A database that is unavailable or a read that throws is
 * reported as `error` / `failedSources`, never as zero phrases — an outage and
 * a quiet month must not look alike to the miner that ranks on this.
 */
import { createLogger } from "../lib/logger";
import { scrubFreeText } from "./activityLedger";
import { jaccardSimilarity } from "../../shared/reelOriginality";
import { demandTokens } from "../../shared/contentTopicMiner";
import { SYMPTOM_PATTERNS, symptomForPhrase } from "../../shared/topicGraph";

const log = createLogger("services:customer-language-miner");

export type CustomerLanguageSource = "calls" | "sms" | "reviews" | "leads";
const SOURCES: readonly CustomerLanguageSource[] = ["calls", "sms", "reviews", "leads"];

export interface CustomerLanguageRow {
  source: CustomerLanguageSource;
  text: string;
  at: Date | string | null;
  /** Names the row itself carries (customerName, author, lead name) — stripped from the text. */
  knownNames?: Array<string | null | undefined>;
}

export interface CustomerPhrase {
  phrase: string;
  count: number;
  lastSeenAt: string;
  sources: Record<CustomerLanguageSource, number>;
  symptomTopic: string | null;
}

export interface CustomerLanguageResult {
  phrases: CustomerPhrase[];
  /** Rows with text that were scanned. */
  sampled: number;
  /** PII tokens removed before extraction — proof the scrubber ran. */
  redactedTokens: number;
  /** Set when NOTHING could be read. phrases is [] and means "unknown", not "none". */
  error?: string;
  /** Sources that failed while others succeeded — partial, say so. */
  failedSources?: CustomerLanguageSource[];
}

/** Rows per source per read — the window is 30 days; this is a ceiling, not a target. */
const MAX_ROWS_PER_SOURCE = 1500;
const MAX_PHRASES = 40;
/** Near-duplicate merge threshold over stemmed, stopword-free tokens — a hypothesis. */
const MERGE_THRESHOLD = 0.5;

// ── scrubbing ──────────────────────────────────────────────────────────────

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;
/**
 * "123 Main St", "4567 euclid ave": a house number, one to three name words,
 * a street suffix. The name words exclude function words so "4 tires by the
 * way" — a real customer phrase — is not read as an address and eaten.
 */
const STREET_RE =
  /\b\d{1,6}\s+(?:(?!(?:the|by|my|a|an|of|and|to|in|on|at|for|or|is|it)\s)[A-Za-z0-9.'-]+\s+){1,3}(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|circle|cir|parkway|pkwy|highway|hwy)\b\.?/gi;
/** Ohio-shaped plates: 3 letters + 4 digits, or 2 letters + digit + 4 digits, upper-case only. */
const PLATE_RE = /\b(?:[A-Z]{3}[\s-]?\d{4}|[A-Z]{2}\d[\s-]?\d{4})\b/g;
/** "my name is John Smith" / "this is Maria" — capitalised to avoid "this is the second time". */
const INTRO_NAME_RE = /\b(my name is|this is|i am|i'm|it's|its|name's)\s+((?:[A-Z][a-z'-]+)(?:\s+[A-Z][a-z'-]+)?)/g;
const HONORIFIC_NAME_RE = /\b(?:mr|mrs|ms|miss|dr)\.?\s+[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?/g;
/** What scrubFreeText leaves behind for a phone/email — removed so no digit survives. */
const LEDGER_MASK_RE = /\S*•••\S*/g;
/**
 * Known-name tokens that are ordinary words. A lead named "The Tire Guy" or
 * "Walk In Customer" must not strip "the" / "tire" / "in" out of the text —
 * that would break the very phrases being mined ("to the floor", "4 tires").
 */
const NAME_TOKEN_SKIP = new Set([
  "the", "and", "of", "in", "a", "an", "mr", "mrs", "ms", "dr", "jr", "sr",
  "auto", "car", "cars", "tire", "tires", "shop", "walk", "customer", "guest", "unknown", "test", "fleet", "llc", "inc",
]);

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

function scrubRow(text: string, knownNames: Array<string | null | undefined> = []): { text: string; redacted: number } {
  let redacted = 0;
  // 1. phone + email — the ledger scrubber, reused.
  let out = scrubFreeText(text);
  redacted += countMatches(out, LEDGER_MASK_RE);
  out = out.replace(LEDGER_MASK_RE, " ");
  // 2. vehicle + location identifiers.
  for (const re of [VIN_RE, STREET_RE, PLATE_RE]) {
    redacted += countMatches(out, re);
    out = out.replace(re, " ");
  }
  // 3. names: the row's own, then self-introductions.
  for (const name of knownNames) {
    for (const token of String(name ?? "").split(/[^A-Za-z'-]+/)) {
      if (token.length < 2 || NAME_TOKEN_SKIP.has(token.toLowerCase())) continue;
      const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      redacted += countMatches(out, re);
      out = out.replace(re, " ");
    }
  }
  redacted += countMatches(out, INTRO_NAME_RE);
  out = out.replace(INTRO_NAME_RE, "$1 ");
  redacted += countMatches(out, HONORIFIC_NAME_RE);
  out = out.replace(HONORIFIC_NAME_RE, " ");
  return { text: out.replace(/\s+/g, " ").trim(), redacted };
}

// ── extraction ─────────────────────────────────────────────────────────────

const normalizePhrase = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9'\s/]/g, " ").replace(/\s+/g, " ").trim();

/** Every claimed span in a row: first pattern wins, later overlaps are dropped. */
function extractPhrases(text: string): Array<{ phrase: string; symptom: string }> {
  const claimed: Array<[number, number]> = [];
  const found: Array<{ phrase: string; symptom: string }> = [];
  const overlaps = (s: number, e: number) => claimed.some(([cs, ce]) => s < ce && e > cs);
  for (const p of SYMPTOM_PATTERNS) {
    const re = new RegExp(p.re.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      claimed.push([start, end]);
      const phrase = normalizePhrase(m[0]);
      if (phrase) found.push({ phrase, symptom: p.symptom });
    }
  }
  return found;
}

const stemmed = (s: string): string => Array.from(demandTokens(s)).sort().join(" ");

const toIso = (at: Date | string | null): string | null => {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

interface Bucket {
  symptom: string;
  surfaces: Map<string, number>;
  stems: string;
  count: number;
  lastSeenAt: string;
  sources: Record<CustomerLanguageSource, number>;
}

/**
 * Pure core: rows in, counted phrases out. Exported for the fixture-driven
 * tests; `mineCustomerLanguage` is the only runtime caller.
 */
export function mineCustomerLanguageFromRows(rows: CustomerLanguageRow[]): Pick<CustomerLanguageResult, "phrases" | "sampled" | "redactedTokens"> {
  let sampled = 0;
  let redactedTokens = 0;
  const buckets: Bucket[] = [];

  for (const row of rows) {
    const raw = String(row.text ?? "").trim();
    if (!raw) continue;
    sampled++;
    const { text, redacted } = scrubRow(raw, row.knownNames);
    redactedTokens += redacted;
    const at = toIso(row.at) ?? "";

    // One concern per (row, phrase) — repeats inside a call are not demand.
    const seenInRow = new Set<string>();
    for (const { phrase, symptom } of extractPhrases(text)) {
      const key = stemmed(phrase);
      if (!key || seenInRow.has(key)) continue;
      seenInRow.add(key);

      let bucket = buckets.find((b) => b.symptom === symptom && (b.stems === key || jaccardSimilarity(b.stems, key) >= MERGE_THRESHOLD));
      if (!bucket) {
        bucket = { symptom, surfaces: new Map(), stems: key, count: 0, lastSeenAt: "", sources: { calls: 0, sms: 0, reviews: 0, leads: 0 } };
        buckets.push(bucket);
      }
      bucket.surfaces.set(phrase, (bucket.surfaces.get(phrase) ?? 0) + 1);
      bucket.count++;
      bucket.sources[row.source]++;
      if (at > bucket.lastSeenAt) bucket.lastSeenAt = at;
    }
  }

  const phrases: CustomerPhrase[] = buckets
    .map((b) => {
      // Representative surface form: most frequent, then shortest.
      const [phrase] = Array.from(b.surfaces.entries()).sort((x, y) => y[1] - x[1] || x[0].length - y[0].length)[0]!;
      return {
        phrase,
        count: b.count,
        lastSeenAt: b.lastSeenAt,
        sources: b.sources,
        // Re-mapped through the shared helper so the graph and the miner agree by construction.
        symptomTopic: symptomForPhrase(phrase) ?? b.symptom,
      };
    })
    .sort((a, b) => b.count - a.count || (b.lastSeenAt > a.lastSeenAt ? 1 : b.lastSeenAt < a.lastSeenAt ? -1 : 0))
    .slice(0, MAX_PHRASES);

  return { phrases, sampled, redactedTokens };
}

// ── IO ─────────────────────────────────────────────────────────────────────

type Reader = (d: any, cutoff: Date) => Promise<CustomerLanguageRow[]>;

function parseTurns(raw: unknown): string[] {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

const READERS: Record<CustomerLanguageSource, Reader> = {
  calls: async (d, cutoff) => {
    const { vapiCallLogs } = await import("../../drizzle/schema");
    const { and, desc, gte, sql } = await import("drizzle-orm");
    const turnsExpr = sql<unknown>`JSON_EXTRACT(${vapiCallLogs.metadata}, '$.customerSpeech.turns')`;
    const rows = await d
      .select({ turns: turnsExpr, name: vapiCallLogs.customerName, at: vapiCallLogs.createdAt })
      .from(vapiCallLogs)
      .where(and(gte(vapiCallLogs.createdAt, cutoff), sql`${turnsExpr} IS NOT NULL`))
      .orderBy(desc(vapiCallLogs.createdAt))
      .limit(MAX_ROWS_PER_SOURCE);
    return (rows as Array<{ turns: unknown; name: string | null; at: Date | null }>).map((r) => ({
      source: "calls" as const,
      text: parseTurns(r.turns).join(" "),
      at: r.at,
      knownNames: [r.name],
    }));
  },
  sms: async (d, cutoff) => {
    const { communicationLog } = await import("../../drizzle/schema");
    const { and, desc, eq, gte } = await import("drizzle-orm");
    const rows = await d
      .select({ body: communicationLog.body, at: communicationLog.createdAt })
      .from(communicationLog)
      .where(and(eq(communicationLog.type, "sms"), eq(communicationLog.direction, "inbound"), gte(communicationLog.createdAt, cutoff)))
      .orderBy(desc(communicationLog.createdAt))
      .limit(MAX_ROWS_PER_SOURCE);
    return (rows as Array<{ body: string | null; at: Date | null }>).map((r) => ({ source: "sms" as const, text: String(r.body ?? ""), at: r.at }));
  },
  reviews: async (d, cutoff) => {
    const { customerTestimonials } = await import("../../drizzle/schema");
    const { desc, gte } = await import("drizzle-orm");
    const rows = await d
      .select({ text: customerTestimonials.text, author: customerTestimonials.author, at: customerTestimonials.createdAt })
      .from(customerTestimonials)
      .where(gte(customerTestimonials.createdAt, cutoff))
      .orderBy(desc(customerTestimonials.createdAt))
      .limit(MAX_ROWS_PER_SOURCE);
    return (rows as Array<{ text: string | null; author: string | null; at: Date | null }>).map((r) => ({
      source: "reviews" as const,
      text: String(r.text ?? ""),
      at: r.at,
      knownNames: [r.author],
    }));
  },
  leads: async (d, cutoff) => {
    const { leads } = await import("../../drizzle/schema");
    const { and, desc, gte, isNotNull } = await import("drizzle-orm");
    const rows = await d
      .select({ problem: leads.problem, name: leads.name, at: leads.createdAt })
      .from(leads)
      .where(and(gte(leads.createdAt, cutoff), isNotNull(leads.problem)))
      .orderBy(desc(leads.createdAt))
      .limit(MAX_ROWS_PER_SOURCE);
    return (rows as Array<{ problem: string | null; name: string | null; at: Date | null }>).map((r) => ({
      source: "leads" as const,
      text: String(r.problem ?? ""),
      at: r.at,
      knownNames: [r.name],
    }));
  },
};

/**
 * Mine the last `days` of customer text. A rolling window (`now - days`) has no
 * day boundary, so there is no calendar-date conversion to get wrong.
 */
export async function mineCustomerLanguage(opts: { days?: number; now?: Date } = {}): Promise<CustomerLanguageResult> {
  const days = Math.max(1, opts.days ?? 30);
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86400000);

  let d: any;
  try {
    const { getDb } = await import("../db");
    d = await getDb();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("customer-language miner: database import failed — signal UNKNOWN, not empty", { err: message.slice(0, 200) });
    return { phrases: [], sampled: 0, redactedTokens: 0, error: message.slice(0, 200) };
  }
  if (!d) return { phrases: [], sampled: 0, redactedTokens: 0, error: "database unavailable" };

  const rows: CustomerLanguageRow[] = [];
  const failedSources: CustomerLanguageSource[] = [];
  const errors: string[] = [];
  for (const source of SOURCES) {
    try {
      rows.push(...(await READERS[source](d, cutoff)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedSources.push(source);
      errors.push(`${source}: ${message.slice(0, 120)}`);
    }
  }

  if (failedSources.length === SOURCES.length) {
    const error = `all sources failed — ${errors.join("; ")}`;
    log.warn("customer-language miner: every read failed — signal UNKNOWN, not empty", { failedSources });
    return { phrases: [], sampled: 0, redactedTokens: 0, error, failedSources };
  }

  const mined = mineCustomerLanguageFromRows(rows);
  // Counts only — never a phrase list, never a row.
  log.info("customer language mined", {
    days,
    rows: rows.length,
    sampled: mined.sampled,
    phrases: mined.phrases.length,
    redactedTokens: mined.redactedTokens,
    failedSources,
  });
  return failedSources.length ? { ...mined, failedSources } : mined;
}
