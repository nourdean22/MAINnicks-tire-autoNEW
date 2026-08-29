/**
 * Delightfully Useful Absurdity (DUA) — concept model + hard gates.
 *
 * THE ONE RULE
 *   Be absurd about the presentation. Never be absurd about the truth.
 *
 * The absurd frame is packaging. The mechanical fact underneath must be real,
 * sourced, and UNCHANGED by the joke. This is not a style preference: a reel
 * shipped with three false claims about Ohio E-Check law burned into audio and
 * pixels, where no copy edit could reach them. Comedy makes that failure more
 * likely, not less, because a funny frame invites invented specifics.
 *
 * WHY THIS FILE EXISTS AT ALL — this repo already had most of the vocabulary
 * and none of the enforcement:
 *   · `ReelConceptScores.absurdity` (facelessReelStudio.ts) SCORES absurdity
 *     0-10 into a 60-point total, so a 10/10 irrelevant joke and a 7/10
 *     perfectly relevant one are interchangeable. Relevance is not a score
 *     here. It is a gate.
 *   · `igCarouselStudioPrompt.ts:181` tells the model "absurdity is a TEACHING
 *     DEVICE ... if the absurd image doesn't teach the fact, cut it" — as
 *     PROSE IN A PROMPT. Nothing checked it.
 *   · `contentFranchises.ts` declares `blockingConditions`, `requiredEvidence`
 *     and `disclosure` for all twelve shows, and `brand-universe.test.ts:96-97`
 *     asserts only that those arrays are NON-EMPTY. Presence, not behaviour.
 *     No runtime reader existed until this file.
 *
 * THE LOAD-BEARING FINDING (why relevance is a gate, not a score)
 * Strong humour DAMAGES memory for the underlying claim when the joke is only
 * loosely related to the message, and the damage disappears when relevance is
 * high. An irrelevant joke is therefore not neutral-but-fun; it is actively
 * worse than no joke, because it costs the fact. So the test is not "is this
 * funny" or even "is this on-topic" — it is: COULD THIS FRAME BE SWAPPED FOR
 * ANOTHER TOPIC'S FRAME AND STILL WORK? If yes, the joke is decoration sitting
 * beside the fact instead of being the mechanism that teaches it.
 *
 * WHAT A LINTER CAN AND CANNOT DO — the same doctrine as
 * `detectFabricatedStats`: we cannot fact-check inside a pure function. We CAN
 * refuse the SHAPE the defect takes. A decorative frame has a measurable
 * signature: strip the fact's mechanism terms out of the frame's own words and
 * nothing is missing. That signature is what "the frame could be swapped for
 * any other topic" reduces to, and it is the half a pure function can decide.
 *
 * Pure: no DB, no network, no clock, no side effects.
 */
import { FRANCHISES, type FranchiseId } from "./contentFranchises";
import { BRAND_CAST, type BrandCharacterId } from "./brandBible";
import { requiresAiDisclosure, type DisclosureMode } from "./episodeContract";
import { ABSURDITY_CONCEPTS } from "./absurdityConcepts";

export const DUA_MODEL_VERSION = "dua-v1" as const;

// ─── Absurdity types (the archetype bank) ──────────────────────────
//
// These are ABSURD FRAMES — the borrowed institution the joke runs inside.
// Deliberately a different axis from `ReelArchetype` (story shape: loop, POV,
// countdown) and `MotionLens` (visual treatment: macro, blueprint, claymation)
// in facelessReelStudio.ts. One reel picks one of each: a courtroom frame
// (type) told as a tiny cinematic story (archetype) shot in forensic evidence
// scan (lens). Folding them into one enum was tempting and wrong — it would
// have made "courtroom" and "claymation" mutually exclusive.

export const ABSURDITY_TYPES = [
  "personification",
  "institutional_trial",
  "bureaucracy_parody",
  "sports_commentary",
  "nature_documentary",
  "medical_drama",
  "forensic_investigation",
  "luxury_product_parody",
  "mission_control",
  "financial_market",
  "video_game_hud",
  "museum_archaeology",
] as const;

export type AbsurdityType = (typeof ABSURDITY_TYPES)[number];

export interface AbsurdityTypeSpec {
  label: string;
  /** The borrowed institution and what it lends the explanation. */
  essence: string;
  /** WHY this frame teaches — the cognitive job it does for the fact. This is
   *  what a concept must actually deliver on, not a flavour note. */
  teachingMechanism: string;
  /** The characteristic way this frame goes wrong. Every one is a route to
   *  inventing evidence, which is the failure this file exists for. */
  failureMode: string;
}

export const ABSURDITY_TYPE_SPECS: Record<AbsurdityType, AbsurdityTypeSpec> = {
  personification: {
    label: "Personification",
    essence: "The part has a want, a job, and a bad day. Posture and motion only — never a face.",
    teachingMechanism:
      "gives an invisible mechanical process an intent the viewer can predict, so the failure mode becomes a story beat instead of a spec",
    failureMode: "the character's feelings replace the mechanism and the viewer remembers a mood, not a check",
  },
  institutional_trial: {
    label: "Institutional / Courtroom",
    essence: "Tire Court. The damaged part is the defendant; the evidence, not the narrator, decides.",
    teachingMechanism:
      "forces the fact into a burden-of-proof structure, so the viewer learns which observation actually implicates which part",
    failureMode: "a verdict is delivered that the physical evidence never supported — the highest-risk frame in this bank",
  },
  bureaucracy_parody: {
    label: "Bureaucracy Parody",
    essence: "Forms, queues, rubber stamps, and a department that will not help until the right box is ticked.",
    teachingMechanism: "makes a required sequence memorable by dramatising what happens when a step is skipped",
    failureMode: "inventing a rule, a form, or an authority that does not exist — especially near real regulation such as Ohio E-Check",
  },
  sports_commentary: {
    label: "Sports Commentary",
    essence: "Ohio Rust Olympics. Play-by-play over a slow corrosion event.",
    teachingMechanism: "the commentator names the moment of failure as it happens, which teaches the viewer what to watch for",
    failureMode: "manufacturing scores, times, records and rankings that read as measurements",
  },
  nature_documentary: {
    label: "Nature Documentary",
    essence: "A hushed narrator tracks the elusive coolant through its natural habitat.",
    teachingMechanism: "reframes a routine part as an observed specimen, licensing slow close inspection the viewer would skip",
    failureMode: "documentary authority lends false weight to an unsourced claim",
  },
  medical_drama: {
    label: "Medical Drama",
    essence: "Car ER. Triage, monitors, and a calm voice over an urgent bay.",
    teachingMechanism: "sorts symptoms by urgency, which is exactly the judgement a driver has to make",
    failureMode: "diagnosing from a symptom, or dramatising urgency the evidence does not support",
  },
  forensic_investigation: {
    label: "Forensic Investigation",
    essence: "Evidence Lab. Markers, sweeps, and magnification on a part that cannot testify.",
    teachingMechanism: "separates observation from conclusion — the viewer sees the clue before the meaning",
    failureMode: "lab-coat framing that asserts a test was run and returned a number",
  },
  luxury_product_parody: {
    label: "Luxury-Product Parody",
    essence: "Flagship-launch lighting and reverent voiceover for a valve cap.",
    teachingMechanism: "the mismatch between reverence and importance makes a genuinely overlooked cheap part impossible to forget",
    failureMode: "the joke lands on the price, and reel copy may never carry one",
  },
  mission_control: {
    label: "Mission Control",
    essence: "NASA Alignment. Consoles, callouts, and a hold at T-minus for one out-of-spec axis.",
    teachingMechanism: "makes tolerance concrete — a value is either inside the window or the launch stops",
    failureMode: "inventing the tolerance window, i.e. fabricating the number the whole bit turns on",
  },
  financial_market: {
    label: "Financial-Market Parody",
    essence: "A ticker tracking what a deferred small job compounds into.",
    teachingMechanism: "makes deferred maintenance legible as compounding rather than as nagging",
    failureMode: "quoting money — reels carry no price claims at all",
  },
  video_game_hud: {
    label: "Video-Game HUD",
    essence: "Health bars, durability meters, and a quest marker over a wheel well.",
    teachingMechanism: "turns a continuous wear process into a readable state the viewer can check themselves",
    failureMode: "the meter implies a precise remaining-life reading nobody measured",
  },
  museum_archaeology: {
    label: "Museum / Archaeology",
    essence: "A brake line excavated, catalogued, and placed behind glass.",
    teachingMechanism: "distance in time makes slow damage visible in one frame",
    failureMode: "inventing a provenance, a date, or an age for the specimen",
  },
};

