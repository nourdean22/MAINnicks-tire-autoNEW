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

import {
  runDuaGate,
  runDuaBriefChecks,
  type DuaConcept,
  type DuaFinding,
} from "@shared/dua";
import { askLeakageProblem } from "@shared/reelAsk";
import { checkEditorialContract } from "@shared/editorialContract";
import { declaredBeatSource, shotRouteProblems, type ShotSource } from "@shared/shotRouter";
import { beatAllowsHands, parsePresenceProfile, type CaptionStyle, type PresenceProfile } from "@shared/reelSourceProfile";
import { classifyHookGrammar, saturatedHookGrammar } from "@shared/reelHookGrammar";
import { BUSINESS } from "@shared/business";

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
// Review rating/count read from the BUSINESS SSOT (2026-10-01): the copy this
// file carried had drifted from the live floor; the drift canary in
// server/brandTruth.test.ts now fails on any literal review count here.

export const STUDIO_BRAND = {
  name: "Nick's Tire & Auto",
  handle: "@nicks_tire_euclid",
  website: "nickstire.org",
  address: "17625 Euclid Ave, Cleveland, OH 44112",
  phone: "(216) 862-0005",
  reputation: `${BUSINESS.reviews.rating}-star local reputation`,
  reviews: `${BUSINESS.reviews.countDisplay} Google reviews`,
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
  /**
   * ACCEPTANCE ceiling for the storyboard, raised 22 -> 35 on 2026-09-07 by operator
   * decision: 95 of the 99 rotating packs are authored at 25-35s and were being refused
   * by `validateReelLengthTarget` alone.
   *
   * IT IS NOT A RENDER CAPABILITY. `maxClipSeconds` below is what the pipeline can
   * actually put on screen, and it is the smaller number. A storyboard may DECLARE 35s;
   * assembly still clamps every beat to a real clip, so the finished video is
   * `beats x maxClipSeconds + SAVE freeze`. Budget narration against THAT, never this.
   */
  maxSeconds: 35,
  /**
   * Longest real footage one beat can carry — provider clips render at ~4s, and
   * `briefToSegments` clamps to it (`reelAssembly.ts`, which imports this value so the
   * two cannot drift; `reelRenderBudget.test.ts` asserts the import).
   *
   * Padding a beat past its source clip does not buy motion, it FREEZES the last frame:
   * the 2026-07-17 incident shipped a 25s container holding 72 unique frames — "one
   * image the whole time".
   */
  maxClipSeconds: 4,
  /**
   * The finished frame is held this long after the last beat (the SAVE card).
   *
   * It is part of the VIDEO: `reelAssembly` computes `videoTotal = beats +
   * saveFreezeSeconds` and trims the voice track to THAT, so narration may run
   * into the freeze without being cut. Talking over the end card is a CREATIVE
   * problem (the contract says narration should land before it); being cut off
   * mid-sentence is a RENDER problem. Those are different thresholds, three
   * seconds apart, and conflating them made the first draft of the voiceover
   * gate refuse every pack in the rotation.
   */
  saveFreezeSeconds: 3,
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
 *
 * Limbs (gloved/bare hands, arms, fingers) are included because prod reel
 * 690001 rendered gloved hands even though the subject was an object — a beat
 * whose action verb casts hands as the actor ("gloved hands lift the rotor")
 * has to be caught at design time, not just hinted at in the negative prompt.
 * Bare hand/arm/finger tokens are scoped to a human cue so a metaphor like
 * "the tire hands off to the next shot" does not false-positive; "glove" and
 * an explicit action ("hands install/torque…") are human enough to block.
 */
const FACE_SUBJECT_PATTERN =
  /\b(?:human\s+face|person'?s?\s+face|talking\s+head|man|woman|mechanic\s+(?:smiling|talking|speaking|on\s+camera)|customer\s+(?:smiling|talking|face)|selfie|presenter|spokesperson|face\s+to\s+camera|shop\s+tour|glove[ds]?|gloved\s+hands?|(?:human|bare|mechanic'?s?)\s+(?:hand|arm|finger)s?|hands?\s+(?:hold|grip|grab|lift|install|torque|wrench|turn|reach|place|wipe|point)\w*)\b/i;

/**
 * Beat visuals that structurally REQUIRE the generator to render readable
 * text/brand/readouts. Seedance cannot spell — any word, number, gauge
 * reading, screen readout, badge, sign, or logo written into a beat comes
 * back garbled (prod reel 690001 shipped a fake "FTD913" battery readout and
 * a "Nixs" logo exactly this way). This is the design-time gate: a beat that
 * depends on the viewer READING something is disqualified before it ever
 * reaches Seedance. The gold caption is an ffmpeg overlay added AFTER
 * generation, so it is not affected — only content the generator would draw.
 * NOTE: runs over beat visual + motion (author-designed), never the compiled
 * prompt, which itself contains the clean-scene directive's own "no logos /
 * no text" wording and would self-trigger.
 */
const IN_FRAME_TEXT_PATTERN =
  /\b(?:logo|signage|billboard|brand\s+name|branded|branding|nick'?s|watermark|readout|read-out|screen\s+(?:show|display|read)\w*|monitor\s+(?:show|display)\w*|gauge\s+(?:show|read|display)\w*|dial\s+read\w*|scanner\s+(?:show|display|read)\w*|diagnostic\s+(?:tester|screen|readout)|dashboard\s+(?:text|read)\w*|license\s+plate|number\s+plate|part\s+number|serial\s+number|(?:label|text|words?|letters?|numbers?|caption)\s+(?:that\s+)?(?:read|say|spell|show)\w*|title\s+card|intertitle)\b/i;

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
    grammar: "Orthographic technical blueprint visualization, flat deep-navy drafting field, precise white linework, exploded component layers, measured callout arrows, flat lighting. Render callouts as bare arrows and marker dots only — no legible letters or numbers; any labels are added as ffmpeg overlays after generation.",
    avoid: "depth of field, film grain, photographic realism, dramatic shadows",
  },
  neon_retro_futurist: {
    label: "Neon Retro-Futurist", essence: "Synthwave grid, chrome, scan glow - the part as 80s hero.",
    grammar: "Synthwave retro-futurism, neon rim lighting, chrome reflections, glowing grid horizon, scanline glow, saturated magenta-cyan palette against black.",
    avoid: "natural daylight, documentary realism, muted colors",
  },
  forensic_evidence_scan: {
    label: "Forensic Evidence Scan", essence: "UV light, evidence markers, magnified clue passes.",
    grammar: "Forensic evidence examination, fixed locked-off composition, UV sweep lighting passes, plain evidence marker dots, dark graphite field, clinical magnification detail. Markers are bare dots and tape only — no legible letters or numbers; any labels are added as ffmpeg overlays after generation.",
    avoid: "glossy product-ad camera moves, warm cozy lighting",
  },
  product_ad_macro: {
    label: "Product-Ad Macro", essence: "Flagship-launch lighting for a humble part on a turntable.",
    grammar: "Premium product commercial, 85mm macro lens, shallow depth of field, studio-grade key lighting on a dark seamless background, slow turntable rotation, ultra-detailed 8K, photorealistic.",
    avoid: "cluttered scene, handheld camera shake",
  },
  weather_radar_overlay: {
    label: "Weather Radar Overlay", essence: "Storm-tracker graphics tracking salt, ice, and pothole season.",
    grammar: "Broadcast weather-radar graphics package, sweeping radar arcs, threat-zone color overlays on a stylized road map, crisp motion-graphics aesthetic. Keep the map and radar abstract — no legible place names, letters, or numbers; any labels are added as ffmpeg overlays after generation.",
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
  | "road_salt_quiet_thief"
  | "plain_part";

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
  // No persona (2026-10-08). The approved-pack lane used to give every Reel
  // "Rust, Creeping Villain", so a penny test or a TPMS light went to the video
  // model with rust as its hero. A pack's beats already describe the real part;
  // this lets beat 1's visual be the hero, as the continuity block anchors it.
  plain_part: { label: "The Part Itself", essence: "The real component, shown plainly as it is: its true material, wear and scale." },
};

/**
 * The persona a brief's hero carries, or null for plain_part: a pack Reel names
 * no persona anywhere a model reads it. Its continuity anchor is beat 1's visual
 * alone, there is no "Character energy" line, and the vision critic is told
 * there is no persona (renderedQa.heroForCritic). Some packs open on a scene,
 * not a part (a dashboard, a highway through the windshield), so even
 * "The Part Itself" would mislabel them; their anchor is that opening scene,
 * as before.
 */
