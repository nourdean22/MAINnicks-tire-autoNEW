/*
 * Faceless Reel Intelligence Studio — core model, validation, scoring.
 *
 * Pure, dependency-free helpers (no network, no storage, no side effects).
 * Everything here is testable in isolation and consumed by the admin-only
 * Studio page (client/src/pages/admin/FacelessReelStudio.tsx).
 *
 * The Reels sibling of lib/igCarouselStudio.ts (built in a parallel session).
 * SafetyFinding / ChecklistItem / PatternRule shapes are kept interface-
 * compatible so a future shared Social Studio layer can merge them without a
 * rewrite — but this module is self-contained on purpose: the Carousel PR is
 * unmerged and this PR must not depend on it.
 *
 * This pure lib makes no external calls itself. Generation is LIVE via its
 * consumers (the Studio page + server procs generate briefs, images, and reel
 * clips). Live PUBLISHING is gated SERVER-SIDE by REEL_PUBLISH_ENABLED
 * (default OFF) + full caption claim-safety — see server/services/socialPublish.ts.
 * The PUBLISH_ENABLED / GENERATION_ENABLED flags below are client-side UI
 * affordances only; they cannot reach Instagram on their own.
 */

// ─── Modes & statuses ─────────────────────────────────────────────

export type ReelStudioMode = "draft" | "asset_prep" | "publish_prep";

export type ReelBriefStatus =
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

/** Client-side UI affordances for the Studio — NOT the publish safety gate.
 *  Live reel publishing is enforced server-side (REEL_PUBLISH_ENABLED, default
 *  off) + claim-safety regardless of these flags. */
export const PUBLISH_ENABLED = true;
export const GENERATION_ENABLED = true;
export const INSIGHTS_ENABLED = true;

export const DISABLED_REASON =
  "Studio actions are turned off — no external generation or posting occurs.";

// ─── Brand constants (operator-facing source of truth for the Studio) ──
// NOTE: shared/business.ts holds site-wide business facts; it is being edited
// by an open PR (#49), so the Studio carries its own copy for now. Same
// deliberate duplication as the Carousel Studio; consolidation is a listed
// follow-up in docs/faceless-reel-intelligence-studio.md.

export const STUDIO_BRAND = {
  name: "Nick's Tire & Auto",
  handle: "@nicks_tire_euclid",
  website: "nickstire.org",
  address: "17625 Euclid Ave, Cleveland, OH 44112",
  phone: "(216) 862-0005",
  reputation: "4.9-star local reputation",
  reviews: "1,685+ Google reviews",
  certification: "ASE-certified service capability",
  typography: {
    display: "Anton",
    body: "Barlow",
  },
  colors: {
    primary: "#FDB913",
    background: "#0A0A0A",
  },
} as const;

// ─── Reel output rules (hard format contract) ─────────────────────

export const REEL_OUTPUT_RULES = {
  reelsPerRun: 1,
  minSeconds: 15,
  maxSeconds: 22,
  resolution: "1080x1920",
  codec: "H.264 MP4",
  pixelFormat: "yuv420p",
  fps: 30,
  faststart: true,
  minBeats: 4,
  maxBeats: 6,
  faceless: true,
} as const;

/**
 * Subjects that violate the faceless contract when they appear as the
 * VISUAL SUBJECT of a beat or prompt. Pure-string heuristic: the operator
 * still does a manual no-face check after any future render.
 */
