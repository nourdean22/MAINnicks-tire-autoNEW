/**
 * Visual families for static posts — composition systems, not one card.
 *
 * THE PROBLEM THIS SOLVES
 * Every Studio V2 static post renders through ONE template: a radial gradient, a
 * yellow ring motif, a skewed yellow CTA, an inset border. Same composition for a
 * safety warning, a seasonal offer and a customer proof. The carousel renderer
 * already escaped this — it carries 13 per-territory designs and its own header
 * names "one universal 1080x1080 card" as the failure mode. Static posts never
 * got the same treatment.
 *
 * THE TWO-LAYER RULE, which is the whole architecture:
 *
 *   SUBJECT LAYER   — photography or generated imagery. May be absent.
 *   BRAND LAYER     — headline, CTA, logo, page number, disclaimer.
 *                     ALWAYS drawn by us, NEVER by an image model.
 *
 * An image model cannot reliably spell "Nick's Tire & Auto" or reproduce a logo,
 * and this codebase has already shipped reels held for GENERATED_TEXT_ARTIFACT.
 * Keeping type deterministic is not a stylistic preference — it is the only way
 * the words on a published asset can be trusted to say what we wrote.
 *
 * WHY THREE FAMILIES AND NOT TEN
 * A reviewer proposed ten. Ten unproven composition systems is speculative
 * generality: nine of them would be tuned against nothing. These three cover the
 * distinct shapes the shop actually posts — evidence, offer, warning — and one of
 * them (`mechanic_evidence`) exercises the subject layer end to end. Add the
 * fourth when a real post wants it.
 */
import { fitFontSize } from "./instagramStudio";

/** Instagram feed favours 4:5 — it occupies more of the screen than 1:1. */
export const FEED_W = 1080;
export const FEED_H = 1350;
export const STORY_W = 1080;
export const STORY_H = 1920;

/**
 * Story safe zones: Instagram overlays its own chrome top and bottom. Text placed
 * there is covered by the profile row or the reply bar on a real phone.
 */
export const STORY_SAFE_TOP = 250;
export const STORY_SAFE_BOTTOM = 320;

export type SubjectRequirement = "required" | "optional" | "none";

export interface VisualFamily {
  id: string;
  /** Operator-facing name. Appears in the UI, so it must mean something to Nour. */
  label: string;
  /** When to reach for this one, in plain language. */
  when: string;
  subject: SubjectRequirement;
  /** Page background when there is no subject image. */
  bg: string;
  /** Decorative layer CSS. Kept separate so a subject image can replace it. */
  motif: string;
  /** How dark to scrim a subject image so type stays legible over any photo. */
  scrim: string;
  headlineColor: string;
  accent: string;
  /** Where the type block sits. Different families read differently. */
  anchor: "top" | "center" | "bottom";
  ctaStyle: "solid" | "outline" | "underline";
}

/**
 * The families. Ordered by how often the shop would actually use them.
 *
 * Each carries its own `when` because an operator choosing a family needs to know
 * what it is FOR, not just what it looks like.
 */
export const VISUAL_FAMILIES: Record<string, VisualFamily> = {
  mechanic_evidence: {
    id: "mechanic_evidence",
    label: "Mechanic evidence",
    when: "You have a real photo of the part — worn tread, a cracked belt, a rusted rotor. The picture carries the argument.",
    subject: "required",
    bg: "linear-gradient(160deg,#14181c 0%,#0a0d10 70%,#06080a 100%)",
    motif: "",
    // Bottom-weighted so the part stays visible while type sits under it.
    scrim: "linear-gradient(to top,rgba(4,6,8,.94) 0%,rgba(4,6,8,.72) 34%,rgba(4,6,8,.10) 66%,transparent 100%)",
    headlineColor: "#ffffff",
    accent: "#FDB913",
    anchor: "bottom",
    ctaStyle: "solid",
  },

  seasonal_offer: {
    id: "seasonal_offer",
    label: "Seasonal offer",
    when: "A direct, time-bound ask — winter tires, an alignment special, an E-Check reminder. The words are the point.",
    subject: "optional",
    bg: "radial-gradient(circle at 74% 16%,#2b2b2b 0,#0c0c0c 48%,#050505 100%)",
    motif: "background:repeating-linear-gradient(135deg,transparent 0 58px,rgba(253,185,19,.05) 58px 60px);",
    scrim: "linear-gradient(to top,rgba(5,5,5,.90) 0%,rgba(5,5,5,.55) 50%,rgba(5,5,5,.28) 100%)",
    headlineColor: "#ffffff",
    accent: "#FDB913",
    anchor: "center",
    ctaStyle: "solid",
  },

  road_hazard: {
    id: "road_hazard",
    label: "Cleveland road hazard",
    when: "Weather or road conditions — potholes, salt, a freeze warning. Urgent without looking like a cheap emergency graphic.",
    subject: "optional",
    bg: "linear-gradient(200deg,#1b1407 0%,#0d0a05 60%,#070604 100%)",
    motif: "background:repeating-linear-gradient(90deg,transparent 0 120px,rgba(253,185,19,.08) 120px 128px);",
    scrim: "linear-gradient(to top,rgba(7,6,4,.92) 0%,rgba(7,6,4,.60) 48%,transparent 100%)",
    headlineColor: "#ffffff",
    accent: "#FF8A1E",
    anchor: "top",
    ctaStyle: "outline",
  },
};

