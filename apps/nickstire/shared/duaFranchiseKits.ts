/**
 * DUA franchise kits — the sound, the vocabulary, and the ask, per show.
 *
 * Sound and vocabulary are brand memory, and they are the cheapest brand
 * memory there is: a gavel, a stadium roar, or the phrase "Exhibit A" costs
 * nothing per reel and is recognised on the second episode. This file gives
 * each of the twelve existing franchises one audio palette, one recurring
 * vocabulary, and one participation ask that only makes sense inside that show.
 *
 * DELIBERATELY NOT A THIRTEENTH REGISTRY. `contentFranchises.ts` owns what a
 * show IS (premise, cast, evidence, blocking conditions); this owns how it
 * SOUNDS and what it ASKS. Keyed by `FranchiseId`, exhaustive by type, so a new
 * franchise cannot ship without a kit and a kit cannot outlive its franchise.
 *
 * MAPPING NOTE — the brief named five shows: Tire Court, Evidence Lab, Ohio
 * Rust Olympics, Car ER, NASA Alignment. Four already exist here under other
 * names (`pothole_court`, `tire_autopsy`, `rust_files`, `can_it_be_saved`) and
 * are given the brief's tone rather than being duplicated. "NASA Alignment" has
 * NO existing franchise; it is recorded in `UNHOUSED_SHOW_CONCEPTS` below
 * instead of being smuggled in as a thirteenth entry, because adding a
 * franchise is a decision about the publishing schedule, not a data edit.
 *
 * AUDIO IS MUTED-FIRST. Every palette carries `mutedFirstEquivalent`: what
 * carries the same beat with the sound off. Instagram plays muted by default,
 * so a palette that only works with audio is a palette that mostly does not
 * work — the existing quality score already awards 10 points for muted-first
 * clarity, and an audio identity that ignores it fights its own gate.
 *
 * Pure data. No DB, no network, no side effects.
 */
import { FRANCHISES, type FranchiseId } from "./contentFranchises";
import { BRAND_CAST } from "./brandBible";
import { DUA_ROLE_SPECS, type AbsurdityType, type AbsurdityLevel, type DuaRole } from "./dua";

export const DUA_KIT_VERSION = "dua-franchise-kits-v1" as const;

export interface DuaAudioPalette {
  /** The one sound that means "this show" within half a second. */
  signature: string;
  /** The bed the whole episode sits on. */
  ambience: string;
  /** How this show cuts between beats. */
  transition: string;
  /** The sound on the reveal. */
  payoffStinger: string;
  /** What carries the same beat with the sound off. Non-negotiable. */
  mutedFirstEquivalent: string;
}

export interface DuaFranchiseKit {
  franchiseId: FranchiseId;
  /** The absurd frame this show runs in. */
  absurdityType: AbsurdityType;
  /** Where this show normally sits on the dial. Never above the default cap. */
  defaultLevel: AbsurdityLevel;
  audio: DuaAudioPalette;
  /** Recurring audience language. Said the same way every episode, on purpose. */
  vocabulary: readonly string[];
  /** The ask. Tied to this show's format, not generic engagement bait. */
  participation: readonly string[];
  /** Which DUA roles this show casts. */
  roles: readonly DuaRole[];
}

