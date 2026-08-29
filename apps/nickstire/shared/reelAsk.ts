/**
 * The ONE ask a reel is allowed to make, as a declared field.
 *
 * WHAT WAS ACTUALLY RENDERING. `reelAssembly.ts` built the end card by string
 * concatenation from a default:
 *
 *   brief.campaignKeyword ? `SAVE THIS | DM "${KEYWORD}"` : "SAVE THIS POST"
 *
 * That is TWO asks in one card, on every reel this pipeline has ever produced.
 * Measured 2026-08-29 by reading the actual frames: 1770003 ends on
 * `SAVE THIS | DM "SALT"`, and 1770004 ends on `SAVE THIS | DM "ALIGNMENT"`
 * plus a second burned-in line, `STOP BY NICK'S FOR A LOOK. NO PRESSURE, JUST
 * ANSWERS.` - three asks in one frame.
 *
 * WHY IT MATTERS MORE THAN TIDINESS. The account's measured failure is profile
 * visits: 13,871 views -> 74 profile visits (0.53%) -> ONE website tap. A reel
 * that asks for a save AND a DM asks for neither clearly, and neither of those
 * asks moves the failing metric.
 *
 * AND THE CONSTRAINT THAT SHAPES THE ALLOWED SET. Verified against Meta's
 * parameter reference for POST /{ig-user-id}/media: the accepted fields are
 * access_token, alt_text, audio_name, caption, collaborators, children,
 * cover_url, image_url, is_carousel_item, location_id, media_type,
 * product_tags, share_to_feed, thumb_offset, upload_type, user_tags,
 * trial_params, branded_content_sponsor_ids, is_paid_partnership,
 * is_ai_generated, video_url. There is NO link parameter, and a URL typed into
 * a Reel caption renders as unclickable plain text. The landing page is
 * reachable ONLY through the profile.
 *
 * So `profile` is not one flavour among four - it is the only ask that routes a
 * viewer to a page by construction, and therefore the only one that can move
 * the metric that is failing. It is a genuinely different class from `dm`,
 * `save` and `visit`, and it needs no keyword and no automation behind it.
 *
 * A `dm` ask, by contrast, currently promises an interaction nothing answers:
 * there is no keyword automation in this codebase - `campaignKeyword` is inert
 * metadata - so a DM lands in an inbox a human must read.
 */

export type ReelAskKind =
  /** "full breakdown in our bio" - the only ask that can reach a landing page. */
  | "profile"
  /** "DM us WORD" - needs a keyword AND a human to answer it. */
  | "dm"
  /** "save this" - a Meta reach lever, but asks nothing of the business. */
  | "save"
  /** "stop by" - a walk-in ask. */
  | "visit";

export interface ReelAsk {
  kind: ReelAskKind;
  /** Required for `dm`, meaningless otherwise. */
  keyword?: string | null;
}

/**
 * Separators that turn one card into a compound ask. `|` is the exact character
 * the old concatenation used; the rest are the obvious ways someone rebuilds it.
 */
const COMPOUND_MARKERS = ["|", "•", " + ", " AND ", " & ", " THEN "];

/** The single line burned into the end card. Exactly one imperative, always. */
export function renderAskText(ask: ReelAsk): string {
  switch (ask.kind) {
    case "profile":
      // No keyword, no automation, no promise the business must staff. Sends
      // the viewer to the profile, which is where the only clickable link is.
      //
      // WORDING IS DELIBERATELY MODEST. An earlier draft read "FULL BREAKDOWN
      // IN OUR BIO". Checked against the live account 2026-08-29: the bio links
      // http://nickstire.org, the HOMEPAGE - not a page about the reel's topic.
      // "Full breakdown" would therefore promise something the destination does
      // not contain, which is a claim about a destination this code cannot
      // verify. "More" is true of any shop profile with a site behind it.
      return "MORE IN OUR BIO";
    case "dm":
      return `DM US ${String(ask.keyword ?? "").toUpperCase().trim()}`;
    case "save":
      return "SAVE THIS";
    case "visit":
      return "STOP BY NICK'S";
  }
}

/**
 * Why this ask may not be rendered, or null when it is fine.
 *
 * The compound check is on the RENDERED TEXT, not on the shape of the object -
 * the defect being prevented was produced by string concatenation, so the
 * assertion has to live where the string is.
 */
export function askProblem(ask: ReelAsk | null | undefined): string | null {
  if (!ask) return "no ask is declared";
  if (!["profile", "dm", "save", "visit"].includes(ask.kind)) {
    return `unknown ask kind "${ask.kind}"`;
  }
  if (ask.kind === "dm" && !String(ask.keyword ?? "").trim()) {
    return "a dm ask needs a keyword - \"DM US\" with no word is not an ask";
  }
  const text = renderAskText(ask);
  const upper = text.toUpperCase();
  for (const m of COMPOUND_MARKERS) {
    if (upper.includes(m.toUpperCase())) {
      return `the ask renders as a COMPOUND card (${JSON.stringify(text)} contains ${JSON.stringify(m)}). One reel, one ask.`;
    }
  }
  return null;
}

/**
 * What a newly generated brief declares unless something overrides it.
 *
 * `profile` is the default because it is the ONLY ask that routes to a landing
 * page by construction, it needs no keyword, and it needs nobody to answer it.
 * `dm` is the exception: it must be declared deliberately, and only where there
 * is a real reason to converse (a quote, a photo of the damage) AND somebody is
 * actually replying. It can never arrive by default or by fallback - the live
 * SALT reel is the proof of why, asking for DMs that no automation answers.
 */
export const DEFAULT_REEL_ASK: ReelAsk = { kind: "profile" };

/** The brief fields this resolver reads. Kept narrow so any brief shape fits. */
export interface AskBearingBrief {
  /** The declared ask. When present it WINS - nothing is inferred. */
  ask?: ReelAsk | null;
}

/**
 * The ask this brief will render, or null for NO END CARD.
 *
 * THERE IS NO FALLBACK, AND THAT IS THE POINT. An earlier version inferred a
 * `dm` ask from `campaignKeyword` so legacy briefs would keep an end card. Two
 * things were wrong with it:
 *
 *   1. It silently produced the one ask nothing answers. An unanswered ask is
 *      worse than no ask.
 *   2. It reopened the truth gap this whole area exists to close. If a brief
 *      that declares no ask still renders a card, then reading the payload
 *      again fails to tell you what is in the frame - which is exactly the
 *      defect that let `SAVE THIS | DM "SALT"` reach reel 1770003.
 *
 * So an undeclared ask renders nothing. New briefs always declare one
 * (DEFAULT_REEL_ASK), so nothing generated from here loses its card; only
 * legacy briefs, whose payloads genuinely never declared an ask, render without
 * - which is the honest outcome rather than a card nobody asked for.
 */
export function resolveReelAsk(brief: AskBearingBrief | null | undefined): ReelAsk | null {
  if (brief?.ask && askProblem(brief.ask) === null) return brief.ask;
  return null;
}