// ─── The absurdity dial ────────────────────────────────────────────
//
// Moderate incongruity outperforms extreme. Past the middle of the dial the
// frame stops being a surprising way to see a real thing and starts being
// confusing, and confusion is paid for in credibility — the single most
// valuable asset a neighbourhood repair shop has. 5 is reachable, deliberately.

export const ABSURDITY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type AbsurdityLevel = (typeof ABSURDITY_LEVELS)[number];

export const ABSURDITY_BAND = {
  /** Below this the frame is not doing work the plain fact could not do. */
  min: 2,
  /** Default ceiling. Above this, `levelOptIn` must be explicitly true. */
  max: 4,
  /** The absolute ceiling, reachable only with opt-in. */
  ceiling: 5,
} as const;

export const ABSURDITY_LEVEL_SPECS: Record<AbsurdityLevel, { label: string; essence: string }> = {
  0: { label: "Documentary", essence: "Straight explanation. No frame at all." },
  1: { label: "Dry aside", essence: "One wry line over an otherwise straight piece." },
  2: { label: "Light frame", essence: "A borrowed tone (commentary, bedside manner) over real footage." },
  3: { label: "Committed frame", essence: "The institution is fully built and sustained for the whole reel." },
  4: { label: "Heightened", essence: "The frame's internal logic drives the edit, the sound, and the payoff." },
  5: { label: "Fever dream", essence: "Scale, physics, or reality break. Opt-in only — it costs credibility to spend." },
};

// ─── Visual layers — the structural answer to generated evidence ───
//
// Three layers, and the boundary between them is enforced, not advisory:
//
//   A  Evidence     100% real shop footage. Generated content is FORBIDDEN.
//   B  Explanation  diagrams, arrows, callouts, data viz — authored, not shot.
//   C  Absurdity    the generated visual metaphor, clearly editorial.
//
// The point is structural. If generated pixels can only ever appear in the
// layer whose entire job is to be obviously editorial, then no generated pixel
// can ever be mistaken for a record of something that happened. AI creates the
// metaphor; real footage creates the evidence; a customer incident, repair,
// test, or before/after is never faked.
//
// Permission is MONOTONE down the stack: everything allowed in A is allowed in
// B, everything allowed in B is allowed in C. Only `generated` is C-exclusive.
// Written this way so a future origin cannot reach A by accident.

export const VISUAL_LAYERS = ["evidence", "explanation", "absurdity"] as const;
export type VisualLayer = (typeof VISUAL_LAYERS)[number];

export const ASSET_ORIGINS = ["real_footage", "authored_graphic", "generated"] as const;
export type AssetOrigin = (typeof ASSET_ORIGINS)[number];

export interface LayerContract {
  code: "A" | "B" | "C";
  label: string;
  purpose: string;
  allowedOrigins: readonly AssetOrigin[];
}

export const LAYER_CONTRACT: Record<VisualLayer, LayerContract> = {
  evidence: {
    code: "A",
    label: "Evidence",
    purpose: "What actually happened, in this shop, on this vehicle. The claim rests here.",
    allowedOrigins: ["real_footage"],
  },
  explanation: {
    code: "B",
    label: "Explanation",
    purpose: "Diagrams, arrows, callouts, data viz — authored to explain the evidence.",
    allowedOrigins: ["real_footage", "authored_graphic"],
  },
  absurdity: {
    code: "C",
    label: "Absurdity",
    purpose: "The generated visual metaphor. Clearly editorial, never a record.",
    allowedOrigins: ["real_footage", "authored_graphic", "generated"],
  },
};

export interface DuaAsset {
  id: string;
  layer: VisualLayer;
  origin: AssetOrigin;
  description: string;
}

// ─── Recurring cast — ROLES bound to the existing bible ────────────
//
// Faceless does not mean characterless; characterless is the failure mode of
// every AI content account. But a second character registry would be exactly
// the competing-authority defect `brandBible.ts` warns about in its own header,
// so these are ROLES that BIND to `BRAND_CAST`, not new characters.
// `boundTo: null` means a staging convention with no registered character.

export const DUA_ROLES = [
  "the_judge",
  "the_examiner",
  "the_defendant",
  "the_rookie",
  "the_old_mechanic",
  "cleveland",
] as const;
export type DuaRole = (typeof DUA_ROLES)[number];

export interface DuaRoleSpec {
  label: string;
  essence: string;
  boundTo: BrandCharacterId | null;
  /** Wordless, bodiless staging. Must survive the faceless + in-frame-text gates. */
  embodiment: string;
}