export const DUA_FRANCHISE_KITS: Record<FranchiseId, DuaFranchiseKit> = {
  pothole_court: {
    franchiseId: "pothole_court",
    absurdityType: "institutional_trial",
    defaultLevel: 3,
    audio: {
      signature: "a single gavel strike, close-mic'd, with room tail",
      ambience: "a large quiet room — low HVAC hum, occasional distant chair scrape",
      transition: "paper shuffle into a hard silence",
      payoffStinger: "gavel, then two seconds of nothing",
      mutedFirstEquivalent: "a hard cut to black with the verdict card held one full beat longer than any other card",
    },
    vocabulary: ["Exhibit A", "The defendant", "Sustained", "The metal doesn't lie", "Court is in session"],
    participation: ["Sentence this tire: repair, replace, or dismissed?", "Which exhibit convicted it — A, B, or C?"],
    roles: ["the_judge", "the_defendant", "cleveland"],
  },

  tire_autopsy: {
    franchiseId: "tire_autopsy",
    absurdityType: "forensic_investigation",
    defaultLevel: 3,
    audio: {
      signature: "a clinical tone sweep, like a scanner passing over a surface",
      ambience: "cold room tone, faint fluorescent buzz",
      transition: "a soft magnetic click between examination passes",
      payoffStinger: "the sweep stops dead on the defect",
      mutedFirstEquivalent: "the scanning line freezes and a marker dot lands — motion stopping IS the stinger",
    },
    vocabulary: ["Exhibit A", "The examiner", "Cause of death", "Under the skin", "The metal doesn't lie"],
    participation: ["Diagnose it before we open it.", "Shoulder or centre — where did it start?"],
    roles: ["the_examiner", "the_defendant"],
  },

  dashboard_after_dark: {
    franchiseId: "dashboard_after_dark",
    absurdityType: "personification",
    defaultLevel: 4,
    audio: {
      signature: "the ignition chime, slowed and pitched down",
      ambience: "night interior — rain on glass, engine off, faint electrical hum",
      transition: "one indicator relay tick",
      payoffStinger: "every light extinguishes at once except the right one",
      mutedFirstEquivalent: "the lights argue by pulsing in turn; the correct one is the last still lit",
    },
    vocabulary: ["The Rookie's wrong again", "A code names a system, not a part", "Who lit up first?"],
    participation: ["Suspect A, B, or C — which light is telling the truth?", "Which one is your car doing tonight?"],
    roles: ["the_rookie", "the_judge"],
  },

  cleveland_car_survival: {
    franchiseId: "cleveland_car_survival",
    absurdityType: "sports_commentary",
    defaultLevel: 3,
    audio: {
      signature: "a stadium crowd swelling under a play-by-play cadence",
      ambience: "wind across an open lot, road brine crunch underfoot",
      transition: "an air-horn blast cut short",
      payoffStinger: "the crowd drops out completely on the damage reveal",
      mutedFirstEquivalent: "a scoreboard-style card counts the hit, then the crowd card empties to a still frame",
    },
    vocabulary: ["Euclid Avenue Survivor", "Ohio Rust Olympics", "The Metal Has Spoken", "Salt season"],
    participation: ["Score it 1-10: how did your car survive this week?", "Euclid Avenue Survivor or not — you tell us."],
    roles: ["cleveland", "the_judge"],
  },

  can_it_be_saved: {
    franchiseId: "can_it_be_saved",
    absurdityType: "medical_drama",
    defaultLevel: 3,
    audio: {
      signature: "a steady monitor beep that the edit is timed to",
      ambience: "a bright bay — ventilation, distant tool noise, no voices",
      transition: "the beep skips exactly one interval",
      payoffStinger: "the beep resolves to a steady tone, or does not",
      mutedFirstEquivalent: "a pulsing indicator drives the cut rhythm; it holds steady or flatlines on screen",
    },
    vocabulary: ["Triage", "Maypop", "Can it be saved?", "The metal doesn't lie"],
    participation: ["Call it before we do: saved or gone?", "Triage these three — which goes in the bay first?"],
    roles: ["the_examiner", "the_defendant", "the_old_mechanic"],
  },

  mechanic_myth_lab: {
    franchiseId: "mechanic_myth_lab",
    absurdityType: "nature_documentary",
    defaultLevel: 3,
    audio: {
      signature: "a hushed narrator's breath before the first word",
      ambience: "still air, one distant drip, the sense of a very quiet observer",
      transition: "a slow tape-style whoosh between habitats",
      payoffStinger: "the narration stops mid-sentence when the myth fails",
      mutedFirstEquivalent: "the myth card and the observed card share the frame; one visibly loses",
    },
    vocabulary: ["In its natural habitat", "The myth, observed", "Maypop", "Do not guess"],
    participation: ["Which one did you believe?", "Send this to whoever taught you that."],
    roles: ["the_examiner", "the_rookie"],
  },

  rust_files: {
    franchiseId: "rust_files",
    absurdityType: "museum_archaeology",
    defaultLevel: 3,
    audio: {
      signature: "a low archival hum, like a room kept at a fixed temperature",
      ambience: "deep quiet, faint metal contraction ticks",
      transition: "a case lid settling shut",
      payoffStinger: "one long metallic groan under the final frame",
      mutedFirstEquivalent: "a catalogue card slides in under the specimen and holds",
    },
    vocabulary: ["The Rust Files", "Specimen", "Euclid Avenue Survivor", "Salt pays for traction in metal"],
    participation: ["Date this specimen: how many winters?", "Score the corrosion 1-10 before the reveal."],
    roles: ["cleveland", "the_examiner", "the_old_mechanic"],
  },

  sunday_rescue_simulator: {
    franchiseId: "sunday_rescue_simulator",
    absurdityType: "video_game_hud",
    defaultLevel: 4,
    audio: {
      signature: "a game-menu confirm blip",
      ambience: "an empty Sunday street — wind, one distant car, no traffic",
      transition: "a level-load riser",
      payoffStinger: "a quest-complete chime, or a failure buzz",
      mutedFirstEquivalent: "an on-screen objective meter fills or empties; the outcome is a visual state, not a sound",
    },
    vocabulary: ["Sunday, and everything's shut", "Objective", "Run it back", "We're open"],
    participation: ["Pick your move: wait it out, call around, or drive on it?", "Run it back — what would you have done?"],
    roles: ["the_rookie", "the_judge"],
  },

  review_reconstructed: {
    franchiseId: "review_reconstructed",
    absurdityType: "personification",
    defaultLevel: 2,
    audio: {
      signature: "a single page turn before the first frame",
      ambience: "warm room tone, low and unhurried",
      transition: "a soft dissolve with no sound at all",
      payoffStinger: "the room tone drops out under the closing line",
      mutedFirstEquivalent: "the quoted line is held on screen long enough to read twice",
    },
    vocabulary: ["Reconstructed", "In their words", "The metal doesn't lie"],
    participation: ["Recognise this one? Tell us how yours went.", "Which part of this happened to you too?"],
    roles: ["the_old_mechanic"],
  },

  recall_radar: {
    franchiseId: "recall_radar",
    absurdityType: "mission_control",
    defaultLevel: 3,
    audio: {
      signature: "radio static breaking into a clear channel",
      ambience: "a room of consoles — soft switch clicks, steady fan noise",
      transition: "a channel-change squelch",
      payoffStinger: "the channel goes clear and stays clear",
      mutedFirstEquivalent: "a console indicator moves from a held state to a cleared state on screen",
    },
    vocabulary: ["Radar contact", "One action clears it", "Go / no-go", "Check your VIN"],
    participation: ["Is your model on this list? Check and report back.", "Go or no-go — did yours clear?"],
    roles: ["the_judge", "the_rookie"],
  },

  echeck_escape_room: {
    franchiseId: "echeck_escape_room",
    absurdityType: "bureaucracy_parody",
    defaultLevel: 3,
    audio: {
      signature: "a rubber stamp landing on a desk",
      ambience: "a waiting room — a clock, a distant door, nobody talking",
      transition: "a drawer closing on a form",
      payoffStinger: "the stamp lands, or the drawer closes without it",
      mutedFirstEquivalent: "a checklist card fills one row at a time; the last row is the whole story",
    },
    vocabulary: ["Readiness monitors", "Not ready", "One more drive cycle", "Do not guess"],
    participation: ["Guess the blocker before we reveal it.", "How many monitors were you short?"],
    roles: ["the_rookie", "the_judge"],
  },

  choose_the_ending: {
    franchiseId: "choose_the_ending",
    absurdityType: "financial_market",
    defaultLevel: 3,
    audio: {
      signature: "a ticker's mechanical clatter running under both timelines",
      ambience: "two identical road beds, one gaining a rattle",
      transition: "the ticker speeds up on the ignored branch",
      payoffStinger: "one branch's ticker stops; the other keeps running",
      mutedFirstEquivalent: "a split screen where one side's counter keeps climbing and the other flatlines",
    },
    vocabulary: ["Two versions of the same drive", "The cheap moment before the expensive one", "Which one are you living?"],
    participation: ["Which ending are you living? A or B.", "Comment A or B and we'll tell you what happens next."],
    roles: ["the_judge", "cleveland"],
  },
};