const FACE_SUBJECT_PATTERN =
  /\b(?:human\s+face|person'?s?\s+face|talking\s+head|man|woman|mechanic\s+(?:smiling|talking|speaking|on\s+camera)|customer\s+(?:smiling|talking|face)|selfie|presenter|spokesperson|face\s+to\s+camera|shop\s+tour)\b/i;

// ─── Fact buckets ──────────────────────────────────────────────────

export type FactBucket =
  | "invisible_killers"
  | "wallet_protectors"
  | "cleveland_survival"
  | "myth_buster";

export const FACT_BUCKETS: Record<FactBucket, { label: string; essence: string }> = {
  invisible_killers: {
    label: "Invisible Killers",
    essence: "Quiet problems a driver cannot see that age the car underneath them.",
  },
  wallet_protectors: {
    label: "Wallet Protectors",
    essence: "The cheap moment before the expensive one — catch it early.",
  },
  cleveland_survival: {
    label: "Cleveland Survival",
    essence: "Potholes, salt, freeze-thaw — surviving these specific roads.",
  },
  myth_buster: {
    label: "Myth Buster",
    essence: "A widely-believed car myth meets a verifiable mechanic truth.",
  },
};

// ─── Campaign keywords (same approved bank as the Carousel Studio) ──

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

// ─── Archetypes (reel-native story shapes) ─────────────────────────

export type ReelArchetype =
  | "satisfying_loop"
  | "one_second_hook_payoff"
  | "pov_you_are_the_part"
  | "asmr_macro"
  | "myth_vs_reality"
  | "tiny_cinematic_story"
  | "fast_countdown_list"
  | "timelapse_transformation"
  | "caught_on_camera_documentary"
  | "diagnostic_hud_reveal"
  | "cleveland_road_alert"
  | "part_as_character_drama"
  | "silent_film_title_cards"
  | "movie_trailer_energy";

export const REEL_ARCHETYPES: Record<ReelArchetype, { label: string; essence: string }> = {
  satisfying_loop: { label: "Satisfying Loop", essence: "Last frame feeds the first — viewers watch it twice without noticing." },
  one_second_hook_payoff: { label: "1-Second Hook → Payoff", essence: "Frame one earns the next three seconds; the payoff lands before second eight." },
  pov_you_are_the_part: { label: "POV: You Are The Part", essence: "The camera IS the brake pad / tire / battery living its day." },
  asmr_macro: { label: "Oddly Satisfying ASMR Macro", essence: "Extreme close textures and motion that feel good muted." },
  myth_vs_reality: { label: "Myth vs Reality Reveal", essence: "Split-screen belief vs verified truth with a turn moment." },
  tiny_cinematic_story: { label: "Tiny Cinematic Story", essence: "A 15-second three-act film starring a car part." },
  fast_countdown_list: { label: "Fast Countdown / List", essence: "3-2-1 ranked clues with kinetic typography." },
  timelapse_transformation: { label: "Timelapse Transformation", essence: "Wear, rust, or repair compressed into seconds." },
  caught_on_camera_documentary: { label: "Caught-On-Camera Fake Documentary", essence: "Security-cam / dashcam framing for a road villain." },
  diagnostic_hud_reveal: { label: "Diagnostic HUD / Scan-Line Reveal", essence: "Futuristic scanner overlays expose the hidden problem." },
  cleveland_road_alert: { label: "Cleveland Road Survival Alert", essence: "Emergency-broadcast energy for a real local hazard." },
  part_as_character_drama: { label: "Part-As-Character Mini-Drama", essence: "An anthropomorphized part with a want and an obstacle." },
  silent_film_title_cards: { label: "Silent-Film Title Cards", essence: "Black-and-white melodrama with intertitle cards." },
  movie_trailer_energy: { label: "Movie-Trailer Energy", essence: "Epic cuts and title cards for a mundane maintenance truth." },
};

// ─── Motion lenses (visual treatment systems) ──────────────────────

export type MotionLens =
  | "extreme_macro_push_in"
  | "tilt_shift_miniature"
  | "xray_cutaway"
  | "anthropomorphized_object"
  | "surreal_scale"
  | "optical_illusion_morph"
  | "hyperreal_cinematic"
  | "claymation_stop_motion"
  | "blueprint_technical"
  | "neon_retro_futurist"
  | "forensic_evidence_scan"
  | "product_ad_macro"
  | "weather_radar_overlay"
  | "warning_light_world";

/**
 * Each lens carries its OWN generation grammar. Before this, one universal
 * "85mm / shallow depth of field / film grain" quality line was appended to
 * every beat prompt, pulling blueprint, claymation, radar, and neon concepts
 * toward the same glossy AI-commercial look. `grammar` is the language the
 * generator MUST receive for this lens; `avoid` extends the negative prompt
 * with what would break the style.
 */
export const MOTION_LENSES: Record<MotionLens, { label: string; essence: string; grammar: string; avoid: string }> = {
  extreme_macro_push_in: {
    label: "Extreme Macro Push-In", essence: "Slow relentless push into texture until it becomes a landscape.",
    grammar: "Extreme macro lens, tactile texture detail, shallow depth of field, one continuous controlled push-in, studio-grade lighting, photorealistic, 8K detail.",
    avoid: "busy background, wide shot, fast camera movement",
  },
  tilt_shift_miniature: {
    label: "Tilt-Shift Miniature", essence: "The car world as a tiny diorama with miniature crews.",
    grammar: "Tilt-shift miniature effect, strong focal blur band top and bottom, toy-diorama scale cues, bright even daylight, physical model texture.",
    avoid: "full-scale realistic background, cinematic film grain, dark moody lighting",
  },
  xray_cutaway: {
    label: "X-Ray / Cutaway", essence: "See-through layers reveal what the driver can't see.",
    grammar: "Technical x-ray cutaway visualization, translucent layered materials, cool schematic glow, clean dark field, precise engineering aesthetic.",
    avoid: "film grain, bokeh, photorealistic product-ad lighting",
  },
  anthropomorphized_object: {
    label: "Anthropomorphized Object", essence: "Parts with posture, intent, and reactions - no faces needed.",
    grammar: "A real physical part staged with posture and intent through position and motion only, practical scene lighting, photorealistic surfaces.",
    avoid: "cartoon googly eyes, drawn face, mascot suit",
  },
  surreal_scale: {
    label: "Surreal Scale", essence: "A penny the size of a building; a pothole as a canyon.",
    grammar: "Impossible scale contrast rendered physically real, grounded shadows and perspective, epic wide composition, believable materials at the wrong size.",
    avoid: "cartoon rendering, floating objects without shadows",
  },
  optical_illusion_morph: {
    label: "Optical-Illusion Morph", essence: "One object impossibly becomes the next - seamless match cuts.",
    grammar: "Seamless in-camera morph, matched silhouette and lighting between the two subjects, smooth continuous transformation, clean background.",
    avoid: "hard cut, glitch transition, busy background",
  },
  hyperreal_cinematic: {
    label: "Hyperreal Cinematic", essence: "Anamorphic, wet asphalt, practical light - premium film look.",
    grammar: "Award-winning cinematography, 85mm lens, shallow depth of field, anamorphic feel, practical light sources, wet-surface reflections, dramatic high contrast, 35mm film grain texture, photorealistic.",
    avoid: "cartoon texture, flat even lighting",
  },
  claymation_stop_motion: {
    label: "Claymation / Stop-Motion", essence: "Handmade frame-by-frame charm; imperfection is the style.",
    grammar: "Handmade claymation stop-motion, visible clay texture and fingerprints, 12fps stepped cadence, miniature practical set, soft studio shadows, intentionally imperfect motion.",
    avoid: "photorealistic automotive surfaces, smooth 30fps motion, film grain",
  },
  blueprint_technical: {
    label: "Blueprint / Technical", essence: "Drafting lines, callouts, and exploded views that teach.",
    grammar: "Orthographic technical blueprint visualization, flat deep-navy drafting field, precise white linework, exploded component layers, measured callout arrows, flat lighting.",
    avoid: "depth of field, film grain, photographic realism, dramatic shadows",
  },
  neon_retro_futurist: {
    label: "Neon Retro-Futurist", essence: "Synthwave grid, chrome, scan glow - the part as 80s hero.",
    grammar: "Synthwave retro-futurism, neon rim lighting, chrome reflections, glowing grid horizon, scanline glow, saturated magenta-cyan palette against black.",
    avoid: "natural daylight, documentary realism, muted colors",
  },
  forensic_evidence_scan: {
    label: "Forensic Evidence Scan", essence: "UV light, evidence markers, magnified clue passes.",
    grammar: "Forensic evidence examination, fixed locked-off composition, UV sweep lighting passes, numbered evidence markers, dark graphite field, clinical magnification detail.",
    avoid: "glossy product-ad camera moves, warm cozy lighting",
  },
  product_ad_macro: {
    label: "Product-Ad Macro", essence: "Flagship-launch lighting for a humble part on a turntable.",
    grammar: "Premium product commercial, 85mm macro lens, shallow depth of field, studio-grade key lighting on a dark seamless background, slow turntable rotation, ultra-detailed 8K, photorealistic.",
    avoid: "cluttered scene, handheld camera shake",
  },
  weather_radar_overlay: {
    label: "Weather Radar Overlay", essence: "Storm-tracker graphics tracking salt, ice, and pothole season.",
    grammar: "Broadcast weather-radar graphics package, sweeping radar arcs, threat-zone color overlays on a stylized road map, crisp motion-graphics aesthetic.",
    avoid: "cinematic depth of field, film grain, photorealistic street photography",
  },
  warning_light_world: {
    label: "Dashboard Warning-Light World", essence: "Inside the dashboard where warning lights live and work.",
    grammar: "Inside a dark dashboard interior world, glowing indicator lights as inhabitants, deep blacks with amber and red bokeh glow, macro perspective.",
    avoid: "daylight exterior, flat even lighting",
  },
};

// ─── Object characters (faceless cast) ─────────────────────────────

export type ObjectCharacter =
  | "penny_test_inspector"
  | "brake_pad_lifeguard"
  | "tire_pressure_balloonist"
  | "alignment_tightrope_walker"
  | "pothole_gremlin"
  | "tread_channel_water_tunnel"
  | "rust_creeping_villain"
  | "battery_heat_victim"
  | "check_engine_smoke_alarm"
  | "spare_tire_backup_singer"
  | "valve_stem_traffic_controller"
  | "rotor_alarm_bell"
  | "wiper_blade_on_strike"
  | "road_salt_quiet_thief";

export const OBJECT_CHARACTERS: Record<ObjectCharacter, { label: string; essence: string }> = {
  penny_test_inspector: { label: "Penny-Test Inspector", essence: "A penny that audits tread depth like a building inspector." },
  brake_pad_lifeguard: { label: "Brake-Pad Lifeguard", essence: "The pad watches every stop, wearing thinner with each save." },
  tire_pressure_balloonist: { label: "Tire-Pressure Balloonist", essence: "A balloonist whose altitude is your PSI — cold mornings drop it." },
  alignment_tightrope_walker: { label: "Alignment Tightrope Walker", essence: "One pothole and the walker leans forever left." },
  pothole_gremlin: { label: "Pothole Gremlin", essence: "The villain that collects wheel weights and bends rims." },
  tread_channel_water_tunnel: { label: "Tread-Channel Water Tunnel", essence: "Rain evacuates through tread tunnels — until they're shallow." },
  rust_creeping_villain: { label: "Rust, Creeping Villain", essence: "Slow, patient, quiet — rust never hurries and never stops." },
  battery_heat_victim: { label: "Battery, Heat Victim", essence: "Summer cooks it; winter exposes it. The battery remembers." },
  check_engine_smoke_alarm: { label: "Check-Engine Smoke Alarm", essence: "The light is not the diagnosis. It is the smoke alarm." },
  spare_tire_backup_singer: { label: "Spare-Tire Backup Singer", essence: "Forgotten in the trunk, flat on the night of the show." },
  valve_stem_traffic_controller: { label: "Valve-Stem Air Traffic Controller", essence: "Every PSI in and out clears through this tiny tower." },
  rotor_alarm_bell: { label: "Rotor As Alarm Bell", essence: "When pads wear out, the rotor rings the bell you can hear." },
  wiper_blade_on_strike: { label: "Wiper Blade On Strike", essence: "Cracked rubber walks off the job mid-storm." },
  road_salt_quiet_thief: { label: "Road Salt, Quiet Thief", essence: "It pays for traction in metal — invoiced years later." },
};

// ─── Sources (same research standard as the Carousel Studio) ───────

export type SourceKind = "proof" | "pain_point";

export interface SourceNote {
  label: string; // e.g. "NHTSA tire pressure guidance"
  url?: string; // optional — labels are acceptable in V1
  kind: SourceKind; // proof = supports the fact; pain_point = shows people ask
  supports: string; // what claim this source backs
}

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

// ─── Concept / storyboard / brief models ──────────────────────────

export interface ReelConceptScores {
  hook: number; // 0-10 first-frame scroll-stopping power
  truth: number; // 0-10 strength/verifiability of the mechanic fact
  save: number; // 0-10 save/share usefulness
  local: number; // 0-10 Cleveland specificity
  absurdity: number; // 0-10 useful-absurdity as a teaching device
  fit: number; // 0-10 fit with Nick's actual services/voice
}

export const CONCEPT_SCORE_MAX = 60;

export interface ReelConcept {
  id: string;
  hook: string; // the first-second visual/text idea
  coreFact: string;
  factBucket: FactBucket;
  driverEmotion: string;
  campaignKeyword: CampaignKeyword;
  archetype: ReelArchetype;
  motionLens: MotionLens;
  objectCharacter: ObjectCharacter;
  usefulAbsurdity: string;
  localAngle: string;
  beatOutline: string[]; // 4-6 one-line beats
  loopIdea: string; // how the last frame feeds the first
  captionAngle: string;
  saveShareReason: string;
  nickFitReason: string;
  nonGenericReason: string;
  rejectionRisk: string;
  scores: ReelConceptScores;
}

export interface StoryboardBeat {
  beatNumber: number; // 1-based
  startSecond: number;
  endSecond: number;
  visual: string; // what is on screen
  motion: string; // camera/subject movement
  onScreenText: string; // muted-first clarity lives here
  purpose: string; // why this beat exists
  audioCue: string; // sfx/music direction (works muted regardless)
  safeZoneNotes: string; // IG UI safe-zone guidance
}

export interface SafetyFinding {
  severity: "block" | "warn";
  rule: string;
  match: string;
  where: string; // which field/beat
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
  recentArchetypes: string[];
  recentMotionLenses: string[];
  recentObjectCharacters: string[];
  topicRepeated: boolean;
  keywordRepeated: boolean;
  archetypeRepeated: boolean;
  motionLensRepeated: boolean;
  objectCharacterRepeated: boolean;
}

export interface HiggsfieldBeatPrompt {
  beatNumber: number;
  prompt: string;
  negativePrompt: string;
  styleKit: string;
  safeZoneGuidance: string;
}

export interface ReelBrief {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ReelBriefStatus;
  mode: ReelStudioMode;
  isSample?: boolean; // SAMPLE seed briefs are clearly labelled in the UI

  topic: string;
  mechanicTruth: string;
  driverConfusion: string;
  clevelandAngle: string;
  sourceNotes: SourceNote[];

  factBucket: FactBucket;
  campaignKeyword: CampaignKeyword;
  archetype: ReelArchetype;
  motionLens: MotionLens;
  objectCharacter: ObjectCharacter;
  usefulAbsurdity: string;

  concepts: ReelConcept[];
  winningConceptId: string | null;

  storyboardBeats: StoryboardBeat[]; // 4-6 when valid
  promptPack?: HiggsfieldBeatPrompt[]; // neutral naming for clip generator prompt pack
  higgsfieldPromptPack: HiggsfieldBeatPrompt[]; // legacy - one per beat
  ffmpegAssemblyNotes: string;
  voiceoverScript: string; // optional VO — reel must still work muted

  captionHooks: string[];
  selectedCaption: string;
  hashtags: string[];

  avoidedForRepetition: string; // what was deliberately NOT used today

  qualityScore: number; // cached last computation (recompute via calculateReelQualityScore)
  assetPlan: string; // cover frame + file naming plan — text only in V1
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
  { rule: "no-best-claims", pattern: /\bbest\s+in\s+cleveland\b|\b(?:the\s+)?best\b/i, fix: "Show proof (4.9-star, review count) instead of 'best'." },
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
  { rule: "no-your-x-is-broken", pattern: /\byour\s+\w+(?:\s+\w+)?\s+is\s+broken\b/i, fix: "Don't diagnose from a reel — invite a check instead." },
];

export const FEARMONGER_PATTERNS: PatternRule[] = [
  { rule: "no-fear-leverage", pattern: /\bcould\s+kill\b|\bdeath\s*trap\b|\bcatastroph/i, fix: "Teach calmly; the clue is the story, not the fear." },
  { rule: "no-ticking-bomb", pattern: /\btime\s*bomb\b|\bwaiting\s+to\s+(?:explode|fail)\b/i, fix: "Replace doom framing with 'before the bill' framing." },
];

export const GENERIC_MARKETING_PATTERNS: PatternRule[] = [
  { rule: "no-generic-cliche", pattern: /\bhassle.?free\b|\btop.?notch\b|\bstate.of.the.art\b|\bone.stop\s+shop\b/i, fix: "Concrete beats cliché — name the actual thing." },
  { rule: "no-trust-label", pattern: /\btrusted\b|\bexperts?\b(?!\s+say)/i, fix: "Show, don't claim: 4.9-star and 1,685+ reviews do the work." },
];

/** Price-shaped text blocks in reel copy: reels carry NO price claims at all. */
export const PRICE_CLAIM_PATTERN = /\$\s?\d+/;

/** Softer diagnostic language the detectors must ALLOW. */
export const SOFT_DIAGNOSTIC_ALLOWED = [
  "can point to",
  "may indicate",
  "worth checking",
  "one clue",
  "do not guess",
  "stop by and we'll take a look",
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

export function detectForbiddenReelClaims(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(FORBIDDEN_CLAIM_PATTERNS, text, where, "block");
}

export function detectOverdiagnosis(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(OVERDIAGNOSIS_PATTERNS, text, where, "block");
}

export function detectFearmongering(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(FEARMONGER_PATTERNS, text, where, "block");
}

export function detectGenericAdLanguage(text: string, where = "text"): SafetyFinding[] {
  return runPatternBank(GENERIC_MARKETING_PATTERNS, text, where, "warn");
}

/** Reels carry no price claims, period — any $-amount blocks. */
export function detectPriceClaims(text: string, where = "text"): SafetyFinding[] {
  const m = text.match(PRICE_CLAIM_PATTERN);
  if (!m) return [];
  return [
    {
      severity: "block",
      rule: "no-price-in-reel",
      match: m[0],
      where,
      fix: "Reel copy carries no prices. Pricing lives on the website only.",
    },
  ];
}

// ─── Structural validators ─────────────────────────────────────────

export function validateReelLengthTarget(beats: StoryboardBeat[]): { ok: boolean; reason?: string } {
  if (beats.length === 0) return { ok: false, reason: "No beats — cannot compute length" };
  const end = Math.max(...beats.map((b) => b.endSecond));
  if (end < REEL_OUTPUT_RULES.minSeconds)
    return { ok: false, reason: `Reel ends at ${end}s — under the ${REEL_OUTPUT_RULES.minSeconds}s minimum` };
  if (end > REEL_OUTPUT_RULES.maxSeconds)
    return { ok: false, reason: `Reel ends at ${end}s — over the ${REEL_OUTPUT_RULES.maxSeconds}s maximum` };
  return { ok: true };
}

export function validateBeatCount(beats: StoryboardBeat[]): { ok: boolean; reason?: string } {
  if (beats.length < REEL_OUTPUT_RULES.minBeats || beats.length > REEL_OUTPUT_RULES.maxBeats)
    return { ok: false, reason: `Expected ${REEL_OUTPUT_RULES.minBeats}-${REEL_OUTPUT_RULES.maxBeats} beats, got ${beats.length}` };
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (b.beatNumber !== i + 1) return { ok: false, reason: `Beat ${i + 1} has wrong beatNumber ${b.beatNumber}` };
    if (b.endSecond <= b.startSecond) return { ok: false, reason: `Beat ${b.beatNumber} has non-positive duration` };
    if (i > 0 && b.startSecond !== beats[i - 1].endSecond)
      return { ok: false, reason: `Beat ${b.beatNumber} does not start where beat ${i} ends (no gaps/overlaps)` };
  }
  return { ok: true };
}

/** Faceless contract: no human face / talking head / shop tour as the subject. */
export function validateFacelessSubject(texts: string[]): { ok: boolean; reason?: string } {
  for (const t of texts) {
    const m = t.match(FACE_SUBJECT_PATTERN);
    if (m) return { ok: false, reason: `Faceless rule violated by "${m[0]}" — recast with an object character` };
  }
  return { ok: true };
}

/** Muted-first clarity: every beat must carry on-screen text that teaches without audio. */
export function validateMutedFirstClarity(beats: StoryboardBeat[]): { ok: boolean; reason?: string } {
  if (beats.length === 0) return { ok: false, reason: "No beats" };
  const silent = beats.filter((b) => !b.onScreenText.trim());
  if (silent.length > 0)
    return { ok: false, reason: `Beat(s) ${silent.map((b) => b.beatNumber).join(", ")} have no on-screen text — the reel must teach muted` };
  return { ok: true };
}

/** Loop plan: a non-empty loop idea on the winning concept. */
export function validateLoopPlan(loopIdea: string): { ok: boolean; reason?: string } {
  if (!loopIdea.trim()) return { ok: false, reason: "No loop plan — describe how the last frame feeds the first" };
  return { ok: true };
}

export function validateCampaignKeyword(keyword: string): { ok: boolean; reason?: string } {
  if (!/^[A-Z]+$/.test(keyword)) return { ok: false, reason: "Keyword must be a single ALL-CAPS word" };
  if (!(CAMPAIGN_KEYWORDS as readonly string[]).includes(keyword))
    return { ok: false, reason: `"${keyword}" is not in the approved keyword list` };
  return { ok: true };
}

export function validateSourceGrounding(brief: Pick<ReelBrief, "sourceNotes" | "mechanicTruth">): {
  ok: boolean;
  reason?: string;
} {
  const proof = brief.sourceNotes.filter((s) => s.kind === "proof");
  if (proof.length === 0) return { ok: false, reason: "Needs at least one PROOF source for the mechanic truth" };
  if (!brief.mechanicTruth.trim()) return { ok: false, reason: "Mechanic truth is empty" };
  return { ok: true };
}

/**
 * Attests that THIS pure module performs no external calls (no network, storage,
 * or process execution). It does NOT attest about consumers: the Studio page and
 * server procs DO generate assets and publish. Live reel publishing is gated
 * server-side by REEL_PUBLISH_ENABLED (default OFF) + full claim-safety
 * (server/services/socialPublish.ts) — this is not a publish kill-switch.
 */
export function validateNoExternalSideEffects(): { ok: true; attestation: string } {
  return {
    ok: true,
    attestation:
      "This pure module performs no external calls. Its consumers generate assets and publish; live reel publishing is gated server-side by REEL_PUBLISH_ENABLED (default off) plus full claim-safety.",
  };
}

// ─── Scoring ───────────────────────────────────────────────────────

export const STUDIO_DEFAULTS = {
  conceptMinScore: 57, // of 60 — same bar as the Carousel Studio
  qualityMinScore: 70, // of 75
} as const;

export function scoreReelConcept(c: ReelConcept): { total: number; max: number; passing: boolean; min: number } {
  const s = c.scores;
  const clamp = (n: number) => Math.max(0, Math.min(10, n));
  const total = clamp(s.hook) + clamp(s.truth) + clamp(s.save) + clamp(s.local) + clamp(s.absurdity) + clamp(s.fit);
  return { total, max: CONCEPT_SCORE_MAX, passing: total >= STUDIO_DEFAULTS.conceptMinScore, min: STUDIO_DEFAULTS.conceptMinScore };
}

export interface QualityScorePart {
  label: string;
  points: number;
  max: number;
  ok: boolean;
  detail: string;
}

export interface QualityScoreResult {
  overall: number;
  gate: "pass" | "block";
  reasoning: string[];
  parts: QualityScorePart[];
  passing: boolean;
}

function allBriefText(brief: ReelBrief): { text: string; where: string }[] {
  return [
    ...brief.storyboardBeats.map((b) => ({ text: `${b.visual}\n${b.onScreenText}`, where: `beat ${b.beatNumber}` })),
    { text: brief.voiceoverScript, where: "voiceover" },
    { text: brief.selectedCaption, where: "caption" },
    ...brief.captionHooks.map((h, i) => ({ text: h, where: `caption hook ${i + 1}` })),
  ];
}

export function runSafetyChecks(brief: ReelBrief, now: () => string = () => new Date().toISOString()): SafetyReport {
  const findings: SafetyFinding[] = [];
  for (const { text, where } of allBriefText(brief)) {
    findings.push(
      ...detectForbiddenReelClaims(text, where),
      ...detectOverdiagnosis(text, where),
      ...detectFearmongering(text, where),
      ...detectPriceClaims(text, where),
      ...detectGenericAdLanguage(text, where),
    );
  }
  const faceless = validateFacelessSubject([
    ...brief.storyboardBeats.map((b) => b.visual),
    ...brief.higgsfieldPromptPack.map((p) => p.prompt),
  ]);
  if (!faceless.ok) {
    findings.push({ severity: "block", rule: "no-human-face", match: faceless.reason ?? "face subject", where: "storyboard/prompts", fix: "Recast the beat with an object character — the format is faceless." });
  }
  return { findings, blocked: findings.some((f) => f.severity === "block"), checkedAt: now() };
}

export function calculateReelQualityScore(brief: ReelBrief, minScore: number = STUDIO_DEFAULTS.qualityMinScore): QualityScoreResult {
  const safety = runSafetyChecks(brief, () => "scored");
  const beatsOk = validateBeatCount(brief.storyboardBeats).ok;
  const lengthOk = validateReelLengthTarget(brief.storyboardBeats).ok;
  const mutedOk = validateMutedFirstClarity(brief.storyboardBeats).ok;
  const kwOk = validateCampaignKeyword(brief.campaignKeyword).ok;
  const srcOk = validateSourceGrounding(brief).ok;
  const winner = brief.concepts.find((c) => c.id === brief.winningConceptId) ?? null;
  const loopOk = winner ? validateLoopPlan(winner.loopIdea).ok : false;
  const hardBlocks = safety.findings.filter((f) => f.severity === "block");
  const faceBlocks = hardBlocks.filter((f) => f.rule === "no-human-face");
  const claimBlocks = hardBlocks.filter((f) => f.rule !== "no-human-face");
  const firstBeat = brief.storyboardBeats[0];
  const hookOk = !!firstBeat && firstBeat.startSecond === 0 && !!firstBeat.visual.trim() && !!firstBeat.onScreenText.trim();

  const parts: QualityScorePart[] = [
    { label: "First-frame scroll-stop", max: 10, ok: hookOk, points: hookOk ? 10 : 0, detail: hookOk ? "Beat 1 opens at 0s with visual + text" : "Beat 1 must open at 0s with a visual and on-screen text" },
    { label: "Muted-first clarity", max: 10, ok: mutedOk, points: mutedOk ? 10 : 0, detail: mutedOk ? "Every beat teaches without audio" : "Beats missing on-screen text" },
    { label: `${REEL_OUTPUT_RULES.minBeats}-${REEL_OUTPUT_RULES.maxBeats} beats, contiguous`, max: 5, ok: beatsOk, points: beatsOk ? 5 : 0, detail: beatsOk ? "Beat structure valid" : "Beat structure invalid" },
    { label: `${REEL_OUTPUT_RULES.minSeconds}-${REEL_OUTPUT_RULES.maxSeconds} second target`, max: 5, ok: lengthOk, points: lengthOk ? 5 : 0, detail: lengthOk ? "Length in band" : "Length out of band" },
    { label: "Loop plan", max: 5, ok: loopOk, points: loopOk ? 5 : 0, detail: loopOk ? "Last frame feeds the first" : "No loop plan on winning concept" },
    { label: "Verified mechanic fact (sourced)", max: 10, ok: srcOk, points: srcOk ? 10 : 0, detail: srcOk ? "Proof source present" : "Needs a proof source" },
    { label: "Faceless contract", max: 10, ok: faceBlocks.length === 0, points: faceBlocks.length === 0 ? 10 : 0, detail: faceBlocks.length === 0 ? "No face/talking-head subjects" : "Face subject detected" },
    { label: "Claim safety (no blocked claims)", max: 10, ok: claimBlocks.length === 0, points: claimBlocks.length === 0 ? 10 : 0, detail: claimBlocks.length === 0 ? "No blocked claims" : `${claimBlocks.length} blocked claim(s)` },
    { label: "Campaign keyword valid", max: 5, ok: kwOk, points: kwOk ? 5 : 0, detail: brief.campaignKeyword },
    { label: `Winning concept >= ${STUDIO_DEFAULTS.conceptMinScore}/60`, max: 5, ok: !!(winner && scoreReelConcept(winner).passing), points: winner && scoreReelConcept(winner).passing ? 5 : 0, detail: winner ? `${scoreReelConcept(winner).total}/60` : "No winning concept" },
  ];
  const score = parts.reduce((a, p) => a + p.points, 0);
  const passing = score >= minScore;
  const reasoning = parts.filter(p => !p.ok).map(p => p.detail);
  const gate = passing ? "pass" as const : "block" as const;
  return { overall: score, gate, reasoning, parts, passing };
}

// ─── Repetition / content-memory checks (manual import in V1) ──────

export function buildRepetitionChecks(
  brief: Pick<ReelBrief, "topic" | "campaignKeyword" | "archetype" | "motionLens" | "objectCharacter">,
  recent: { topics: string[]; keywords: string[]; archetypes: string[]; motionLenses: string[]; objectCharacters: string[] },
): RepetitionChecks {
  const norm = (s: string) => s.trim().toLowerCase();
  return {
    recentTopics: recent.topics,
    recentKeywords: recent.keywords,
    recentArchetypes: recent.archetypes,
    recentMotionLenses: recent.motionLenses,
    recentObjectCharacters: recent.objectCharacters,
    topicRepeated: recent.topics.map(norm).includes(norm(brief.topic)),
    keywordRepeated: recent.keywords.map((k) => k.toUpperCase()).includes(brief.campaignKeyword),
    archetypeRepeated: recent.archetypes.map(norm).includes(norm(brief.archetype)),
    motionLensRepeated: recent.motionLenses.map(norm).includes(norm(brief.motionLens)),
    objectCharacterRepeated: recent.objectCharacters.map(norm).includes(norm(brief.objectCharacter)),
  };
}

// ─── Prompt pack / checklists (pure builders, copy-paste outputs) ──

/**
 * One shared VISUAL CONTINUITY block, inserted verbatim into EVERY beat prompt.
 * Each beat is an independent generation call with no shared seed or reference
 * frame, so the only continuity tool we have is the prompt itself: anchor every
 * call to the same hero subject (beat 1's visual), the same palette, and the
 * same invariants. Deterministic - derived from the brief, no LLM call.
 */
export function buildReelContinuityBlock(brief: Pick<ReelBrief, "storyboardBeats" | "objectCharacter" | "motionLens">): string {
  const character = OBJECT_CHARACTERS[brief.objectCharacter];
  const heroAnchor = brief.storyboardBeats[0]?.visual.trim() || character.essence;
  return [
    `VISUAL CONTINUITY (identical in every shot of this reel):`,
    `Hero subject: ${character.label} - ${character.essence} First established as: ${heroAnchor}`,
    `Palette: graphite black and deep shadow tones with gold #FDB913 accent highlights.`,
    `Same hero object design, same environment, same lighting direction, and same weather in every shot.`,
    `Never change the hero object's shape, tread/surface pattern, damage location, or color between shots.`,
  ].join("\n");
}

export function buildHiggsfieldReelPromptPack(brief: ReelBrief): HiggsfieldBeatPrompt[] {
  const lens = MOTION_LENSES[brief.motionLens];
  const character = OBJECT_CHARACTERS[brief.objectCharacter];
  const continuity = buildReelContinuityBlock(brief);
  const beats = brief.storyboardBeats;
  return beats.map((b, i) => {
    // Source clips are ALWAYS 4s (Seedance fixed duration); assembly trims each
    // beat to its storyboard length. The prompt must speak the renderer TRUTH:
    // a 4s source of which only the first trimDurationSec survives - the old
    // "clip, 2.5s" line contradicted the actual generation and actions ran long.
    const trimDurationSec = Math.min(4, Math.max(0.8, b.endSecond - b.startSecond));
    const settleSec = Math.min(0.6, trimDurationSec * 0.2);
    const actionCompleteBySec = Number((trimDurationSec - settleSec).toFixed(1));
    const prev = i > 0 ? beats[i - 1] : null;
    const isLast = i === beats.length - 1;
    return {
      beatNumber: b.beatNumber,
      prompt: [
        `Vertical 9:16 cinematic clip. Generate a four-second source clip; the final edit uses only the first ${trimDurationSec.toFixed(1)} seconds.`,
        `Subject: ${b.visual}`,
        `Character energy: ${character.label} - ${character.essence}`,
        `Motion: ${b.motion}`,
        `Style: ${lens.label} - ${lens.essence}`,
        `Style grammar: ${lens.grammar}`,
        continuity,
        // Transition intent: source clips are fixed-length; the story action must
        // land inside the clip, and adjacent shots must hand off composition.
        prev
          ? `Opening frame: continue directly from the previous shot - the hero object in the same state and position it settled in (previous shot ended on: ${prev.visual})`
          : `Opening frame: strongest possible first frame - the hero object clearly readable at a glance.`,
        `Timing: complete the primary action by ${actionCompleteBySec} seconds; keep every frame after that visually stable${isLast ? ", settled on a frame that echoes the opening shot for a seamless loop" : ", ready for a match cut into the next shot"}.`,
        `No humans, no faces, no hands, no readable shop signage.`,
        `Leave the top 12% and bottom 20% of frame clear for IG UI; key action center-frame.`,
      ].join("\n"),
      negativePrompt:
        `human face, person, hands, talking head, text artifacts, warped letters, watermark, logo, low-res, extra fingers, plastic glow, oversaturated AI look, warped engine parts, ${lens.avoid}`,
      styleKit: `${lens.label} + ${REEL_ARCHETYPES[brief.archetype].label}`,
      safeZoneGuidance: b.safeZoneNotes || "Keep critical visuals out of the top 12% / bottom 20% IG UI zones.",
    };
  });
}

export interface ChecklistItem {
  label: string;
  ok: boolean | null; // null = pending / manual
  detail: string;
}

export function buildFfmpegChecklist(brief: ReelBrief): ChecklistItem[] {
  const beats = brief.storyboardBeats;
  const end = beats.length ? Math.max(...beats.map((b) => b.endSecond)) : 0;
  return [
    { label: "Output container/codec", ok: null, detail: `${REEL_OUTPUT_RULES.codec}, ${REEL_OUTPUT_RULES.pixelFormat}, ${REEL_OUTPUT_RULES.fps}fps, ${REEL_OUTPUT_RULES.resolution}, +faststart` },
    { label: "Clip count matches beats", ok: null, detail: `${beats.length} beat clip(s) expected from Higgsfield` },
    { label: "Total duration in band", ok: end >= REEL_OUTPUT_RULES.minSeconds && end <= REEL_OUTPUT_RULES.maxSeconds, detail: `Storyboard ends at ${end}s (target ${REEL_OUTPUT_RULES.minSeconds}-${REEL_OUTPUT_RULES.maxSeconds}s)` },
    { label: "Kinetic density", ok: null, detail: "A cut, push, or text change every 1.5-2.5s — no static stretches" },
    { label: "On-screen text legible at arm's length", ok: null, detail: "Manual check on a phone before export" },
    { label: "Audio mix", ok: null, detail: brief.voiceoverScript.trim() ? "VO under music; -14 LUFS target; reel must still teach muted" : "Music/SFX only; reel teaches muted by design" },
    { label: "Cover frame", ok: null, detail: brief.assetPlan.trim() || "Pick the strongest face-free frame; export 1080x1920 JPEG" },
    { label: "Example command shape", ok: null, detail: "ffmpeg -i beats.concat -c:v libx264 -pix_fmt yuv420p -r 30 -movflags +faststart out.mp4 (NOT executed by this Studio)" },
  ];
}

export function buildInstagramPublishChecklist(brief: ReelBrief): ChecklistItem[] {
  const safety = runSafetyChecks(brief, () => "checklist");
  const reps = brief.avoidedForRepetition;
  return [
    { label: "Verified fact with source", ok: validateSourceGrounding(brief).ok, detail: "Proof source attached" },
    { label: "Quality gate passing", ok: calculateReelQualityScore(brief).passing, detail: `${calculateReelQualityScore(brief).overall}/75` },
    { label: "No blocked claims", ok: !safety.blocked, detail: safety.blocked ? `${safety.findings.filter((f) => f.severity === "block").length} block(s)` : "Clean" },
    { label: "Faceless verified on FINAL render", ok: null, detail: "Manual frame-scrub after Higgsfield render — heuristics are not eyes" },
    { label: "Caption keyword CTA present", ok: brief.selectedCaption.includes(brief.campaignKeyword), detail: `DM/comment "${brief.campaignKeyword}"` },
    { label: "Caption ASCII-safe", ok: /^[\x20-\x7E\n]*$/.test(brief.selectedCaption), detail: "Plain characters only — IG strips exotic glyphs" },
    { label: "Hashtags 3-12", ok: brief.hashtags.length >= 3 && brief.hashtags.length <= 12, detail: `${brief.hashtags.length} tags` },
    { label: "Keyword/topic not repeated recently", ok: reps ? true : null, detail: reps ? `Avoided: ${reps}` : "Paste recent log in Content Memory panel" },
    { label: "Posting from correct account", ok: null, detail: `${STUDIO_BRAND.handle} — manual check` },
    { label: "Facebook cross-post OFF", ok: null, detail: "Manual check in IG composer" },
    { label: "Manual operator review", ok: null, detail: "A human watches the full reel before posting" },
    { label: "Publish button", ok: PUBLISH_ENABLED, detail: PUBLISH_ENABLED ? "Live — publishing is server-gated (REEL_PUBLISH_ENABLED + claim-safety)" : DISABLED_REASON },
  ];
}

export function buildArchiveChecklist(brief: ReelBrief): ChecklistItem[] {
  return [
    { label: "Reel MP4 archived", ok: null, detail: "Save final MP4 + cover frame to the content archive" },
    { label: "Log entry written", ok: null, detail: "Topic, fact, keyword, archetype, motion lens, object character, date" },
    { label: "Instagram URL recorded", ok: brief.instagramUrl ? true : null, detail: brief.instagramUrl ?? "Fill after MANUAL publish" },
    { label: "Repetition memory updated", ok: null, detail: "Add this reel's topic/keyword/archetype/lens/character to the recent list" },
    { label: "Brief archived", ok: null, detail: "Keep the full brief with the asset for the future DB-backed memory" },
  ];
}

// ─── Gates (single source for the UI's disabled buttons) ──────────

export function canPublish(): { ok: false; reason: string } | { ok: true } {
  if (!PUBLISH_ENABLED) return { ok: false, reason: DISABLED_REASON };
  return { ok: true };
}

export function canGenerateVideo(): { ok: false; reason: string } | { ok: true } {
  if (!GENERATION_ENABLED) return { ok: false, reason: DISABLED_REASON };
  return { ok: true };
}

export function canAssembleMp4(): { ok: false; reason: string } | { ok: true } {
  if (!GENERATION_ENABLED) return { ok: false, reason: DISABLED_REASON };
  return { ok: true };
}

export function canReadInsights(): { ok: false; reason: string } | { ok: true } {
  if (!INSIGHTS_ENABLED) return { ok: false, reason: DISABLED_REASON };
  return { ok: true };
}
