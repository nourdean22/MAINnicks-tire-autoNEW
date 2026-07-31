/**
 * CLEVELAND MECHANICAL NOIR — the versioned brand bible for Nick's generated
 * content universe.
 *
 * Governing principle: GENERATED MEDIA. VERIFIED REALITY. NO FAKE EVIDENCE.
 * Every visual may be synthetic. No synthetic asset may stand in as evidence
 * that a real customer, vehicle, employee, repair or event existed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE NARRATOR HAS NO BODY
 *
 * The obvious design — a uniformed digital mechanic who talks to camera —
 * cannot render here. `FACE_SUBJECT_PATTERN` blocks `man|woman|mechanic
 * speaking|presenter|spokesperson|glove[ds]|human hands|hands grip…`, so a
 * humanoid host would block on essentially every beat, and the faceless rule is
 * load-bearing, not decorative.
 *
 * Rather than carve an exemption, NICK-01 is defined as a DISEMBODIED PRESENCE:
 * a scanning beam, a gold inspection light, a reticle that finds the defect.
 * Voice and light, never a body. Three things fall out of that, all good:
 *   1. It passes the faceless gate by construction, not by exception.
 *   2. It is not photorealistic human video, so Meta's realistic-AI disclosure
 *      burden does not attach to the narrator itself.
 *   3. "An AI actor presented as a real Nick's employee" becomes structurally
 *      impossible rather than a rule someone has to remember.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CAST IS MOSTLY ALREADY BUILT
 *
 * `OBJECT_CHARACTERS` in facelessReelStudio.ts already carries a validated
 * 14-strong faceless cast. The named ensemble binds to it instead of forking a
 * parallel one — a second character registry would be exactly the competing-
 * authority defect this system keeps re-learning.
 */
import type { ObjectCharacter } from "../client/src/lib/facelessReelStudio";

export const BRAND_BIBLE_VERSION = "cleveland-mechanical-noir-v1" as const;

// ─── Visual language ───────────────────────────────────────────────

/** Palette. Hex is authoritative; the names are what prompts should say, since
 *  a generator cannot read a hex code but does understand "warning-light red". */
export const NOIR_PALETTE = {
  black: { hex: "#0B0B0C", prompt: "deep matte black" },
  graphite: { hex: "#2A2D31", prompt: "graphite grey metal" },
  nicksGold: { hex: "#C8A23C", prompt: "warm brushed gold" },
  icyBlue: { hex: "#7FD3E8", prompt: "cold icy blue light" },
  warningRed: { hex: "#E0362B", prompt: "warning-light red" },
} as const;

/** Environments. Cleveland-specific and seasonal — the local texture is the
 *  differentiator, and it is also what makes a reel worth sending to someone
 *  who drives the same roads. */
export const NOIR_ENVIRONMENTS = [
  "rain-slicked night asphalt with sodium reflections",
  "salt-crusted winter underbody, road brine drying white",
  "pothole-scarred Cleveland side street, freeze-thaw cracked",
  "cold garage bay, breath-fog cold, single overhead work light",
  "lake-effect snow blowing across a dark parking lot",
  "summer heat shimmer over blacktop",
] as const;

/** Camera grammar. Every entry is deliberately WORDLESS — none of these depend
 *  on rendered text, so they cannot trip the in-frame-text gate. */
export const NOIR_CAMERA_GRAMMAR = [
  "macro on metal grain and rubber texture",
  "slow orbit around a single isolated part",
  "cross-section cutaway revealing interior structure",
  "x-ray scan pass, interior lit from within",
  "impact captured in high-speed slow motion",
  "cold-open push-in on the defect before any context",
] as const;

export const NOIR_COMPOSITION = {
  aspectRatio: "9:16",
  /** The first frame IS the hook. Instagram distributes reels on watch time,
   *  and the 3-second hold rate is decided before a viewer hears a word. */
  firstFrameRule: "open on the physical defect, never on a title card, logo, or greeting",
  /** On-screen words are an ffmpeg overlay added AFTER generation — never
   *  generated, because the video model cannot spell. */
  typography: "industrial condensed sans, added as an overlay, never generated in-frame",
} as const;

// ─── Cast ──────────────────────────────────────────────────────────

export type BrandCharacterId = "nick_01" | "the_metal" | "the_pothole" | "rust" | "check" | "tread";

export interface BrandCharacter {
  id: BrandCharacterId;
  name: string;
  /** How the character may be rendered. MUST NOT describe a face, hands, arms,
   *  gloves or a speaking person — those block on the faceless gate. */
  embodiment: string;
  voice: string;
  personality: string;
  /** Existing faceless-cast member this binds to, when one already covers it.
   *  null = voice/presence only, never a rendered subject. */
  objectCharacter: ObjectCharacter | null;
  /** Invariants that must survive every generation. */
  lockedInvariants: string[];
  /** Things that must never be generated for this character. */
  prohibited: string[];
}