/**
 * Shows the brief named that have no franchise behind them.
 *
 * Recorded rather than quietly created. Adding a thirteenth franchise changes
 * the publishing rotation and needs `requiredEvidence` and `blockingConditions`
 * written for it — that is an operator decision, not a data edit, and a kit
 * with no show to belong to would be the built-unwired shape this repo keeps
 * re-learning.
 */
export const UNHOUSED_SHOW_CONCEPTS: readonly { name: string; absurdityType: AbsurdityType; note: string }[] = [
  {
    name: "NASA Alignment",
    absurdityType: "mission_control",
    note:
      "Mission-control framing for alignment tolerance. No franchise covers it; `recall_radar` borrows the mission-control PALETTE but is about recalls, not geometry. " +
      "Needs its own `requiredEvidence` (manufacturer alignment spec) before it can ship, because the whole bit turns on a tolerance window and inventing that window is this frame's named failure mode.",
  },
];

/** Every phrase the kits teach the audience, deduplicated. */
export const DUA_AUDIENCE_VOCABULARY: readonly string[] = [
  ...new Set(Object.values(DUA_FRANCHISE_KITS).flatMap((k) => k.vocabulary)),
];

/**
 * THE METAL speaks once per episode and its signature line is fixed by the
 * brand bible ("one line per episode, never two — repetition destroys the
 * signature"). "The Metal Has Spoken" therefore exists in
 * `cleveland_car_survival` as an ON-SCREEN VERDICT CARD, never as a second
 * spoken line for that character. Anything that renders kit vocabulary as
 * dialogue must consult this list first.
 */
