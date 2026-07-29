/**
 * lib/integrations/source-resolver.ts — canonical source evidence
 * (2026-07-29 · next-queue item 6).
 *
 * Resolves a DOI / PMID / OpenAlex id into canonical metadata plus
 * CORRECTION AND RETRACTION status, so a research claim in the
 * knowledge lane can carry evidence instead of a bare URL.
 *
 * THE LOAD-BEARING RULE: absence of a correction record is NOT proof of
 * cleanliness. Every failure mode — network down, unknown id, no
 * `relation` field — resolves to `unknown`, never `none_found`. Only a
 * successful lookup that actually inspected the relations field may
 * report `none_found`. Treating metadata absence as safety is the
 * defect this module exists to avoid.
 *
 * Scope (deliberate): read-only, no new knowledge store, no full-text
 * retrieval. Pure parsers live here and are unit-tested offline; the
 * network layer is guardian-wrapped and never runs in the PR gate.
 */
import { withGuardian } from "@/lib/tools/guardian";

export type SourceIdType = "doi" | "pmid" | "openalex" | "url";

export type CorrectionStatus =
  | "none_found"
  | "corrected"
  | "retracted"
  | "expression_of_concern"
  | "unknown";

export interface SourceEvidence {
  canonicalId: string;
  idType: SourceIdType;
  title: string | null;
  authors: string[];
  publishedAt: string | null;
  sourceName: string | null;
  openAccessUrl: string | null;
  correctionStatus: CorrectionStatus;
  correctionSources: string[];
  retrievedAt: string;
  provenance: string[];
  /** Present when resolution failed — the caller renders "unverified". */
  error?: string;
}

/** Pure: classify a raw identifier. Exported for tests. */
export function classifyIdentifier(raw: string): { idType: SourceIdType; id: string } | null {
  const s = raw.trim();
  if (!s) return null;
  const doiMatch = s.match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  if (doiMatch) return { idType: "doi", id: doiMatch[0].replace(/[.,;)\]]+$/, "") };
  if (/^pmid:?\s*\d{1,9}$/i.test(s)) return { idType: "pmid", id: s.replace(/\D/g, "") };
  if (/^\d{5,9}$/.test(s)) return { idType: "pmid", id: s };
  if (/^(https?:\/\/openalex\.org\/)?W\d{6,12}$/i.test(s)) {
    return { idType: "openalex", id: s.replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase() };
  }
  if (/^https?:\/\//i.test(s)) return { idType: "url", id: s };
  return null;
}

/** Crossref `relation` keys that mean the work is compromised. */
const CROSSREF_RETRACTION_KEYS = ["is-retracted-by", "is-retraction-of"];
const CROSSREF_CORRECTION_KEYS = ["is-corrected-by", "has-correction"];
const CROSSREF_CONCERN_KEYS = ["is-expression-of-concern-for", "has-expression-of-concern"];

interface CrossrefMessage {
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  relation?: Record<string, unknown>;
  type?: string;
  subtype?: string;
  URL?: string;
}

/**
 * Pure: derive correction status from a Crossref message. Returns
 * `unknown` when the payload carries no relation field at all — we
 * cannot distinguish "no corrections" from "not reported here".
 * Exported for tests.
 */
export function correctionStatusFromCrossref(msg: CrossrefMessage): {
  status: CorrectionStatus;
  sources: string[];
} {
  // A retraction notice ITSELF is typed by Crossref — treat as retracted-adjacent.
  if (msg.type === "peer-review") return { status: "unknown", sources: [] };
  const relation = msg.relation;
  if (!relation || typeof relation !== "object") {
    return { status: "unknown", sources: [] };
  }
  const keys = Object.keys(relation);
  const hit = (list: string[]) => keys.filter((k) => list.includes(k));

  const retracted = hit(CROSSREF_RETRACTION_KEYS);
  if (retracted.length > 0) return { status: "retracted", sources: retracted };
  const concern = hit(CROSSREF_CONCERN_KEYS);
  if (concern.length > 0) return { status: "expression_of_concern", sources: concern };
  const corrected = hit(CROSSREF_CORRECTION_KEYS);
  if (corrected.length > 0) return { status: "corrected", sources: corrected };
  // Relation field present and inspected → a real "nothing found".
  return { status: "none_found", sources: [] };
}