export const BRAND_CAST: Record<BrandCharacterId, BrandCharacter> = {
  nick_01: {
    id: "nick_01",
    name: "NICK-01",
    embodiment:
      "a disembodied inspection presence — a narrow gold scanning beam and a floating reticle that finds and holds on the defect. Light and motion only; no body, no figure, no silhouette.",
    voice: "calm, level, unhurried; explains rather than sells; never alarmed",
    personality: "the one who looks before speaking. States what the metal shows, then what it means.",
    objectCharacter: null,
    lockedInvariants: [
      "gold beam, icy-blue reticle, always the same two colours",
      "moves deliberately — never a fast whip or a jump scare",
      "arrives AFTER the defect is on screen, never before",
    ],
    prohibited: [
      "any body, silhouette, face, hands, arms, gloves or uniform",
      "being named, implied or captioned as a real Nick's employee or technician",
      "quoting a diagnosis attributed to a real person",
    ],
  },
  the_metal: {
    id: "the_metal",
    name: "THE METAL",
    embodiment: "voice only, over the final reveal frame. Never rendered as a subject.",
    voice: "deep, slow, close-mic'd; used for exactly one line per episode",
    personality: "the closing verdict. Speaks last, speaks once.",
    objectCharacter: null,
    lockedInvariants: [
      'the signature line is "The metal doesn\'t lie" and it lands on the final reveal',
      "one line per episode, never two — repetition destroys the signature",
    ],
    prohibited: [
      "predicting when a part will fail",
      "any line implying a vehicle is unsafe to drive without an inspection",
    ],
  },
  the_pothole: {
    id: "the_pothole",
    name: "THE POTHOLE",
    embodiment: "the road defect itself, shot as a character — rim-lit edges, depth, standing water",
    voice: "none; it never speaks",
    personality: "patient, indifferent, always there. It does not chase; it waits.",
    objectCharacter: "pothole_gremlin",
    lockedInvariants: ["never anthropomorphised into a creature with a face or limbs"],
    prohibited: ["depicting a real identifiable Cleveland street address as the site of a specific event"],
  },
  rust: {
    id: "rust",
    name: "RUST",
    embodiment: "creeping oxidation spreading across a joint or seam, time-lapsed",
    voice: "none",
    personality: "slow, patient, quiet. Never hurries, never stops.",
    objectCharacter: "rust_creeping_villain",
    lockedInvariants: ["spreads along real corrosion paths — seams, fasteners, brake lines"],
    prohibited: [
      "stating a corroded part will fail within any specific timeframe",
      "implying corrosion severity that the evidence does not support",
    ],
  },
  check: {
    id: "check",
    name: "CHECK",
    embodiment: "the check-engine glyph as a lit object in space — pulsing, never a face",
    voice: "anxious, quick, wrong first",
    personality: "blames the wrong component confidently, then gets corrected.",
    objectCharacter: "check_engine_smoke_alarm",
    lockedInvariants: [
      "CHECK is always wrong first — that IS the format",
      "the episode must state that a code names a SYSTEM or a detected condition, never the failed part",
    ],
    prohibited: ["asserting that a specific code equals a specific failed component"],
  },
  tread: {
    id: "tread",
    name: "TREAD",
    embodiment: "tread blocks and grooves examined in macro, water channels traced under light",
    voice: "methodical, procedural",
    personality: "the detective. Measures before concluding.",
    objectCharacter: "penny_test_inspector",
    lockedInvariants: ["depth claims cite the measured number, never an eyeball estimate"],
    prohibited: ["claiming a repairability verdict without showing puncture location"],
  },
};

/** The narrator presences carry no rendered body, so they are the only cast
 *  members safe to use when a beat would otherwise need a human subject. */
export const DISEMBODIED_CAST: readonly BrandCharacterId[] = ["nick_01", "the_metal"];

/**
 * Prompt fragment for the brand bible. Kept as a function so a bible version
 * bump changes every downstream prompt in one place.
 */
export function buildBrandBibleFragment(): string {
  const palette = Object.values(NOIR_PALETTE).map((c) => c.prompt).join(", ");
  return [
    `VISUAL BIBLE — ${BRAND_BIBLE_VERSION} (Cleveland Mechanical Noir).`,
    `Palette: ${palette}. Nothing outside this palette.`,
    `Environments: ${NOIR_ENVIRONMENTS.slice(0, 3).join(" / ")}.`,
    `Camera: ${NOIR_CAMERA_GRAMMAR.slice(0, 4).join("; ")}.`,
    `Composition: ${NOIR_COMPOSITION.aspectRatio}. ${NOIR_COMPOSITION.firstFrameRule}.`,
    `Typography: ${NOIR_COMPOSITION.typography}.`,
    `NARRATOR: NICK-01 is a gold scanning beam and an icy-blue reticle — light and motion only.`,
    `NEVER render a body, face, hands, arms, gloves, uniform or any speaking person.`,
    `NICK-01 is a brand character and must never be presented as a real Nick's employee.`,
  ].join("\n");
}
