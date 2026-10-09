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

/**
 * Ask language, wherever it appears. Used to keep CTAs OUT of the content
 * surfaces and to count them in the caption.
 *
 * WHY THIS EXISTS, found by auditing generated output on 2026-08-29. The
 * declared `ask` governs the END CARD only. Nothing stopped the brief
 * generator writing a CTA into a storyboard BEAT — and it did, on all three
 * freshly generated briefs: "Comment ECHECK and we'll take a look." as beat 5,
 * repeated in the voiceover. That is a second ask, burned into pixels and
 * audio, contradicting the declared `profile` end card. The compound-ask defect
 * came straight back through a door the end-card fix did not cover.
 */
const ASK_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "comment-keyword", re: /\bcomment\s+["']?[A-Z]{3,}\b/i },
  { id: "dm-us", re: /\bdm\s+(us|me)\b/i },
  { id: "send-this-to", re: /\bsend\s+th(is|ese)\s+to\b/i },
  { id: "save-this", re: /\bsave\s+th(is|ese)\b/i },
  { id: "share-this", re: /\bshare\s+th(is|ese)\b/i },
  { id: "link-in-bio", re: /\b(link|more|full\s+\w+)\s+in\s+(our\s+)?bio\b/i },
  { id: "tap-follow", re: /\b(tap|click|swipe)\s+(the\s+)?(link|up|here)\b|\bfollow\s+us\b/i },
  // Case-insensitive since 2026-10-08: without the flag only an all-lowercase
  // "call us" matched, so "Call us" and an on-card "CALL US" slipped through.
  { id: "call-us", re: /\bcall\s+us\b|\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b/i },
  { id: "stop-by", re: /\bstop\s+by\b|\bcome\s+(in|see\s+us)\b|\bbook\s+now\b/i },
];

/** Which ask signals appear in a piece of copy. */
export function askSignals(text: string | null | undefined): string[] {
  const t = String(text ?? "");
  return ASK_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.id);
}

export interface AskSurfaces {
  /** On-screen text of every storyboard beat, in order. */
  beats?: Array<string | null | undefined>;
  voiceoverScript?: string | null;
  caption?: string | null;
  /**
   * The ask this reel DECLARED, if known. When supplied, the caption's ask must
   * either be absent or be the same ask - see the consistency rule below.
   */
  declaredAsk?: ReelAsk | null;
}

/**
 * Which ask signal each declared kind legitimately produces in copy.
 *
 * THE GAP THIS CLOSES, found by reading a generated brief on 2026-08-29. The
 * brief declared `ask: profile` - so the end card renders "MORE IN OUR BIO" -
 * while its caption said "Send this to someone whose light is on." Both surfaces
 * passed every check: the caption held exactly ONE ask, and no beat carried a
 * CTA. But the reel still asked for two different things in two places, which is
 * the rule ("one reel, one ask") broken through a third door.
 *
 * `save`/`share` framing has no declared kind of its own, so a share prompt in a
 * caption is always a SECOND ask unless `save` was the declared one.
 */
const ASK_KIND_SIGNALS: Record<ReelAskKind, readonly string[]> = {
  profile: ["link-in-bio"],
  dm: ["dm-us", "comment-keyword"],
  save: ["save-this", "share-this", "send-this-to"],
  visit: ["stop-by", "call-us"],
};

/**
 * Why this brief's copy breaks the one-ask rule, or null when it holds.
 *
 * BEATS AND VOICEOVER MUST CARRY NO ASK AT ALL. They are content, and they are
 * the two surfaces a later copy edit cannot reach — a CTA there is permanent.
 * The ask belongs on the end card, which is declared and rendered from one
 * field.
 *
 * THE CAPTION MAY CARRY AT MOST ONE. A phone number counts: it is a request to
 * act, and "send this / comment WORD / call us" is three asks competing in one
 * caption, which is how the published 1770003 caption read before it was cut
 * down to one.
 */
export function askLeakageProblem(surfaces: AskSurfaces): string | null {
  const beats = surfaces.beats ?? [];
  for (let i = 0; i < beats.length; i++) {
    const hits = askSignals(beats[i]);
    if (hits.length) {
      return (
        `storyboard beat ${i + 1} contains a call to action (${hits.join(", ")}): ` +
        `${JSON.stringify(String(beats[i]).slice(0, 80))}. Beats are content. The ask is declared once and ` +
        "rendered on the end card — a CTA burned into a beat is a second, permanent ask that no copy edit can reach."
      );
    }
  }

  const voHits = askSignals(surfaces.voiceoverScript);
  if (voHits.length) {
    return (
      `the voiceover contains a call to action (${voHits.join(", ")}). Spoken asks cannot be edited after ` +
      "render, and they compete with the declared end-card ask."
    );
  }

  const capHits = askSignals(surfaces.caption);
  if (capHits.length > 1) {
    return (
      `the caption carries ${capHits.length} competing asks (${capHits.join(", ")}). One reel, one ask — ` +
      "a caption asking for a comment, a share and a phone call asks for none of them clearly."
    );
  }

  // ONE ASK PER REEL MEANS ACROSS SURFACES, NOT WITHIN EACH. A caption holding
  // exactly one ask still breaks the rule if that ask is not the one the end
  // card renders — the viewer is asked for two different things in two places.
  const declared = surfaces.declaredAsk;
  if (declared && capHits.length === 1) {
    const allowed = ASK_KIND_SIGNALS[declared.kind] ?? [];
    if (!allowed.includes(capHits[0])) {
      return (
        `the caption asks for "${capHits[0]}" while the declared end-card ask is "${declared.kind}" ` +
        `(which renders ${JSON.stringify(renderAskText(declared))}). That is two different asks on two ` +
        "surfaces. Either drop the caption's ask and let the end card carry it, or make them the same ask."
      );
    }
  }

  return null;
}

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