export function heroPersona(key: ObjectCharacter): { label: string; essence: string } | null {
  return key === "plain_part" ? null : OBJECT_CHARACTERS[key];
}


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
  // U.S. Tire Manufacturers Association — the industry's own repair standard
  // (tread-only, 1/4-inch limit, demount-and-inspect, plug+patch). Added
  // 2026-09-08 after its page passed the registry's extractor test; backed by
  // the `ustma_tire_repair` record in server/services/evidenceResolver.ts.
  "USTMA",
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
  /**
   * The source this beat is produced from (shot router, 2026-10-08): real
   * footage, a deterministic card/diagram, an approved still with motion, or
   * an AI shot labelled illustrative. Optional — the 196 committed packs
   * predate it, and the proof packs declare it in the leading REAL /
   * DETERMINISTIC tag of `visual` as well. Preflight only checks that a
   * declared source does not contradict what the beat claims to show; the
   * provider pick does not honour it yet (doctrine §8).
   */
  source?: ShotSource;
  /**
   * For a beat declared real (2026-10-09): the media_assets.id of the captured
   * clip to bind. The pipeline verifies the row is real_shop video and binds its
   * exact bytes (server/services/realShotBinding.ts); a URL never self-asserts.
   */
  realAssetId?: string;
  /** For a beat declared deterministic: the label lines the local card draws (server/services/deterministicCard.ts). */
  cardLines?: string[];
  /** Higgsfield API request already submitted; resume polling after ambiguity. */
  higgsfieldRequestId?: string;
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
  /** Milestone 5: per-beat provider-scene compile status. "corrected" means a
   *  text/faceless risk was detected in the beat and a deterministic corrective
   *  clause was applied to the provider Subject. Consumed by M10's preflight. */
  sceneStatus?: "clean" | "corrected";
  /** the reasons a correction was applied (empty when clean) */
  sceneFindings?: string[];
  /** Milestone 8: the conditioning strategy these prompts were compiled for. */
  conditioningMode?: ConditioningMode;
}

/**
 * THE PALETTE EACH LENS ACTUALLY WANTS.
 *
 * One hardcoded line - "graphite black and deep shadow tones with gold #FDB913
 * accent highlights" - was pushed into the continuity block of EVERY autonomous
 * reel. Two problems, and the second is worse than the first.
 *
 * MONOTONY: 166 produced packs, and the corpus is visually interchangeable. A
 * distinctive brand asset used as the ground instead of an accent stops being
 * distinctive; it just becomes the only thing the account looks like.
 *
 * CONTRADICTION: it fought the lens grammar it was printed beside.
 * xray_cutaway asks for "cool schematic glow, clean dark field"; blueprint_
 * technical asks for a drafting field; tilt_shift_miniature asks for "bright
 * even daylight". The palette line then demanded deep shadow and gold over all
 * three. The generator received two instructions and split the difference,
 * which is the reliable way to make everything look like the same murky
 * AI-commercial render.
 *
 * Nick yellow (#FDB913) survives in every world - as an ACCENT, the 5-15% it
 * should have been. The brand code stays; the mood changes.
 */
export const LENS_PALETTES: Record<MotionLens, string> = {
  extreme_macro_push_in: "deep graphite and black field, one hard key light raking the surface, gold #FDB913 only as a rim accent on the hero edge.",
  tilt_shift_miniature: "bright even daylight, clean saturated model-shop colours, gold #FDB913 as a single prop or marker accent.",
  xray_cutaway: "cool schematic blue-white on a clean dark field, translucent layers, gold #FDB913 reserved for the one annotated detail.",
  anthropomorphized_object: "practical shop lighting on neutral concrete, warm tungsten pools, gold #FDB913 accent on one prop.",
  surreal_scale: "epic natural light with grounded shadows, palette taken from the real environment, gold #FDB913 as the single human-made accent.",
  optical_illusion_morph: "flat even lighting and high-contrast graphic colour so the morph reads, gold #FDB913 as one of two dominant tones.",
  hyperreal_cinematic: "deep graphite and shadow, controlled highlight roll-off, gold #FDB913 rim light - the premium world.",
  claymation_stop_motion: "soft toy-set lighting, matte plasticine colour, visible fingerprints, gold #FDB913 as a moulded accent.",
  blueprint_technical: "drafting blue and paper white, precise line weight, gold #FDB913 for the one callout that matters.",
  neon_retro_futurist: "magenta and cyan neon on wet black, chrome reflections, gold #FDB913 as the warm third light.",
  forensic_evidence_scan: "controlled dark field with one narrow inspection beam, evidence-table neutrality, gold #FDB913 on the marker only.",
  product_ad_macro: "seamless studio sweep, soft box gradient, restrained gold #FDB913 rim - the catalogue world.",
  weather_radar_overlay: "cold grey-blue Cleveland daylight, wet asphalt sheen, gold #FDB913 as the alert colour.",
  warning_light_world: "near-black cabin dark with amber instrument glow, gold #FDB913 as the warning source itself.",
};

/**
 * Nick yellow is a DISTINCTIVE ASSET, not a filter. It must appear in every
 * reel and dominate almost none of them.
 */
export const BRAND_ACCENT_RULE =
  "Nick yellow #FDB913 appears as a deliberate accent on roughly 5-15% of the frame - one edge, one marker, one light source. It is never a global colour cast or a full-field wash.";

export const VISUAL_WORLD_STYLES = ["safe", "bold", "experimental"] as const;
export type VisualWorldStyle = (typeof VISUAL_WORLD_STYLES)[number];

/** An approved reference frame + the invariants every clip must match. The
 *  frame itself conditions generation only where the video model supports an
 *  input image (NOT verified for seedance1_5 — probing the model schema
 *  rotates the prod CLI session); until then the lock is enforced through
 *  the compiled invariant text in every beat prompt. */
export interface ReelVisualWorld {
  style: VisualWorldStyle;
  heroFrameUrl: string;
  /** the exact prompt that produced the approved frame */
  framePrompt: string;
  /** compiled invariant block inserted into every beat prompt */
  lockedInvariants: string;
}

/**
 * The single ask a reel is allowed to burn into its end card. Declared on the
 * brief so a payload review shows everything the viewer will see - see
 * shared/reelAsk.ts and shared/reelTextSurfaces.ts. Undeclared renders NO card.
 */
export type ReelBriefAsk = { kind: "profile" | "dm" | "save" | "visit"; keyword?: string | null };

export interface ReelBrief {
  /** Declared end-card ask. New briefs default to `profile`; `dm` is opt-in. */
  ask?: ReelBriefAsk;
  /**
   * Which social_reel_patterns row this brief was built on, when Pattern Lab
   * supplied a structure. This is the cohort key the pattern table was shaped
   * for — its own schema comment promised "future cohort joins (pattern x trial
   * results)" — and which never existed, so nothing could ask which captured
   * structure actually earned distribution. It rides the brief into
   * reel_jobs.payload; joining it against ig_metric_snapshots is what turns
   * rotation into ranking later.
   */
  structurePatternId?: string;
  /**
   * Source-aware production (2026-10-09, shared/reelSourceProfile.ts). Absent
   * means the legacy contract: object-only presence, uppercase captions.
   * `hands_only_real` admits real hands/tools ONLY on beats declared real;
   * faces stay blocked everywhere and generated beats keep the object-only rule.
   */
  presenceProfile?: PresenceProfile;
  captionStyle?: CaptionStyle;
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
  /** Authored Delightfully Useful Absurdity concept. OPTIONAL on purpose: this
   *  model postdates every existing brief, so absence must not break them. When
   *  present, `runReelPreflight` runs the FULL DUA gate at block severity; when
   *  absent it falls back to the lossy derived checks. Authoring one is what
   *  buys the strong guarantee. */
  dua?: DuaConcept;

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

