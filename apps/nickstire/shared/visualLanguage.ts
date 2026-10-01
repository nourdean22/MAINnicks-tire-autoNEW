/**
 * Creative Visual Language — the ONE vocabulary of composition grammars
 * (Creative Intelligence OS README §C–E `visual_family`, §J).
 *
 * Three renderers grew three vocabularies: `visualFamily.ts` (3 static
 * families), `carouselSlideRenderer.ts` (13 territory designs) and the Ad
 * Studio poster (`adStudio/adTemplate.ts`). Each carried its own inline
 * colours and its own idea of what a layout IS. This file is the canonical
 * list they all alias into: sixteen grammars, each a genuinely different
 * composition — grid, hierarchy and image treatment are pairwise distinct
 * across (at least) fourteen of them, and the unit test proves it, so adding
 * a seventeenth that is a recolour of an existing one fails CI.
 *
 * PURE DATA. No rendering here. The renderers keep their HTML byte-identical
 * for now and only MAP into this file (`familyGrammar`, `territoryGrammar`,
 * and the poster is `industrial_editorial`); their inline colours are the
 * documented remaining work — the tokens below name the brand palette the
 * re-skin must draw from, and nothing in this file is a hex literal.
 *
 * Tokens are KEYS of `NOIR_PALETTE` (shared/brandBible.ts), resolved to hex
 * by the consumer. The palette has no light neutral on purpose (type over a
 * dark ground is the brand), so "ink" is not a token: a grammar that needs a
 * light ground (split_diagnosis, blueprint) says so in `imageTreatment` and
 * `accentUsage`, and the renderer owns the neutral.
 */
import { NOIR_PALETTE } from "./brandBible";
import type { CreativeTerritory } from "../client/src/lib/igCarouselStudio";

export type VisualGrammarId =
  | "forensic_macro"
  | "mechanic_annotation"
  | "split_diagnosis"
  | "decision_tree"
  | "blueprint"
  | "cutaway"
  | "evidence_board"
  | "checklist"
  | "myth_reality"
  | "cleveland_alert"
  | "receipt_proof"
  | "question_card"
  | "industrial_editorial"
  | "clean_catalog"
  | "before_after"
  | "shop_documentary";

export type PaletteToken = keyof typeof NOIR_PALETTE;

export type GrammarSubjectRequirement = "required" | "optional" | "none";

export interface VisualGrammar {
  id: VisualGrammarId;
  label: string;
  /** Content this grammar is built for. */
  suitableFor: string[];
  /** Content it actively harms — a renderer should refuse or substitute. */
  unsuitableFor: string[];
  subjectRequirement: GrammarSubjectRequirement;
  /** Spatial skeleton. One of the distinctness triple. */
  grid: string;
  /** What the eye lands on first. One of the distinctness triple. */
  hierarchy: string;
  /** Display / editorial / label / compact — how the type scale is built. */
  typeScale: "display" | "editorial" | "label" | "compact";
  /** Total characters (headline + body) the composition can carry legibly on a phone. */
  copyBudget: number;
  /** How imagery is handled. One of the distinctness triple. */
  imageTreatment: string;
  /** Where the accent token is allowed to appear. */
  accentUsage: string;
  /** Zones the renderer must keep clear (platform chrome, subject, captions). */
  safeZones: string;
  ctaBehaviour: string;
  /** How a multi-slide deck progresses when this grammar carries a carousel. */
  slideProgression: string;
  /** How the grammar translates to a reel (motion family it maps to). */
  motionAdaptation: string;
  /** Short signature for the repetition ledger — two posts with the same
   *  fingerprint read as the same post. */
  originalityFingerprint: string;
  /** Brand palette tokens (keys of NOIR_PALETTE), never hex. */
  tokens: { ground: PaletteToken; surface: PaletteToken; accent: PaletteToken; signal: PaletteToken };
}

const noir = (signal: PaletteToken = "icyBlue"): VisualGrammar["tokens"] => ({ ground: "black", surface: "graphite", accent: "nicksGold", signal });