export const DUA_ROLE_SPECS: Record<DuaRole, DuaRoleSpec> = {
  the_judge: {
    label: "The Judge",
    essence: "Does not decide. Asks what the evidence shows, and waits.",
    boundTo: "nick_01",
    embodiment: "the gold scanning beam settling and holding still over the part under question",
  },
  the_examiner: {
    label: "The Examiner",
    essence: "Measures before concluding. Shows the clue before the meaning.",
    boundTo: "tread",
    embodiment: "a magnification pass and plain marker dots moving across a surface",
  },
  the_defendant: {
    label: "The Defendant",
    essence: "The broken part. Always the machine, never the driver who owns it.",
    boundTo: null,
    embodiment: "the failed component isolated in darkness, rim-lit, rotating slowly",
  },
  the_rookie: {
    label: "The Rookie",
    essence: "Confidently wrong first, corrected by the evidence. Carries the viewer's own misconception.",
    boundTo: "check",
    embodiment: "the check-engine glyph pulsing over the wrong component, then dimming as the beam moves on",
  },
  the_old_mechanic: {
    label: "The Old Mechanic",
    essence: "Speaks last, speaks once, and only about what the metal shows.",
    boundTo: "the_metal",
    embodiment: "voice only, over the final reveal frame. Never rendered as a subject.",
  },
  cleveland: {
    label: "Cleveland",
    essence: "An off-screen force, not a backdrop. Salt, freeze-thaw and Euclid Avenue act on the car.",
    boundTo: "the_pothole",
    embodiment: "road brine drying white, freeze-cracked asphalt, lake-effect snow crossing frame",
  },
};

// ─── The concept ───────────────────────────────────────────────────

/** What the joke is aimed at. `customer` exists so the gate can BLOCK it — it
 *  is never a legal value for a shipped concept. The machine is the character;
 *  the person who owns it is not the butt of anything. */
export type DuaSubject = "part" | "machine" | "road" | "weather" | "process" | "customer";

export interface DuaConcept {
  id: string;
  /** Which show this belongs to. Binds the concept to that franchise's
   *  `blockingConditions`, which nothing read before. */
  franchiseId?: FranchiseId;

  absurdityType: AbsurdityType;
  absurdityLevel: AbsurdityLevel;
  /** Required at level 5. Absent or false at level 5 blocks. */
  levelOptIn?: boolean;

  subject: DuaSubject;

  /** What is wrong / out of place — the incongruity itself. */
  violation: string;
  /** Why it is harmless, and therefore funny rather than alarming. */
  benignResolution: string;
  /** The real mechanical fact the frame exists to teach. */
  usefulFact: string;
  /** Proof-source labels for `usefulFact`. Empty means unverified, which blocks. */
  factSources: readonly string[];

  brandConnection: string;
  audienceParticipation: string;
  visualMetaphor: string;
  audioMetaphor: string;
  payoff: string;

  assets?: readonly DuaAsset[];
  roles?: readonly DuaRole[];
  /** Required once any asset is `generated`. Layering confines generated pixels
   *  to Layer C; it does NOT discharge the platform's AI-labelling duty. */
  disclosureMode?: DisclosureMode;
}

// ─── Mechanism-term extraction ─────────────────────────────────────

const STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "also", "another", "because", "been", "before",
  "being", "below", "between", "both", "cannot", "could", "does", "doing", "down", "during",
  "each", "even", "ever", "every", "from", "have", "here", "into", "just", "like", "make",
  "makes", "many", "more", "most", "much", "must", "never", "next", "onto", "only", "other",
  "over", "same", "should", "since", "some", "such", "than", "that", "their", "them", "then",
  "there", "these", "they", "thing", "things", "this", "those", "through", "under", "until",
  "very", "want", "well", "were", "what", "when", "where", "which", "while", "will", "with",
  "would", "your", "yours", "still", "keep", "keeps", "take", "takes", "give", "gives", "look",
  "looks", "come", "comes", "goes", "gets", "back", "know", "knows", "little", "worth", "really",
  "actually", "something", "anything", "everything", "nothing", "someone", "always",
]);

/** Short domain tokens the >=4 length filter would otherwise discard. Every one
 *  is a mechanism term in this content, not a function word. */
const SHORT_DOMAIN_TERMS = new Set([
  "psi", "mph", "oil", "air", "gas", "dot", "abs", "tpms", "ice", "wet", "dry", "hot", "cold",
  "low", "pad", "rim", "cap", "fan", "hum", "toe", "cat", "o2", "cv", "pcv", "maf", "ac",
]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length - 3 >= 4 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length - 2 >= 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length - 2 >= 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length - 1 >= 4 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

/**
 * The mechanism terms a piece of text carries. Measurement tokens ("2/32",
 * "45") survive intact — they are frequently the whole point of the fact.
 */
export function mechanismTerms(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z][a-z-]*|\d+(?:\/\d+)?/g) ?? [];
  const out = new Set<string>();
  for (const token of raw) {
    const t = token.replace(/-/g, "");
    if (!t) continue;
    if (/\d/.test(t)) {
      out.add(t);
      continue;
    }
    if (SHORT_DOMAIN_TERMS.has(t)) {
      out.add(t);
      continue;
    }
    if (t.length < 4 || STOPWORDS.has(t)) continue;
    out.add(stem(t));
  }
  return [...out];
}

/** Which of `terms` appear in `text`. */
function carriedIn(terms: readonly string[], text: string): string[] {
  if (terms.length === 0) return [];
  const present = new Set(mechanismTerms(text));
  return terms.filter((t) => present.has(t));
}

// ─── Relevance: the hard gate ──────────────────────────────────────

/** The three surfaces that constitute the joke's structure. If the mechanism is
 *  not present here, the frame is beside the fact, not carrying it. */
export const RELEVANCE_SURFACES = ["violation", "visualMetaphor", "payoff"] as const;
export type RelevanceSurface = (typeof RELEVANCE_SURFACES)[number];

/** At least this many of the three structural surfaces must carry the mechanism. */
export const RELEVANCE_MIN_SURFACES = 2;
/** And at least this many distinct mechanism terms must appear across the frame. */
export const RELEVANCE_MIN_TERMS = 2;

export type RelevanceInput = Pick<DuaConcept, "usefulFact" | "violation" | "visualMetaphor" | "payoff">;

export interface RelevanceReading {
  factTerms: string[];
  carried: Record<RelevanceSurface, string[]>;
  /** Distinct mechanism terms present anywhere in the structural surfaces. */
  distinctTerms: string[];
  surfacesCarrying: number;
  /** distinctTerms / factTerms — how much of the fact the frame is holding. */
  ratio: number;
  relevant: boolean;
  reason: string;
}

