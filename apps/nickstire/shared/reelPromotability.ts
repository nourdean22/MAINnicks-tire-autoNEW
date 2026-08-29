/**
 * Is this pack safe to PROMOTE (put money behind), not merely to publish?
 *
 * Promotable is a STRICTER spec than organic, and building to it up front is
 * cheaper than discovering after the fact that a good pack cannot be boosted.
 * Failing this check never blocks organic publishing - a pack that is not
 * boost-eligible is still perfectly postable, it just says why it is not
 * eligible instead of failing into silence.
 *
 * EVERY META RULE BELOW WAS VERIFIED AGAINST META'S OWN POLICY DOCS ON
 * 2026-08-28, and two of them contradicted what a model would assume:
 *
 *  - BEFORE/AFTER IS NOT BANNED FOR AN AUTO SHOP. The before-and-after
 *    restriction is scoped to "General cosmetic products, procedures, surgeries
 *    depicting before and after transformation" (18+ targeting) under Health and
 *    Wellbeing. It is NOT a general prohibition, so before/after REPAIR imagery
 *    is not caught by it. An earlier reading of a search summary suggested a
 *    blanket ban; fetching the primary page refuted that.
 *    transparency.meta.com/policies/ad-standards/restricted-goods-services/health-wellness/
 *
 *  - THE 20% IMAGE-TEXT RULE IS GONE. "There is no longer a limit on the amount
 *    of text that can exist in your ad image. The text overlay tool is no longer
 *    available." It is a performance recommendation now, not a policy gate, so
 *    NO text-percentage rule is encoded here. Encoding one would invent a
 *    rejection Meta does not issue.
 *    facebook.com/business/help/223409425500940
 *
 * WHAT IS ACTUALLY UNIVERSAL, and therefore encoded:
 *  - "Use deceptive or exaggerated claims about the success of a product or
 *    service to mislead people into purchasing" - applies to ALL advertisers.
 *    transparency.meta.com/policies/ad-standards/fraud-scams/unacceptable-business-practices/
 *  - AI self-disclosure. For ads Meta applies "AI info" labels by automatic
 *    detection with "no advertiser action required", but ORGANIC still requires
 *    the creator to self-disclose - and a promoted post is an organic post with
 *    money behind it. The stricter of the two therefore governs: the publish call
 *    must still set is_ai_generated. See shared/reelDisclosure.ts.
 *
 * FIRST-PARTY RULES (ours, not Meta's) are labelled as such in their reasons, so
 * nobody later cites this file as "Meta requires" for something Meta never said.
 */
import { disclosureViolation, isGenerativeProvider, type DisclosurePack } from "./reelDisclosure";
import { destinationProblem, isHomepagePath } from "./reelDestinations";

/**
 * Safe-area margin, top and bottom, to keep clear of text and logos.
 *
 * PROVENANCE, stated because it is partly unverified: Meta publishes "roughly
 * 14% (250 pixels) of the top and bottom" free of text and logos for CAROUSEL
 * ads in Facebook Stories. The Reels-specific safe-zone page
 * (facebook.com/business/help/980593475366490) is client-rendered and could not
 * be retrieved, so the Reels number is UNVERIFIED and this constant is applied
 * as a conservative house default rather than as a quoted Meta requirement.
 * Do not cite it as "Meta requires 14% for Reels".
 */
export const SAFE_AREA_MARGIN_PCT = 14;

/** Claims that assert a guaranteed or absolute outcome. Universal ad rule. */
const ABSOLUTE_CLAIM_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "guarantee", re: /\b(guarantee[ds]?|guaranteed)\b/i },
  { id: "always-never", re: /\b(always|never)\s+(works|fails|breaks|lasts)\b/i },
  { id: "absolute-percent", re: /\b100%\s*(guaranteed|effective|safe|success)\b/i },
  { id: "risk-free", re: /\brisk[- ]free\b/i },
  { id: "cure-fix-forever", re: /\b(fix(es|ed)?|last[s]?)\s+(it\s+)?forever\b/i },
  { id: "best-in-superlative", re: /\b(the\s+)?(cheapest|lowest price|best price)\s+(in|anywhere|guaranteed)\b/i },
];

/**
 * Unqualified money framings. NOT a quoted Meta pricing rule - Meta's
 * Unacceptable Business Practices page has no specific pricing clause. This is
 * OUR conservative reading of the universal deceptive-claims rule: a bare
 * "$50 or $1,500?" invites a cost expectation the shop has not qualified.
 */