export const DEFAULT_FAMILY_ID = "seasonal_offer";

export function getVisualFamily(id?: string | null): VisualFamily {
  return VISUAL_FAMILIES[id ?? ""] ?? VISUAL_FAMILIES[DEFAULT_FAMILY_ID];
}

/**
 * A family that REQUIRES a subject cannot be honoured without one.
 *
 * Returns the family that will actually be used plus a reason when it differs
 * from what was asked for — the caller can then tell the operator "you asked for
 * evidence, there was no photo, here is an offer card" instead of silently
 * rendering something else. A silent substitution is how an operator loses trust
 * in the whole generator.
 */
export function resolveFamilyForSubject(
  requestedId: string | null | undefined,
  hasSubjectImage: boolean,
): { family: VisualFamily; substituted: boolean; reason?: string } {
  const requested = getVisualFamily(requestedId);
  if (requested.subject !== "required" || hasSubjectImage) {
    return { family: requested, substituted: false };
  }
  const fallback = getVisualFamily(DEFAULT_FAMILY_ID);
  return {
    family: fallback,
    substituted: true,
    reason: `"${requested.label}" needs a real photo of the part and none was available, so this rendered as "${fallback.label}" instead.`,
  };
}

export interface FamilyCardInput {
  family: VisualFamily;
  headline: string;
  body: string;
  cta: string;
  eyebrow: string;
  width: number;
  height: number;
  /** Subject layer. A data: URI or an https URL; absent renders the family bg. */
  subjectImageUrl?: string | null;
  index?: number;
  total?: number;
}

const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

/** Vertical padding must clear Instagram's own chrome on a story. */
function paddingFor(input: FamilyCardInput): { top: number; bottom: number; side: number } {
  const isStory = input.height >= STORY_H;
  return {
    top: isStory ? STORY_SAFE_TOP : 92,
    bottom: isStory ? STORY_SAFE_BOTTOM : 92,
    side: input.width >= 1080 ? 88 : 64,
  };
}

function ctaCss(family: VisualFamily): string {
  if (family.ctaStyle === "outline") {
    return `background:transparent;border:4px solid ${family.accent};color:${family.accent};padding:20px 30px`;
  }
  if (family.ctaStyle === "underline") {
    return `background:transparent;border-bottom:6px solid ${family.accent};color:#fff;padding:12px 4px 14px`;
  }
  return `background:${family.accent};color:#080808;padding:22px 32px`;
}

/**
 * Render one card. The subject layer sits behind a scrim; every word and the
 * brand marks are drawn here, deterministically, on top.
 */
