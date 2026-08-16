import { createHash, randomUUID } from "crypto";
import { z } from "zod";
import { BUSINESS } from "@shared/business";
import {
  INSTAGRAM_STUDIO_VERSION,
  type InstagramCarouselSlide,
  type InstagramFormat,
  type InstagramObjective,
  type InstagramQualityDimension,
  type InstagramQualityGate,
  type InstagramQualityResult,
  type InstagramSourceInput,
  type InstagramStudioDraft,
} from "../../shared/instagramStudio";
import { assessEvidence, evidenceDirective, type EvidenceFact } from "../../shared/evidenceSufficiency";
import { invokeLLM, type OutputSchema } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { sanitizeText } from "../sanitize";
import { captionClaimBlockers } from "./socialPublish";

const log = createLogger("services:instagram-studio");

const generatedDraftSchema = z.object({
  topic: z.string().min(2).max(180),
  caption: z.string().min(10).max(2200),
  hashtags: z.array(z.string().min(1).max(40)).max(12),
  headline: z.string().min(2).max(42),
  subheadline: z.string().min(2).max(90),
  cta: z.string().min(2).max(52),
  artDirection: z.string().min(10).max(500),
  rationale: z.string().min(5).max(500),
  conceptKey: z.string().min(3).max(64),
  carouselSlides: z.array(z.object({
    role: z.enum(["hook", "truth", "proof", "action", "cta"]),
    headline: z.string().min(2).max(42),
    body: z.string().min(2).max(110),
    artDirection: z.string().min(5).max(300),
  })).max(7),
});

const OUTPUT_SCHEMA: OutputSchema = {
  name: "instagram_studio_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string" },
      caption: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      headline: { type: "string" },
      subheadline: { type: "string" },
      cta: { type: "string" },
      artDirection: { type: "string" },
      rationale: { type: "string" },
      conceptKey: { type: "string" },
      carouselSlides: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            role: { type: "string", enum: ["hook", "truth", "proof", "action", "cta"] },
            headline: { type: "string" },
            body: { type: "string" },
            artDirection: { type: "string" },
          },
          required: ["role", "headline", "body", "artDirection"],
        },
      },
    },
    required: [
      "topic", "caption", "hashtags", "headline", "subheadline", "cta",
      "artDirection", "rationale", "conceptKey", "carouselSlides",
    ],
  },
};

