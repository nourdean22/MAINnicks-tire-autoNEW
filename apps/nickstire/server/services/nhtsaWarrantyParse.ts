/**
 * NHTSA manufacturer warranty extensions · the pure half of the ingest (ADR-0021 §3, §4, §6.4).
 *
 * Row layout, classification and chunk naming, with no I/O, so every rule here
 * is unit-testable on a fixture. The network, zip and database half lives in
 * nhtsaWarrantyIngest.ts.
 *
 * Source: https://static.nhtsa.gov/odi/ffdd/tsbs/TSBS.txt — tab separated, no
 * header, 14 fields, one row per communication x product x multi-valued field.
 *
 * A row is KEPT when either signal fires (§4):
 *   nhtsa_type   — field 7 normalized equals "warrantyprogramextension"
 *                  (only exists for rows received since mid-2024)
 *   summary_text — field 14 matches one of TEXT_RULES (finds older rows and
 *                  GM "Special Coverage", which GM files as "Service Campaign")
 * Neither signal is clean (§4 lists false positives of both), so the
 * classification is information for the advisor; nothing acts on it.
 */

const FIELD_COUNT = 14;

/** One parsed TSV line. Strings are trimmed; empty strings become null where the field is optional. */
export interface NhtsaRow {
  nhtsaId: number;
  addedDate: string | null;
  documentId: string;
  mfrDate: string | null;
  mfrCampaignId: string | null;
  communicationType: string;
  make: string;
  model: string;
  /** 9999 = not stated by the manufacturer (also used for a blank or unparseable year). */
  modelYear: number;
  component: string | null;
  summary: string;
}

export type ParsedLine = { ok: true; row: NhtsaRow } | { ok: false; reason: "field_count" | "bad_id" };

/** YYYYMMDD -> YYYY-MM-DD, or null when the field is blank or not a real date. */
function parseNhtsaDate(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d{8}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  // A real calendar day only: TiDB STRICT rejects 2024-02-31, and one bad date would fail the whole batch insert.
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Mis-encoded UTF-8 in the source (ADR-0021 section 3). Measured on the live files
 * 2026-10-01, it comes in three shapes (code points, so this comment survives any
 * re-encoding); only the first is the shape the ADR quoted from a cp1252 terminal:
 *   1. cp1252 double encoding   U+00E2 U+20AC U+2122                 -> U+2019 (right quote)
 *   2. latin-1 double encoding  U+00E2 U+0080 U+0099                 -> U+2019 (2020-2024: 16 summaries)
 *   3. latin-1 triple encoding  U+00C3 U+00A2 U+00C2 U+0080 U+00C2 U+0093 -> U+2013 (en dash)
 * Shapes 2 and 3 are repaired generically: each UTF-8-shaped sequence of
 * U+0080-U+00FF characters (a lead byte plus its continuation bytes) is
 * re-read as latin-1 bytes and replaced only when those bytes are VALID UTF-8
 * (a fatal decoder), repeated until nothing changes (shape 3 takes two
 * passes). Ordinary accented text survives: a lone e-acute, or two accented
 * letters in a row, is not UTF-8-shaped, and a real letter next to a broken
 * sequence does not stop the sequence's repair. Shape 1 has characters outside
 * latin-1, so it keeps an exact table. The text is never round-tripped as a
 * whole, which would corrupt every correct character.
 */
const CP1252_MOJIBAKE: ReadonlyArray<readonly [string, string]> = [
  ["\u00e2\u20ac\u2122", "\u2019"], // right single quote
  ["\u00e2\u20ac\u02dc", "\u2018"], // left single quote
  ["\u00e2\u20ac\u0153", "\u201c"], // left double quote
  ["\u00e2\u20ac\u009d", "\u201d"], // right double quote
  ["\u00e2\u20ac\u00a2", "\u2022"], // bullet
  ["\u00e2\u20ac\u201c", "\u2013"], // en dash
  ["\u00e2\u20ac\u201d", "\u2014"], // em dash
  ["\u00e2\u20ac\u00a6", "\u2026"], // ellipsis
];

/** One UTF-8-shaped byte sequence spelled as latin-1 characters (lead byte + its continuation bytes). */
const LATIN1_UTF8_SEQ = /[\u00c2-\u00df][\u0080-\u00bf]|[\u00e0-\u00ef][\u0080-\u00bf]{2}|[\u00f0-\u00f4][\u0080-\u00bf]{3}/g;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
/** Symbol-font bullets that decode into the Private Use Area (U+F0A7, U+F0B7, U+F0D8). */
const PUA_BULLETS = /[\uf0a7\uf0b7\uf0d8]/g;

function redecodeLatin1Run(run: string): string {
  try {
    return STRICT_UTF8.decode(Buffer.from(run, "latin1"));
  } catch {
    return run;
  }
}

export function repairMojibake(text: string): string {
  if (!/[\u0080-\u00ff]|\u20ac/.test(text)) return text;
  let out = text;
  for (const [bad, good] of CP1252_MOJIBAKE) {
    if (out.includes(bad)) out = out.split(bad).join(good);
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = out.replace(LATIN1_UTF8_SEQ, redecodeLatin1Run);
    if (next === out) break;
    out = next;
  }
  return out.replace(PUA_BULLETS, "\u2022");
}

/** Split one line (without its newline). A trailing \r from a CRLF file is dropped. */
export function parseLine(line: string): ParsedLine {
  const clean = line.endsWith("\r") ? line.slice(0, -1) : line;
  const f = clean.split("\t");
  if (f.length !== FIELD_COUNT) return { ok: false, reason: "field_count" };
  const id = Number(f[0].trim());
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "bad_id" };
  const year = Number(f[9].trim());
  const opt = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    ok: true,
    row: {
      nhtsaId: id,
      addedDate: parseNhtsaDate(f[2]),
      documentId: f[3].trim(),
      mfrDate: parseNhtsaDate(f[4]),
      mfrCampaignId: opt(f[5]),
      communicationType: f[6].trim(),
      make: f[7].trim(),
      model: f[8].trim(),
      modelYear: Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : 9999,
      component: opt(f[10]),
      summary: f[13].trim(),
    },
  };
}