export const OVERLAY_ONLY_VOCABULARY: readonly string[] = ["The Metal Has Spoken", "Ohio Rust Olympics", "Euclid Avenue Survivor"];

/** The kit for a franchise, or null. Never invents a default — a show without a
 *  kit is a real gap and should read as one. */
export function kitFor(franchiseId: FranchiseId): DuaFranchiseKit | null {
  return DUA_FRANCHISE_KITS[franchiseId] ?? null;
}

/**
 * Prompt fragment for a franchise's DUA identity. Kept as a function so a kit
 * edit reaches every downstream prompt in one place, matching
 * `buildBrandBibleFragment()`.
 */
export function buildDuaKitFragment(franchiseId: FranchiseId): string {
  const kit = kitFor(franchiseId);
  const franchise = FRANCHISES[franchiseId];
  if (!kit || !franchise) return "";
  const cast = franchise.cast.map((id) => BRAND_CAST[id]?.name ?? id).join(", ");
  const roles = kit.roles.map((r) => DUA_ROLE_SPECS[r].label).join(", ");
  return [
    `DUA KIT — ${franchise.name} (${DUA_KIT_VERSION}).`,
    `Absurd frame: ${kit.absurdityType}. Working level: ${kit.defaultLevel} of 5.`,
    `Signature sound: ${kit.audio.signature}. Bed: ${kit.audio.ambience}. Payoff: ${kit.audio.payoffStinger}.`,
    `MUTED-FIRST: ${kit.audio.mutedFirstEquivalent}. The reel must land with the sound off.`,
    `Recurring language: ${kit.vocabulary.join(" / ")}.`,
    `Overlay-only (never spoken): ${OVERLAY_ONLY_VOCABULARY.join(" / ")}.`,
    `Ask: ${kit.participation[0]}`,
    `Cast: ${cast}. Roles: ${roles}.`,
    "The absurd frame is packaging. The mechanical fact underneath is never absurd.",
  ].join("\n");
}