/**
 * Does the frame carry the fact's mechanism, or sit beside it?
 *
 * Deliberately lexical. This cannot judge whether a metaphor is APT — it can
 * only detect the signature of decoration, which is that the fact's own
 * mechanism words are absent from the joke's own words.
 */
export function readRelevance(concept: RelevanceInput): RelevanceReading {
  const factTerms = mechanismTerms(concept.usefulFact);
  const carried: Record<RelevanceSurface, string[]> = {
    violation: carriedIn(factTerms, concept.violation),
    visualMetaphor: carriedIn(factTerms, concept.visualMetaphor),
    payoff: carriedIn(factTerms, concept.payoff),
  };

  const distinctTerms = [...new Set(Object.values(carried).flat())];
  const surfacesCarrying = RELEVANCE_SURFACES.filter((s) => carried[s].length > 0).length;
  const ratio = factTerms.length === 0 ? 0 : distinctTerms.length / factTerms.length;
  const relevant = surfacesCarrying >= RELEVANCE_MIN_SURFACES && distinctTerms.length >= RELEVANCE_MIN_TERMS;

  const missing = RELEVANCE_SURFACES.filter((s) => carried[s].length === 0);
  const reason = relevant
    ? `frame carries ${distinctTerms.length} mechanism term(s) across ${surfacesCarrying}/3 structural surfaces`
    : factTerms.length === 0
      ? "usefulFact carries no mechanism terms to test against"
      : `frame is decoration: ${missing.join(", ")} carr${missing.length === 1 ? "ies" : "y"} none of the fact's mechanism ` +
        `(${distinctTerms.length} distinct term(s) across ${surfacesCarrying}/3 surfaces; need ${RELEVANCE_MIN_TERMS} across ${RELEVANCE_MIN_SURFACES})`;

  return { factTerms, carried, distinctTerms, surfacesCarrying, ratio, relevant, reason };
}

/**
 * The swap test, run for real.
 *
 * Score the frame against its OWN fact, then against a corpus of other topics'
 * facts. If some foreign fact fits the frame at least as well as its own, the
 * frame is portable — it teaches nothing specific and would work as-is over a
 * different topic. That is the disqualifying condition.
 *
 * TERMS ARE WEIGHTED BY RARITY, and that is the whole reason this works.
 * The first draft compared raw coverage ratios and reported PORTABLE on 6 of 6
 * genuinely-relevant authored concepts — a 100% false-positive rate. Two causes,
 * both fixed here:
 *
 *   1. Ratio-of-terms is biased by fact LENGTH. A frame carrying 3 terms of a
 *      20-term fact scores 0.15; the same frame accidentally carrying 2 terms
 *      of a 5-term foreign clause scores 0.40 and "wins". Fair comparison needs
 *      a length-independent score, so this sums weights instead of dividing.
 *   2. Generic connective terms are what MAKE a frame look portable, and they
 *      were counted the same as diagnostic ones. Measured over the seed corpus,
 *      "point" appears in 15 of 100 facts, "check" in 7 — while "sidewall" and
 *      "hygroscopic" appear in one or two. Inverse document frequency is
 *      therefore not a refinement here; it IS the signal.
 *
 * Near-duplicate facts are excluded before comparing. Two facts about tread
 * depth SHOULD both fit a tread-depth frame; that is the frame working, not the
 * frame being generic, and counting it as portability would punish exactly the
 * concepts this gate exists to protect. Measured: at a 0.5 cutoff a real
 * sidewall-PSI concept was still beaten by another sidewall-PSI fact; 0.4
 * clears all six authored concepts while the deliberately-generic control
 * (a courtroom with a gavel and a gallery, over a tread fact) still scores 0.
 */
export const SWAP_NEAR_DUPLICATE_WEIGHT_RATIO = 0.4;

/** A corpus with the term weights precomputed once. */
export interface SwapCorpus {
  facts: readonly string[];
  weight(term: string): number;
}

export function buildSwapCorpus(facts: readonly string[]): SwapCorpus {
  const df = new Map<string, number>();
  for (const f of facts) for (const t of new Set(mechanismTerms(f))) df.set(t, (df.get(t) ?? 0) + 1);
  const n = facts.length;
  return {
    facts,
    // Terms unseen in the corpus are maximally distinctive, not zero-weight —
    // a term this corpus has never seen is the strongest possible evidence that
    // the frame is about one specific thing.
    weight: (t) => (n === 0 ? 0 : Math.max(0, Math.log(n / (1 + (df.get(t) ?? 0))))),
  };
}

function weightedCarried(fact: string, frame: string, corpus: SwapCorpus): number {
  const present = new Set(mechanismTerms(frame));
  return mechanismTerms(fact)
    .filter((t) => present.has(t))
    .reduce((sum, t) => sum + corpus.weight(t), 0);
}

/** How much of `foreign`'s weight is already carried by `own` — i.e. same topic. */
function nearDuplicateRatio(foreign: string, own: string, corpus: SwapCorpus): number {
  const ownTerms = new Set(mechanismTerms(own));
  const foreignTerms = mechanismTerms(foreign);
  const total = foreignTerms.reduce((s, t) => s + corpus.weight(t), 0);
  if (total === 0) return 1; // no distinctive content — never a fair swap target
  return foreignTerms.filter((t) => ownTerms.has(t)).reduce((s, t) => s + corpus.weight(t), 0) / total;
}

export interface SwapProbe {
  ownScore: number;
  bestForeignScore: number;
  bestForeignFact: string | null;
  comparedAgainst: number;
  portable: boolean;
}

export function probeFrameSwap(concept: RelevanceInput, corpus: SwapCorpus = DUA_SEED_CORPUS): SwapProbe {
  const frame = [concept.violation, concept.visualMetaphor, concept.payoff].join(" \n ");
  const ownScore = weightedCarried(concept.usefulFact, frame, corpus);

  let bestForeignScore = 0;
  let bestForeignFact: string | null = null;
  let comparedAgainst = 0;

  for (const fact of corpus.facts) {
    if (nearDuplicateRatio(fact, concept.usefulFact, corpus) > SWAP_NEAR_DUPLICATE_WEIGHT_RATIO) continue;
    comparedAgainst++;
    const score = weightedCarried(fact, frame, corpus);
    if (score > bestForeignScore) {
      bestForeignScore = score;
      bestForeignFact = fact;
    }
  }

  return {
    ownScore,
    bestForeignScore,
    bestForeignFact,
    comparedAgainst,
    // No corpus means no verdict. An empty corpus must never read as "clean",
    // so `comparedAgainst` is reported and callers can see the probe ran.
    // A frame that carries none of its own fact (ownScore 0) is portable even
    // when nothing beats it — that tie is the decoration signature, not a pass.
    portable: comparedAgainst > 0 && ownScore <= bestForeignScore,
  };
}