  /** Approved visual world (reference frame + locked invariants) — when set,
   *  the continuity block in EVERY beat prompt locks to it. Optional: briefs
   *  without one keep the standard brief-derived continuity block. */
  visualWorld?: ReelVisualWorld;

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
  { rule: "no-trust-label", pattern: /\btrusted\b|\bexperts?\b(?!\s+say)/i, fix: `Show, don't claim: ${BUSINESS.reviews.rating}-star and ${BUSINESS.reviews.countDisplay} reviews do the work.` },
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

/**
 * A first-person shop observation stated as a statistic is UNVERIFIABLE and the
 * model invents them. Live capture (reel 1200004, 2026-07-31): the generator
 * wrote "In Cleveland, we see zero salt-related brake seizures" — fabricated,
 * and backwards (road salt seizing calipers is a common Cleveland failure). It
 * cleared every existing gate, because the claim bank checks for guarantees,
 * prices and fearmongering, not for whether an assertion is TRUE.
 *
 * We cannot fact-check a claim here. What we CAN do deterministically is refuse
 * the shape that carries fabrications: OUR OWN shop's experience quantified as
 * an absolute ("we see zero…", "we've never had…", "9 out of 10 of our…").
 *
 * Deliberately narrow — it matches first-person subjects ONLY. Impersonal
 * technical facts must keep passing: "every 10 degrees drops about 1 PSI",
 * "rated around 50 miles", "below 2/32 inch" are the substance of the content
 * and none of them trip this.
 */
// NOTE on the trailing boundary: the quantifier alternation must NOT close with
// a single shared `\b`. The percentage arms end in "%", a NON-word character,
// so a following `\b` requires a word char next to it and never matches — the
// rule silently ignored every "90% of our…" claim while looking correct. Word-
// ending arms keep their `\b`; the "%" arm deliberately has none.
const FABRICATED_STAT_PATTERN =
  /\b(?:we|our (?:shop|techs?|customers?|drivers?)|nick'?s)\b[^.!?]{0,70}?\b(?:see|seen|saw|find|found|get|got|have had|had|never|always)\b[^.!?]{0,40}?(?:\b(?:zero|none|no\s+\w+\s+(?:at all|ever)|every\s+single|\d+\s+out\s+of\s+\d+)\b|\d{1,3}\s?%)/i;

export function detectFabricatedStats(text: string, where = "text"): SafetyFinding[] {
  const m = text.match(FABRICATED_STAT_PATTERN);
  if (!m) return [];
  return [
    {
      severity: "block",
      rule: "no-fabricated-stat",
      match: m[0],
      where,
      fix: "Remove the invented shop statistic. State the mechanism itself ('road salt can seize a caliper'), never a quantified claim about what this shop sees — nothing here can verify it, and the model makes them up.",
    },
  ];
}

/**
 * Instagram caps a post at FIVE hashtags (rolled out December 2025). It is a
 * hard platform limit, not guidance: beyond five, the publish is rejected or
 * the extra tags are silently stripped — and stripped-not-errored is the worse
 * outcome, because nothing here would ever learn it happened.
 *
 * Measured 2026-07-31: the last 12 posts carried 8–11 tags each — 12 of 12 over
 * the cap — while the quality score rated "Hashtags 3-12" as correct. The rule
 * encoded the pre-2025 30-tag era, so the gate was certifying every post as
 * compliant with a limit that no longer exists.
 *
 * Zero is explicitly allowed: Instagram's own guidance is that hashtags help
 * categorisation and do NOT inherently increase reach, so an empty set is a
 * legitimate editorial choice, not a defect.
 */
export const INSTAGRAM_HASHTAG_CAP = 5;

export function validateHashtagCap(hashtags: string[]): { ok: boolean; reason?: string } {
  if (hashtags.length > INSTAGRAM_HASHTAG_CAP) {
    return {
      ok: false,
      reason: `${hashtags.length} hashtags — Instagram caps posts at ${INSTAGRAM_HASHTAG_CAP}; the excess is rejected or silently stripped. Keep 0-${INSTAGRAM_HASHTAG_CAP} highly relevant tags.`,
    };
  }
  return { ok: true };
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

/**
 * The faceless rule for a beat that may show real hands (2026-10-09,
 * presenceProfile hands_only_real on a beat declared real): faces, talking
 * heads, presenters and shop tours stay blocked; the limb and glove
 * alternatives of FACE_SUBJECT_PATTERN are dropped, because captured hands on
 * a tool are the evidence the beat exists to show.
 */
const FACE_ONLY_PATTERN =
  /\b(?:human\s+face|(?:person|technician|tech|mechanic|customer|driver|worker|owner|employee|man|woman|guy|someone)'?s?\s+(?:face|head|eyes|smile|mouth|beard|hair)|(?:visible|full|partial|half)\s+(?:face|figure|body)|face\s+(?:visible|in\s+frame|in\s+shot|turned|looking)|talking\s+head|man|woman|mechanic\s+(?:smiling|talking|speaking|on\s+camera|standing|leaning)|technician\s+(?:smiling|talking|speaking|on\s+camera|standing|leaning)|customer\s+(?:smiling|talking|face|standing)|selfie|presenter|spokesperson|silhouette|figure\s+of\s+a|face\s+to\s+camera|shop\s+tour|torso|shoulders?\s+and\s+head|uniform(?:ed)?\s+(?:tech|technician|mechanic|worker))\b/i;

/** Faceless contract: no human face / talking head / shop tour as the subject. */
export function validateFacelessSubject(texts: string[], opts: { allowHands?: boolean } = {}): { ok: boolean; reason?: string } {
  const pattern = opts.allowHands ? FACE_ONLY_PATTERN : FACE_SUBJECT_PATTERN;
  for (const t of texts) {
    const m = t.match(pattern);
    if (m) {
      return opts.allowHands
        ? { ok: false, reason: `Faceless rule violated by "${m[0]}" — real hands and tools are allowed on this beat, a face or a figure is not` }
        : { ok: false, reason: `Faceless rule violated by "${m[0]}" — recast with an object character (no faces, hands, gloves, or arms)` };
    }
  }
  return { ok: true };
}

/**
 * Design-time gate against beats that depend on rendered text/brand/readouts —
 * the direct upstream cause of garbled on-screen text and mis-spelled logos.
 * Recast such a beat to show the physical thing itself (worn tread, dead
 * terminal), wordless and unbranded; the teaching words are an ffmpeg overlay.
 */
export function validateNoInFrameText(texts: string[]): { ok: boolean; reason?: string } {
  for (const t of texts) {
    const m = t.match(IN_FRAME_TEXT_PATTERN);
    if (m) return { ok: false, reason: `Beat depends on rendered text/brand "${m[0]}" — Seedance cannot spell; recast as a wordless, unbranded shot (words are an ffmpeg overlay, not generated)` };
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

/**
 * Can the on-screen text be READ in the time its beat is on screen? (2026-10-08)
 *
 * Muted viewing is the default on Reels, so a beat whose text cannot be read
 * before it cuts teaches nothing — and that is knowable from the storyboard,
 * before any paid clip exists. Two thresholds, both hypotheses stated:
 *   block  more than 4 words per second of beat — faster than adults read plain
 *          prose with nothing else on screen. Unambiguous; no approved pack in
 *          docs/reel-packs comes near it (densest beat measured 3.75).
 *   warn   more than 3 words per second after a 0.3 s reaction allowance —
 *          the subtitle-reading guideline range. Measured 2026-10-08 over the
 *          68 of 196 committed packs that carry storyboardBeats (346 beats):
 *          two beats in one pack exceed it; they are flagged, not held.
 * Numbers, prices and "3,000-mile" each count as one word.
 */
export function validateOnScreenReadability(beats: StoryboardBeat[]): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  for (const b of beats) {
    // A beat with no text (older payloads, a partial draft) has nothing to
    // read: no finding, and never a throw — a $0 gate that crashes preflight
    // would hold the lane harder than any block it could raise.
    const words = (String(b.onScreenText ?? "").match(/[A-Za-z0-9$%'/.,-]+/g) ?? []).filter((w) => /[A-Za-z0-9]/.test(w)).length;
    const seconds = Number(b.endSecond) - Number(b.startSecond);
    if (!words || !(seconds > 0)) continue;
    if (words > 4 * seconds) {
      blocking.push(`beat ${b.beatNumber}: ${words} words of on-screen text in ${seconds.toFixed(1)}s cannot be read before the cut (limit 4 words/s)`);
    } else if (words > 3 * Math.max(0, seconds - 0.3)) {
      warnings.push(`beat ${b.beatNumber}: ${words} words in ${seconds.toFixed(1)}s is tight to read muted (aim for 3 words/s)`);
    }
  }
  return { blocking, warnings };
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

/** Conversational narration rate the voiceover contract is written against.
 *  Module-internal: reached through `runReelPreflight`, never imported directly. */
const SPOKEN_WORDS_PER_SECOND = 2.2;

/**
 * What the SYNTHESIZER actually does to that rate, mirrored from
 * `server/services/reelVoice.ts` — review P2 on #2171.
 *
 * A word count alone under-estimates the finished audio twice over: the Google
 * request sets `speakingRate: 0.97` (3% slower than nominal), and
 * `buildReelSsml` splits on sentence punctuation and joins with
 * `<break time="350ms"/>`, so an N-sentence script carries N-1 programmed
 * pauses that no word count can see. A gate that ignored both would approve
 * narration that assembly still truncates — passing while failing at exactly
 * the thing it exists to prevent.
 */
const TTS_SPEAKING_RATE = 0.97;
const TTS_SENTENCE_BREAK_SECONDS = 0.35;

/** Sentence count as the SSML builder counts it — same split, same filter. */
function narrationSentenceCount(script: string): number {
  return script
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean).length;
}

/** Estimated finished-audio seconds, pauses and speaking rate included. */
function estimatedNarrationSeconds(script: string, words: number): number {
  const speech = words / SPOKEN_WORDS_PER_SECOND / TTS_SPEAKING_RATE;
  const pauses = Math.max(0, narrationSentenceCount(script) - 1) * TTS_SENTENCE_BREAK_SECONDS;
  return speech + pauses;
}

/**
 * Seconds of finished video a storyboard will actually produce.
 *
 * NOT `max(endSecond)`. Assembly clamps every beat to one provider clip
 * (`briefToSegments` -> `maxClipSeconds`), so the declared duration and the
 * rendered one diverge as soon as a beat is authored longer than a clip. The
 * SAVE freeze is excluded deliberately: narration must land BEFORE it.
 */
function renderableVideoSeconds(beats: StoryboardBeat[]): number {
  return Number(
    beats
      .reduce((total, b) => {
        const raw = Number(b.endSecond) - Number(b.startSecond);
        const dur = Number.isFinite(raw) && raw > 0 ? raw : 0;
        return total + Math.min(dur, REEL_OUTPUT_RULES.maxClipSeconds);
      }, 0)
      .toFixed(2),
  );
}

/**
 * The voiceover must fit the video that will actually be RENDERED.
 *
 * This gate exists because raising `maxSeconds` 22 -> 35 admitted 30 packs, and
 * 29 of them carry more narration than their own render can play. The ffmpeg
 * graph forces the voice track to exactly the video length
 * (`atrim=0:${videoTotal}` + `apad=whole_dur=${videoTotal}`), so an over-long
 * script is not slowed or squeezed — it is CUT, mid-sentence, taking the payoff
 * with it. Measured worst case in the rotation: 121 words (~55s of speech) in a
 * 27s video, so more than half the script never plays.
 *
 * Nothing caught this before. The length gate read the DECLARED duration, the
 * quality scorer scored the brief, and the render-integrity gate compares the
 * output against the CLAMPED segments — so it agrees with the truncated result
 * and passes. The defect was only ever visible in the finished artifact.
 *
 * Fails closed: an unreadable/absent script is not a violation (a deliberately
 * silent reel is legal), but a script that cannot fit is.
 */
function validateVoiceoverFitsRender(
  brief: Pick<ReelBrief, "voiceoverScript" | "storyboardBeats">,
): { ok: boolean; reason?: string } {
  const script = String(brief.voiceoverScript ?? "").trim();
  const words = script.split(/\s+/).filter(Boolean).length;
  if (words === 0) return { ok: true };
  const spokenSeconds = estimatedNarrationSeconds(script, words);
  const videoSeconds = renderableVideoSeconds(brief.storyboardBeats ?? []);
  if (videoSeconds <= 0) return { ok: true }; // beat-count gate owns that failure
  // BUDGET AGAINST THE WHOLE VIDEO, freeze included. reelAssembly trims the
  // voice track to `videoTotal = beats + saveFreezeSeconds`, so narration that
  // runs into the SAVE card is not cut — it just talks over the end card, which
  // is a creative note rather than a render defect. The first draft of this gate
  // budgeted against the beats alone and consequently refused all 99 packs in
  // the rotation: it was measuring the creative threshold and reporting it as
  // truncation. Three seconds, and it inverted the verdict on every pack.
  const audibleSeconds = videoSeconds + REEL_OUTPUT_RULES.saveFreezeSeconds;
  if (spokenSeconds <= audibleSeconds) return { ok: true };
  // Invert the same model for the advice, so the number handed back actually
  // fits: subtract the programmed pauses this script will carry, then convert
  // the remaining seconds back to words at the synthesized rate.
  const pauses = Math.max(0, narrationSentenceCount(script) - 1) * TTS_SENTENCE_BREAK_SECONDS;
  const budget = Math.max(
    0,
    Math.floor((audibleSeconds - pauses) * SPOKEN_WORDS_PER_SECOND * TTS_SPEAKING_RATE),
  );
  return {
    ok: false,
    reason:
      `Voiceover is ${words} words (~${spokenSeconds.toFixed(1)}s synthesized, including ` +
      `${pauses.toFixed(2)}s of sentence breaks at the configured rate) but the reel is only ` +
      `${audibleSeconds.toFixed(1)}s long (${videoSeconds.toFixed(1)}s of beats plus the ` +
      `${REEL_OUTPUT_RULES.saveFreezeSeconds}s SAVE card) — the voice track is hard-trimmed to ` +
      `the video, so ${(spokenSeconds - audibleSeconds).toFixed(1)}s would be cut off ` +
      `mid-sentence. Trim to ${budget} words or fewer.`,
  };
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

/** A condition that must hold no matter how well the reel scores elsewhere. */
export interface QualityHardGate {
  name: string;
  ok: boolean;
  detail: string;
}

export interface QualityScoreResult {
  overall: number;
  gate: "pass" | "block";
  reasoning: string[];
  parts: QualityScorePart[];
  passing: boolean;
  /** Non-offsettable conditions, evaluated separately from the total. A
   *  failure here blocks regardless of score - see the note in the scorer. */
  hardGates: QualityHardGate[];
}

export function isScorableReelBrief(value: unknown): value is ReelBrief {
  if (!value || typeof value !== "object") return false;
  const brief = value as Partial<ReelBrief>;
  return (
    Array.isArray(brief.storyboardBeats) &&
    Array.isArray(brief.captionHooks) &&
    Array.isArray(brief.concepts) &&
    Array.isArray(brief.sourceNotes) &&
    typeof brief.topic === "string" &&
    typeof brief.mechanicTruth === "string" &&
    typeof brief.campaignKeyword === "string" &&
    typeof brief.archetype === "string" &&
    typeof brief.motionLens === "string" &&
    typeof brief.objectCharacter === "string" &&
    typeof brief.voiceoverScript === "string" &&
    typeof brief.selectedCaption === "string"
  );
}

/**
 * Runtime guard for persisted briefs.
 *
 * ReelBrief is a compile-time contract, but the Admin queue also reads
 * historical rows written before the current shape existed. Never send a
 * partial legacy object into the scorer and then rely on a catch after it
 * dereferences missing arrays. Incomplete rows are unscorable/fail-closed
 * at the queue surface; the publish gate remains independently strict.
 */
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
      ...detectFabricatedStats(text, where),
    );
  }
  // Faceless + wordless gates run over the AUTHORED design (beat visual +
  // motion), never the compiled higgsfield prompt — the compiled prompt carries
  // the clean-scene directive's own "no hands / no logos / no text" wording and
  // would self-trigger these patterns, blocking every reel.
  const designInputs = brief.storyboardBeats.flatMap((b) => [b.visual, b.motion]);
  const presence = parsePresenceProfile(brief.presenceProfile);
  if (presence === "object_only") {
    // Legacy path, unchanged: one check over every beat, one finding.
    const faceless = validateFacelessSubject(designInputs);
    if (!faceless.ok) {
      findings.push({ severity: "block", rule: "no-human-face", match: faceless.reason ?? "face subject", where: "storyboard", fix: "Recast the beat with an object character (no faces, hands, gloves, or arms) — the format is faceless." });
    }
  } else {
    // hands_only_real (2026-10-09): per beat, because the rule depends on the
    // beat's declared source. Real beats may show hands on a tool; a generated
    // beat keeps the object-only rule, and a face blocks everywhere.
    for (const b of brief.storyboardBeats) {
      const allowHands = beatAllowsHands(presence, declaredBeatSource(b));
      const faceless = validateFacelessSubject([b.visual, b.motion], { allowHands });
      if (!faceless.ok) {
        findings.push({
          severity: "block", rule: "no-human-face", match: faceless.reason ?? "face subject", where: `beat ${b.beatNumber}`,
          fix: allowHands
            ? "Keep the hands and the tool; remove the face, figure or presenter — the format is faceless."
            : "Recast the beat with an object character (no faces, hands, gloves, or arms), or declare it REAL and bind captured footage.",
        });
        break;
      }
    }
  }
  const inFrameText = validateNoInFrameText(designInputs);
  if (!inFrameText.ok) {
    findings.push({ severity: "block", rule: "no-in-frame-text", match: inFrameText.reason ?? "in-frame text subject", where: "storyboard", fix: "Recast the beat to show the physical object itself, wordless and unbranded — Seedance cannot spell; teaching text is an ffmpeg overlay added after generation." });
  }
  return { findings, blocked: findings.some((f) => f.severity === "block"), checkedAt: now() };
}

export interface QualityScoreContext {
  /** Recent signals from reel_jobs, the same shape buildRepetitionChecks takes. */
  recent?: {
    topics: string[]; keywords: string[]; archetypes: string[]; motionLenses: string[]; objectCharacters: string[];
    /** Beat-1 hook grammar per recent Reel (getRecentReelSignals). Optional: a
     *  fixture without it simply has no hook-fatigue reading. */
    hookGrammars?: string[];
    /**
     * Did the history read actually SUCCEED? getRecentReelSignals returns the
     * same empty arrays whether the window was genuinely empty or the database
     * was unreachable, and those two mean opposite things here: the first is a
     * brief with nothing to repeat, the second is a brief nobody could check.
     * Without this flag a DB outage scores as perfectly distinct - absent
     * evidence read as a pass. Optional, and only `false` is treated as an
     * outage, so a hand-built fixture stays a real answer.
     */
    available?: boolean;
  };
}

/**
 * The distinctiveness part. Scores one point per identity axis that is genuinely
 * new against the recent window, so a reel reusing last week's archetype loses a
 * point rather than the whole part. Repeating ALL FIVE is not a score at all -
 * that is the same reel again, and the hard gate in the scorer refuses it.
 */
/** The five signals buildRepetitionChecks compares. Also the part's max, so
 *  the weight and the number of things being weighed cannot drift apart. */
const DISTINCT_SIGNALS = 5;

function distinctPart(
  brief: ReelBrief,
  recent?: QualityScoreContext["recent"],
): QualityScorePart {
  // Two different nothings, and they must not read alike. A caller that never
  // supplied context did not ask the question; a caller whose DB read failed
  // asked and got no answer. Neither earns the points - "absent evidence is
  // not a pass" - but only the second one is an outage worth seeing.
  if (!recent || recent.available === false) {
    return {
      label: "Distinct from recent reels",
      max: DISTINCT_SIGNALS,
      ok: false,
      points: 0,
      detail: recent
        ? "Not checked - recent-reel history was unreadable"
        : "Not checked - no recent-signal context supplied to the scorer",
    };
  }
  const checks = buildRepetitionChecks(brief, recent);
  const repeated = [
    checks.topicRepeated ? "topic" : null,
    checks.keywordRepeated ? "keyword" : null,
    checks.archetypeRepeated ? "archetype" : null,
    checks.motionLensRepeated ? "motion lens" : null,
    checks.objectCharacterRepeated ? "object" : null,
  ].filter(Boolean) as string[];
  // HOOK FATIGUE (2026-10-08). The five signals are identity; none of them
  // sees the opening SHAPE, which is where the corpus collapsed. One point
  // when this brief opens with the grammar that already opened most recent
  // Reels (shared/reelHookGrammar.ts says why CTA and structure are excluded).
  // The part keeps its max, so the 75-point scale and its slack do not move.
  const saturation = saturatedHookGrammar(recent.hookGrammars);
  const hookFatigued = !!saturation && classifyHookGrammar(brief.storyboardBeats?.[0]?.onScreenText) === saturation.grammar;
  const ok = repeated.length === 0 && !hookFatigued;
  const points = Math.max(0, DISTINCT_SIGNALS - repeated.length - (hookFatigued ? 1 : 0));
  const fatigueNote = hookFatigued && saturation
    ? `opens like ${saturation.count}/${saturation.of} recent reels (${saturation.grammar.replace(/_/g, " ")})`
    : "";
  return {
    label: "Distinct from recent reels",
    max: DISTINCT_SIGNALS,
    ok,
    // GRADUATED, one point per signal that is genuinely new.
    //
    // The first version scored 5 or 0, which made repeating a single signal
    // cost as much as repeating all five. Measured against production on
    // 2026-09-09 (47 reels in the 21-day window): 41 distinct topics but only
    // 6 of 14 archetypes and 5 of 14 motion lenses in use. With that much
    // concentration most new briefs repeat SOMETHING, so all-or-nothing
    // handed nearly every brief a zero and quietly required a perfect score
    // on all nine other parts. Graduated says what is actually true: this
    // brief is four-fifths new.
    points,
    // The fraction is the points awarded, so the hook-fatigue deduction shows
    // in the same number the scale sums ("4/5" never reads beside a 3).
    detail: ok
      ? `No repeat across ${recent.topics.length} recent reels`
      : [
          repeated.length ? `Repeats recent ${repeated.join(", ")}` : "",
          fatigueNote,
        ].filter(Boolean).join("; ") + ` (${points}/${DISTINCT_SIGNALS} points)`,
  };
}

/** How many of the five signals repeat, or null when the history could not be
 *  read. null is NOT zero - it is the difference between a brief proven new
 *  and a brief nobody checked, and the duplicate gate refuses to fire on it. */
export function repeatedSignalCount(
  brief: Pick<ReelBrief, "topic" | "campaignKeyword" | "archetype" | "motionLens" | "objectCharacter">,
  recent?: QualityScoreContext["recent"],
): number | null {
  if (!recent || recent.available === false) return null;
  const c = buildRepetitionChecks(brief, recent);
  return [c.topicRepeated, c.keywordRepeated, c.archetypeRepeated, c.motionLensRepeated, c.objectCharacterRepeated]
    .filter(Boolean).length;
}

export function calculateReelQualityScore(brief: ReelBrief, minScore: number = STUDIO_DEFAULTS.qualityMinScore, opts?: QualityScoreContext): QualityScoreResult {
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
  const textBlocks = hardBlocks.filter((f) => f.rule === "no-in-frame-text");
  const claimBlocks = hardBlocks.filter((f) => f.rule !== "no-human-face" && f.rule !== "no-in-frame-text");
  const facelessWordlessOk = faceBlocks.length === 0 && textBlocks.length === 0;
  const firstBeat = brief.storyboardBeats[0];
  const hookOk = !!firstBeat && firstBeat.startSecond === 0 && !!firstBeat.visual.trim() && !!firstBeat.onScreenText.trim();

  const parts: QualityScorePart[] = [
    { label: "First-frame scroll-stop", max: 10, ok: hookOk, points: hookOk ? 10 : 0, detail: hookOk ? "Beat 1 opens at 0s with visual + text" : "Beat 1 must open at 0s with a visual and on-screen text" },
    { label: "Muted-first clarity", max: 10, ok: mutedOk, points: mutedOk ? 10 : 0, detail: mutedOk ? "Every beat teaches without audio" : "Beats missing on-screen text" },
    { label: `${REEL_OUTPUT_RULES.minBeats}-${REEL_OUTPUT_RULES.maxBeats} beats, contiguous`, max: 5, ok: beatsOk, points: beatsOk ? 5 : 0, detail: beatsOk ? "Beat structure valid" : "Beat structure invalid" },
    { label: `${REEL_OUTPUT_RULES.minSeconds}-${REEL_OUTPUT_RULES.maxSeconds} second target`, max: 5, ok: lengthOk, points: lengthOk ? 5 : 0, detail: lengthOk ? "Length in band" : "Length out of band" },
    { label: "Loop plan", max: 5, ok: loopOk, points: loopOk ? 5 : 0, detail: loopOk ? "Last frame feeds the first" : "No loop plan on winning concept" },
    { label: "Verified mechanic fact (sourced)", max: 10, ok: srcOk, points: srcOk ? 10 : 0, detail: srcOk ? "Proof source present" : "Needs a proof source" },
    { label: "Faceless & wordless contract", max: 10, ok: facelessWordlessOk, points: facelessWordlessOk ? 10 : 0, detail: facelessWordlessOk ? "No face/hand/limb subjects and no in-frame text or branding" : (faceBlocks[0]?.match ?? textBlocks[0]?.match ?? "Faceless/wordless violation") },
    { label: "Claim safety (no blocked claims)", max: 10, ok: claimBlocks.length === 0, points: claimBlocks.length === 0 ? 10 : 0, detail: claimBlocks.length === 0 ? "No blocked claims" : `${claimBlocks.length} blocked claim(s)` },
    { label: "Campaign keyword valid", max: 5, ok: kwOk, points: kwOk ? 5 : 0, detail: brief.campaignKeyword },
    // DISTINCTIVENESS replaced a 5-point SELF-GRADE.
    //
    // The old part scored "winning concept >= 57/60", where all six of those
    // sub-scores are written by the generator about its own output -
    // conceptTournament.ts says so in its header: "'Self-score honestly' is
    // literally in the reel prompt". A model grading itself is not a gate.
    //
    // What the scale was missing is the thing the corpus actually suffers from.
    // Measured 2026-09-09 across 166 produced packs: 99 share an identical
    // five-beat shape, 130 close with the same sentence, and the repo's own
    // originality report scored ten machine-written reels at 0.99-1.00 against
    // already-published content while four hand-written ones scored 0.14-0.28.
    // Every one of those briefs cleared 70/75, because nothing in the scale
    // could see a sibling.
    //
    // NO CONTEXT IS NOT A PASS. When the caller supplies no recent signals this
    // part scores ZERO and says why, so a brief scored blind spends its slack
    // instead of being quietly certified distinct. The repetition data already
    // exists (getRecentReelSignals -> buildRepetitionChecks); this makes the
    // score read it.
    distinctPart(brief, opts?.recent),
  ];
  const score = parts.reduce((a, p) => a + p.points, 0);

  // HARD GATES vs SCORED DIMENSIONS.
  //
  // One averaged number cannot express "this must never ship" and "this could
  // be better" at the same time, and the arithmetic proved it: max is 75 and
  // the threshold is 70, so there are exactly 5 points of slack - and FIVE
  // separate 5-point parts. Any one of them can fail while the reel still
  // passes at exactly 70. A part whose weight equals the slack cannot block
  // anything by itself; it is decoration with a number attached.
  //
  // So the things that must never ship are listed here instead of trusted to
  // the total. They are not offsettable by scoring well elsewhere, and they
  // stay correct if the weights or the threshold are ever retuned.
  const repeatedCount = repeatedSignalCount(brief, opts?.recent);
  const hardGates: QualityHardGate[] = [
    {
      name: "Faceless & wordless contract",
      ok: facelessWordlessOk,
      detail: facelessWordlessOk ? "No face/hand/limb subjects and no in-frame text or branding" : (faceBlocks[0]?.match ?? textBlocks[0]?.match ?? "Faceless/wordless violation"),
    },
    {
      // Already fatal today only because a 10-point loss happens to land under
      // the threshold. Stated explicitly so it survives a retune.
      name: "No blocked claims",
      ok: claimBlocks.length === 0,
      detail: claimBlocks.length === 0 ? "No blocked claims" : `${claimBlocks.length} blocked claim(s)`,
    },
    {
      // The floor, not the ambition. Repeating some signals is ordinary and
      // costs points; repeating ALL FIVE is the same reel again, and shipping
      // it is the spam-and-repetition exposure the platform actually polices.
      // It cannot deadlock the lane: escaping it requires changing any ONE of
      // five signals, and the 2026-09-09 window had 8 unused archetypes and 9
      // unused motion lenses. null (history unreadable) never fires it - an
      // outage must not start blocking publishes.
      name: "Not a duplicate of a recent reel",
      ok: repeatedCount === null || repeatedCount < DISTINCT_SIGNALS,
      detail: repeatedCount === null
        ? "Not checked - recent-reel history unavailable"
        : repeatedCount < DISTINCT_SIGNALS
          ? `${DISTINCT_SIGNALS - repeatedCount} of ${DISTINCT_SIGNALS} signals differ from recent reels`
          : "Every signal repeats a recent reel - this is that reel again",
    },
  ];
  const failedGates = hardGates.filter((g) => !g.ok);
  const passing = score >= minScore && failedGates.length === 0;
  const reasoning = [...failedGates.map((g) => g.detail), ...parts.filter(p => !p.ok).map(p => p.detail)];
  const gate = passing ? "pass" as const : "block" as const;
  return { overall: score, gate, reasoning, parts, passing, hardGates };
}

// ─── Deterministic preflight (Creative Compiler 2.0 Milestone 10) ──────

export interface PreflightFinding {
  category: "structural" | "production" | "truth" | "memory";
  severity: "block" | "warn";
  message: string;
}
export interface PreflightReport {
  status: "pass" | "block";
  findings: PreflightFinding[];
  blocking: PreflightFinding[];
}

/**
 * ONE deterministic gate run BEFORE any paid generation. It unifies the
 * structural / production / truth checks that were scattered across validators
 * plus the M5/M6 per-beat provider-scene status, and returns a single verdict.
 * A "block" finding means a predictable defect the render would inherit — do not
 * reserve paid generation until this passes. "warn" is advisory (e.g. the
 * compiler auto-corrected a beat scene). Pure + synchronous — no LLM, no spend.
 */
export function runReelPreflight(brief: ReelBrief): PreflightReport {
  const findings: PreflightFinding[] = [];
  const push = (category: PreflightFinding["category"], severity: PreflightFinding["severity"], message: string) =>
    findings.push({ category, severity, message });

  // Structural
  const beatCount = validateBeatCount(brief.storyboardBeats);
  if (!beatCount.ok) push("structural", "block", beatCount.reason ?? "beat structure invalid");
  const length = validateReelLengthTarget(brief.storyboardBeats);
  if (!length.ok) push("structural", "block", length.reason ?? "reel length out of band");
  if (!validateMutedFirstClarity(brief.storyboardBeats).ok) push("structural", "warn", "a beat is missing muted-first on-screen text");
  // Previs: readable-in-time is decided from the storyboard, before any spend.
  const readability = validateOnScreenReadability(brief.storyboardBeats);
  for (const m of readability.blocking) push("structural", "block", m);
  for (const m of readability.warnings) push("structural", "warn", m);
  // Editorial contract (2026-10-08): frame one carries the subject (never a
  // logo, plate or generic car), one idea per card, one CTA and it comes last,
  // an end card never outstays two seconds. WARN, not block: these are the
  // rules an editor executes, and a pack that opens on a logo still renders —
  // the Studio says why it should not, before anything is bought. The $0
  // storyboard is the only place they can be read; the renderer sees pixels.
  for (const f of checkEditorialContract(brief.storyboardBeats ?? [])) push("structural", "warn", f.message);
  // Keyword FORMAT is a caption/CTA concern, not a render-blocking defect — a
  // warning, not a pre-spend block (it never garbles the generated video).
  const kw = validateCampaignKeyword(brief.campaignKeyword);
  if (!kw.ok) push("structural", "warn", kw.reason ?? "campaign keyword should be a single ALL-CAPS word");
  // BLOCK, not warn: over the cap Instagram rejects the publish or strips tags
  // silently. A warning would let the pipeline spend render credits on a post
  // that cannot go out intact.
  const tags = validateHashtagCap(brief.hashtags ?? []);
  if (!tags.ok) push("structural", "block", tags.reason ?? "too many hashtags");

  // Truth — BLOCKS. This was a warning, which meant a reel with no proof source
  // could clear preflight, reserve credits, render, and publish while its
  // factual foundation was never established. That is the same defect the
  // no-fabricated-stat rule addresses, one layer up: the claim bank catches
  // claims that LOOK wrong, this catches claims backed by nothing at all.
  // Failing closed is affordable here — prepareCleanReelBrief regenerates on a
  // block, so an ungrounded brief costs one LLM call, not a render.
  const grounding = validateSourceGrounding(brief);
  if (!grounding.ok) push("truth", "block", grounding.reason ?? "no verified proof source for the mechanic truth");

  // Production: the voiceover must fit the video that will actually RENDER, not
  // the duration the storyboard declares. BLOCKS, for the same reason grounding
  // does — this is a pre-spend gate, and a reel whose narration gets cut in half
  // is a defect the render would inherit, not an advisory. See
  // validateVoiceoverFitsRender for why nothing downstream catches it.
  const voFit = validateVoiceoverFitsRender(brief);
  if (!voFit.ok) push("production", "block", voFit.reason ?? "voiceover is longer than the rendered video");

  // A LEAKED CALL TO ACTION USED TO COST A WHOLE RENDER.
  //
  // askLeakageProblem had exactly ONE caller - assembleReel - and assembly runs
  // AFTER every clip has been generated and paid for. So a brief whose voiceover
  // or beats carried a spoken ask was bought in full and then refused at the
  // last gate, with the clips discarded.
  //
  // It is not a rare shape. Two of the three reel failures on 2026-09-09 were
  // exactly this ("refusing to render: the voiceover contains a call to action
  // (dm-us)", and a beat carrying "send this to..."), and the gate's own comment
  // records that all three freshly generated briefs measured on 2026-08-29 had
  // one. The generator writes them; the renderer refuses them; nothing in
  // between was looking.
  //
  // Checking here makes it free. prepareCleanReelBrief regenerates on a preflight
  // block, so a leaked ask now costs one LLM call instead of a full set of paid
  // clips - the same reasoning that put grounding and voiceover-fit in this
  // function rather than downstream.
  //
  // The render-time check STAYS. This adds a layer, it does not move one: a brief
  // can be edited between preflight and assembly, and the surface that renders
  // must be the surface that was checked.
  // ONLY THE PERMANENT SURFACES. Beats and voiceover, deliberately NOT caption.
  //
  // A pre-spend gate should refuse what SPENDING would make permanent. Once
  // clips are bought and assembled, a CTA burned into a beat or spoken in the
  // voiceover cannot be taken out - the reel would have to be regenerated. A
  // caption is editable right up to the moment of publishing, so a caption
  // problem is not a reason to refuse a render.
  //
  // The render-time check in assembleReel still evaluates ALL of it, caption
  // and declared-ask agreement included. This adds an early, cheaper layer for
  // the irreversible half; it does not replace the full gate.
  const leakedAsk = askLeakageProblem({
    beats: (brief.storyboardBeats ?? []).map((b) => b.onScreenText),
    voiceoverScript: brief.voiceoverScript,
  });
  // WARN, NOT BLOCK - and the reason is worth stating, because the honest
  // severity here is "block" and this is deliberately less than that.
  //
  // A block changes control flow: prepareCleanReelBrief REGENERATES on one, so
  // turning this to a block immediately re-generates every brief carrying a
  // beat CTA. That pattern is not rare - it is what the three canonical sample
  // briefs modelled until this same change fixed them, and it is still baked
  // into fixtures across seven test files that assert on generation attempt
  // counts. Flipping the severity without first sweeping those is how a green
  // suite turns red for a reason unrelated to the defect being fixed.
  //
  // As a warn it still does the useful half: the leak is visible in the
  // preflight report, before any clip is bought, instead of surfacing only as
  // a failed job after assembly refuses it. The render-time gate in
  // assembleReel remains the hard stop, so nothing ships with a leaked ask.
  //
  // To promote it: fix the leaking fixtures, then change "warn" to "block"
  // here. reelAskPreflight.test.ts pins both halves of that contract.
  if (leakedAsk) push("production", "warn", leakedAsk);

  // Production + truth: claim safety, faceless, in-frame-text (over the design)
  for (const f of runReelSafety(brief)) push(f.category, f.severity, f.message);

  // Production: per-beat provider-scene status (M5/M6) — the compiler corrected a
  // beat that carried a renderable token / faceless risk.
  for (const p of buildHiggsfieldReelPromptPack(brief)) {
    if (p.sceneStatus === "corrected") push("production", "warn", `beat ${p.beatNumber}: provider scene auto-corrected (${(p.sceneFindings ?? []).join("; ")})`);
  }

  // Production: a beat whose DECLARED source contradicts what it claims to show
  // (an "AI illustrative" beat describing a measurement or repair; a "real"
  // beat asking for a generated shot). Silent for beats that declare nothing —
  // the committed packs predate the field, and a warning on every one of them
  // would be noise, not a guard. WARN: the provider pick does not read
  // `source` yet, so nothing downstream would act on a block (doctrine §8).
  for (const m of shotRouteProblems(brief.storyboardBeats ?? [])) push("production", "warn", m);

  // Truth: Delightfully Useful Absurdity. Every brief here carries an absurd
  // frame (`usefulAbsurdity`) and until now nothing checked that the frame
  // taught the fact rather than decorating it — the absurdity score is averaged
  // into a 60-point total, so an irrelevant joke and a relevant one were worth
  // the same. Severity splits on what is STATED vs what is INFERRED; see the
  // adoption-seam comment in shared/dua.ts for why.
  for (const f of runReelDuaChecks(brief)) findings.push(f);

  const blocking = findings.filter((f) => f.severity === "block");
  return { status: blocking.length ? "block" : "pass", findings, blocking };
}

/**
 * DUA findings for a brief, mapped into preflight categories.
 *
 * Two paths, deliberately different severities:
 *   · `brief.dua` authored  -> the full gate, every hard fail BLOCKS.
 *   · no authored concept   -> the three content detectors still BLOCK, because
 *                              they read text that will actually ship; relevance
 *                              and the swap probe WARN, because reconstructing
 *                              `violation`/`payoff` from a brief is lossy and
 *                              blocking live generation on this file's own
 *                              approximation is not the same as blocking on an
 *                              author's declaration.
 */
export function runReelDuaChecks(brief: ReelBrief): PreflightFinding[] {
  const out: PreflightFinding[] = [];
  const asFinding = (f: DuaFinding): PreflightFinding => ({
    category: "truth",
    severity: f.severity,
    message: `dua/${f.code} (${f.where}): ${f.detail}`,
  });

  // The authored gate runs IN ADDITION TO the stated-surface checks, never
  // instead of them. An early return here meant a clean or STALE concept
  // exempted the shipping copy: edit the caption afterwards to ridicule the
  // driver or to claim a lab confirmed a failure, and nothing would look at it.
  // The concept describes intent; the caption, voiceover and beats are what
  // actually ships, and REAL_EVENT_ASSERTED has to see them either way.
  if (brief.dua) {
    for (const f of runDuaGate(brief.dua).findings) out.push(asFinding(f));
  }

  const winner = brief.concepts.find((c) => c.id === brief.winningConceptId) ?? brief.concepts[0];
  const report = runDuaBriefChecks({
    usefulAbsurdity: brief.usefulAbsurdity ?? "",
    mechanicTruth: brief.mechanicTruth ?? "",
    hook: winner?.hook ?? "",
    captionAngle: winner?.captionAngle ?? brief.selectedCaption ?? "",
    loopIdea: winner?.loopIdea ?? "",
    audienceText: [
      { where: "caption", text: brief.selectedCaption ?? "" },
      { where: "voiceover", text: brief.voiceoverScript ?? "" },
      { where: "usefulAbsurdity", text: brief.usefulAbsurdity ?? "" },
      // Beat visual and on-screen text are DIFFERENT REGISTERS and must never
      // be concatenated into one string: a shot description ("...pulled into
      // the bay") fused to a CTA ("We check all three free") manufactures a
      // sentence nobody wrote. That artefact was the ONLY false positive the
      // real-event detector produced across 134 committed reel packs.
      ...brief.storyboardBeats.flatMap((b) => [
        { where: `beat ${b.beatNumber} visual`, text: b.visual ?? "" },
        { where: `beat ${b.beatNumber} text`, text: b.onScreenText ?? "" },
      ]),
    ],
  });
  for (const f of [...report.stated, ...report.inferred]) out.push(asFinding(f));
  return out;
}

/** Map runSafetyChecks findings into preflight categories. */
function runReelSafety(brief: ReelBrief): PreflightFinding[] {
  const report = runSafetyChecks(brief);
  return report.findings.map((f) => {
    const production = f.rule === "no-in-frame-text" || f.rule === "no-human-face";
    return {
      category: production ? "production" as const : "truth" as const,
      severity: f.severity === "block" ? "block" as const : "warn" as const,
      message: `${f.rule}: ${f.match}`,
    };
  });
}

// ─── Draft workspace (Creative Compiler 2.0 Milestone 12) ──────

export interface DraftWorkspaceView {
  truth: { topic: string; mechanicTruth: string; driverConfusion: string; clevelandAngle: string; evidence: string[] };
  concepts: { count: number; winningConceptId: string | null; usefulAbsurdity: string };
  execution: {
    conditioningMode: ConditioningMode;
    beats: Array<{ beatNumber: number; intent: string; onScreenText: string; providerScene: string; sceneStatus: "clean" | "corrected"; sceneFindings: string[] }>;
  };
  preflight: PreflightReport;
  generation: Array<{ beatNumber: number; prompt: string; negativePrompt: string }>;
  /** "persisted" = the exact frozen pack the worker sent to the provider;
   *  "recompiled_preview" = re-derived live (an un-enqueued draft, or the
   *  persisted pack is absent) — may differ from a past render after a compiler
   *  change. Never label a live recompile as the exact generation input. */
  generationSource: "persisted" | "recompiled_preview";
}

/**
 * Assemble the operator-facing draft workspace (Section 23): the compiler's own
 * output made inspectable — Truth, Concepts, Execution (creative INTENT vs the
 * provider-safe SCENE the generator actually gets), the deterministic Preflight
 * verdict, and the exact compiled prompts. Pure — derived from the brief + the
 * compiler functions, so the view can never drift from what will be generated.
 */
export function buildDraftWorkspace(brief: ReelBrief): DraftWorkspaceView {
  // Prefer the PERSISTED prompt pack the worker actually sent to the provider.
  // Recompiling here would show prompts that DIFFER from what was generated if
  // the compiler changed between enqueue and review — so an operator would
  // review one prompt while Higgsfield received another (audit finding).
  const recompiled = buildHiggsfieldReelPromptPack(brief);
  const persisted = brief.promptPack;
  const usePersisted = Array.isArray(persisted) && persisted.length === recompiled.length && persisted.length > 0;
  const pack = usePersisted ? persisted! : recompiled;
  const subjectOf = (prompt: string) => prompt.split("\n").find((l) => l.startsWith("Subject:"))?.replace(/^Subject:\s*/, "") ?? "";
  return {
    truth: {
      topic: brief.topic,
      mechanicTruth: brief.mechanicTruth,
      driverConfusion: brief.driverConfusion,
      clevelandAngle: brief.clevelandAngle,
      evidence: brief.sourceNotes.filter((s) => s.kind === "proof").map((s) => s.label),
    },
    concepts: {
      count: brief.concepts.length,
      winningConceptId: brief.winningConceptId ?? null,
      usefulAbsurdity: brief.usefulAbsurdity,
    },
    execution: {
      conditioningMode: resolveConditioningMode(brief),
      beats: brief.storyboardBeats.map((b, i) => ({
        beatNumber: b.beatNumber,
        intent: b.visual,
        onScreenText: b.onScreenText,
        providerScene: subjectOf(pack[i]?.prompt ?? ""),
        sceneStatus: pack[i]?.sceneStatus ?? "clean",
        sceneFindings: pack[i]?.sceneFindings ?? [],
      })),
    },
    preflight: runReelPreflight(brief),
    generation: pack.map((p) => ({ beatNumber: p.beatNumber, prompt: p.prompt, negativePrompt: p.negativePrompt })),
    generationSource: usePersisted ? "persisted" : "recompiled_preview",
  };
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
export function buildReelContinuityBlock(
  brief: Pick<ReelBrief, "storyboardBeats" | "objectCharacter" | "motionLens" | "visualWorld">,
): string {
  // An operator-approved visual world REPLACES the derived continuity block:
  // its invariants were compiled from the exact approved reference frame, so
  // they are stricter and already carry palette/environment/lighting locks.
  if (brief.visualWorld?.lockedInvariants?.trim()) {
    return brief.visualWorld.lockedInvariants.trim();
  }
  const character = OBJECT_CHARACTERS[brief.objectCharacter];
  const persona = heroPersona(brief.objectCharacter);
  // M6: neutralize renderable tokens in the anchor so the continuity block never
  // seeds the generator with a label/code/brand to (mis)spell.
  const heroAnchor = transformToProviderSafeScene(brief.storyboardBeats[0]?.visual.trim() || character.essence);
  return [
    `VISUAL CONTINUITY (identical in every shot of this reel):`,
    persona
      ? `Hero subject: ${persona.label} - ${persona.essence} First established as: ${heroAnchor}`
      : `Hero subject: ${heroAnchor}`,
    `Palette: ${LENS_PALETTES[brief.motionLens] ?? LENS_PALETTES.hyperreal_cinematic}`,
    BRAND_ACCENT_RULE,
    `Same hero object design, same environment, same lighting direction, and same weather in every shot.`,
    `Never change the hero object's shape, tread/surface pattern, damage location, or color between shots.`,
  ].join("\n");
}

/**
 * FACELESS + UNBRANDED SCENE, expressed as a POSITIVE description of the scene
 * state rather than a DO-NOT list.
 *
 * Seedance has no negative-prompt parameter (verified via `model get`,
 * higgsfieldStudio.ts:245) — exclusions are compiled into a "DO NOT INCLUDE"
 * string. Text-to-video models activate concept tokens even inside a negation,
 * so naming "text / letters / logo / watermark" in a DO-NOT clause is a
 * documented cause of exactly the garbled on-screen text and mis-spelled brand
 * logos ("Nixs" for "Nick's") measured in prod reel 690001. Describing an
 * empty, unbranded scene gives the model a concrete clean state to render
 * instead of a forbidden concept to fixate on. The gold caption is a
 * deterministic ffmpeg overlay added AFTER generation — the generator itself
 * must render zero text.
 */
export const FACELESS_CLEAN_SCENE_DIRECTIVE = [
  `Unpopulated scene: no people, no faces, no hands, no arms, no gloves — the objects move on their own.`,
  `Every surface is clean and unbranded: no signage, no logos, no lettering, no words, no numbers, no readable text of any kind anywhere in frame; any screen, gauge, or display is dark, powered off, or angled away from camera.`,
].join("\n");

/**
 * A few motion lenses are BUILT around glowing indicators / radar sweeps /
 * blueprint callout linework — for those, the strict "screens dark, no numbers"
 * clause negates the lens's own premise (a warning-light world with every light
 * off is not the lens). The graphical variant keeps the HARD no-brand /
 * no-readable-word rule (the actual defect) but permits the style's abstract,
 * non-spelling elements. Everything else gets the strict directive.
 */
const GRAPHICAL_DISPLAY_LENSES = new Set<string>(["warning_light_world", "weather_radar_overlay", "blueprint_technical"]);

const FACELESS_CLEAN_SCENE_DIRECTIVE_GRAPHICAL = [
  `Unpopulated scene: no people, no faces, no hands, no arms, no gloves — the objects move on their own.`,
  `No brand names, no logos, no signage, and no readable words or spelled-out numbers anywhere in frame. The style's own abstract elements — indicator glows, radar sweeps, callout lines, marker dots, scan lines — are welcome as long as they spell nothing legible.`,
].join("\n");

export function facelessCleanSceneDirective(motionLens: string): string {
  return GRAPHICAL_DISPLAY_LENSES.has(motionLens) ? FACELESS_CLEAN_SCENE_DIRECTIVE_GRAPHICAL : FACELESS_CLEAN_SCENE_DIRECTIVE;
}

export interface ProviderSceneCompilation {
  /** what Seedance renders — the beat's creative intent made provider-safe */
  scene: string;
  status: "clean" | "corrected";
  /** reasons a correction was applied (empty when clean) */
  findings: string[];
}

/**
 * Milestone 5: separate a beat's CREATIVE INTENT (visual + motion — what the shot
 * means) from the PROVIDER SCENE (what Seedance renders). The in-frame-text and
 * faceless validators run HERE, at the compile boundary, so EVERY path that
 * builds the prompt pack — including the ungated autonomous cron path
 * (dailyReelPost, which never calls runSafetyChecks) — gets per-beat provider
 * safety, not only paths that gate the brief. When a risk is detected, a
 * deterministic corrective clause steers the generator away from it even for a
 * beat that slipped the brief-level gate. The full intent->scene TRANSFORMATION
 * (zero-lettering rewrites) is Milestone 6; M5 establishes the seam + the guard.
 */
/**
 * Milestone 6 (zero generated lettering): deterministically NEUTRALIZE the
 * renderable-text tokens a beat visual may carry — brand/logo words, quoted
 * labels, measured readings, and alphanumeric codes — so the generator has
 * nothing to (mis)spell. This is the compiler-level kill for the "FTD913" /
 * "Nixs" / 'MAX PRESS 44 PSI' class from reel 690001. Removal (not paraphrase)
 * keeps the surrounding prose grammatical; the removed meaning is carried by the
 * deterministic caption overlay (ffmpeg), never by generated pixels.
 */
export function transformToProviderSafeScene(visual: string): string {
  return visual
    // brand / logo constructs -> a clean unbranded surface
    .replace(/\b(?:nick'?s\s+)?(?:logos?|wordmarks?|badges?|signage)\b/gi, "unbranded surface")
    .replace(/\bnick'?s\b/gi, "the shop")
    .replace(/\bbrand(?:ed|ing)?\b/gi, "unbranded")
    // quoted readable labels -> removed (the caption overlay carries the words).
    // The opening quote must follow start-or-space so a possessive apostrophe
    // ("sidewall's") is never mistaken for a label delimiter.
    .replace(/(?<=^|\s)["'“”‘’][^"'“”‘’]{1,60}["'“”‘’]/g, "")
    // measured readings (11.8V, 44 PSI, 2mm, 63%) -> removed
    .replace(/\b\d+(?:\.\d+)?\s?(?:v|volts?|psi|mm|%|percent|degrees?)\b/gi, "")
    // bare alphanumeric codes (FTD913, DOT1234) -> removed
    .replace(/\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z0-9]{4,}\b/g, "")
    // descriptive renderable-text/label nouns (unquoted, no digits) that still
    // positively instruct lettering/labels the model would try to render —
    // "embossed lettering", "amber tag", "diagnostic label" — neutralized to an
    // unmarked surface. Kept tight (adjective + text-noun) so legitimate object
    // descriptions are untouched (audit: residual label nouns survived removal).
    .replace(/\b(?:embossed|raised|printed|stamped|engraved|etched|painted|glowing|illuminated|amber|digital|diagnostic|warning|status|LED|LCD)\s+(?:letter(?:s|ing)?|text|labels?|tags?|readouts?|displays?|screens?|signage|writing|numbers?|digits?|characters?|markings?)\b/gi, "unmarked surface")
    // tidy the gaps left behind
    .replace(/\s+([,.;])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function compileProviderScene(visual: string, motion: string): ProviderSceneCompilation {
  const design = `${visual}\n${motion}`;
  const findings: string[] = [];
  const text = validateNoInFrameText([design]);
  if (!text.ok && text.reason) findings.push(text.reason);
  const faceless = validateFacelessSubject([design]);
  if (!faceless.ok && faceless.reason) findings.push(faceless.reason);
  // M6: neutralize renderable tokens even when the structural validator did not
  // fire — a bare code / quoted label slips IN_FRAME_TEXT_PATTERN.
  const transformed = transformToProviderSafeScene(visual);
  if (transformed !== visual) findings.push("renderable text/brand tokens neutralized (M6)");
  if (findings.length === 0) return { scene: visual, status: "clean", findings: [] };
  const corrections: string[] = [];
  if (!text.ok || transformed !== visual) corrections.push("every screen, gauge, or display is dark, off, or angled away and shows NO readable text, numbers, or logos — all words are added as overlays later");
  if (!faceless.ok) corrections.push("no people, faces, hands, gloves, or arms; the object moves on its own");
  return {
    scene: `${transformed} [provider-safe: ${corrections.join("; ")}]`,
    status: "corrected",
    findings,
  };
}

/**
 * Milestone 8: which conditioning strategy the beats are compiled for. A reel
 * with an attached hero frame shares ONE identity anchor across all beats
 * (hero_image); without one, each clip is generated independently (text_only).
 * The compiler must not emit both strategies at once — "start from the shared
 * hero frame" and "continue from the previous clip's ending" are different
 * continuities. (previous_frame / fallback are reserved for future modes.)
 */
export type ConditioningMode = "hero_image" | "text_only";

export function resolveConditioningMode(brief: Pick<ReelBrief, "visualWorld">): ConditioningMode {
  return brief.visualWorld?.heroFrameUrl ? "hero_image" : "text_only";
}

export function buildHiggsfieldReelPromptPack(brief: ReelBrief): HiggsfieldBeatPrompt[] {
  const lens = MOTION_LENSES[brief.motionLens];
  const persona = heroPersona(brief.objectCharacter);
  const continuity = buildReelContinuityBlock(brief);
  const beats = brief.storyboardBeats;
  const conditioningMode = resolveConditioningMode(brief);
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
    // Milestone 5: the provider Subject is a COMPILED provider-safe scene, not
    // the raw creative-intent visual — validated + corrected at the compile
    // boundary so this holds on every path, including the ungated cron path.
    const providerScene = compileProviderScene(b.visual, b.motion);
    return {
      beatNumber: b.beatNumber,
      prompt: [
        `Vertical 9:16 cinematic clip. Generate a ${REEL_OUTPUT_RULES.maxClipSeconds}-second source clip; the final edit uses only the first ${trimDurationSec.toFixed(1)} seconds.`,
        `Subject: ${providerScene.scene}`,
        // A pack Reel's hero has no persona (heroPersona): no Character line at all.
        ...(persona ? [`Character energy: ${persona.label} - ${persona.essence}`] : []),
        // Motion is a provider-facing field too — run it through the SAME
        // token/label neutralization as Subject so a code/label/logo placed in
        // motion (e.g. "the FTD913 badge rotates") cannot bypass the zero-
        // lettering transform (audit: motion emitted raw).
        `Motion: ${transformToProviderSafeScene(b.motion)}`,
        `Style: ${lens.label} - ${lens.essence}`,
        `Style grammar: ${lens.grammar}`,
        continuity,
        // Transition intent: source clips are fixed-length; the story action must
        // land inside the clip, and adjacent shots must hand off composition.
        // M8: conditioning-aware continuity. In hero_image mode EVERY beat is
        // generated from the SAME identity anchor, so we must NOT tell it to
        // continue from the previous clip's final frame (the Section-14
        // contradiction) — we tell it to keep the shared identity and compose
        // this beat fresh. In text_only mode there is no shared frame, so the
        // aspirational "continue from the previous shot" guidance stands.
        prev
          ? (conditioningMode === "hero_image"
              ? `Opening frame: keep the SHARED hero identity from the visual world (same geometry, materials, damage location, and palette as every beat); compose THIS beat's scene, camera, and action fresh from that anchor — do NOT continue from the previous clip's final frame.`
              : `Opening frame: continue directly from the previous shot - the hero object in the same state and position it settled in (previous shot ended on: ${transformToProviderSafeScene(prev.visual)})`)
          : (conditioningMode === "hero_image"
              ? `Opening frame: establish the hero identity every later beat will share - clear, unbranded, wordless; strongest possible first frame.`
              : `Opening frame: strongest possible first frame - the hero object clearly readable at a glance.`),
        `Timing: complete the primary action by ${actionCompleteBySec} seconds; keep every frame after that visually stable${isLast ? ", settled on a frame that echoes the opening shot for a seamless loop" : ", ready for a match cut into the next shot"}.`,
        facelessCleanSceneDirective(brief.motionLens),
        `Leave the top 12% and bottom 20% of frame clear for IG UI; key action center-frame.`,
      ].join("\n"),
      // The scene bans (people/hands/text/branding) live in the POSITIVE prompt
      // above — the DO-NOT list keeps ONLY the render-quality avoids plus a light
      // human backstop, because naming "text/letters/logo/watermark" in a negation
      // is what made Seedance render garbled screens and the "Nixs" logo. Gloves +
      // arms are added since a bare "hands" ban let gloved hands through in 690001.
      negativePrompt:
        `human face, person, hands, gloves, arms, talking head, low-res, blurry, extra fingers, plastic glow, oversaturated AI look, warped engine parts, ${lens.avoid}`,
      styleKit: `${lens.label} + ${REEL_ARCHETYPES[brief.archetype].label}`,
      safeZoneGuidance: b.safeZoneNotes || "Keep critical visuals out of the top 12% / bottom 20% IG UI zones.",
      sceneStatus: providerScene.status,
      sceneFindings: providerScene.findings,
      conditioningMode,
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
    { label: "Kinetic density", ok: null, detail: "Motion in every beat, and consecutive beats must not move at the same speed for the same reason — no static stretches, no metronome" },
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
    { label: `Hashtags 0-${INSTAGRAM_HASHTAG_CAP}`, ok: validateHashtagCap(brief.hashtags).ok, detail: `${brief.hashtags.length} tags` },
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