const PRICE_CLAIM_RE = /\$\s?\d[\d,]*/g;
const PRICE_QUALIFIER_RE = /\b(from|starting at|most|typically|varies|depends|estimate|quote|average|up to)\b/i;

/**
 * How far before a dollar amount a qualifier still counts as qualifying it.
 * A caption-wide search let "From our shop to yours, alignment is $500" read as
 * qualified - the word "from" was 30 characters away and about something else.
 */
const QUALIFIER_PROXIMITY_CHARS = 24;

export interface PromotabilityFacts {
  id: string;
  /** Caption + on-screen text: everything a reviewer would read. */
  copy: string;
  videoProvider?: string | null;
  hasGeneratedVideo?: boolean;
  /** Will the publish call set Meta's is_ai_generated? */
  apiDisclosureFlag?: boolean;
  /** e.g. "9:16". */
  aspectRatio?: string | null;
  /** True when the master keeps SAFE_AREA_MARGIN_PCT clear top and bottom. */
  safeAreaRespected?: boolean | null;
  /** Where the CTA sends people, e.g. "/brakes". Null = undeclared. */
  landingDestination?: string | null;
  /** The action the copy asks for, e.g. "book a brake inspection". */
  ctaText?: string | null;
}

export interface PromotabilityBlocker {
  code: string;
  /** "meta" = a Meta advertising rule. "first-party" = our own stricter rule. */
  source: "meta" | "first-party";
  reason: string;
}

/** Absolute/guarantee claims found in the copy. Empty when clean. */
export function absoluteClaims(copy: string): string[] {
  return ABSOLUTE_CLAIM_PATTERNS.filter((p) => p.re.test(copy ?? "")).map((p) => p.id);
}

/** True when copy names a price without any qualifier alongside it. */
export function hasUnqualifiedPrice(copy: string): boolean {
  const c = copy ?? "";
  PRICE_CLAIM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRICE_CLAIM_RE.exec(c)) !== null) {
    const windowStart = Math.max(0, m.index - QUALIFIER_PROXIMITY_CHARS);
    const near = c.slice(windowStart, m.index + m[0].length);
    if (!PRICE_QUALIFIER_RE.test(near)) return true; // this amount stands unqualified
  }
  return false;
}

/**
 * THE FUNNEL RULE, and the reason it is in the promotability check rather than
 * a doc: promoting a reel that lands on the homepage means PAYING for traffic
 * that converts at the measured baseline of 0.53% profile-visit rate and one
 * website tap in 13,871 views. Money does not fix a destination mismatch, it
 * multiplies it. A promoted pack must therefore declare where its CTA sends
 * people, and that destination must be topic-specific rather than the homepage.
 */
/**
 * Action-oriented copy. Exists because ctaText is OPTIONAL metadata: a caller
 * could omit it and slip past the funnel blocker while the caption plainly asks
 * the viewer to act. The ask is read from the COPY, not only from the metadata.
 */
const ASK_PATTERNS = [
  // Imperative CTA phrasing only. Bare verbs are deliberately NOT used: "shop"
  // matches "our shop", "order" matches "in order to", "call" matches "a call",
  // "schedule" matches "on schedule", "visit" matches "a visit". A gate that
  // fires on ordinary shop copy becomes noise and gets switched off, which is
  // worse than not having it.
  /\b(book|schedule|reserve)\s+(a|an|your|now|today)\b/i,
  /\b(call|text|dm)\s+(us|now|today|the shop)\b/i,
  /\b(stop|swing|come)\s+(by|in)\b/i,
  /\b(visit|shop)\s+(us|our|the)\b/i,
  /\b(order|shop)\s+(now|online|today)\b/i,
  /\b(get|request)\s+(a\s+)?(quote|estimate)\b/i,
  /\bmake\s+an\s+appointment\b/i,
  /\b(link in bio|tap the link|swipe up)\b/i,
];

export function copyContainsAsk(copy: string): boolean {
  return ASK_PATTERNS.some((re) => re.test(copy ?? ""));
}

/**
 * True when the destination resolves to the site root.
 * Delegates to reelDestinations, which owns normalization now.
 */
export function isHomepageDestination(dest: string): boolean {
  return isHomepagePath(dest);
}