export function renderFamilyCardHtml(input: FamilyCardInput): string {
  const { family } = input;
  const pad = paddingFor(input);
  const contentW = input.width - pad.side * 2;

  const headlineSize = fitFontSize(input.headline, {
    width: Math.min(950, contentW), maxLines: 3, max: 112, min: 46, charRatio: 0.6,
  });
  const bodySize = fitFontSize(input.body, {
    width: Math.min(900, contentW), maxLines: 4, max: 50, min: 26, charRatio: 0.52,
  });

  const justify = family.anchor === "top" ? "flex-start" : family.anchor === "bottom" ? "flex-end" : "center";
  const subject = input.subjectImageUrl
    ? `<div class="subject" style="background-image:url('${esc(input.subjectImageUrl)}')"></div><div class="scrim"></div>`
    : `<div class="motif"></div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${input.width}px;height:${input.height}px;overflow:hidden;background:#070707}
body{font-family:Arial Black,Arial,sans-serif;color:#fff}
.stage{position:relative;width:100%;height:100%;padding:${pad.top}px ${pad.side}px ${pad.bottom}px;display:flex;flex-direction:column;justify-content:${justify};background:${family.bg}}
.subject{position:absolute;inset:0;background-size:cover;background-position:center;z-index:0}
.scrim{position:absolute;inset:0;background:${family.scrim};z-index:1}
.motif{position:absolute;inset:0;z-index:0;${family.motif}}
.top{position:absolute;top:${pad.top}px;left:${pad.side}px;right:${pad.side}px;display:flex;justify-content:space-between;align-items:center;z-index:3}
.eyebrow{font:700 26px Arial,sans-serif;letter-spacing:5px;text-transform:uppercase;color:${family.accent}}
.count{font:700 25px Arial,sans-serif;color:#9a9a9a}
.main{position:relative;z-index:3;max-width:94%}
.headline{font-size:${headlineSize}px;line-height:.92;letter-spacing:-3px;text-transform:uppercase;color:${family.headlineColor};overflow-wrap:break-word;word-break:break-word;text-shadow:0 4px 34px rgba(0,0,0,.55)}
.body{margin-top:30px;font:700 ${bodySize}px/1.12 Arial,sans-serif;max-width:900px;color:#e9e9e9;overflow-wrap:break-word;word-break:break-word;text-shadow:0 2px 18px rgba(0,0,0,.5)}
.cta{position:relative;z-index:3;align-self:flex-start;margin-top:38px;${ctaCss(family)};font:900 30px Arial,sans-serif;text-transform:uppercase}
.footer{position:absolute;bottom:${pad.bottom}px;left:${pad.side}px;right:${pad.side}px;display:flex;justify-content:space-between;font:700 23px Arial,sans-serif;letter-spacing:2px;color:#9a9a9a;text-transform:uppercase;z-index:3}
</style></head><body><div class="stage">${subject}
<div class="top"><div class="eyebrow">${esc(input.eyebrow)}</div><div class="count">${input.index && input.total ? `${input.index}/${input.total}` : ""}</div></div>
<div class="main"><div class="headline">${esc(input.headline)}</div><div class="body">${esc(input.body)}</div><div class="cta">${esc(input.cta)}</div></div>
<div class="footer"><span>@nicks_tire_euclid</span><span>nickstire.org</span></div></div></body></html>`;
}

/**
 * Map the LLM's `artDirection` prose onto a family.
 *
 * The generator has always produced an artDirection string and the renderer has
 * always ignored it — the creative intent was computed and thrown away, the same
 * shape of bug as the audio verdict that was logged and never persisted.
 *
 * This is deliberately a DETERMINISTIC keyword map, not another model call. The
 * art direction is already model output; asking a second model to interpret it
 * adds cost, latency and a second thing that can hallucinate, to choose between
 * three options. Same input always picks the same family, and a test can pin it.
 */
export function familyFromArtDirection(artDirection: string | null | undefined, hasSubjectImage = false): string {
  const text = String(artDirection ?? "").toLowerCase();

  // Evidence first: it is the only family that can USE a photo, so when the art
  // direction asks for one and we have one, nothing else should win.
  if (hasSubjectImage && /photo|macro|close[- ]?up|close up|real|actual|part|tread|rotor|worn|damage|evidence/.test(text)) {
    return "mechanic_evidence";
  }
  if (/weather|snow|ice|salt|freeze|frozen|pothole|road|storm|winter hazard|flood/.test(text)) {
    return "road_hazard";
  }
  if (/offer|deal|special|promo|sale|discount|book|appointment|reminder|deadline|e-?check/.test(text)) {
    return "seasonal_offer";
  }
  return DEFAULT_FAMILY_ID;
}
