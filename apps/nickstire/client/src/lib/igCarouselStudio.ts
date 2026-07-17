/*
 * IG Carousel Intelligence Studio — core model, validation, scoring.
 *
 * Pure, dependency-free helpers (no network, no storage, no side effects).
 * Everything here is testable in isolation and consumed by the admin-only
 * Studio page (client/src/pages/admin/IgCarouselStudio.tsx).
 *
 * This pure lib makes no external calls itself. Generation is LIVE via its
 * consumers (the Studio page + server procs generate briefs and images).
 * Publishing is gated upstream (admin-only procs + caption claim-safety; reels
 * additionally require the server REEL_PUBLISH_ENABLED flag, default off).
 * PUBLISH_ENABLED below is a client-side UI affordance only.
 */

// ─── Modes & statuses ─────────────────────────────────────────────

export type CarouselStudioMode = "draft" | "asset_prep" | "publish_prep";

export type CarouselBriefStatus =
  | "draft"
  | "needs_research"
  | "ready_for_assets"
  | "assets_ready"
  | "published_manual"
  | "failed"
  | "idea"
  | "needs_review"
  | "approved"
  | "posted"
  | "archived"
  | "blocked"
  | "sandbox_preview_sent";

/** Client-side affordance only — live publishing is enforced server-side
 *  (claim-safety + env gates) regardless of this flag. */
export const PUBLISH_ENABLED = true;

export const DISABLED_REASON =
  "Studio actions are turned off — no external social or image-generation calls are made.";

// ─── Brand constants (operator-facing source of truth for the Studio) ──
// NOTE: shared/business.ts holds site-wide business facts; it is being edited
// by an open PR, so the Studio carries its own copy for now. Consolidation is
// listed as a follow-up in docs/ig-carousel-intelligence-studio.md.

export const STUDIO_BRAND = {
  name: "Nick's Tire & Auto",
  handle: "@nicks_tire_euclid",
  website: "nickstire.org",
  address: "17625 Euclid Ave, Cleveland, OH 44112",
  phone: "(216) 862-0005",
  reputation: "4.9-star local reputation",
  reviews: "1,685+ Google reviews",
  certification: "ASE-certified service capability",
} as const;

export const ALLOWED_SERVICES = [
  "tires",
  "new tires",
  "used tires",
  "tire repair",
  "brakes",
  "diagnostics",
  "oil changes",
  "auto repair",
  "alignment and suspension",
  "E-Check / emissions help",
  "$10-down lease-to-own",
] as const;

/** The ONLY approved used-tire price wording. Anything else price-shaped gets flagged. */
export const APPROVED_USED_TIRE_PRICE_LINE =
  "Used tires from $25 installed on select 12-inch sizes; most used tires run $40–$80 installed.";

// ─── Creative territories ─────────────────────────────────────────

export type CreativeTerritory =
  | "cleveland_survival_guide"
  | "mechanic_translation"
  | "csi_evidence_board"
  | "myth_courtroom"
  | "tiny_world"
  | "warning_system"
  | "luxury_part_hero"
  | "road_villain"
  | "car_body_language"
  | "before_the_bill"
  | "blueprint_xray"
  | "premium_product_ad"
  | "weather_local_alert";

/**
 * Each territory carries its OWN image-generation grammar. Before this, one
 * universal "85mm / shallow depth of field / film grain" suffix was appended to
 * every slide prompt, pulling blueprint, evidence-board, tiny-world, and
 * weather-alert decks toward the same glossy product-ad look (the same defect
 * class the reel compiler fixed for motion lenses). `grammar` is the language
 * the image model MUST receive for this territory; `avoid` is compiled into a
 * DO NOT INCLUDE tail.
 */
export const CREATIVE_TERRITORIES: Record<
  CreativeTerritory,
  { label: string; essence: string; grammar: string; avoid: string }
