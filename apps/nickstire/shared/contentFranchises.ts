/**
 * The twelve content franchises of Nick's Mechanical Universe.
 *
 * A franchise is a REPEATABLE SHOW, not a topic. The point is that the page
 * looks like one studio made everything, and that a viewer who liked one
 * episode knows what the next one will feel like.
 *
 * Every franchise declares its contract up front — objective, evidence,
 * metaphors, disclosure, blocking conditions — so a generated episode can be
 * checked against its own show's rules before it costs a render.
 *
 * TWO CONSTRAINTS EVERY ENTRY IS WRITTEN AGAINST (both already enforced
 * upstream; a franchise that ignores them ships 12 shows that all fail
 * preflight):
 *   · FACELESS — no faces, hands, arms, gloves, or speaking people. Every
 *     `visualMetaphors` string below is wordless and bodiless by construction.
 *   · NO IN-FRAME TEXT — the generator cannot spell. Readouts, gauges, codes
 *     and signs are ffmpeg overlays added after generation, never generated.
 *
 * `requiredEvidence` is not decoration. It names what must exist in
 * evidenceRecords before generation may proceed, and `blockingConditions` names
 * what must never ship even when the evidence is present.
 */
import type { CtaType, ContentDistributionObjective } from "./instagramStudio";
import type { BrandCharacterId } from "./brandBible";

export const FRANCHISE_REGISTRY_VERSION = "nicks-mechanical-universe-v1" as const;

export type FranchiseId =
  | "pothole_court"
  | "tire_autopsy"
  | "dashboard_after_dark"
  | "cleveland_car_survival"
  | "can_it_be_saved"
  | "mechanic_myth_lab"
  | "rust_files"
  | "sunday_rescue_simulator"
  | "review_reconstructed"
  | "recall_radar"
  | "echeck_escape_room"
  | "choose_the_ending";

/** What kind of evidence a franchise cannot run without. */
export type EvidenceRequirement =
  | "mechanical_consensus"
  | "government_source"
  | "manufacturer_source"
  | "internal_record"
  | "verified_review"
  | "current_business_fact"
  | "weather_observation";

/** How the episode must label itself. Meta requires disclosure for realistic
 *  AI video/audio; these labels also keep a simulation from reading as a record
 *  of something that happened. */
export type DisclosureMode =
  | "animated_explainer"
  | "generated_simulation"
  | "generated_reenactment"
  | "ai_visualization";

export interface Franchise {
  id: FranchiseId;
  name: string;
  premise: string;
  objective: ContentDistributionObjective;
  audience: string;
  cast: readonly BrandCharacterId[];
  requiredEvidence: readonly EvidenceRequirement[];
  /** Wordless, bodiless shot ideas. Tested against the faceless + in-frame-text gates. */
  visualMetaphors: readonly string[];
  disclosure: DisclosureMode;
  hookStructure: string;
  revealStructure: string;
  ctaOptions: readonly CtaType[];
  primaryMetrics: readonly string[];
  /** Must never ship, even with evidence in hand. */
  blockingConditions: readonly string[];
  targetSeconds: readonly [number, number];
}