/**
 * Every fact in the seed bank, as the default swap corpus.
 *
 * `ABSURDITY_CONCEPTS` sat in `server/services/` for months with ZERO
 * consumers anywhere in the tree (first committed in #346). Its 100 entries are
 * each "<absurd frame>; <mechanical fact>" — which makes it the one honest
 * corpus in this repo for asking whether a frame is specific to its fact.
 */
export const DUA_SEED_FACTS: readonly string[] = ABSURDITY_CONCEPTS.map((c) => {
  const i = c.concept.lastIndexOf(";");
  return (i === -1 ? c.concept : c.concept.slice(i + 1)).trim();
});

/** The default swap corpus, term weights precomputed once at module load. */
export const DUA_SEED_CORPUS: SwapCorpus = buildSwapCorpus(DUA_SEED_FACTS);

// ─── Hard fails ────────────────────────────────────────────────────

export type DuaBlockCode =
  | "FABRICATED_EVIDENCE"
  | "CUSTOMER_HUMILIATED"
  | "SAFETY_TRIVIALISED"
  | "FACT_ABSENT"
  | "FACT_UNVERIFIED"
  | "RELEVANCE_BELOW_THRESHOLD"
  | "FRAME_PORTABLE"
  | "ABSURDITY_LEVEL_UNCAPPED"
  | "LAYER_BOUNDARY_VIOLATION"
  | "GENERATED_WITHOUT_DISCLOSURE"
  | "UNKNOWN_ROLE"
  | "FRANCHISE_BLOCKING_CONDITION";

export type DuaWarnCode = "ABSURDITY_BELOW_BAND" | "NO_EVIDENCE_LAYER" | "AI_DISCLOSURE_REQUIRED";

export interface DuaFinding {
  severity: "block" | "warn";
  code: DuaBlockCode | DuaWarnCode;
  where: string;
  detail: string;
}

/**
 * Measurement-shaped tokens. A courtroom frame is fine; a courtroom frame that
 * announces "the defendant measured 3/32 inch" is an invented measurement
 * wearing a lab coat, and it is the exact shape the E-Check reel took. Any
 * measurement in the JOKE that the FACT does not carry blocks.
 */
const MEASUREMENT_TOKEN =
  /\d+(?:\.\d+)?(?:\/\d+)?\s*(?:psi|mph|miles?|inch(?:es)?|\/32|degrees?|volts?|amps?|%|percent|pounds?|lbs?|ft-?lbs?|nm|years?|months?|weeks?|days?|hours?|minutes?|seconds?)\b/gi;

/**
 * Assertions that a test was run and returned a result. The frame may stage an
 * examination; it may not report findings the evidence never produced.
 *
 * "show" / "shows" / "showed" are DELIBERATELY ABSENT from the verb list. "An
 * OBD scan shows a stored code" is correct diagnostic English and appears in
 * this shop's real content; "the scan confirms the caliper seized" is a verdict
 * the scan never returned. The verbs kept here all assert a CONCLUSION. Probed
 * against ten legitimate diagnostic sentences and four fabricated verdicts —
 * both sets are locked as tests.
 */
const FABRICATED_VERDICT_PATTERN =
  /\b(?:lab|labs|test|tests|testing|study|studies|analysis|scan|scans|report|reports|data|research|survey|poll|census|statistics)\b[^.!?]{0,40}?\b(?:confirm|confirms|confirmed|prove|proves|proved|proven|conclude|concludes|concluded|determine|determines|determined|certif\w+|measured|recorded)\b/i;

/** The machine is the character. The person who owns it is never the butt. */
const HUMILIATION_PATTERN = new RegExp(
  [
    // driver ... insult
    "\\b(?:driver|drivers|owner|owners|customer|customers)\\b[^.!?]{0,60}?\\b(?:idiots?|stupid|dumb|morons?|clueless|lazy|fools?|foolish|pathetic|ridiculous|too cheap|deserved it|had it coming|should have known better)\\b",
    // insult ... driver
    "\\b(?:idiots?|stupid|dumb|morons?|clueless|lazy|pathetic)\\b[^.!?]{0,40}?\\b(?:driver|drivers|owner|owners|customer|customers)\\b",
    // second-person contempt
    "\\byou\\b[^.!?]{0,40}?\\b(?:idiots?|stupid|dumb|morons?|clueless|lazy|pathetic|fools?)\\b",
    "\\bserves? (?:you|them|him|her) right\\b",
    "\\bdon'?t be (?:that|this) (?:guy|person|driver|owner|customer)\\b",
  ].join("|"),
  "i",
);

/** Mechanisms where being wrong is a safety event, not an inconvenience. */
const SAFETY_MECHANISM_PATTERN =
  /\b(?:brake\s*(?:failure|fails?|failing|line|lines|loss)|no\s+brakes|tie\s*rods?|ball\s*joints?|steering\s*(?:loss|failure|fails?|column)|airbags?|blow\s*-?\s*outs?|blowouts?|hydroplan\w+|calipers?\s+seiz\w+|wheel\s+(?:came|comes|fell|falls)\s+off|lug\s*nuts?\s+(?:loose|missing)|master\s*cylinder|bald\s+tires?|below\s+2\/32|tread\s+separation|control\s+arms?)\b/i;

/**
 * Unambiguous dismissals ONLY. "it's fine" and "whatever" were in the first
 * draft and had to come out: a benign resolution's entire job is to say the
 * situation is fine, so those tokens fired on correct concepts. What must never
 * appear next to a safety mechanism is an instruction to do nothing.
 */
const TRIVIALISER_PATTERN =
  /\b(?:no\s+big\s+deal|nbd|who\s+cares|nothing\s+to\s+worry\s+about|don'?t\s+worry\s+about\s+it|just\s+drive\s+it|keep\s+driving\s+it|ignore\s+it|not\s+a\s+problem|barely\s+matters|doesn'?t\s+matter|no\s+need\s+to\s+(?:check|look|worry)|totally\s+fine|perfectly\s+fine|nothing\s+serious)\b/i;

/**
 * A named piece of text to inspect. The three content detectors take these
 * rather than a `DuaConcept`, so an authored concept and a reel brief that was
 * never authored as one run through the SAME implementation — which in turn
 * means one set of canaries covers both callers instead of two that can drift.
 */
export interface DuaSurface {
  where: string;
  text: string;
}