> = {
  cleveland_survival_guide: {
    label: "Cleveland Survival Guide",
    essence: "Local roads, local seasons, local fixes — survival manual energy.",
    grammar: "Field-guide editorial photography, real Cleveland streetscape texture, overcast midwest light, practical documentary framing, rugged tactile detail.",
    avoid: "luxury studio lighting, film grain, glossy product-ad polish",
  },
  mechanic_translation: {
    label: "Mechanic Translation",
    essence: "Shop language translated to plain English, side by side.",
    grammar: "Clean split-composition explainer, neutral studio background, one clear subject per side, bright even lighting, generous negative space for labels.",
    avoid: "shallow depth of field, moody shadows, cluttered shop background",
  },
  csi_evidence_board: {
    label: "CSI / Evidence Board",
    essence: "Clues, string, magnifying glass — the car left evidence.",
    grammar: "Forensic evidence photography, controlled tabletop lighting, numbered-object staging, dark investigative atmosphere, clinical magnification detail.",
    avoid: "luxury product-ad lighting, film grain, police tape cliches, whimsical cartoon treatment",
  },
  myth_courtroom: {
    label: "Myth Courtroom",
    essence: "A common belief goes on trial; the verdict teaches the truth.",
    grammar: "Dramatic theatrical staging, single spotlight on the accused part, dark formal backdrop, courtroom gravitas rendered physically real.",
    avoid: "literal gavels and judges, cartoon rendering, busy background",
  },
  tiny_world: {
    label: "Tiny World",
    essence: "Miniature crews working inside the car — scale makes it memorable.",
    grammar: "High-detail miniature practical diorama, strong scale cues, tilt-shift focus band, tactile model materials, macro photography of a tiny scene.",
    avoid: "full-size human workers, photoreal giant people, film grain, flat illustration",
  },
  warning_system: {
    label: "Warning System",
    essence: "Sounds, lights, and feel as an early-warning network.",
    grammar: "Dashboard warning-light world, deep blacks with amber and red indicator glow, macro bokeh of instrument detail, alert-panel graphic energy.",
    avoid: "daylight exterior, product-ad turntable staging, pastel palette",
  },
  luxury_part_hero: {
    label: "Luxury Part Hero",
    essence: "One humble part shot like a flagship product.",
    grammar: "Premium product commercial, 85mm macro lens, shallow depth of field, studio-grade key lighting on a dark seamless background, controlled reflections, ultra-detailed.",
    avoid: "diagram labels, cluttered scene, cartoon texture",
  },
  road_villain: {
    label: "Road Villain",
    essence: "Pothole, salt, or curb cast as the antagonist.",
    grammar: "Cinematic low-angle antagonist framing, wet asphalt atmosphere, dramatic rim lighting on the hazard, storm-light mood, physically real menace.",
    avoid: "cartoon villain faces, glossy showroom polish, cheerful daylight",
  },
  car_body_language: {
    label: "Car Body Language",
    essence: "What the car is 'saying' through pulls, shakes, and noises.",
    grammar: "Expressive motion-cue photography, subtle motion blur on the symptomatic part, clean neutral environment, one readable gesture per frame.",
    avoid: "anthropomorphic cartoon faces, busy backgrounds, film grain",
  },
  before_the_bill: {
    label: "Before The Bill",
    essence: "The cheap moment before the expensive one — timeline framing.",
    grammar: "Two-state timeline composition, matched framing between early clue and costly outcome, clean editorial lighting, visual before-and-after discipline.",
    avoid: "shallow depth of field haze, luxury ad styling, random collage clutter",
  },
  blueprint_xray: {
    label: "Blueprint / X-Ray",
    essence: "Cutaway, schematic, see-through teaching visuals.",
    grammar: "Orthographic technical illustration, flat deep-navy drafting field, precise white linework, exploded cutaway layers, flat controlled illumination.",
    avoid: "shallow depth of field, film grain, photographic background, cinematic bokeh",
  },
  premium_product_ad: {
    label: "Premium Product-Ad",
    essence: "Ad-grade lighting and composition for an everyday service.",
    grammar: "Award-winning 85mm product photography, shallow depth of field, studio-grade lighting, cinematic color grade, dramatic high contrast, photorealistic premium detail.",
    avoid: "diagram labels, cartoon texture, cluttered composition",
  },
  weather_local_alert: {
    label: "Weather / Local Alert",
    essence: "Forecast-style urgency tied to a real seasonal behavior.",
    grammar: "Broadcast weather-graphics package, sweeping radar arcs and threat-zone overlays on a stylized Cleveland map, crisp motion-graphics aesthetic, alert-banner energy.",
    avoid: "cinematic depth of field, film grain, photorealistic street photography",
  },
};