export const FRANCHISES: Record<FranchiseId, Franchise> = {
  pothole_court: {
    id: "pothole_court",
    name: "Pothole Court",
    premise: "Damaged parts testify. The evidence decides which one the pothole actually caused.",
    objective: "discovery",
    audience: "Cleveland drivers who hit something and are not sure what it cost them",
    cast: ["nick_01", "the_pothole", "the_metal"],
    requiredEvidence: ["mechanical_consensus"],
    visualMetaphors: [
      "three damaged parts lit separately in darkness, one at a time",
      "slow orbit around a bent rim edge, rim-lit",
      "impact frozen in high-speed slow motion, then reversed",
      "cross-section cutaway through a bruised sidewall",
    ],
    disclosure: "animated_explainer",
    hookStructure: "state the accusation, then undercut it — 'the tire got blamed. the tire was fine.'",
    revealStructure: "three suspects introduced → inspection isolates one → the mechanism explains why",
    ctaOptions: ["send", "comment", "none"],
    primaryMetrics: ["avg_watch_time", "shares_per_reach", "comments"],
    blockingConditions: [
      "naming a real street or intersection as the site of a specific incident",
      "asserting a repair cost or estimate",
      "implying the vehicle is unsafe to drive without an inspection",
    ],
    targetSeconds: [15, 25],
  },

  tire_autopsy: {
    id: "tire_autopsy",
    name: "Tire Autopsy",
    premise: "A tire enters the examination chamber. The camera goes through it.",
    objective: "utility",
    audience: "drivers who cannot tell a worn tire from a dangerous one",
    cast: ["nick_01", "tread", "the_metal"],
    requiredEvidence: ["mechanical_consensus"],
    visualMetaphors: [
      "x-ray pass through a tire revealing steel belt structure",
      "cross-section cutaway showing tread depth against the wear bar",
      "macro on a shoulder puncture versus a centre-tread puncture",
      "heat blooming through an underinflated sidewall in thermal false-colour",
    ],
    disclosure: "ai_visualization",
    hookStructure: "the outside looked fine — open on the intact exterior, then cut inside",
    revealStructure: "exterior → cutaway → the defect the exterior hid → what it means for grip",
    ctaOptions: ["save", "send", "none"],
    primaryMetrics: ["avg_watch_time", "saves_per_reach", "shares_per_reach"],
    blockingConditions: [
      "presenting a generated tire as a specific customer's tire",
      "stating remaining tread life in weeks or months",
    ],
    targetSeconds: [20, 30],
  },

  dashboard_after_dark: {
    id: "dashboard_after_dark",
    name: "Dashboard After Dark",
    premise: "Warning lights argue about whose fault it is. They are all wrong until the scan runs.",
    objective: "discovery",
    audience: "drivers with a light on who are googling the wrong thing",
    cast: ["nick_01", "check", "the_metal"],
    requiredEvidence: ["mechanical_consensus"],
    visualMetaphors: [
      "warning glyphs floating lit in black space, pulsing in turn",
      "a single glyph steady, then the same glyph flashing — cut between them",
      "gold scan beam sweeping across a dark engine bay",
    ],
    disclosure: "animated_explainer",
    hookStructure: "two lights that look similar and mean opposite things",
    revealStructure: "the accusation → the scan → the system the code actually names",
    ctaOptions: ["send", "comment", "none"],
    primaryMetrics: ["avg_watch_time", "shares_per_reach", "follows_per_reach"],
    blockingConditions: [
      "asserting that a specific code equals a specific failed part",
      "telling a viewer a light is safe to ignore",
    ],
    targetSeconds: [15, 25],
  },

  cleveland_car_survival: {
    id: "cleveland_car_survival",
    name: "Cleveland Car Survival",
    premise: "What this week's actual weather does to a car, simulated.",
    objective: "utility",
    audience: "everyone driving in Cleveland this week",
    cast: ["nick_01", "rust", "the_metal"],
    requiredEvidence: ["weather_observation", "mechanical_consensus"],
    visualMetaphors: [
      "air molecules contracting inside a tire as temperature falls",
      "brine drying to white crust along an underbody seam",
      "lake-effect snow crossing dark asphalt in one continuous take",
      "water evacuating through tread channels, then failing to",
    ],
    disclosure: "generated_simulation",
    hookStructure: "name the condition arriving, then the part it acts on first",
    revealStructure: "condition → mechanism → the check that takes two minutes",
    ctaOptions: ["save", "send"],
    primaryMetrics: ["saves_per_reach", "shares_per_reach", "local_engagement"],
    blockingConditions: [
      "stating a forecast not sourced from an observation record",
      "claiming a specific failure will occur on a specific date",
    ],
    targetSeconds: [15, 25],
  },

  can_it_be_saved: {
    id: "can_it_be_saved",
    name: "Can It Be Saved?",
    premise: "One part, one decision, and a beat of silence before the answer.",
    objective: "community",
    audience: "drivers deciding whether to repair or replace",
    cast: ["nick_01", "tread", "the_metal"],
    requiredEvidence: ["mechanical_consensus"],
    visualMetaphors: [
      "the part rotating slowly, fully lit, nothing hidden",
      "a repair boundary line traced in icy blue across a tread face",
      "two identical parts side by side, one crossing the line",
    ],
    disclosure: "animated_explainer",
    hookStructure: "show the damage completely, then ask the question and hold",
    revealStructure: "damage → deliberate pause for the viewer to decide → rule → verdict",
    ctaOptions: ["comment", "send"],
    primaryMetrics: ["comments", "avg_watch_time", "saves_per_reach"],
    blockingConditions: [
      "giving a repair verdict without showing the damage location",
      "quoting a price for either option",
    ],
    targetSeconds: [12, 20],
  },

  mechanic_myth_lab: {
    id: "mechanic_myth_lab",
    name: "Mechanic Myth Lab",
    premise: "Internet advice enters the simulation chamber and does not survive it.",
    objective: "discovery",
    audience: "drivers who read something confident and wrong",
    cast: ["nick_01", "check", "the_metal"],
    requiredEvidence: ["mechanical_consensus", "government_source"],
    visualMetaphors: [
      "the claim rendered as a physical object, then stress-tested to failure",
      "split-screen of two identical setups diverging over time",
      "gold beam isolating the one variable that actually changed",
    ],
    disclosure: "generated_simulation",
    hookStructure: "state the myth in the words people actually use",
    revealStructure: "myth → test → what really happens → why the myth is believable anyway",
    ctaOptions: ["send", "comment"],
    primaryMetrics: ["shares_per_reach", "avg_watch_time", "follows_per_reach"],
    blockingConditions: [
      "debunking a claim without an evidence record behind the correction",
      "naming a competitor or a specific product as the source of the myth",
    ],
    targetSeconds: [20, 30],
  },

  rust_files: {
    id: "rust_files",
    name: "Rust Files",
    premise: "Corrosion moves through a system. Slowly, and then not slowly.",
    objective: "discovery",
    audience: "owners of cars that have seen more than three Cleveland winters",
    cast: ["nick_01", "rust", "the_metal"],
    requiredEvidence: ["mechanical_consensus"],
    visualMetaphors: [
      "oxidation time-lapsed along a brake line seam",
      "macro on a fastener head losing its edges",
      "cutaway showing sound metal beside compromised metal",
    ],
    disclosure: "ai_visualization",
    hookStructure: "start where it looks cosmetic",
    revealStructure: "surface → the path inward → the connection it reaches → what weakens",
    // No SAVE here despite the reference-feel: Rust Files is a DISCOVERY show
    // and a save prompt competes with the send that actually distributes it.
    // The saveable version of this material is a carousel, not a reel.
    ctaOptions: ["send", "none"],
    primaryMetrics: ["avg_watch_time", "shares_per_reach"],
    blockingConditions: [
      "stating a corroded component will fail within any timeframe",
      "implying a vehicle is unsafe to drive without an inspection",
      "showing a generated underbody as a specific customer's vehicle",
    ],
    targetSeconds: [20, 30],
  },

  sunday_rescue_simulator: {
    id: "sunday_rescue_simulator",
    name: "Sunday Rescue Simulator",
    premise: "A hypothetical Sunday problem, played out. Nick's is open; most are not.",
    objective: "conversion",
    audience: "drivers who discover a problem when everything is closed",
    cast: ["nick_01", "the_metal"],
    requiredEvidence: ["current_business_fact"],
    visualMetaphors: [
      "a dark closed storefront row, one bay light on at the end",
      "a tire losing pressure against a falling clock, wordless",
      "empty Sunday street, single set of tail lights",
    ],
    disclosure: "generated_simulation",
    hookStructure: "set the time and the constraint in one line",
    revealStructure: "scenario → the options that are actually open → what Nick's hours cover",
    ctaOptions: ["visit", "send"],
    primaryMetrics: ["profile_visits_per_reach", "direction_taps", "calls"],
    blockingConditions: [
      "depicting a generated customer as a real person",
      "stating hours, services or pricing not drawn from a current business fact record",
      "implying a specific wait time or same-day guarantee",
    ],
    targetSeconds: [15, 25],
  },

  review_reconstructed: {
    id: "review_reconstructed",
    name: "Review Reconstructed",
    premise: "A verified review, and a labelled generated reenactment of the work it describes.",
    objective: "trust",
    audience: "people who read the reviews and then check the social",
    cast: ["nick_01", "the_metal"],
    requiredEvidence: ["verified_review", "internal_record"],
    visualMetaphors: [
      "the named part, before and after, lit identically",
      "gold beam tracing the repair path described in the review",
    ],
    disclosure: "generated_reenactment",
    hookStructure: "open on the problem the review describes, in the reviewer's words",
    revealStructure: "problem → what was done → the reviewer's own outcome line",
    ctaOptions: ["visit", "none"],
    primaryMetrics: ["profile_visits_per_reach", "dms", "direction_taps"],
    blockingConditions: [
      "inventing ANY detail beyond what the review states — vehicle, name, timeline, cost",
      "presenting the reenactment without its disclosure label",
      "generating a person to stand in for the reviewer",
      "using a review that has no evidence record",
    ],
    targetSeconds: [15, 25],
  },

  recall_radar: {
    id: "recall_radar",
    name: "Recall Radar",
    premise: "A current recall, explained, with the one action that actually resolves it.",
    objective: "utility",
    audience: "owners of the affected model who have not checked",
    cast: ["nick_01", "the_metal"],
    requiredEvidence: ["government_source"],
    visualMetaphors: [
      "the affected assembly isolated and rotating",
      "cutaway showing the mechanism the recall describes",
    ],
    disclosure: "ai_visualization",
    hookStructure: "name the system and the symptom, not the brand drama",
    revealStructure: "what the recall covers → the mechanism → check your VIN",
    ctaOptions: ["save", "send"],
    primaryMetrics: ["saves_per_reach", "shares_per_reach", "profile_visits_per_reach"],
    blockingConditions: [
      "implying every vehicle of a model has an unrepaired recall",
      "publishing without a government source record",
      "omitting the instruction to verify the specific VIN",
      "recall data past its evidence expiry",
    ],
    targetSeconds: [15, 25],
  },

  echeck_escape_room: {
    id: "echeck_escape_room",
    name: "E-Check Escape Room",
    premise: "A car tries to leave the test. The readiness monitors will not let it.",
    objective: "utility",
    audience: "Ohio drivers with a test deadline",
    cast: ["nick_01", "check", "the_metal"],
    requiredEvidence: ["government_source"],
    visualMetaphors: [
      "monitor states as locks releasing one at a time",
      "a drive cycle traced as a looping path in icy blue",
      "the last lock staying shut",
    ],
    disclosure: "animated_explainer",
    hookStructure: "the light went off and the car still failed",
    revealStructure: "cleared code → monitors reset → why not-ready is not the same as failed",
    ctaOptions: ["save", "send"],
    primaryMetrics: ["saves_per_reach", "shares_per_reach", "local_engagement"],
    blockingConditions: [
      "stating a drive-cycle procedure not drawn from a government or manufacturer record",
      "advising anything intended to defeat the test",
      "promising a pass",
    ],
    targetSeconds: [20, 30],
  },

  choose_the_ending: {
    id: "choose_the_ending",
    name: "Choose the Ending",
    premise: "Two versions of the same drive. The viewer picks which one they are living.",
    objective: "community",
    audience: "drivers postponing a decision they already know about",
    cast: ["nick_01", "the_metal"],
    requiredEvidence: ["mechanical_consensus"],
    visualMetaphors: [
      "the road forking into two lit paths",
      "the same part rendered twice, diverging over time",
    ],
    disclosure: "generated_simulation",
    hookStructure: "one symptom, two futures, stated flatly",
    revealStructure: "symptom → path A → path B → the mechanism that separates them",
    ctaOptions: ["comment", "send"],
    primaryMetrics: ["comments", "avg_watch_time", "shares_per_reach"],
    blockingConditions: [
      "generating a catastrophic outcome to frighten rather than teach",
      "attaching a timeline to either ending",
      "implying a specific safety consequence without evidence",
    ],
    targetSeconds: [15, 25],
  },
};

export const FRANCHISE_IDS = Object.keys(FRANCHISES) as FranchiseId[];

/** Franchises that may only run when the evidence they name is on hand. */
export function franchisesRequiring(req: EvidenceRequirement): Franchise[] {
  return FRANCHISE_IDS.map((id) => FRANCHISES[id]).filter((f) => f.requiredEvidence.includes(req));
}

/** Prompt fragment for one franchise — its show contract, in the model's words. */
export function buildFranchiseFragment(id: FranchiseId): string {
  const f = FRANCHISES[id];
  return [
    `FRANCHISE — ${f.name} (${FRANCHISE_REGISTRY_VERSION}). ${f.premise}`,
    `Objective: ${f.objective}. Target length ${f.targetSeconds[0]}-${f.targetSeconds[1]}s.`,
    `Hook: ${f.hookStructure}`,
    `Reveal: ${f.revealStructure}`,
    `Visual metaphors (wordless, no bodies): ${f.visualMetaphors.join("; ")}`,
    `CTA must be one of: ${f.ctaOptions.join(", ")}.`,
    `NEVER: ${f.blockingConditions.join("; ")}.`,
  ].join("\n");
}
