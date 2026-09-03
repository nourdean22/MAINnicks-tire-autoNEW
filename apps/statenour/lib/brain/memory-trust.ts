/**
 * lib/brain/memory-trust.ts — provenance trust tiers for BrainMemory.
 *
 * THE PROBLEM, measured on prod 2026-09-03:
 *
 *   source            rows     what it actually is
 *   ---------------   ------   -------------------------------------------
 *   manual             9,678   operator-stated
 *   cleantechnica        368   SCRAPED WEB CONTENT
 *   car-driver           378   SCRAPED WEB CONTENT
 *   cleveland-com        329   SCRAPED WEB CONTENT
 *   electrek             324   SCRAPED WEB CONTENT
 *   fox8-cleveland       317   SCRAPED WEB CONTENT
 *   wkyc-3               305   SCRAPED WEB CONTENT
 *   inside-evs           158   SCRAPED WEB CONTENT
 *
 * ~2,179 rows of externally-authored web text sit in the agent's memory
 * with `created_by: "system"`, and recall does not filter on source. So a
 * scraped article is retrieved indistinguishably from something Nour said.
 *
 * That is PROVENANCE LAUNDERING: content enters as "text I scraped from
 * cleantechnica" and leaves storage as "something I know". The write is
 * the laundering step — every later read treats it as self-knowledge
 * rather than as a quote. An instruction embedded in a scraped article
 * becomes durable, and survives the context window that would otherwise
 * have contained the injection.
 *
 * WHY THIS FILE AND NOT A SCHEMA CHANGE AT 176 WRITE SITES:
 * `source` ALREADY encodes the answer. Every writer records where the
 * content came from; nothing ever interpreted it. So the tier is derived,
 * not collected — no write site changes, and old rows classify correctly
 * without a backfill of judgement, only of the derived column.
 *
 * The tiers are deliberately about ORIGIN, not confidence. A scraped
 * article can be perfectly accurate and still must not be able to
 * instruct the agent.
 */

export type TrustTier =
  /** Nour said it, or he explicitly approved it. */
  | "OPERATOR"
  /** This system derived it from its own first-party data. */
  | "SYSTEM_DERIVED"
  /** A model inferred it. Plausible, unverified, but not attacker-controlled. */
  | "AGENT_INFERRED"
  /** Third-party text this system did not author. ATTACKER-CONTROLLABLE. */
  | "EXTERNAL_CONTENT";

/**
 * Sources that carry text written by someone outside this system.
 * Matching is exact OR prefix (`web:`, `rss:`) so a new feed added later
 * lands in the right tier without editing this list — but a new bare
 * hostname will NOT, which is why `looksLikeExternalHost` exists below.
 */
const EXTERNAL_EXACT = new Set([
  "cleantechnica",
  "cleveland-com",
  "electrek",
  "fox8-cleveland",
  "wkyc-3",
  "inside-evs",
  "car-driver",
]);

const EXTERNAL_PREFIXES = ["web:", "rss:", "scrape:", "firecrawl", "news:", "telegram:", "email:"];

const OPERATOR_EXACT = new Set(["manual", "user", "operator", "nour"]);

const AGENT_PREFIXES = ["nick", "agent:", "llm:", "distillation", "output_critic", "judge-eval"];

/**
 * A source that looks like a bare hostname (contains a dot or a known TLD
 * shape) is almost certainly a feed someone added without updating this
 * file. Defaulting those to EXTERNAL_CONTENT is the fail-CLOSED choice:
 * the cost of over-restricting a first-party source is a missing recall,
 * the cost of under-restricting a scraped one is a durable injection.
 */
export function looksLikeExternalHost(source: string): boolean {
  const s = source.toLowerCase();
  if (s.includes("://")) return true;
  // "fox8-cleveland" style slugs are handled by the exact set; this
  // catches "example.com", "sub.example.co.uk".
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}

/**
 * Derive the trust tier from the provenance already stored on the row.
 * Pure and total — every input returns a tier, and the default is the
 * restrictive one.
 */
export function classifyTrustTier(
  source: string | null | undefined,
  createdBy?: string | null
): TrustTier {
  const s = (source ?? "").trim().toLowerCase();
  const by = (createdBy ?? "").trim().toLowerCase();

  // An explicit human author outranks whatever the source slug says.
  if (by === "user" || by === "operator" || by === "nour") return "OPERATOR";

  if (EXTERNAL_EXACT.has(s)) return "EXTERNAL_CONTENT";
  if (EXTERNAL_PREFIXES.some((p) => s.startsWith(p))) return "EXTERNAL_CONTENT";
  if (looksLikeExternalHost(s)) return "EXTERNAL_CONTENT";

  if (OPERATOR_EXACT.has(s)) return "OPERATOR";

  if (AGENT_PREFIXES.some((p) => s.startsWith(p))) return "AGENT_INFERRED";

  // cron:*, lib:*, brain/*, mastery-xp, journal_brain, device_analysis,
  // behavior_tracking, vision - all first-party derivations.
  if (s.length > 0) return "SYSTEM_DERIVED";

  // No source recorded at all. Unknown provenance is not trusted
  // provenance.
  return "EXTERNAL_CONTENT";
}

/**
 * Tiers permitted to inform a state-changing tool call or be stated as
 * fact. EXTERNAL_CONTENT is deliberately absent: it may be surfaced as a
 * labelled quote, never as something the agent knows.
 */
export const AUTHORITATIVE_TIERS: readonly TrustTier[] = [
  "OPERATOR",
  "SYSTEM_DERIVED",
  "AGENT_INFERRED",
];

export function isAuthoritative(tier: TrustTier): boolean {
  return AUTHORITATIVE_TIERS.includes(tier);
}

/**
 * Wrap untrusted recall so it cannot be read as the agent's own
 * knowledge. Mirrors the fenceContent() convention already used for
 * live scrape output — the same discipline, applied to the memory that
 * outlives the turn.
 */
export function fenceUntrustedMemory(content: string, source: string): string {
  return `<untrusted-memory source="${source}">\n${content}\n</untrusted-memory>`;
}