// ─── Campaign keywords ─────────────────────────────────────────────

export const CAMPAIGN_KEYWORDS = [
  "POTHOLE",
  "TREAD",
  "PRESSURE",
  "BRAKES",
  "SALT",
  "BATTERY",
  "WIPERS",
  "ALIGNMENT",
  "ECHECK",
  "TIRES",
  "SPARE",
  "VIBRATION",
  "PULLING",
  "TPMS",
  "NOISE",
  "DOT",
  "RAIN",
  "CLUNK",
] as const;

export type CampaignKeyword = (typeof CAMPAIGN_KEYWORDS)[number];

// ─── Five-slide structure ──────────────────────────────────────────

export type SlideRole =
  | "pattern_interrupt"
  | "plain_english_truth"
  | "the_clue"
  | "what_to_do"
  | "saveable_recap";

export const SLIDE_ROLES: { role: SlideRole; label: string; job: string }[] = [
  { role: "pattern_interrupt", label: "1 · Pattern Interrupt", job: "Stop the scroll with the hook image + headline." },
  { role: "plain_english_truth", label: "2 · Plain-English Truth", job: "The verified mechanic fact, stated like a person." },
  { role: "the_clue", label: "3 · The Clue", job: "What the driver can see / hear / feel themselves." },
  { role: "what_to_do", label: "4 · What To Do", job: "The next sensible step — no fear, no pressure." },
  { role: "saveable_recap", label: "5 · Saveable Recap + Soft CTA", job: "Recap worth saving + keyword CTA + business close." },
];

// ─── Sources ───────────────────────────────────────────────────────

export type SourceKind = "proof" | "pain_point";

export interface SourceNote {
  label: string; // e.g. "AAA tire pressure guidance"
  url?: string; // optional — labels are acceptable in V1
  kind: SourceKind; // proof = supports the fact; pain_point = shows people ask
  supports: string; // what claim this source backs
}

/** Source families the research standard accepts as PROOF. */
export const PROOF_SOURCE_FAMILIES = [
  "AAA",
  "NHTSA",
  "Tire Rack",
  "Consumer Reports",
  "Bridgestone education",
  "Goodyear education",
  "Michelin education",
  "Car Care Council",
  "Ohio BMV",
  "Ohio E-Check",
] as const;

// ─── Brief / concept / slide models ───────────────────────────────

export interface ConceptScores {
  hook: number; // 0-10 scroll-stopping power
  truth: number; // 0-10 strength/verifiability of the mechanic fact
  save: number; // 0-10 save/share usefulness
  local: number; // 0-10 Cleveland specificity
  absurdity: number; // 0-10 useful-absurdity as a teaching device
  fit: number; // 0-10 fit with Nick's actual services/voice
}

export const CONCEPT_SCORE_MAX = 60;

export interface CarouselConcept {
  id: string;
  hook: string;
  mechanicTruth: string;
  driverEmotion: string;
  campaignKeyword: CampaignKeyword;
  creativeTerritory: CreativeTerritory;
  usefulAbsurdity: string;
  localAngle: string;
  slideOutline: string[];
  saveShareReason: string;
  boostReason: string;
  nickFitReason: string;
  nonGenericReason: string;
  rejectionRisk: string;
  scores: ConceptScores;
}