export const VISUAL_GRAMMARS: Record<VisualGrammarId, VisualGrammar> = {
  forensic_macro: {
    id: "forensic_macro",
    label: "Forensic macro",
    suitableFor: ["a real photo of a worn, cracked or corroded part", "tread, rotor, belt, bushing close-ups", "mechanic_evidence static posts"],
    unsuitableFor: ["offers and pricing", "anything without a real subject", "multi-step teaching"],
    subjectRequirement: "required",
    grid: "full_bleed",
    hierarchy: "image_first",
    typeScale: "display",
    copyBudget: 140,
    imageTreatment: "macro_crop",
    accentUsage: "one gold caption bar and the reticle; nothing else is gold",
    safeZones: "bottom 30% scrimmed for type; subject stays in the upper two-thirds",
    ctaBehaviour: "single short line under the headline, solid accent",
    slideProgression: "wider shot -> closer macro -> the one detail that decides it",
    motionAdaptation: "locked_macro / progressive_push_in",
    originalityFingerprint: "macro+scrim-bottom+1-line-cta",
    tokens: noir("icyBlue"),
  },
  mechanic_annotation: {
    id: "mechanic_annotation",
    label: "Mechanic annotation",
    suitableFor: ["a photo with 2-4 labelled callouts", "where-is-it-on-my-car explainers", "car body language symptoms"],
    unsuitableFor: ["copy-heavy arguments", "no subject", "offers"],
    subjectRequirement: "required",
    grid: "annotation_callouts",
    hierarchy: "label_first",
    typeScale: "label",
    copyBudget: 180,
    imageTreatment: "annotated_photo",
    accentUsage: "callout leader lines and numerals only",
    safeZones: "callouts never cross the subject's defining edge; keep the right 20% for labels",
    ctaBehaviour: "footer line, outline style, never competing with callouts",
    slideProgression: "overview with all callouts -> one slide per callout",
    motionAdaptation: "orbit_reveal with callouts arriving in sequence",
    originalityFingerprint: "photo+numbered-callouts+right-labels",
    tokens: noir("icyBlue"),
  },
  split_diagnosis: {
    id: "split_diagnosis",
    label: "Split diagnosis",
    suitableFor: ["shop term vs plain English", "two lookalike symptoms", "mechanic_translation decks"],
    unsuitableFor: ["single-subject hero shots", "long lists", "alerts"],
    subjectRequirement: "optional",
    grid: "split_vertical",
    hierarchy: "label_first",
    typeScale: "editorial",
    copyBudget: 220,
    imageTreatment: "paired_crops",
    accentUsage: "the centre divider and the right-hand label only; a light neutral ground is allowed here",
    safeZones: "each half keeps its own 8% inner margin; nothing straddles the divider but the headline",
    ctaBehaviour: "spans both halves at the bottom, compact",
    slideProgression: "the pair -> what the left means -> what the right means -> which one you have",
    motionAdaptation: "split_wipe",
    originalityFingerprint: "vertical-split+paired-labels",
    tokens: noir("warningRed"),
  },
  decision_tree: {
    id: "decision_tree",
    label: "Decision tree",
    suitableFor: ["if-you-hear/feel/see-X-then-Y", "warning_system triage", "should-I-drive-it questions"],
    unsuitableFor: ["evidence photos", "offers", "one-fact posts"],
    subjectRequirement: "none",
    grid: "tree",
    hierarchy: "question_first",
    typeScale: "compact",
    copyBudget: 260,
    imageTreatment: "none_type_only",
    accentUsage: "the branch the reader should take; the other branches stay surface-toned",
    safeZones: "root question in the top 25%; leaves never below the bottom 12%",
    ctaBehaviour: "the final leaf IS the CTA (walk in / call / send this)",
    slideProgression: "root question -> one branch per slide -> the leaf you landed on",
    motionAdaptation: "freeze_punch_in on each branch",
    originalityFingerprint: "tree+question-root+leaf-cta",
    tokens: noir("warningRed"),
  },
  blueprint: {
    id: "blueprint",
    label: "Blueprint",
    suitableFor: ["how a system is laid out", "blueprint_xray decks", "exploded views"],
    unsuitableFor: ["emotional stories", "real-photo evidence", "offers"],
    subjectRequirement: "optional",
    grid: "schematic_plate",
    hierarchy: "label_first",
    typeScale: "label",
    copyBudget: 200,
    imageTreatment: "linework",
    accentUsage: "the one component under discussion is accent-lit; the rest is signal-toned linework",
    safeZones: "title block bottom-right as on a drawing; 6% border grid",
    ctaBehaviour: "inside the title block, compact",
    slideProgression: "whole plate -> zoom plate -> the one part -> what wears first",
    motionAdaptation: "x-ray scan pass (NOIR_CAMERA_GRAMMAR)",
    originalityFingerprint: "schematic-plate+title-block",
    tokens: noir("icyBlue"),
  },
  cutaway: {
    id: "cutaway",
    label: "Cutaway",
    suitableFor: ["what is inside the part", "tiny_world dioramas", "how a failure propagates inside"],
    unsuitableFor: ["offers", "lists", "surface-level evidence photos"],
    subjectRequirement: "optional",
    grid: "centred_stack",
    hierarchy: "image_first",
    typeScale: "display",
    copyBudget: 150,
    imageTreatment: "cutaway_render",
    accentUsage: "the cut face only",
    safeZones: "subject centred in the middle 60%; type above and below, never over the cut",
    ctaBehaviour: "under the subject, outline style",
    slideProgression: "outside -> cut -> inside mechanism -> consequence",
    motionAdaptation: "cross-section cutaway reveal (NOIR_CAMERA_GRAMMAR)",
    originalityFingerprint: "centred-cutaway+type-above-below",
    tokens: noir("icyBlue"),
  },
  evidence_board: {
    id: "evidence_board",
    label: "Evidence board",
    suitableFor: ["several clues that add up", "csi_evidence_board decks", "diagnosis stories with 3+ artefacts"],
    unsuitableFor: ["one-image posts", "offers", "alerts"],
    subjectRequirement: "required",
    grid: "pinboard",
    hierarchy: "evidence_first",
    typeScale: "label",
    copyBudget: 240,
    imageTreatment: "pinned_photos",
    accentUsage: "the string between clues and the numbered tags",
    safeZones: "no clue within 6% of an edge; the verdict card sits bottom-centre",
    ctaBehaviour: "on the verdict card only",
    slideProgression: "the board -> clue 1 -> clue 2 -> clue 3 -> verdict",
    motionAdaptation: "match_cut between clues",
    originalityFingerprint: "pinboard+string+numbered-tags",
    tokens: noir("nicksGold"),
  },
  checklist: {
    id: "checklist",
    label: "Checklist",
    suitableFor: ["seasonal prep", "cleveland_survival_guide decks", "save-this lists of 3-6 items"],
    unsuitableFor: ["one hero image", "emotional stories", "two-state comparisons"],
    subjectRequirement: "none",
    grid: "list_rows",
    hierarchy: "headline_first",
    typeScale: "editorial",
    copyBudget: 300,
    imageTreatment: "none_type_only",
    accentUsage: "the tick marks and the one row that matters most",
    safeZones: "rows never below the bottom 14%; headline in the top 22%",
    ctaBehaviour: "last row is 'save this' or the keyword chip",
    slideProgression: "the whole list -> one row per slide with its why",
    motionAdaptation: "silent_hold with rows ticking in",
    originalityFingerprint: "rows+ticks+save-row",
    tokens: noir("icyBlue"),
  },
  myth_reality: {
    id: "myth_reality",
    label: "Myth / reality",
    suitableFor: ["a common belief that is wrong", "myth_courtroom decks", "belief -> contradiction -> truth"],
    unsuitableFor: ["lists", "evidence collections", "catalogue content"],
    subjectRequirement: "optional",
    grid: "split_horizontal",
    hierarchy: "verdict_first",
    typeScale: "display",
    copyBudget: 200,
    imageTreatment: "paired_crops",
    accentUsage: "the verdict stamp only; the myth half is struck through in surface tone",
    safeZones: "the stamp never covers the subject in either half",
    ctaBehaviour: "under the reality half",
    slideProgression: "the myth -> why people believe it -> the reality -> what to do",
    motionAdaptation: "match_cut myth -> reality",
    originalityFingerprint: "horizontal-split+verdict-stamp",
    tokens: noir("warningRed"),
  },
  cleveland_alert: {
    id: "cleveland_alert",
    label: "Cleveland alert",
    suitableFor: ["weather and road conditions", "road_hazard statics", "weather_local_alert and road_villain decks"],
    unsuitableFor: ["evergreen teaching", "pricing", "proof"],
    subjectRequirement: "optional",
    grid: "poster_block",
    hierarchy: "headline_first",
    typeScale: "display",
    copyBudget: 160,
    imageTreatment: "scrim_photo",
    accentUsage: "the alert band; signal red only for the hazard word",
    safeZones: "band in the top 18%; headline centred; bottom 15% kept for handle and CTA",
    ctaBehaviour: "solid accent, one line, imperative",
    slideProgression: "the alert -> what it does to your car -> what to check -> where we are",
    motionAdaptation: "cold-open push-in on the hazard (NOIR_CAMERA_GRAMMAR)",
    originalityFingerprint: "alert-band+centre-headline",
    tokens: noir("warningRed"),
  },
  receipt_proof: {
    id: "receipt_proof",
    label: "Receipt proof",
    suitableFor: ["an alignment printout, a scan readout, a measured number", "what-it-actually-cost stories (no customer PII)"],
    unsuitableFor: ["anything without a real artefact", "alerts", "pure teaching"],
    subjectRequirement: "required",
    grid: "receipt_column",
    hierarchy: "number_first",
    typeScale: "compact",
    copyBudget: 180,
    imageTreatment: "receipt_scan",
    accentUsage: "the one number that matters is accent-circled; everything else stays monochrome",
    safeZones: "the artefact column keeps 10% margin; no type over the artefact",
    ctaBehaviour: "beside the artefact, outline style",
    slideProgression: "the artefact -> the number -> what it means -> what it would have cost later",
    motionAdaptation: "locked_macro on the printout with the number punched in",
    originalityFingerprint: "artefact-column+circled-number",
    tokens: noir("nicksGold"),
  },
  question_card: {
    id: "question_card",
    label: "Question card",
    suitableFor: ["one symptom question the viewer answers for themselves", "ask-in-comments posts", "hook_grammar symptom_question"],
    unsuitableFor: ["evidence", "lists", "pricing"],
    subjectRequirement: "none",
    grid: "centred_stack",
    hierarchy: "question_first",
    typeScale: "display",
    copyBudget: 120,
    imageTreatment: "none_type_only",
    accentUsage: "the question mark and the answer line only",
    safeZones: "question in the middle 50%; nothing in the top 15% or bottom 15%",
    ctaBehaviour: "the CTA is the invitation to answer (comments / send to someone)",
    slideProgression: "the question -> the usual wrong answer -> the right answer -> why",
    motionAdaptation: "silent_hold then freeze_punch_in on the answer",
    originalityFingerprint: "centred-question+answer-line",
    tokens: noir("icyBlue"),
  },
  industrial_editorial: {
    id: "industrial_editorial",
    label: "Industrial editorial",
    suitableFor: ["the Ad Studio garage poster (adStudio/adTemplate.ts)", "premium_product_ad decks", "a service presented like a magazine spread"],
    unsuitableFor: ["forensic evidence", "triage", "alerts"],
    subjectRequirement: "optional",
    grid: "poster_block",
    hierarchy: "headline_first",
    typeScale: "display",
    copyBudget: 140,
    imageTreatment: "product_isolated",
    accentUsage: "the first headline line and the skewed CTA bar",
    safeZones: "kicker top-left; product bleeds bottom-right; headline never over the product",
    ctaBehaviour: "skewed solid bar, one line, bottom",
    slideProgression: "hook -> value ticks -> offer -> proof -> cta (the fixed Ad Studio order)",
    motionAdaptation: "slow orbit around a single isolated part (NOIR_CAMERA_GRAMMAR)",
    originalityFingerprint: "poster+isolated-product+skewed-bar",
    tokens: noir("nicksGold"),
  },
  clean_catalog: {
    id: "clean_catalog",
    label: "Clean catalog",
    suitableFor: ["seasonal_offer statics", "luxury_part_hero decks", "a service or part with a plain price-from line"],
    unsuitableFor: ["stories", "evidence", "alerts"],
    subjectRequirement: "optional",
    grid: "catalog_grid",
    hierarchy: "number_first",
    typeScale: "editorial",
    copyBudget: 170,
    imageTreatment: "catalog_tile",
    accentUsage: "the price-from or the one spec; tiles stay surface-toned",
    safeZones: "tiles keep an even gutter; headline top 20%; CTA bottom 12%",
    ctaBehaviour: "solid accent, centred, one line",
    slideProgression: "the headline tile -> one tile per option -> the recap tile with the keyword",
    motionAdaptation: "orbit_reveal on the hero tile",
    originalityFingerprint: "tiles+price-from",
    tokens: noir("nicksGold"),
  },
  before_after: {
    id: "before_after",
    label: "Before / after",
    suitableFor: ["before_the_bill decks", "cheap-now vs expensive-later", "the same part at two points in time"],
    unsuitableFor: ["single-state posts", "lists", "alerts"],
    subjectRequirement: "optional",
    grid: "two_panel_sequence",
    hierarchy: "sequence_first",
    typeScale: "editorial",
    copyBudget: 200,
    imageTreatment: "before_after_pair",
    accentUsage: "the arrow between panels and the 'after' cost line",
    safeZones: "matched framing in both panels; the arrow never covers either subject",
    ctaBehaviour: "under the 'before' panel: what to do now",
    slideProgression: "before -> the clue in it -> after -> the bill -> what to do today",
    motionAdaptation: "match_cut before -> after",
    originalityFingerprint: "two-panel+arrow+cost-line",
    tokens: noir("warningRed"),
  },
  shop_documentary: {
    id: "shop_documentary",
    label: "Shop documentary",
    suitableFor: ["real shop photos and video stills", "the bay, the lift, the tool on the bench", "real_shop_photo evidence"],
    unsuitableFor: ["generated imagery", "pricing", "triage"],
    subjectRequirement: "required",
    grid: "documentary_strip",
    hierarchy: "image_first",
    typeScale: "compact",
    copyBudget: 130,
    imageTreatment: "documentary_photo",
    accentUsage: "the caption strip only; the photo is never tinted",
    safeZones: "photo untouched; caption strip in the bottom 16%",
    ctaBehaviour: "in the strip, compact, after the caption",
    slideProgression: "the bay -> the car -> the part -> the fix -> the door you walk in",
    motionAdaptation: "handheld_phone / pov_mechanic",
    originalityFingerprint: "untinted-photo+caption-strip",
    tokens: noir("nicksGold"),
  },
};

/** The three static families in visualFamily.ts. */
export type VisualFamilyId = "mechanic_evidence" | "seasonal_offer" | "road_hazard";

/** Each static family is an alias of one grammar. */
export const familyGrammar: Record<VisualFamilyId, VisualGrammarId> = {
  mechanic_evidence: "forensic_macro",
  seasonal_offer: "clean_catalog",
  road_hazard: "cleveland_alert",
};

/** Each of the 13 carousel territories maps to one grammar (several
 *  territories share a grammar — a territory is a prompt STYLE for the image
 *  model, a grammar is a COMPOSITION; the two axes are independent). */
export const territoryGrammar: Record<CreativeTerritory, VisualGrammarId> = {
  cleveland_survival_guide: "checklist",
  mechanic_translation: "split_diagnosis",
  csi_evidence_board: "evidence_board",
  myth_courtroom: "myth_reality",
  tiny_world: "cutaway",
  warning_system: "decision_tree",
  luxury_part_hero: "clean_catalog",
  road_villain: "cleveland_alert",
  car_body_language: "mechanic_annotation",
  before_the_bill: "before_after",
  blueprint_xray: "blueprint",
  premium_product_ad: "industrial_editorial",
  weather_local_alert: "cleveland_alert",
};