export function destinationBlocker(f: PromotabilityFacts): PromotabilityBlocker | null {
  const cta = (f.ctaText ?? "").trim();
  const dest = (f.landingDestination ?? "").trim();
  // The ask can come from metadata OR from the copy itself - otherwise omitting
  // the optional field is a free bypass of the funnel rule.
  const askText = cta || (copyContainsAsk(f.copy) ? f.copy.trim() : "");
  if (!askText) return null; // genuinely no ask, nothing to match
  if (!dest) {
    return {
      code: "DESTINATION_UNDECLARED",
      source: "first-party",
      reason:
        `copy asks the viewer to "${askText.slice(0, 60)}" but the pack declares no landing destination. ` +
        "Promoting an undeclared destination pays for traffic with nowhere specific to land.",
    };
  }
  // TYPED against the deployed route set, not free text. The free-text version
  // let its own author recommend "/tire-sidewall" - a path that does not exist
  // and answers HTTP 200 with the generic app shell.
  const problem = destinationProblem(dest);
  if (problem) {
    return {
      code: isHomepagePath(dest) ? "DESTINATION_IS_HOMEPAGE" : "DESTINATION_NOT_DEPLOYED",
      source: "first-party",
      reason: `CTA "${askText.slice(0, 60)}" cannot be used: ${problem}`,
    };
  }
  return null;
}

/**
 * Every reason this pack must not be promoted. Empty array = boost-eligible.
 * NEVER call this to decide organic publishing - see reelDisclosure for that.
 */
export function promotabilityBlockers(f: PromotabilityFacts): PromotabilityBlocker[] {
  const out: PromotabilityBlocker[] = [];

  const claims = absoluteClaims(f.copy);
  if (claims.length > 0) {
    out.push({
      code: "ABSOLUTE_OUTCOME_CLAIM",
      source: "meta",
      reason:
        `copy asserts an absolute or guaranteed outcome [${claims.join(", ")}]. Meta prohibits ` +
        "deceptive or exaggerated claims about the success of a product or service for ALL " +
        "advertisers. Reframe as what the shop does, not what is guaranteed.",
    });
  }

  if (hasUnqualifiedPrice(f.copy)) {
    out.push({
      code: "UNQUALIFIED_PRICE_CLAIM",
      source: "first-party",
      reason:
        "copy names a price with no qualifier. Meta publishes no specific pricing clause, so this is " +
        "OUR conservative reading of the universal deceptive-claims rule: add 'from', 'most', " +
        "'typically' or 'estimate' so a quoted figure cannot read as a fixed promise.",
    });
  }

  // AI disclosure: the stricter of organic and paid governs a promoted post.
  const asDisclosure: DisclosurePack = {
    id: f.id,
    videoProvider: f.videoProvider,
    hasGeneratedVideo: f.hasGeneratedVideo,
    copy: f.copy,
    apiDisclosureFlag: f.apiDisclosureFlag,
  };
  const disc = disclosureViolation(asDisclosure);
  if (disc) {
    out.push({
      code: "DISCLOSURE_NOT_SATISFIED",
      source: "meta",
      reason: `not organically publishable either, so it cannot be promoted: ${disc}`,
    });
  }

  // Same predicate the disclosure gate uses - an earlier version checked only
  // the provider string, so a pack with hasGeneratedVideo:true and no provider
  // name skipped this rule entirely.
  const generated = f.hasGeneratedVideo === true || isGenerativeProvider(f.videoProvider);
  if (generated && f.safeAreaRespected === false) {
    out.push({
      code: "SAFE_AREA_VIOLATED",
      source: "first-party",
      reason:
        `text or logos sit inside the ${SAFE_AREA_MARGIN_PCT}% top/bottom safe area, where placement UI ` +
        "can cover them. House default - the Reels-specific figure is UNVERIFIED (see " +
        "SAFE_AREA_MARGIN_PCT provenance), so this is a conservative rule, not a quoted Meta requirement.",
    });
  }

  if (f.aspectRatio && f.aspectRatio !== "9:16") {
    out.push({
      code: "ASPECT_RATIO_UNSUPPORTED",
      source: "first-party",
      reason: `aspect ratio ${f.aspectRatio} is not the 9:16 the reel lane produces and Reels placements expect.`,
    });
  }

  const destination = destinationBlocker(f);
  if (destination) out.push(destination);

  return out;
}

export function isPromotable(f: PromotabilityFacts): boolean {
  return promotabilityBlockers(f).length === 0;
}