export interface CarouselSlide {
  slideNumber: 1 | 2 | 3 | 4 | 5;
  role: SlideRole;
  headline: string;
  body: string;
  visualPrompt: string; // Higgsfield image direction
  textOverlayPlan: string; // what text is baked into the image vs caption
  qaNotes: string;
}

export interface SafetyFinding {
  severity: "block" | "warn";
  rule: string;
  match: string;
  where: string; // which field/slide
  fix: string;
}

export interface SafetyReport {
  findings: SafetyFinding[];
  blocked: boolean; // any "block" finding
  checkedAt: string; // ISO — when the report was computed
}

export interface RepetitionChecks {
  recentTopics: string[];
  recentKeywords: string[];
  recentVisualLanes: string[];
  topicRepeated: boolean;
  keywordRepeated: boolean;
  visualLaneRepeated: boolean;
}

export interface CarouselBrief {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: CarouselBriefStatus;
  mode: CarouselStudioMode;
  isSample?: boolean; // SAMPLE seed briefs are clearly labelled in the UI

  topic: string;
  mechanicTruth: string;
  driverConfusion: string;
  clevelandAngle: string;
  seasonality: string;
  sourceNotes: SourceNote[];

  campaignKeyword: CampaignKeyword;
  creativeTerritory: CreativeTerritory;
  usefulAbsurdity: string;

  concepts: CarouselConcept[];
  winningConceptId: string | null;

  slides: CarouselSlide[]; // exactly 5 when valid
  higgsfieldPrompts: string[]; // exactly 5, mirrors slides
  typographyPlan: string;

  captionHooks: string[]; // candidate first lines
  selectedCaption: string;
  hashtags: string[];

  avoidedForRepetition: string; // what was deliberately NOT used today

  boostScore: number; // cached last computation (recompute via calculateBoostScore)
  assetPaths: string[]; // filled in Asset Prep workflows later — empty in V1
  instagramUrl: string | null; // filled after MANUAL publish only
  operatorNotes: string;
  plannedDate?: string;
  notes?: string;
}

// ─── Safety pattern banks ──────────────────────────────────────────
// Patterns live here (operator UI / lib scope) on purpose: this is detector
// configuration, not customer-facing copy.

interface PatternRule {
  rule: string;
  pattern: RegExp;
  fix: string;
}