/** The joke's own surfaces — what the audience receives as the frame. */
export function frameSurfaces(c: DuaConcept): DuaSurface[] {
  return [
    { where: "violation", text: c.violation },
    { where: "benignResolution", text: c.benignResolution },
    { where: "visualMetaphor", text: c.visualMetaphor },
    { where: "audioMetaphor", text: c.audioMetaphor },
    { where: "payoff", text: c.payoff },
    { where: "audienceParticipation", text: c.audienceParticipation },
  ];
}

/**
 * Measurements the joke asserts that its own `usefulFact` never carried.
 *
 * SCOPED TO A CLOSED FACT/JOKE PAIR, and that scoping is load-bearing. An
 * authored `DuaConcept` declares exactly one fact, so any measurement in the
 * frame that the fact does not carry is invented by construction. A whole reel
 * is NOT such a pair: its numbers legitimately arrive from several sourced
 * places (`sourceNotes`, each concept's `coreFact`, beat text) that one
 * `mechanicTruth` sentence cannot enumerate.
 *
 * Probed before shipping, and it mattered: running this over
 * `SAMPLE_REEL_BRIEFS` blocked `sample-pressure-door-sticker` on "44 PSI" — a
 * correct, sourced sidewall-max figure in beat 1. That is precisely the failure
 * `reel-fabricated-stat.test.ts` warns about in its own header ("a rule that
 * blocks those blocks every reel, which is worse than the defect it fixes"), so
 * the derived path runs `detectFabricatedVerdicts` only.
 */