/** Pure: map a Crossref message into SourceEvidence. Exported for tests. */
export function evidenceFromCrossref(
  doi: string,
  msg: CrossrefMessage,
  retrievedAt: string,
): SourceEvidence {
  const { status, sources } = correctionStatusFromCrossref(msg);
  const dateParts = msg.issued?.["date-parts"]?.[0];
  return {
    canonicalId: doi,
    idType: "doi",
    title: msg.title?.[0] ?? null,
    authors: (msg.author ?? [])
      .map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" "))
      .filter((n): n is string => !!n)
      .slice(0, 12),
    publishedAt: dateParts
      ? [dateParts[0], dateParts[1], dateParts[2]]
          .filter((n): n is number => typeof n === "number")
          .map((n, i) => (i === 0 ? String(n) : String(n).padStart(2, "0")))
          .join("-")
      : null,
    sourceName: msg["container-title"]?.[0] ?? null,
    openAccessUrl: msg.URL ?? null,
    correctionStatus: status,
    correctionSources: sources,
    retrievedAt,
    provenance: ["crossref"],
  };
}

/** Pure: the honest failure shape — `unknown`, never `none_found`. */
export function unresolvedEvidence(
  raw: string,
  idType: SourceIdType,
  reason: string,
  retrievedAt: string,
): SourceEvidence {
  return {
    canonicalId: raw,
    idType,
    title: null,
    authors: [],
    publishedAt: null,
    sourceName: null,
    openAccessUrl: null,
    // Absence of evidence is not evidence of cleanliness.
    correctionStatus: "unknown",
    correctionSources: [],
    retrievedAt,
    provenance: [],
    error: reason,
  };
}

const CROSSREF_API = "https://api.crossref.org/works/";
/** Crossref asks for a contact in the UA for the polite pool. */
const UA = "statenour/1.0 (mailto:nourdean22@gmail.com)";

async function _resolveSource(raw: string): Promise<SourceEvidence> {
  const retrievedAt = new Date().toISOString();
  const parsed = classifyIdentifier(raw);
  if (!parsed) {
    return unresolvedEvidence(raw, "url", "unrecognized identifier", retrievedAt);
  }
  if (parsed.idType !== "doi") {
    // PMID/OpenAlex/URL lanes are deliberately not implemented yet —
    // returning `unknown` is truthful; a fake "clean" would not be.
    return unresolvedEvidence(
      parsed.id,
      parsed.idType,
      `${parsed.idType} resolution not implemented — DOI lane only in V1`,
      retrievedAt,
    );
  }
  try {
    const res = await fetch(`${CROSSREF_API}${encodeURIComponent(parsed.id)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return unresolvedEvidence(parsed.id, "doi", `crossref HTTP ${res.status}`, retrievedAt);
    }
    const body = (await res.json()) as { message?: CrossrefMessage };
    if (!body?.message) {
      return unresolvedEvidence(parsed.id, "doi", "crossref payload missing message", retrievedAt);
    }
    return evidenceFromCrossref(parsed.id, body.message, retrievedAt);
  } catch (e) {
    return unresolvedEvidence(
      parsed.id,
      "doi",
      `crossref unreachable: ${e instanceof Error ? e.message : String(e)}`,
      retrievedAt,
    );
  }
}

/** Guardian-wrapped exterior — same idiom as the firecrawl integration. */
export const resolveSource = withGuardian("source-resolver", _resolveSource, {
  timeoutMs: 15_000,
  maxRetries: 1,
  reliabilityOnly: true,
});

/** One-line operator/agent rendering — never says "clean" on unknown. */
export function describeEvidence(e: SourceEvidence): string {
  const head = e.title ? `"${e.title}"` : e.canonicalId;
  switch (e.correctionStatus) {
    case "retracted":
      return `⛔ RETRACTED — ${head}. Do not cite as current.`;
    case "expression_of_concern":
      return `⚠️ EXPRESSION OF CONCERN — ${head}. Cite only with the caveat.`;
    case "corrected":
      return `⚠️ CORRECTED — ${head}. Check the correction before citing.`;
    case "none_found":
      return `✓ No correction or retraction found for ${head} (Crossref relations checked ${e.retrievedAt.slice(0, 10)}).`;
    case "unknown":
    default:
      return `? UNVERIFIED — ${head}. ${e.error ?? "correction status could not be checked"} — absence of a record is NOT proof it is clean.`;
  }
}