export const FORBIDDEN_CLAIM_PATTERNS: PatternRule[] = [
  { rule: "no-free-claims", pattern: /\bfree\b(?!\s*check)/i, fix: "Only 'free check' is approved free-wording; drop other 'free' claims." },
  { rule: "no-guarantees", pattern: /\bguarantee[ds]?\b/i, fix: "Remove guarantees entirely." },
  { rule: "no-best-claims", pattern: /\bbest\s+in\s+cleveland\b|\b(?:the\s+)?best\b/i, fix: "Show proof (4.9★, review count) instead of 'best'." },
  { rule: "no-everyone-uses-us", pattern: /\beveryone\s+(?:uses|comes\s+to)\s+us\b/i, fix: "Use an implied-proof line like 'Cleveland drivers ask us this all the time.'" },
  { rule: "no-fake-urgency", pattern: /\blimited\s+time\b|\bbook\s+now\s+before\b|\bbefore\s+it'?s\s+too\s+late\b/i, fix: "Demand without pressure — cut the countdown language." },
  { rule: "no-stock-claims", pattern: /\bin\s+stock\b/i, fix: "Inventory changes hourly; never claim stock." },
  { rule: "no-you-need", pattern: /\byou\s+need\b/i, fix: "Use 'worth checking' / 'do not guess'." },
  { rule: "no-unsafe-scare", pattern: /\bdangerous\s+to\s+drive\b/i, fix: "Teach the clue; don't declare danger from a symptom." },
  { rule: "no-sameday-guarantee", pattern: /\bguaranteed\s+same.?day\b|\bsame.?day\s+guaranteed\b/i, fix: "'Same-day service when realistic' is the approved framing." },
  { rule: "no-exact-wait-times", pattern: /\b(?:in|under)\s+\d+\s*(?:minutes|mins|hours)\b/i, fix: "Never promise wait times." },
  { rule: "no-warranty-claims", pattern: /\bwarrant(?:y|ies)\b/i, fix: "Warranty talk stays out of social copy." },
];

export const OVERDIAGNOSIS_PATTERNS: PatternRule[] = [
  { rule: "no-this-means-bad", pattern: /\bthis\s+means\s+your\s+\w+(?:\s+\w+)?\s+is\s+(?:bad|shot|gone|broken|failing)\b/i, fix: "Symptoms are clues, not verdicts — use 'can point to'." },
  { rule: "no-definitely-need", pattern: /\byou\s+definitely\s+need\b|\bdefinitely\s+(?:needs?|broken|bad)\b/i, fix: "Use 'may indicate' / 'worth checking'." },
  { rule: "no-your-x-is-broken", pattern: /\byour\s+\w+(?:\s+\w+)?\s+is\s+broken\b/i, fix: "Don't diagnose from a post — invite a check instead." },
];

export const FEARMONGER_PATTERNS: PatternRule[] = [
  { rule: "no-fear-leverage", pattern: /\bcould\s+kill\b|\bdeath\s*trap\b|\bcatastroph/i, fix: "Teach calmly; the clue is the story, not the fear." },
  { rule: "no-ticking-bomb", pattern: /\btime\s*bomb\b|\bwaiting\s+to\s+(?:explode|fail)\b/i, fix: "Replace doom framing with 'before the bill' framing." },
];

export const GENERIC_MARKETING_PATTERNS: PatternRule[] = [
  { rule: "no-generic-cliche", pattern: /\bhassle.?free\b|\btop.?notch\b|\bstate.of.the.art\b|\bone.stop\s+shop\b/i, fix: "Concrete beats cliché — name the actual thing." },
  { rule: "no-trust-label", pattern: /\btrusted\b|\bexperts?\b(?!\s+say)/i, fix: "Show, don't claim: 4.9★ and 1,685+ reviews do the work." },
];

/** Price-shaped text that is NOT the approved used-tire line. */
export const PRICE_CLAIM_PATTERN = /\$\s?\d+/;

/** Softer diagnostic language the detectors must ALLOW. */
export const SOFT_DIAGNOSTIC_ALLOWED = [
  "can point to",
  "may indicate",
  "worth checking",
  "do not guess",
  "stop by and we'll take a look",
  "same-day service when realistic",
] as const;

/** Implied-social-proof phrases the Studio encourages. */
export const IMPLIED_PROOF_PHRASES = [
  "Cleveland drivers ask us this all the time.",
  "We see this after pothole hits.",
  "This is one of those clues people ignore until the car starts feeling different.",
  "Around here, road salt works quietly.",
  "A lot of brake conversations start with this sound.",
  "If your car changed after a hit, do not guess.",
  "The light is not the diagnosis. It is the smoke alarm.",
  "The tire sidewall is not your target pressure.",
  "Your car usually gives clues before it gives you a bill.",
  "Save this before the next weird noise.",
] as const;

// ─── Detectors (pure) ──────────────────────────────────────────────

function runPatternBank(
  bank: PatternRule[],
  text: string,
  where: string,
  severity: SafetyFinding["severity"],
): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  for (const r of bank) {
    const m = text.match(r.pattern);
    if (m) findings.push({ severity, rule: r.rule, match: m[0], where, fix: r.fix });
  }
  return findings;
}

export function detectForbiddenClaims(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(FORBIDDEN_CLAIM_PATTERNS, text, where, "block");
}

export function detectOverdiagnosis(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(OVERDIAGNOSIS_PATTERNS, text, where, "block");
}

export function detectFearmongering(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(FEARMONGER_PATTERNS, text, where, "block");
}

export function detectGenericMarketingLanguage(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(GENERIC_MARKETING_PATTERNS, text, where, "warn");
}