function compact(value: string, max: number): string {
  return sanitizeText(value).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Caption-specific compaction. compact()'s `\s+ → " "` flattened EVERY
 * generated caption into one unbroken line: Instagram captions live on
 * paragraph breaks, and evaluateInstagramDraft reads the first line
 * (`caption.split(/\n+/)`) to score the hook — so the same collapse that made
 * captions publish as walls of text also corrupted hook-strength scoring.
 * Collapse runs of spaces/tabs WITHIN a line, cap blank runs at one empty
 * line, keep the structure.
 */
export function compactCaption(value: string, max: number): string {
  return sanitizeText(value)
    .replace(/[^\S\n]+/g, " ")
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function normalizeHashtag(value: string): string {
  return value.replace(/^#+/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40);
}

function scoreStatus(score: number, blockAt = 5, warnAt = 7): InstagramQualityGate {
  if (score < blockAt) return "block";
  if (score < warnAt) return "warn";
  return "pass";
}

function dimension(
  key: InstagramQualityDimension["key"],
  label: string,
  score: number,
  weight: number,
  finding?: string,
): InstagramQualityDimension {
  return { key, label, score, weight, status: scoreStatus(score), ...(finding ? { finding } : {}) };
}

export function evaluateInstagramDraft(input: {
  source: InstagramSourceInput;
  format: InstagramFormat;
  caption: string;
  headline: string;
  subheadline: string;
  artDirection: string;
  conceptKey?: string;
  /** Carousel slide copy — the deterministic carousel render draws THESE, not
   *  headline/subheadline, so visual readiness must score them. */
  carouselSlides?: Array<{ headline: string; body: string }>;
  cta?: string;
  /** Recent concept keys (fetchRecentConceptKeys) so novelty measures actual
   *  distinctness. Absent = recency unknown — scored honestly as unchecked. */
  recentConceptKeys?: string[];
  /**
   * The RESOLVED record's structured facts (resolveSourceProvenance).
   *
   * Grounding was previously scored from `evidenceStatus` and string
   * non-emptiness, so the dimension could not fail: one character in the
   * context box scored 8/10 and silenced its own warning. The evaluator never
   * received the evidence itself — `buildEvalArgs` passed `source` but not the
   * resolved text — so nothing downstream could compare a claim to a record.
   * Absent = assessed from operator context alone, which caps at `thin`.
   */
  evidenceFacts?: EvidenceFact[];
}): InstagramQualityResult {
  const caption = input.caption.trim();
  const firstLine = caption.split(/\n+/)[0]?.trim() ?? "";
  const lower = caption.toLowerCase();
  const blockers = captionClaimBlockers(caption).map((finding) => `${finding.rule}: ${finding.match}`);
  const warnings: string[] = [];

  const requiresVerifiedSource = input.source.type === "review" || input.source.type === "declined_work";
  if (requiresVerifiedSource && input.source.evidenceStatus !== "verified") {
    blockers.push("A review or declined-work post requires a verified database record.");
  }

  const claimSafety = blockers.length ? 0 : 10;
  // Deterministic assessment over the resolved facts. An unverified
  // review/declined-work draft keeps its hard 0 (the blocker above already
  // holds it), but a VERIFIED record no longer earns a flat 10 just for
  // existing: a row that resolved to nothing but an order number is thin, and
  // now says so.
  // `?? input.source.facts` is what makes the re-score paths work. Generation
  // passes evidenceFacts explicitly; evaluate / render / stage pass a DRAFT, whose
  // facts ride on `source`. Reading only the explicit argument meant every path
  // after generation scored zero facts.
  const evidence = assessEvidence(input.evidenceFacts ?? input.source.facts ?? [], input.source.detail);
  const sourceGrounding = requiresVerifiedSource && input.source.evidenceStatus !== "verified"
    ? 0
    : evidence.groundingScore;

  let hookStrength = 4;
  if (firstLine.length >= 12 && firstLine.length <= 90) hookStrength += 2;
  if (/\d|\?|stop\b|before\b|here'?s\b|your\b/i.test(firstLine)) hookStrength += 2;
  if (firstLine.length > 120) hookStrength -= 2;
  hookStrength = Math.max(0, Math.min(10, hookStrength));

  const bannedCorporate = ["hassle-free", "premium quality", "trusted experts", "best-in-class"]
    .filter((term) => lower.includes(term));
  let voiceMatch = 8;
  if (bannedCorporate.length) voiceMatch -= 4;
  if (caption.length > 900) voiceMatch -= 1;
  if (/nick'?s tire|walk in|pull up|straight answer|no pressure/i.test(lower)) voiceMatch += 1;
  voiceMatch = Math.max(0, Math.min(10, voiceMatch));

  const localRelevance = /cleveland|euclid|east side|i-90|ohio|pothole|road salt/i.test(lower) ? 10 : 6;
  const usefulness = /check|look for|when|before|because|means|ask|save|send|call|book|walk in/i.test(lower) ? 8 : 5;
  // Visual readiness scores what the renderer actually draws. artDirection is
  // deliberately NOT consulted: the deterministic renderer never reads it (it
  // only feeds the LLM prompt at generation), so rewarding its length inflated
  // this dimension with a dead input. Carousels render slide copy, not
  // headline/subheadline — score the slides.
  let visualReadiness: number;
  let visualFinding: string | undefined;
  if (input.format === "carousel") {
    const slides = input.carouselSlides ?? [];
    if (slides.length === 0) {
      visualReadiness = 4;
      visualFinding = "Carousel has no slide copy to render.";
    } else if (slides.every((s) => s.headline.length <= 42 && s.body.length <= 110)) {
      visualReadiness = 10;
    } else {
      visualReadiness = 4;
      visualFinding = "One or more slides exceed render limits (headline 42 / body 110).";
    }
  } else {
    visualReadiness = input.headline.length <= 42 && input.subheadline.length <= 90 ? 10 : 4;
  }

  // Novelty measures distinctness against RECENT posts, not the mere existence
  // of a key (which every generated draft has — the old check awarded 8 for
  // nothing). Unknown recency scores mid, repeats score low and say why.
  const key = input.conceptKey?.trim().toLowerCase();
  let novelty: number;
  let noveltyFinding: string | undefined;
  if (!key || key.length < 3) {
    novelty = 5;
  } else if (!input.recentConceptKeys) {
    novelty = 6;
    noveltyFinding = "Concept recency not checked against recent posts.";
  } else if (input.recentConceptKeys.some((k) => k.trim().toLowerCase() === key)) {
    novelty = 2;
    noveltyFinding = `Concept "${key}" repeats a recent post — pick a different angle.`;
  } else {
    novelty = 8;
  }

  const dimensions = [
    dimension("claim_safety", "Claim safety", claimSafety, 0.25, blockers[0]),
    dimension("source_grounding", "Source grounding", sourceGrounding, 0.15,
      // The assessment's own reason names WHAT is missing, so the finding stops
      // being a generic instruction the operator cannot act on.
      sourceGrounding < 7
        ? `${evidence.reason}${evidence.missing.length ? ` Needs: ${evidence.missing.join(", ")}.` : ""}`
        : undefined),
    dimension("hook_strength", "Hook strength", hookStrength, 0.15,
      hookStrength < 7 ? "Lead with one specific fact, tension point, or useful question." : undefined),
    dimension("voice_match", "Nick voice", voiceMatch, 0.12,
      voiceMatch < 7 ? "Make the copy more direct, concrete, and neighborhood-specific." : undefined),
    dimension("local_relevance", "Cleveland relevance", localRelevance, 0.08,
      localRelevance < 7 ? "Add a truthful Cleveland or East Side reason this matters." : undefined),
    dimension("usefulness", "Usefulness", usefulness, 0.1,
      usefulness < 7 ? "Give the driver one concrete action or diagnostic clue." : undefined),
    dimension("visual_readiness", "Visual readiness", visualReadiness, 0.1,
      visualReadiness < 7 ? (visualFinding ?? "Shorten visual copy so it can render cleanly.") : undefined),
    dimension("novelty", "Concept distinctness", novelty, 0.05,
      novelty < 7 ? (noveltyFinding ?? "Give the concept a distinct angle instead of generic service copy.") : undefined),
  ];

  // "block" findings were SILENT. The loop collected only status "warn", so any
  // dimension scoring below blockAt (5) contributed its finding to nothing —
  // neither `warnings` nor `blockers`, which are populated separately. That made
  // a low score quieter than a middling one. Collect both so a finding can never
  // be discarded by being too severe; what BLOCKS is still decided by `blockers`
  // alone, so this makes the gate louder without newly failing anything.
  for (const item of dimensions) {
    if ((item.status === "warn" || item.status === "block") && item.finding) warnings.push(item.finding);
  }

  const overall = Math.round(dimensions.reduce((sum, item) => sum + item.score * item.weight, 0) * 10);
  const gate: InstagramQualityGate = blockers.length ? "block" : overall >= 82 && warnings.length === 0 ? "pass" : "warn";

  return {
    version: INSTAGRAM_STUDIO_VERSION,
    overall,
    gate,
    dimensions,
    blockers,
    warnings,
    evaluatedAt: new Date().toISOString(),
  };
}

/** Source types with a real first-party table behind them. */
const RESOLVABLE_SOURCE_TYPES = new Set(["review", "declined_work", "special_offer"]);

async function resolveEvidence(
  source: InstagramSourceInput,
): Promise<InstagramSourceInput & { resolvedEvidence: string; facts: EvidenceFact[] }> {
  // `special_offer` joins the resolvable set: `specials` is a real table with an
  // index on (is_active, starts_at, expires_at) that this path never queried, so
  // an offer the shop actually authored arrived as retyped operator prose.
  if (RESOLVABLE_SOURCE_TYPES.has(source.type)) {
    const { resolveSourceProvenance } = await import("./reelBriefGen");
    const resolved = await resolveSourceProvenance(source.type, source.recordId, source.detail);
    // A failed lookup must not read as an absent record. `unverified` covers
    // both today; the availability field is what distinguishes them, and it is
    // logged so an operator staring at an empty picker has a trail.
    if (resolved.availability === "source_unavailable") {
      log.warn("evidence source unavailable — not an empty result", {
        sourceType: source.type,
        recordId: source.recordId,
      });
    }
    return {
      ...source,
      evidenceStatus: resolved.isVerified ? "verified" : "unverified",
      resolvedEvidence: resolved.evidence,
      facts: resolved.facts ?? [],
    };
  }
  const typed = source.detail?.trim();
  return {
    ...source,
    evidenceStatus: typed || source.recordId?.trim() ? "operator_context" : "unverified",
    resolvedEvidence: typed || "No additional operator context supplied.",
    facts: typed
      ? [{ key: "operator_context", label: "Operator context", value: typed, role: "context", basis: "operator" }]
      : [],
  };
}

/**
 * The ONE evaluator-args builder — the router's four procs and generation all
 * pass drafts through this, so a draft scores identically at generation and at
 * every later re-score. Generation previously built its args inline and
 * omitted carouselSlides (+ cta + recentConceptKeys): the same carousel scored
 * 6 points lower at generation, with a spurious "Carousel has no slide copy to
 * render" warning that could flip the gate pass→warn.
 */
export function buildEvalArgs(d: {
  source: InstagramStudioDraft["source"];
  format: InstagramStudioDraft["format"];
  caption: string;
  headline: string;
  subheadline: string;
  artDirection: string;
  conceptKey: string;
  cta: string;
  carouselSlides: Array<{ headline: string; body: string }>;
  /**
   * Resolved facts. This builder previously omitted them, which is why the
   * grounding dimension could only ever see a status flag: the evaluator was
   * structurally unable to inspect the evidence it was scoring.
   */
  evidenceFacts?: EvidenceFact[];
}) {
  return {
    source: d.source,
    format: d.format,
    caption: d.caption,
    headline: d.headline,
    subheadline: d.subheadline,
    artDirection: d.artDirection,
    conceptKey: d.conceptKey,
    cta: d.cta,
    carouselSlides: d.carouselSlides,
    evidenceFacts: d.evidenceFacts,
  };
}

export async function generateInstagramStudioDraft(input: {
  source: InstagramSourceInput;
  format: InstagramFormat;
  objective: InstagramObjective;
  operatorDirection?: string;
  /** From fetchRecentConceptKeys — generation scores novelty against the same
   *  recency window the router's re-score paths use. */
  recentConceptKeys?: string[];
  /** Real shop photos (evidence-first Create) — become the draft's subject imagery. */
  evidenceImageUrls?: string[];
}): Promise<InstagramStudioDraft> {
  if (input.format === "reel") {
    throw new Error("Reels use the dedicated verified ReelBrief pipeline.");
  }

  const source = await resolveEvidence(input.source);
  if ((source.type === "review" || source.type === "declined_work") && source.evidenceStatus !== "verified") {
    throw new Error("NEEDS_RESEARCH: Select a valid verified record before generating this post.");
  }

  const businessFacts = {
    name: BUSINESS.name,
    phone: BUSINESS.phone.display,
    address: BUSINESS.address.full,
    neighborhood: BUSINESS.address.neighborhood,
    hours: BUSINESS.hours.fullDisplay,
    website: "nickstire.org",
    rating: BUSINESS.reviews.rating,
    reviewCount: BUSINESS.reviews.countDisplay,
  };

  const system = `You are the senior social creative director for Nick's Tire & Auto.
Create one publication-ready Instagram ${input.format} designed for the objective "${input.objective}".

BUSINESS FACTS (the only business claims you may state):
${JSON.stringify(businessFacts)}

SOURCE TYPE: ${source.type}
SOURCE EVIDENCE STATUS: ${source.evidenceStatus}
SOURCE EVIDENCE: ${source.resolvedEvidence}
${source.facts.length ? `RESOLVED FACTS (the ONLY specifics you may state — each is a real stored value):
${source.facts.map((f) => `- ${f.label}: ${f.value}${f.basis === "inferred" ? "  [INFERRED — qualify, never assert]" : ""}`).join("\n")}` : "RESOLVED FACTS: none — no stored record backs this piece."}
${evidenceDirective(assessEvidence(source.facts, source.detail))}
SUBJECT PHOTO: ${input.evidenceImageUrls?.length
    ? "A REAL shop photograph is attached and will be the visual subject — write artDirection that frames and annotates THIS photo, never a generated scene."
    : "None — a branded visual-family background will be used."}
OPERATOR DIRECTION: ${input.operatorDirection?.trim() || "Use the strongest truthful angle."}

NON-NEGOTIABLE RULES:
- Never invent a price, statistic, customer, repair count, certification, result, urgency, or diagnosis.
- Never claim 1-in-5, 10,000 services, 97% satisfaction, or any number not present in BUSINESS FACTS or SOURCE EVIDENCE.
- The caption must sound direct, useful, local, and human. No generic agency language.
- The first line must stop the scroll without fearmongering.
- Use one CTA only.
- Headline max 42 characters. Subheadline max 90. CTA max 52.
- Visual fields must contain clean final copy, never fragments, placeholders, repeated words, or decimal punctuation mistakes.
- Hashtags must omit the # symbol.
- For a carousel, output exactly five slides in this order: hook, truth, proof, action, cta.
- For non-carousel formats, carouselSlides must be an empty array.
- artDirection describes composition and subject; it must not ask an image model to draw text.
- conceptKey must be a short lowercase kebab-case identifier.
Return only JSON matching the schema.`;

  const result = await invokeLLM({
    messages: [
      { role: "system", content: system },
      { role: "user", content: "Generate the strongest truthful draft now." },
    ],
    maxTokens: 4096,
    timeoutMs: 90_000,
    outputSchema: OUTPUT_SCHEMA,
  });

  const raw = result.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("The content model returned an empty draft.");
  const parsed = generatedDraftSchema.parse(JSON.parse(raw));

  const carouselSlides: InstagramCarouselSlide[] = input.format === "carousel"
    ? parsed.carouselSlides.slice(0, 5)
    : [];
  if (input.format === "carousel" && carouselSlides.length !== 5) {
    throw new Error("Carousel generation did not return exactly five slides.");
  }

  const normalized = {
    caption: compactCaption(parsed.caption, 2200),
    headline: compact(parsed.headline, 42),
    subheadline: compact(parsed.subheadline, 90),
    cta: compact(parsed.cta, 52),
    artDirection: compact(parsed.artDirection, 500),
    hashtags: [...new Set(parsed.hashtags.map(normalizeHashtag).filter(Boolean))].slice(0, 12),
    conceptKey: compact(parsed.conceptKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), 64),
  };

  const quality = evaluateInstagramDraft({
    ...buildEvalArgs({
      source,
      format: input.format,
      caption: normalized.caption,
      headline: normalized.headline,
      subheadline: normalized.subheadline,
      artDirection: normalized.artDirection,
      conceptKey: normalized.conceptKey,
      cta: normalized.cta,
      carouselSlides,
      evidenceFacts: source.facts,
    }),
    recentConceptKeys: input.recentConceptKeys,
  });

  return {
    version: INSTAGRAM_STUDIO_VERSION,
    id: `ig_${randomUUID()}`,
    source,
    format: input.format,
    objective: input.objective,
    topic: compact(parsed.topic, 180),
    caption: normalized.caption,
    hashtags: normalized.hashtags,
    headline: normalized.headline,
    subheadline: normalized.subheadline,
    cta: normalized.cta,
    artDirection: normalized.artDirection,
    carouselSlides,
    // Evidence-first Create: real shop photos ride in as the subject imagery.
    // Own-render URLs are filtered here too (defense in depth beside the zod
    // refine) — pickSubjectImage would reject them anyway, but a card URL in
    // this field is a data bug worth stopping at the door.
    imageUrls: (input.evidenceImageUrls ?? []).filter((u) => typeof u === "string" && !u.includes(STUDIO_ASSET_PREFIX)),
    rationale: compact(parsed.rationale, 500),
    conceptKey: normalized.conceptKey || createHash("sha1").update(normalized.caption).digest("hex").slice(0, 16),
    quality,
    createdAt: new Date().toISOString(),
  };
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Deterministic shrink-to-fit. Picks the largest font size (clamped to
 * [min, max]) at which `text` fits within `maxLines` lines of `width` px.
 *
 * Why: the card uses `overflow:hidden`, so a FIXED font size silently CLIPPED
 * legitimately-long-but-valid copy (a full-length 42-char headline at 108px
 * overflowed the card). The quality gate bounds copy LENGTH, not rendered
 * SIZE — this closes that gap so the whole point of deterministic rendering
 * ("no malformed / cut-off poster text") actually holds. Char width is
 * approximated as `fontSize * charRatio` (Arial Black uppercase ≈ 0.60,
 * regular bold ≈ 0.52), which is conservative and verified by a real
 * puppeteer render of worst-case copy in the test suite.
 */
export function fitFontSize(
  text: string,
  opts: { width: number; maxLines: number; max: number; min: number; charRatio: number },
): number {
  const chars = Math.max(text.trim().length, 1);
  const ideal = Math.floor((opts.width * opts.maxLines) / (chars * opts.charRatio));
  return Math.max(opts.min, Math.min(opts.max, ideal));
}

export function renderCardHtml(input: {
  headline: string;
  body: string;
  cta: string;
  eyebrow: string;
  width: number;
  height: number;
  index?: number;
  total?: number;
}): string {
  const portrait = input.height > input.width;
  const pad = portrait ? 96 : 76;
  const contentW = input.width - pad * 2;
  const headlineSize = fitFontSize(input.headline, {
    width: Math.min(950, contentW), maxLines: 2, max: portrait ? 120 : 108, min: 48, charRatio: 0.6,
  });
  const bodySize = fitFontSize(input.body, {
    width: Math.min(900, contentW), maxLines: 4, max: portrait ? 54 : 44, min: 28, charRatio: 0.52,
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:${input.width}px;height:${input.height}px;overflow:hidden;background:#090909}
body{font-family:Arial Black,Arial,sans-serif;color:#fff}.stage{position:relative;width:100%;height:100%;padding:${pad}px;display:flex;flex-direction:column;background:radial-gradient(circle at 75% 18%,#292929 0,#0b0b0b 46%,#050505 100%)}
.stage:before{content:"";position:absolute;right:-13%;top:-7%;width:58%;height:45%;border:34px solid #FDB913;border-radius:50%;transform:rotate(-18deg);opacity:.16}
.stage:after{content:"";position:absolute;inset:28px;border:3px solid rgba(253,185,19,.38);pointer-events:none}.top{display:flex;justify-content:space-between;align-items:center;z-index:2}.eyebrow{font:700 27px Arial,sans-serif;letter-spacing:5px;text-transform:uppercase;color:#FDB913}.count{font:700 26px Arial,sans-serif;color:#8d8d8d}.main{margin:auto 0;z-index:2;max-width:92%}.headline{font-size:${headlineSize}px;line-height:.9;letter-spacing:-4px;text-transform:uppercase;max-width:950px;overflow-wrap:break-word;word-break:break-word}.body{margin-top:34px;font:700 ${bodySize}px/1.08 Arial,sans-serif;max-width:900px;color:#e7e7e7;overflow-wrap:break-word;word-break:break-word}.cta{z-index:2;align-self:flex-start;background:#FDB913;color:#080808;padding:22px 30px;font:900 31px Arial,sans-serif;text-transform:uppercase;transform:skewX(-7deg)}.cta span{display:block;transform:skewX(7deg)}.footer{z-index:2;margin-top:28px;display:flex;justify-content:space-between;font:700 24px Arial,sans-serif;letter-spacing:2px;color:#8f8f8f;text-transform:uppercase}
</style></head><body><div class="stage"><div class="top"><div class="eyebrow">${esc(input.eyebrow)}</div><div class="count">${input.index && input.total ? `${input.index}/${input.total}` : ""}</div></div><div class="main"><div class="headline">${esc(input.headline)}</div><div class="body">${esc(input.body)}</div></div><div class="cta"><span>${esc(input.cta)}</span></div><div class="footer"><span>@nicks_tire_euclid</span><span>nickstire.org</span></div></div></body></html>`;
}

/**
 * Where this renderer writes. Anything under it is OUR OWN OUTPUT.
 * Kept beside pickSubjectImage so the two can never drift apart.
 */
export const STUDIO_ASSET_PREFIX = "instagram-studio/";

/**
 * Choose the subject photograph — and REFUSE to accept a card we rendered.
 *
 * `imageUrls` is this renderer's own return value. The router does
 * `return { ...evaluated, imageUrls }`, the client stores that back into the
 * draft, and the Queue re-renders stored drafts. So on any SECOND render, the
 * "subject photo" was the JPEG of the card produced by the first one.
 *
 * The result was a card inside a card: the previous render painted full-bleed as
 * the background, a scrim over it, and the same headline drawn on top again —
 * nesting one level deeper on every re-render, and publishable without anything
 * flagging it. It also flipped `hasSubjectImage` to true, which silently changed
 * which visual family got selected.
 *
 * The rule is decidable from the URL alone: a file this function wrote is never a
 * subject. That keeps the guard in the one place that knows where it writes,
 * instead of asking every caller to remember to clear the field.
 */
export function pickSubjectImage(imageUrls: readonly string[] | null | undefined): string | null {
  for (const url of imageUrls ?? []) {
    if (typeof url !== "string" || !url) continue;
    if (url.includes(STUDIO_ASSET_PREFIX)) continue;
    return url;
  }
  return null;
}

export async function renderInstagramStudioAssets(draft: InstagramStudioDraft): Promise<string[]> {
  if (draft.quality.gate === "block") throw new Error(`Draft is blocked: ${draft.quality.blockers.join("; ")}`);
  if (draft.format === "reel") throw new Error("Reel assets are rendered by the Reel pipeline.");

  const { renderHtmlToJpeg } = await import("./adStudio/adRender");
  const { storagePut } = await import("../storage");
  const { familyFromArtDirection, resolveFamilyForSubject, renderFamilyCardHtml, FEED_W, FEED_H, STORY_W, STORY_H } =
    await import("./visualFamily");

  // 4:5 for the feed, not 1:1. A square post gives away vertical screen on the
  // one surface where screen space is the whole competition, and the carousel
  // renderer has been native 4:5 all along — this brings static posts in line.
  const dimensions = draft.format === "story"
    ? { width: STORY_W, height: STORY_H }
    : { width: FEED_W, height: FEED_H };

  // artDirection has ALWAYS been generated and ALWAYS been ignored — the creative
  // intent was computed and thrown away. It now picks the composition.
  // imageUrls is where a generated or selected photo lands. Empty is normal and
  // must not be a failure — most drafts have no subject and render on the family
  // background instead.
  const subjectImageUrl = pickSubjectImage(draft.imageUrls);
  const requestedFamilyId = familyFromArtDirection(draft.artDirection, Boolean(subjectImageUrl));
  const resolved = resolveFamilyForSubject(requestedFamilyId, Boolean(subjectImageUrl));
  if (resolved.substituted) {
    // Announced, never silent — the caller can surface this to the operator.
    log.warn("visual family substituted", { draftId: draft.id, reason: resolved.reason });
  }
  const cards = draft.format === "carousel"
    ? draft.carouselSlides.map((slide, index) => ({
        headline: slide.headline,
        body: slide.body,
        cta: index === draft.carouselSlides.length - 1 ? draft.cta : "Swipe for the next step",
        eyebrow: `${BUSINESS.name} · ${slide.role}`,
        index: index + 1,
        total: draft.carouselSlides.length,
      }))
    : [{
        headline: draft.headline,
        body: draft.subheadline,
        cta: draft.cta,
        eyebrow: BUSINESS.name,
      }];

  const urls: string[] = [];
  for (let index = 0; index < cards.length; index++) {
    const html = renderFamilyCardHtml({
      ...cards[index],
      ...dimensions,
      family: resolved.family,
      // Only the FIRST card carries the subject image; later carousel slides are
      // teaching frames and a repeated photo behind each one reads as a template.
      subjectImageUrl: index === 0 ? subjectImageUrl : null,
    });
    const buffer = await renderHtmlToJpeg(html, dimensions.width, dimensions.height);
    const upload = await storagePut(
      `${STUDIO_ASSET_PREFIX}${draft.id}-${index + 1}.jpg`,
      buffer,
      "image/jpeg",
    );
    if (!upload.url) throw new Error(`Asset ${index + 1} could not be hosted.`);
    urls.push(upload.url);
  }
  log.info("rendered studio assets", {
    draftId: draft.id, format: draft.format, count: urls.length,
    family: resolved.family.id, substituted: resolved.substituted, hadSubject: Boolean(subjectImageUrl),
  });
  return urls;
}
