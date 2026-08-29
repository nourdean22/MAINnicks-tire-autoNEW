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
      return "FULL BREAKDOWN IN OUR BIO";
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

/** The brief fields this resolver reads. Kept narrow so any brief shape fits. */
export interface AskBearingBrief {
  /** The declared ask. When present it WINS - nothing is inferred. */
  ask?: ReelAsk | null;
  /** Legacy: the only ask signal older briefs carry. */
  campaignKeyword?: string | null;
}

/**
 * The ask this brief will render, or null for no end card at all.
 *
 * A DECLARED ask wins outright. The fallback exists only so the hundreds of
 * briefs written before this field existed do not silently lose their end card,
 * and it is deliberately reduced to a SINGLE ask - a keyword becomes a `dm`
 * ask, never `SAVE THIS | DM "X"`. New briefs should declare `ask`; the
 * fallback is a compatibility shim, not a default worth relying on.
 *
 * Returning null when nothing is known is the point: an end card that nobody
 * declared is exactly the defect this module exists to make impossible.
 */
export function resolveReelAsk(brief: AskBearingBrief | null | undefined): ReelAsk | null {
  if (brief?.ask && askProblem(brief.ask) === null) return brief.ask;
  const kw = String(brief?.campaignKeyword ?? "").trim();
  if (kw) return { kind: "dm", keyword: kw };
  return null;
}