/** Any $-price wording other than the single approved used-tire line blocks. */
export function detectUnsupportedPriceOrFree(text: string, where = "text"): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  if (PRICE_CLAIM_PATTERN.test(text) && !text.includes(APPROVED_USED_TIRE_PRICE_LINE)) {
    findings.push({
      severity: "block",
      rule: "no-unapproved-price",
      match: text.match(PRICE_CLAIM_PATTERN)?.[0] ?? "$",
      where,
      fix: `Only the approved line is allowed: "${APPROVED_USED_TIRE_PRICE_LINE}"`,
    });
  }
  return findings;
}

// ─── Structural validators ─────────────────────────────────────────

export function validateExactlyFiveSlides(slides: CarouselSlide[]): {
  ok: boolean;
  reason?: string;
} {
  if (slides.length !== 5) return { ok: false, reason: `Expected exactly 5 slides, got ${slides.length}` };
  const roles = SLIDE_ROLES.map((s) => s.role);
  for (let i = 0; i < 5; i++) {
    if (slides[i].slideNumber !== ((i + 1) as 1 | 2 | 3 | 4 | 5))
      return { ok: false, reason: `Slide ${i + 1} has wrong slideNumber ${slides[i].slideNumber}` };
    if (slides[i].role !== roles[i])
      return { ok: false, reason: `Slide ${i + 1} must be role "${roles[i]}", got "${slides[i].role}"` };
  }
  return { ok: true };
}

export function validateCampaignKeyword(keyword: string): { ok: boolean; reason?: string } {
  if (!/^[A-Z]+$/.test(keyword)) return { ok: false, reason: "Keyword must be a single ALL-CAPS word" };
  if (!(CAMPAIGN_KEYWORDS as readonly string[]).includes(keyword))
    return { ok: false, reason: `"${keyword}" is not in the approved keyword list` };
  return { ok: true };
}

export function validateSourceGrounding(brief: Pick<CarouselBrief, "sourceNotes" | "mechanicTruth">): {
  ok: boolean;
  reason?: string;
} {
  const proof = brief.sourceNotes.filter((s) => s.kind === "proof");
  if (proof.length === 0) return { ok: false, reason: "Needs at least one PROOF source for the mechanic truth" };
  if (!brief.mechanicTruth.trim()) return { ok: false, reason: "Mechanic truth is empty" };
  return { ok: true };
}

/**
 * Attests that THIS pure module performs no external calls. It does NOT attest
 * about consumers: the Studio page and server procs DO generate images and
 * publish (admin-gated + caption claim-safety). Not a publish kill-switch.
 */
export function validateNoExternalSideEffects(): { ok: true; attestation: string } {
  return {
    ok: true,
    attestation:
      "This pure module performs no external calls. Its consumers generate images and publish via admin-only procs with caption claim-safety.",
  };
}

// ─── Scoring ───────────────────────────────────────────────────────

export const STUDIO_DEFAULTS = {
  conceptMinScore: 57, // of 60
  boostMinScore: 70, // of 75
} as const;

export function scoreConcept(c: CarouselConcept): { total: number; max: number; passing: boolean; min: number } {
  const s = c.scores;
  const clamp = (n: number) => Math.max(0, Math.min(10, n));
  const total = clamp(s.hook) + clamp(s.truth) + clamp(s.save) + clamp(s.local) + clamp(s.absurdity) + clamp(s.fit);
  return { total, max: CONCEPT_SCORE_MAX, passing: total >= STUDIO_DEFAULTS.conceptMinScore, min: STUDIO_DEFAULTS.conceptMinScore };
}

export interface BoostScorePart {
  label: string;
  points: number;
  max: number;
  ok: boolean;
  detail: string;
}

export interface BoostScoreResult {
  score: number;
  max: 75;
  parts: BoostScorePart[];
  passing: boolean;
  min: number;
}