export type Signal = "nhtsa_type" | "summary_text" | "both";

/** Field 7 with case, spaces and "/" removed: "Warranty Program/Extension" and "Warranty Program / Extension" both pass. */
function isTypedWarrantyExtension(communicationType: string): boolean {
  return communicationType.toLowerCase().replace(/[\s/]+/g, "") === "warrantyprogramextension";
}

/**
 * §4 rule 2, as written. Each rule carries the label stored in
 * matched_phrase. A bare "HAS BEEN EXTENDED" is deliberately NOT a rule: in
 * a 15-row read it matched an enrollment window, a campaign deadline and a
 * letter cycle; WARRANTY or COVERAGE must come first, within 120 characters.
 */
const TEXT_RULES: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "WARRANTY EXTENSION", re: /WARRANTY EXTENSION/i },
  { label: "SPECIAL COVERAGE", re: /SPECIAL COVERAGE/i },
  { label: "WARRANTY ENHANCEMENT", re: /WARRANTY ENHANCEMENT/i },
  { label: "EXTENDED WARRANTY", re: /EXTENDED WARRANTY/i },
  { label: "COVERAGE EXTENSION", re: /COVERAGE EXTENSION/i },
  { label: "EXTENDED ... WARRANTY", re: /EXTENDED (?:THE )?(?:NEW VEHICLE )?(?:LIMITED )?WARRANTY/i },
  { label: "WARRANTY/COVERAGE ... HAS BEEN EXTENDED", re: /(?:WARRANTY|COVERAGE)[\s\S]{0,120}?HAS BEEN EXTENDED/i },
];

/** The first text rule the summary matches, or null. */
function matchSummaryRule(summary: string): string | null {
  for (const rule of TEXT_RULES) {
    if (rule.re.test(summary)) return rule.label;
  }
  return null;
}

