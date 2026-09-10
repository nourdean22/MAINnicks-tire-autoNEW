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
  // 2026-09-10 · defence in depth. These are CATEGORY slugs, handled
  // properly by EXTERNAL_CATEGORIES below -- but if one ever arrives in
  // the `source` column instead, failing closed costs a missed recall
  // and failing open costs a durable injection.
  "gmail_thread",
  "inbound",
]);

const EXTERNAL_PREFIXES = ["web:", "rss:", "scrape:", "firecrawl", "news:", "telegram:", "email:"];

const OPERATOR_EXACT = new Set(["manual", "user", "operator", "nour"]);

/**
 * 2026-09-10 · CATEGORIES that carry third-party text.
 *
 * Found by a test, not by review: `classifyTrustTier("gmail_thread",
 * "nick")` returned SYSTEM_DERIVED, because for inbound mail the
 * provenance is recorded in the CATEGORY, not in `source`. The
 * classifier could not see the one field that says "a stranger wrote
 * this" -- so every captured email ranked as first-party derived data
 * and rendered into the prompt as something Nick knows.
 *
 * `gmail_thread` is captured INBOUND mail (categories.ts:492) and is
 * attacker-controllable: anyone who can email Nour can write to it.
 * `gmail_outgoing` is deliberately ABSENT -- that is the operator's own
 * sent mail, which is exactly the OPERATOR tier, and demoting it would
 * fence Nour's own words back at him.
 */
const EXTERNAL_CATEGORIES = new Set(["gmail_thread", "inbound", "inbound_sms", "web_article"]);

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
  createdBy?: string | null,
  /**
   * 2026-09-10 · optional, because for some rows (inbound mail) the
   * provenance lives here and nowhere else. Checked BEFORE the operator
   * shortcut: a cron that stamps createdBy="user" while ingesting a
   * stranger's email must not thereby launder it into OPERATOR.
   */
  category?: string | null,
): TrustTier {
  const s = (source ?? "").trim().toLowerCase();
  const by = (createdBy ?? "").trim().toLowerCase();
  const cat = (category ?? "").trim().toLowerCase();

  // Third-party text stays third-party no matter who filed it.
  if (cat && EXTERNAL_CATEGORIES.has(cat)) return "EXTERNAL_CONTENT";

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
 * 2026-09-10 · PROVENANCE IS NOT AUTHORITY.
 *
 * This list used to be documented as the tiers permitted to "inform a
 * state-changing tool call or be stated as fact", with AGENT_INFERRED
 * among them. Those are two different questions and AGENT_INFERRED
 * answers them differently:
 *
 *   "Nour probably wants this customer emailed today"   (an inference)
 * is not
 *   "Nour told me to email this customer today"          (an authority)
 *
 * A model inference can be useful, probable and worth surfacing while
 * still being incapable of authorizing a side effect or of hardening
 * into a durable fact. Collapsing the two is how an assistant becomes
 * confidently wrong about its owner's own intentions.
 *
 * So the single predicate is split in two, below. This one answers only
 * "may this be rendered as knowledge rather than fenced as hostile
 * text?" -- a question about ATTACKER CONTROL. An inference is not
 * attacker-controlled, so it renders (labelled); external content is,
 * so it does not.
 */
export const AUTHORITATIVE_TIERS: readonly TrustTier[] = [
  "OPERATOR",
  "SYSTEM_DERIVED",
  "AGENT_INFERRED",
];

export function isAuthoritative(tier: TrustTier): boolean {
  return AUTHORITATIVE_TIERS.includes(tier);
}

/** Clearer name for what the predicate above actually decides. */
export const canRenderAsKnowledge = isAuthoritative;

/**
 * Tiers whose content may serve as the BASIS for a side effect -- a
 * durable memory write, an external action, a stated commitment.
 *
 * AGENT_INFERRED is deliberately absent. An inference may propose,
 * influence reasoning, trigger retrieval and generate a hypothesis; it
 * may not, on its own, become the reason a thing was done. Promotion
 * from inference to fact requires either the operator saying so or
 * first-party data confirming it.
 *
 * EXTERNAL_CONTENT is absent for the stronger reason: it is
 * attacker-controllable, and the whole point of the fence is that
 * convincing the model must never be the same thing as acquiring
 * permission.
 */
export const ACTION_AUTHORIZING_TIERS: readonly TrustTier[] = [
  "OPERATOR",
  "SYSTEM_DERIVED",
];

export function canAuthorizeSideEffect(tier: TrustTier): boolean {
  return ACTION_AUTHORIZING_TIERS.includes(tier);
}

/**
 * Should this turn be stamped `inferredBasisOnly`?
 *
 * True when recall returned rows but NOT ONE of them is action-
 * authorizing -- i.e. everything NICK is working from is its own
 * inference or third-party text. Downstream, tool-policy sends any
 * memory write on such a turn to human review.
 *
 * Extracted as a pure function so the DECISION is unit-testable without
 * standing up the whole brain-context pipeline. The stamping call site
 * fails open by design; a rule that only exists inside a try/catch in a
 * 700-line orchestrator is a rule nobody can prove.
 *
 * NOTE the empty case: no hits means no memory basis at all, which is a
 * different thing from an inferred one. Stamping it would escalate
 * every cold-start turn, and an approval prompt the operator sees on
 * every turn is one they learn to click through without reading.
 */
export function shouldStampInferredBasis(
  hits: ReadonlyArray<{ trustTier?: string | null }>,
): boolean {
  if (hits.length === 0) return false;
  return !hits.some((h) => !!h.trustTier && canAuthorizeSideEffect(h.trustTier as TrustTier));
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