export function detectInventedMeasurements(surfaces: readonly DuaSurface[], usefulFact: string): DuaFinding[] {
  const findings: DuaFinding[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const factNumbers = new Set((usefulFact.match(MEASUREMENT_TOKEN) ?? []).map(norm));

  for (const { where, text } of surfaces) {
    for (const m of text.match(MEASUREMENT_TOKEN) ?? []) {
      if (factNumbers.has(norm(m))) continue;
      findings.push({
        severity: "block",
        code: "FABRICATED_EVIDENCE",
        where,
        detail: `the frame asserts a measurement the sourced fact does not carry: "${m.trim()}". Stage the examination; never report a number nothing measured.`,
      });
    }
  }
  return findings;
}

/**
 * Claims that a test was run and returned a result. Shape-only — it needs no
 * fact to compare against, so it is safe on any surface and blocks on BOTH
 * paths. "The Evidence Lab examines the sidewall" passes; "the lab confirms the
 * sidewall failed" does not.
 */
export function detectFabricatedVerdicts(surfaces: readonly DuaSurface[]): DuaFinding[] {
  const findings: DuaFinding[] = [];
  for (const { where, text } of surfaces) {
    const verdict = text.match(FABRICATED_VERDICT_PATTERN);
    if (verdict) {
      findings.push({
        severity: "block",
        code: "FABRICATED_EVIDENCE",
        where,
        detail: `the frame claims a test returned a result ("${verdict[0].trim()}"). A courtroom or lab frame is fine; invented findings are not.`,
      });
    }
  }
  return findings;
}

/** Both fabrication arms. Authored concepts only — see `detectInventedMeasurements`. */
export function detectFabricatedEvidenceIn(surfaces: readonly DuaSurface[], usefulFact: string): DuaFinding[] {
  return [...detectInventedMeasurements(surfaces, usefulFact), ...detectFabricatedVerdicts(surfaces)];
}

export function detectCustomerHumiliationIn(surfaces: readonly DuaSurface[]): DuaFinding[] {
  const findings: DuaFinding[] = [];
  for (const { where, text } of surfaces) {
    const m = text.match(HUMILIATION_PATTERN);
    if (m) {
      findings.push({
        severity: "block",
        code: "CUSTOMER_HUMILIATED",
        where,
        detail: `the joke lands on the driver ("${m[0].trim()}"). Recast the part as the defendant; the person who owns it is not the butt of anything.`,
      });
    }
  }
  return findings;
}

export function detectSafetyTrivialisationIn(surfaces: readonly DuaSurface[], usefulFact: string): DuaFinding[] {
  const all = [usefulFact, ...surfaces.map((s) => s.text)].join(" \n ");
  const safety = all.match(SAFETY_MECHANISM_PATTERN);
  if (!safety) return [];
  const findings: DuaFinding[] = [];
  for (const { where, text } of surfaces) {
    const t = text.match(TRIVIALISER_PATTERN);
    if (t) {
      findings.push({
        severity: "block",
        code: "SAFETY_TRIVIALISED",
        where,
        detail: `a genuine safety mechanism ("${safety[0].trim()}") is resolved by doing nothing ("${t[0].trim()}"). The frame may be absurd; the consequence may not be waved off.`,
      });
    }
  }
  return findings;
}

export function detectFabricatedEvidence(c: DuaConcept): DuaFinding[] {
  return detectFabricatedEvidenceIn(frameSurfaces(c), c.usefulFact);
}

export function detectCustomerHumiliation(c: DuaConcept): DuaFinding[] {
  const findings = c.subject === "customer"
    ? [{
        severity: "block" as const,
        code: "CUSTOMER_HUMILIATED" as const,
        where: "subject",
        detail: "the customer is never the subject of the joke — the machine is the character.",
      }]
    : [];
  return [...findings, ...detectCustomerHumiliationIn(frameSurfaces(c))];
}

export function detectSafetyTrivialisation(c: DuaConcept): DuaFinding[] {
  return detectSafetyTrivialisationIn(frameSurfaces(c), c.usefulFact);
}

export function checkLayerBoundary(assets: readonly DuaAsset[]): DuaFinding[] {
  const findings: DuaFinding[] = [];
  for (const a of assets) {
    const contract = LAYER_CONTRACT[a.layer];
    if (!contract) {
      findings.push({
        severity: "block",
        code: "LAYER_BOUNDARY_VIOLATION",
        where: `asset ${a.id}`,
        detail: `unknown layer "${a.layer}".`,
      });
      continue;
    }
    if (!contract.allowedOrigins.includes(a.origin)) {
      findings.push({
        severity: "block",
        code: "LAYER_BOUNDARY_VIOLATION",
        where: `asset ${a.id}`,
        detail:
          `origin "${a.origin}" is not permitted in Layer ${contract.code} (${contract.label}) — allowed: ${contract.allowedOrigins.join(", ")}. ` +
          "Generated material lives in Layer C only, so no generated pixel can ever be mistaken for a record of what happened.",
      });
    }
  }
  if (assets.length > 0 && !assets.some((a) => a.layer === "evidence")) {
    findings.push({
      severity: "warn",
      code: "NO_EVIDENCE_LAYER",
      where: "assets",
      detail: "no Layer A evidence asset — the claim rests entirely on authored and generated material.",
    });
  }
  return findings;
}

// ─── The gate ──────────────────────────────────────────────────────

export interface DuaGateOptions {
  /** Corpus for the swap probe. Defaults to the seed bank. Pass
   *  `buildSwapCorpus([])` to skip the probe deliberately — it then reports
   *  `comparedAgainst: 0`, which is visible, not silent. */
  swapCorpus?: SwapCorpus;
}

export interface DuaGateReport {
  version: typeof DUA_MODEL_VERSION;
  status: "pass" | "block";
  findings: DuaFinding[];
  blocking: DuaFinding[];
  relevance: RelevanceReading;
  swap: SwapProbe;
  /**
   * The franchise blocking conditions this gate could NOT mechanically check.
   *
   * Carried ON the report rather than left to a separate call, so a caller
   * cannot render "franchise contract enforced" without also holding the list
   * of what was not enforced. A `pass` here means "nothing detectable fired",
   * never "this episode satisfies its show's contract" — the conditions are
   * English sentences and only the recurring shapes are executable.
   */
  unenforcedConditions: string[];
}

/**
 * One deterministic verdict over a DUA concept, run BEFORE any spend.
 *
 * Nothing here degrades to a warning when it cannot decide: a missing swap
 * corpus reports zero comparisons rather than a pass, and absent evidence is
 * never read as evidence of quality.
 */
export function runDuaGate(concept: DuaConcept, opts: DuaGateOptions = {}): DuaGateReport {
  const findings: DuaFinding[] = [];
  const push = (severity: DuaFinding["severity"], code: DuaBlockCode | DuaWarnCode, where: string, detail: string) =>
    findings.push({ severity, code, where, detail });

  // 1. The fact must exist and be sourced. Everything else is downstream of it.
  if (!concept.usefulFact.trim()) {
    push("block", "FACT_ABSENT", "usefulFact", "no mechanical fact — an absurd frame with nothing to teach is just noise in the shop's voice.");
  }
  if (concept.factSources.length === 0 || concept.factSources.every((s) => !s.trim())) {
    push("block", "FACT_UNVERIFIED", "factSources", "the useful fact carries no proof source. Comedy makes an unsourced claim more memorable, not more true.");
  }

  // 2. Relevance — the hard gate, not a score.
  const relevance = readRelevance(concept);
  if (!relevance.relevant) push("block", "RELEVANCE_BELOW_THRESHOLD", "frame", relevance.reason);

  const swap = probeFrameSwap(concept, opts.swapCorpus ?? DUA_SEED_CORPUS);
  if (swap.portable) {
    push(
      "block",
      "FRAME_PORTABLE",
      "frame",
      `the frame fits an unrelated fact at least as well as its own (own ${swap.ownScore.toFixed(1)} vs ${swap.bestForeignScore.toFixed(1)} for "${swap.bestForeignFact ?? "no fact at all"}", ${swap.comparedAgainst} compared). ` +
        "A frame that would work over any topic is decoration beside the fact, not the mechanism that teaches it.",
    );
  }

  // 3. The three content hard fails.
  findings.push(...detectFabricatedEvidence(concept));
  findings.push(...detectCustomerHumiliation(concept));
  findings.push(...detectSafetyTrivialisation(concept));

  // 4. The dial.
  if (concept.absurdityLevel > ABSURDITY_BAND.max && !concept.levelOptIn) {
    push(
      "block",
      "ABSURDITY_LEVEL_UNCAPPED",
      "absurdityLevel",
      `level ${concept.absurdityLevel} exceeds the default ceiling of ${ABSURDITY_BAND.max} and carries no explicit opt-in. ` +
        "Extreme incongruity is spent credibility, and credibility is this shop's most valuable asset.",
    );
  }
  if (concept.absurdityLevel < ABSURDITY_BAND.min) {
    push(
      "warn",
      "ABSURDITY_BELOW_BAND",
      "absurdityLevel",
      `level ${concept.absurdityLevel} is below the working band (${ABSURDITY_BAND.min}-${ABSURDITY_BAND.max}) — the frame may not be doing work the plain fact could not.`,
    );
  }

  // 5. Layers, and the disclosure duty layering does NOT discharge.
  const assets = concept.assets ?? [];
  findings.push(...checkLayerBoundary(assets));
  if (assets.some((a) => a.origin === "generated")) {
    if (!concept.disclosureMode) {
      push(
        "block",
        "GENERATED_WITHOUT_DISCLOSURE",
        "disclosureMode",
        "this concept renders generated material and declares no disclosure mode. Confining generation to Layer C is a TRUTH control — it keeps generated pixels out of the evidence — and it does not discharge the platform's AI-labelling duty.",
      );
    } else if (requiresAiDisclosure(concept.disclosureMode)) {
      push(
        "warn",
        "AI_DISCLOSURE_REQUIRED",
        "disclosureMode",
        `disclosureMode "${concept.disclosureMode}" requires a Meta AI label on the published post.`,
      );
    }
  }

  // 6. Roles bind to the brand bible.
  for (const role of concept.roles ?? []) {
    const spec = DUA_ROLE_SPECS[role];
    if (!spec) {
      push("block", "UNKNOWN_ROLE", `role ${role}`, `"${role}" is not a registered DUA role.`);
      continue;
    }
    if (spec.boundTo && !BRAND_CAST[spec.boundTo]) {
      push("block", "UNKNOWN_ROLE", `role ${role}`, `bound to "${spec.boundTo}", which is not in the brand bible.`);
    }
  }

  // 7. The franchise contract — declared since the registry shipped, read by
  //    nothing until now.
  if (concept.franchiseId) {
    const franchise = FRANCHISES[concept.franchiseId];
    if (!franchise) {
      push("block", "FRANCHISE_BLOCKING_CONDITION", "franchiseId", `"${concept.franchiseId}" is not a registered franchise.`);
    } else {
      for (const condition of franchise.blockingConditions) {
        const hit = matchesBlockingCondition(condition, concept);
        if (hit) {
          push("block", "FRANCHISE_BLOCKING_CONDITION", hit.where, `${franchise.name} forbids: ${condition} — matched "${hit.match}".`);
        }
      }
    }
  }

  const blocking = findings.filter((f) => f.severity === "block");
  return {
    version: DUA_MODEL_VERSION,
    status: blocking.length > 0 ? "block" : "pass",
    findings,
    blocking,
    relevance,
    swap,
    unenforcedConditions: concept.franchiseId ? unenforceableBlockingConditions(concept.franchiseId) : [],
  };
}

/**
 * Franchise `blockingConditions` are English sentences written for a human.
 * They cannot be executed directly, so this maps the RECURRING SHAPES across the
 * twelve franchises onto detectors. Conditions with no detector are reported by
 * `unenforceableBlockingConditions()` rather than silently ignored — an
 * unenforced condition that LOOKS enforced is the defect this file corrects.
 */
const BLOCKING_CONDITION_DETECTORS: { when: RegExp; detect: RegExp }[] = [
  { when: /\b(?:cost|estimate|price|quoted?)\b/i, detect: /\$\s?\d+|\b\d+\s*(?:dollars|bucks)\b/i },
  { when: /\bunsafe to drive\b/i, detect: /\b(?:unsafe to drive|not safe to drive|do not drive|don'?t drive)\b/i },
  {
    when: /\b(?:real|specific|identifiable)\b[^.]{0,40}\b(?:street|intersection|address|location)\b/i,
    detect: /\b\d{3,5}\s+[A-Z][A-Za-z]+\s+(?:Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard)\b/,
  },
  {
    when: /\b(?:weeks or months|remaining[^.]{0,20}life|will fail|timeframe|how long)\b/i,
    detect: /\b(?:will (?:fail|last|die|go|break) (?:in|within)|lasts? (?:another|about)\s*\d+\s*(?:week|month|year)s?)\b/i,
  },
];

function matchesBlockingCondition(condition: string, c: DuaConcept): { where: string; match: string } | null {
  for (const d of BLOCKING_CONDITION_DETECTORS) {
    if (!d.when.test(condition)) continue;
    for (const { where, text } of frameSurfaces(c)) {
      const m = text.match(d.detect);
      if (m) return { where, match: m[0] };
    }
    const f = c.usefulFact.match(d.detect);
    if (f) return { where: "usefulFact", match: f[0] };
  }
  return null;
}

/**
 * Which franchise blocking conditions have NO detector behind them.
 *
 * This is the honest half of `matchesBlockingCondition`. Only the recurring
 * shapes are mechanically checkable; a caller that renders a "franchise
 * contract enforced" badge must show this list too, or it is making the same
 * presence-not-behaviour claim `brand-universe.test.ts` used to make.
 */
export function unenforceableBlockingConditions(franchiseId: FranchiseId): string[] {
  const franchise = FRANCHISES[franchiseId];
  if (!franchise) return [];
  return franchise.blockingConditions.filter((c) => !BLOCKING_CONDITION_DETECTORS.some((d) => d.when.test(c)));
}

// ─── The adoption seam: briefs that were never authored as DUA concepts ──
//
// `ReelBrief` predates this model. It carries `usefulAbsurdity` (the frame),
// `mechanicTruth` (the fact) and a winning concept, but it has no `violation`
// and no `payoff`, so a full `DuaConcept` cannot be recovered from one — only
// approximated. That distinction decides severity, and it is the whole design
// of this seam:
//
//   BLOCK on what is STATED. The three content detectors run over the brief's
//   real words (caption, voiceover, beat text). An invented measurement or a
//   humiliated customer is a defect in text that will actually ship, whether or
//   not anyone authored a concept object.
//
//   WARN on what is INFERRED. Relevance needs `violation` and `payoff`, which
//   do not exist here — mapping hook/caption/loop onto them is a lossy
//   reconstruction this file built, and blocking live generation on my own
//   approximation is not the same as blocking on an author's declaration.
//
// A brief that DOES carry an authored `DuaConcept` gets the full gate at block
// severity. That is the incentive: authoring the concept is what buys the
// strong guarantee, and until then the gap is reported rather than assumed away.

export interface DuaBriefView {
  usefulAbsurdity: string;
  mechanicTruth: string;
  /** Winning concept's hook, when there is one. */
  hook: string;
  captionAngle: string;
  loopIdea: string;
  /** Everything the audience actually receives as words or pictures. */
  audienceText: DuaSurface[];
}

/**
 * The lossy reconstruction, named as one. `violation` and `payoff` are the two
 * approximated fields; `visualMetaphor` maps cleanly because `usefulAbsurdity`
 * is already exactly that.
 */
export function deriveRelevanceInput(view: DuaBriefView): RelevanceInput {
  return {
    usefulFact: view.mechanicTruth,
    violation: `${view.hook} ${view.usefulAbsurdity}`.trim(),
    visualMetaphor: view.usefulAbsurdity,
    payoff: `${view.loopIdea} ${view.captionAngle}`.trim(),
  };
}

export interface DuaBriefReport {
  /** Block-severity findings over text that will actually ship. */
  stated: DuaFinding[];
  /** Warn-severity findings from the lossy reconstruction. */
  inferred: DuaFinding[];
  relevance: RelevanceReading;
  swap: SwapProbe;
}

/**
 * Run the DUA checks against a reel brief that has no authored concept.
 *
 * Returns both severities separately so a caller cannot accidentally promote an
 * inferred finding to a block, or bury a stated one as advisory.
 */
export function runDuaBriefChecks(view: DuaBriefView, opts: DuaGateOptions = {}): DuaBriefReport {
  // `detectInventedMeasurements` is deliberately ABSENT here: a whole reel is
  // not a closed fact/joke pair, and running it over one blocked a correct,
  // sourced "44 PSI" in the shipped samples. See its docstring.
  const stated = [
    ...detectFabricatedVerdicts(view.audienceText),
    ...detectCustomerHumiliationIn(view.audienceText),
    ...detectSafetyTrivialisationIn(view.audienceText, view.mechanicTruth),
  ];

  const input = deriveRelevanceInput(view);
  const relevance = readRelevance(input);
  const swap = probeFrameSwap(input, opts.swapCorpus ?? DUA_SEED_CORPUS);

  const inferred: DuaFinding[] = [];
  if (!relevance.relevant) {
    inferred.push({
      severity: "warn",
      code: "RELEVANCE_BELOW_THRESHOLD",
      where: "usefulAbsurdity",
      detail: `${relevance.reason} (inferred from the brief, not an authored DUA concept — author one to gate this at block severity).`,
    });
  }
  if (swap.portable) {
    inferred.push({
      severity: "warn",
      code: "FRAME_PORTABLE",
      where: "usefulAbsurdity",
      detail:
        `the absurd frame fits an unrelated fact at least as well as its own (own ${swap.ownScore.toFixed(1)} vs ${swap.bestForeignScore.toFixed(1)}, ${swap.comparedAgainst} compared) ` +
        "— inferred from the brief, not an authored DUA concept.",
    });
  }

  return { stated, inferred, relevance, swap };
}