export interface Classification {
  signal: Signal;
  matchedPhrase: string | null;
}

/** null = not a warranty extension by either signal. */
export function classify(communicationType: string, summary: string): Classification | null {
  const typed = isTypedWarrantyExtension(communicationType);
  const phrase = matchSummaryRule(summary);
  if (typed && phrase) return { signal: "both", matchedPhrase: phrase };
  if (typed) return { signal: "nhtsa_type", matchedPhrase: null };
  if (phrase) return { signal: "summary_text", matchedPhrase: phrase };
  return null;
}

/**
 * ADR-0021 §8 step 1: uppercase, hyphens removed, runs of whitespace collapsed.
 * `F-150` and `F150` both become `F150`; `SILVERADO 1500` stays two words.
 * Make ALIASES (Chevy -> CHEVROLET, MERCEDES BENZ -> MERCEDESBENZ) are phase
 * 2b's read-side table; the stored column holds this normalization only.
 */
export function normalizeVehicleName(raw: string): string {
  return raw.toUpperCase().replace(/-/g, "").replace(/\s+/g, " ").trim();
}

/** Truncate to a column width in characters (TiDB STRICT rejects an over-width write and loses the row). */
export function fit(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Column widths from migration 0138. One source for the parser and the tests. */
export const WIDTH = {
  documentId: 128,
  mfrCampaignId: 128,
  communicationType: 64,
  matchedPhrase: 64,
  components: 512,
  /** TEXT holds 65,535 bytes; the spec's maximum is 4,000 characters, so 15,000 characters (4 bytes each at worst) always fits. */
  summary: 15_000,
  sourceChunk: 32,
  make: 128,
  model: 256,
} as const;

/* ── chunk naming (§6.4) ──────────────────────────────────────── */

const CHUNK_URL_BASE = "https://static.nhtsa.gov/odi/ffdd/tsbs/";
const FIRST_CHUNK_START = 1995;
const CHUNK_SPAN = 5;

export function chunkUrl(range: string): string {
  return `${CHUNK_URL_BASE}TSBS_RECEIVED_${range}.zip`;
}

/**
 * Closed 5-year ranges are fixed. The open range's live name contradicts the
 * spec ("2025-2026", not "2025-2029"), so its name is probed, never assumed:
 * `<start>-<this year>` first, then `<start>-<start+4>`, then (the ingest's
 * last resort) previousYearCandidate's `<start>-<last year>`.
 */
export function chunkPlan(year: number): { closed: string[]; openCandidates: string[] } {
  const openStart = FIRST_CHUNK_START + Math.floor((year - FIRST_CHUNK_START) / CHUNK_SPAN) * CHUNK_SPAN;
  const closed: string[] = [];
  for (let s = FIRST_CHUNK_START; s < openStart; s += CHUNK_SPAN) closed.push(`${s}-${s + CHUNK_SPAN - 1}`);
  const candidates = [`${openStart}-${year}`, `${openStart}-${openStart + CHUNK_SPAN - 1}`];
  return { closed, openCandidates: [...new Set(candidates)] };
}

/**
 * One more name for the open range, probed only after every `chunkPlan`
 * candidate is absent: `<start>-<last year>`. Early in a new year NHTSA can
 * still be serving last year's name (in January 2027, "2025-2026" until the
 * first 2027 communication renames it), and without this probe the run would
 * fail "current chunk not found" until it does. null when last year is not
 * after the range's first year (in January 2031 the "2030-2030" name is not
 * probed; that run fails loudly, as before).
 */
export function previousYearCandidate(year: number): string | null {
  const openStart = FIRST_CHUNK_START + Math.floor((year - FIRST_CHUNK_START) / CHUNK_SPAN) * CHUNK_SPAN;
  const last = year - 1;
  if (last <= openStart) return null;
  const name = `${openStart}-${last}`;
  return chunkPlan(year).openCandidates.includes(name) ? null : name;
}