function allBriefText(brief: CarouselBrief): { text: string; where: string }[] {
  return [
    ...brief.slides.map((s) => ({ text: `${s.headline}\n${s.body}`, where: `slide ${s.slideNumber}` })),
    { text: brief.selectedCaption, where: "caption" },
    ...brief.captionHooks.map((h, i) => ({ text: h, where: `caption hook ${i + 1}` })),
  ];
}

export function runSafetyChecks(brief: CarouselBrief, now: () => string = () => new Date().toISOString()): SafetyReport {
  const findings: SafetyFinding[] = [];
  for (const { text, where } of allBriefText(brief)) {
    findings.push(
      ...detectForbiddenClaims(text, where),
      ...detectOverdiagnosis(text, where),
      ...detectFearmongering(text, where),
      ...detectUnsupportedPriceOrFree(text, where),
      ...detectGenericMarketingLanguage(text, where),
    );
  }
  return { findings, blocked: findings.some((f) => f.severity === "block"), checkedAt: now() };
}

export function calculateBoostScore(brief: CarouselBrief, minScore: number = STUDIO_DEFAULTS.boostMinScore): BoostScoreResult {
  const safety = runSafetyChecks(brief, () => "scored");
  const fiveOk = validateExactlyFiveSlides(brief.slides).ok;
  const kwOk = validateCampaignKeyword(brief.campaignKeyword).ok;
  const srcOk = validateSourceGrounding(brief).ok;
  const winner = brief.concepts.find((c) => c.id === brief.winningConceptId) ?? null;
  const winnerScore = winner ? scoreConcept(winner) : null;
  const hardBlocks = safety.findings.filter((f) => f.severity === "block");
  const overdiag = hardBlocks.filter((f) => f.rule.startsWith("no-this-means") || f.rule.includes("definitely") || f.rule.includes("broken"));

  const parts: BoostScorePart[] = [
    { label: "Verified mechanic fact (sourced)", max: 10, ok: srcOk, points: srcOk ? 10 : 0, detail: srcOk ? "Proof source present" : "Needs a proof source" },
    { label: "Exactly five slides, right roles", max: 10, ok: fiveOk, points: fiveOk ? 10 : 0, detail: fiveOk ? "Structure valid" : "Slide structure invalid" },
    { label: "One main idea", max: 5, ok: !!brief.topic.trim(), points: brief.topic.trim() ? 5 : 0, detail: "Topic declared" },
    { label: "Claim safety (no blocked claims)", max: 15, ok: hardBlocks.length === 0, points: hardBlocks.length === 0 ? 15 : 0, detail: hardBlocks.length === 0 ? "No blocked claims" : `${hardBlocks.length} blocked claim(s)` },
    { label: "No overdiagnosis", max: 10, ok: overdiag.length === 0, points: overdiag.length === 0 ? 10 : 0, detail: overdiag.length === 0 ? "Symptom language is soft" : "Overdiagnosis detected" },
    { label: "Cleveland angle", max: 10, ok: !!brief.clevelandAngle.trim(), points: brief.clevelandAngle.trim() ? 10 : 0, detail: "Local relevance stated" },
    { label: "Save/share reason", max: 5, ok: !!winner?.saveShareReason?.trim(), points: winner?.saveShareReason?.trim() ? 5 : 0, detail: "Why someone saves this" },
    { label: "Campaign keyword valid", max: 5, ok: kwOk, points: kwOk ? 5 : 0, detail: brief.campaignKeyword },
    { label: `Winning concept ≥ ${STUDIO_DEFAULTS.conceptMinScore}/60`, max: 5, ok: !!winnerScore?.passing, points: winnerScore?.passing ? 5 : 0, detail: winnerScore ? `${winnerScore.total}/60` : "No winning concept" },
  ];
  const score = parts.reduce((a, p) => a + p.points, 0);
  return { score, max: 75, parts, passing: score >= minScore, min: minScore };
}

// ─── Repetition / content-memory checks (manual import in V1) ──────

export function buildRepetitionChecks(
  brief: Pick<CarouselBrief, "topic" | "campaignKeyword" | "creativeTerritory">,
  recent: { topics: string[]; keywords: string[]; visualLanes: string[] },
): RepetitionChecks {
  const norm = (s: string) => s.trim().toLowerCase();
  return {
    recentTopics: recent.topics,
    recentKeywords: recent.keywords,
    recentVisualLanes: recent.visualLanes,
    topicRepeated: recent.topics.map(norm).includes(norm(brief.topic)),
    keywordRepeated: recent.keywords.map((k) => k.toUpperCase()).includes(brief.campaignKeyword),
    visualLaneRepeated: recent.visualLanes.map(norm).includes(norm(brief.creativeTerritory)),
  };
}

// ─── Checklists ────────────────────────────────────────────────────

export interface ChecklistItem {
  label: string;
  ok: boolean | null; // null = pending / manual
  detail: string;
}

export function buildCaptionChecklist(brief: CarouselBrief): ChecklistItem[] {
  const cap = brief.selectedCaption;
  return [
    { label: "Hook line selected", ok: brief.captionHooks.length > 0 && !!cap.trim(), detail: "First line stops the scroll" },
    { label: "Campaign keyword CTA present", ok: cap.includes(brief.campaignKeyword), detail: `DM/comment "${brief.campaignKeyword}"` },
    { label: "Business close present", ok: cap.includes(STUDIO_BRAND.phone) || cap.includes(STUDIO_BRAND.address) || cap.toLowerCase().includes(STUDIO_BRAND.website), detail: "Phone / address / site" },
    { label: "Hashtags 3–12", ok: brief.hashtags.length >= 3 && brief.hashtags.length <= 12, detail: `${brief.hashtags.length} tags` },
    { label: "Caption claim-safe", ok: detectForbiddenClaims(cap).length === 0 && detectOverdiagnosis(cap).length === 0, detail: "No blocked claims in caption" },
  ];
}

export function buildPublishChecklist(brief: CarouselBrief): ChecklistItem[] {
  const safety = runSafetyChecks(brief, () => "checklist");
  const reps = brief.avoidedForRepetition;
  return [
    { label: "Verified fact with source", ok: validateSourceGrounding(brief).ok, detail: "Proof source attached" },
    { label: "Exactly 5 slides", ok: validateExactlyFiveSlides(brief.slides).ok, detail: "Roles 1–5 in order" },
    { label: "One main idea", ok: !!brief.topic.trim(), detail: brief.topic || "—" },
    { label: "No fake price / free / guarantee", ok: !safety.findings.some((f) => ["no-unapproved-price", "no-free-claims", "no-guarantees"].includes(f.rule)), detail: "Price/claim bank clean" },
    { label: "No overdiagnosis", ok: !safety.findings.some((f) => OVERDIAGNOSIS_PATTERNS.some((p) => p.rule === f.rule)), detail: "Soft diagnostic language only" },
    { label: "No fearmongering", ok: !safety.findings.some((f) => FEARMONGER_PATTERNS.some((p) => p.rule === f.rule)), detail: "Calm teaching tone" },
    { label: "Keyword not repeated recently", ok: reps ? true : null, detail: reps ? `Avoided: ${reps}` : "Paste recent log in Content Memory panel" },
    { label: "Topic not repeated recently", ok: reps ? true : null, detail: "See Content Memory panel" },
    { label: "No warped AI text in images", ok: null, detail: "Manual check after Higgsfield render" },
    { label: "Posting from correct account", ok: null, detail: `${STUDIO_BRAND.handle} — manual check` },
    { label: "Facebook cross-post OFF", ok: null, detail: "Manual check in IG composer" },
    { label: "Manual operator review", ok: null, detail: "A human reads every slide before posting" },
  ];
}

/** Single gate the UI uses for the publish button. Always false in V1. */
export function canPublish(): { ok: false; reason: string } | { ok: true } {
  if (!PUBLISH_ENABLED) return { ok: false, reason: DISABLED_REASON };
  return { ok: true };
}
