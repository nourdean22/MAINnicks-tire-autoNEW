/**
 * Creative Genome — the campaign-level creative core (Genome Wave 1, slice 1).
 *
 * Verified fragmentation this module exists to end (2026-07-17): two caption
 * engines (socialIntelligence for the generic Studio, igAutopost's own rich
 * generator), disjoint creative registries (CREATIVE_TERRITORIES for
 * carousels, MOTION_LENSES/REEL_ARCHETYPES for reels), and concept scoring
 * that is self-evaluation by the generating model.
 *
 * One genome describes ONE campaign idea; format directors (reel, carousel,
 * photo, story, ad) adapt it. This slice ships the contract, claim-safety
 * validation, bridges FROM existing briefs (so shipped content maps into
 * genome space for memory/analytics), and seeds INTO the existing generators
 * (so one genome can drive today's reel + carousel flows without waiting for
 * the full director layer).
 *
 * The CAROUSEL territory registry (13 entries) is the canonical CAMPAIGN
 * territory vocabulary — it is the richest and both other formats can map
 * from it. Reels keep their motion-lens/archetype vocabulary; the seed maps
 * territory -> a suggested lens/archetype pair (a starting point, not a cage).
 */
import { z } from "zod";
import {
  CREATIVE_TERRITORIES,
  FORBIDDEN_CLAIM_PATTERNS,
  OVERDIAGNOSIS_PATTERNS,
  type CreativeTerritory,
} from "./igCarouselStudio";
import type { MotionLens, ReelArchetype } from "./facelessReelStudio";
import type { CarouselBrief } from "./igCarouselStudio";
import type { ReelBrief } from "./facelessReelStudio";

export const CAMPAIGN_OBJECTIVES = [
  "reach",
  "save",
  "share",
  "comment",
  "message",
  "shop_visit",
  "booking",
] as const;
export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];

export interface CreativeGenome {
  /** schema version for stored genomes */
  version: 1;
  objective: CampaignObjective;
  /** the concrete driver moment the campaign speaks to */
  audienceMoment: string;
  /** what the driver fears / does not know */
  driverTension: string;
  /** the verifiable mechanic truth — inspection-first, never diagnosis-by-content */
  mechanicTruth: string;
  /** evidence handles (review IDs, work-order IDs, accepted proof-source labels) */
  proprietaryProof: string[];
  /** the emotional turn the campaign lands (recognition -> relief, etc.) */
  emotionalTurn: string;
  /** the one visual idea every format shares */
  visualMetaphor: string;
  creativeTerritory: CreativeTerritory;
  clevelandAngle: string;
  /** what makes this unmistakably Nick's — tone, stance, locality */
  nickSignature: string;
  /** the single soft action (save / send / DM keyword / stop by) */
  desiredAction: string;
}

export const creativeGenomeSchema = z.object({
  version: z.literal(1),
  objective: z.enum(CAMPAIGN_OBJECTIVES),
  audienceMoment: z.string().min(12).max(400),
  driverTension: z.string().min(12).max(400),
  mechanicTruth: z.string().min(12).max(600),
  proprietaryProof: z.array(z.string().min(2).max(200)).max(8),
  emotionalTurn: z.string().min(6).max(300),
  visualMetaphor: z.string().min(8).max(300),
  creativeTerritory: z.enum(Object.keys(CREATIVE_TERRITORIES) as [CreativeTerritory, ...CreativeTerritory[]]),
  clevelandAngle: z.string().min(6).max(300),
  nickSignature: z.string().min(6).max(300),
  desiredAction: z.string().min(4).max(200),
}) satisfies z.ZodType<CreativeGenome>;

export interface GenomeSafetyFinding {
  field: string;
  rule: string;
  match: string;
}

/**
 * Claim-safety over every text field of the genome — the same pattern banks
 * the carousel studio enforces (forbidden claims + overdiagnosis). A genome
 * is the ROOT of a campaign: a "guaranteed" or "your X is shot" planted here
 * would propagate into every format.
 */
export function validateGenomeClaimSafety(genome: CreativeGenome): GenomeSafetyFinding[] {
  const findings: GenomeSafetyFinding[] = [];
  const fields: Array<[string, string]> = [
    ["audienceMoment", genome.audienceMoment],
    ["driverTension", genome.driverTension],
    ["mechanicTruth", genome.mechanicTruth],
    ["emotionalTurn", genome.emotionalTurn],
    ["visualMetaphor", genome.visualMetaphor],
    ["clevelandAngle", genome.clevelandAngle],
    ["nickSignature", genome.nickSignature],
    ["desiredAction", genome.desiredAction],
  ];
  const banks: Array<[string, Array<{ rule: string; pattern: RegExp }>]> = [
    ["forbidden-claim", FORBIDDEN_CLAIM_PATTERNS as never],
    ["overdiagnosis", OVERDIAGNOSIS_PATTERNS as never],
  ];
  for (const [field, text] of fields) {
    for (const [bankName, bank] of banks) {
      for (const entry of bank) {
        const m = text.match(entry.pattern);
        if (m) findings.push({ field, rule: `${bankName}:${entry.rule}`, match: m[0] });
      }
    }
  }
  return findings;
}

// ─── Bridges FROM existing briefs (shipped content -> genome space) ─────────

/** Best-effort genome extraction from a reel brief — for creative memory and
 *  analytics over ALREADY-SHIPPED content. Lossy where the brief has no
 *  equivalent field; never throws on partial briefs. */
export function genomeFromReelBrief(
  brief: Pick<ReelBrief, "topic" | "mechanicTruth" | "driverConfusion" | "clevelandAngle" | "usefulAbsurdity" | "sourceNotes" | "campaignKeyword">,
  territory: CreativeTerritory = "premium_product_ad",
): CreativeGenome {
  return {
    version: 1,
    objective: "save",
    audienceMoment: brief.topic || "unspecified driver moment",
    driverTension: brief.driverConfusion || "unspecified driver tension",
    mechanicTruth: brief.mechanicTruth || "unspecified mechanic truth",
    proprietaryProof: (brief.sourceNotes ?? []).filter((s) => s.kind === "proof").map((s) => s.label),
    emotionalTurn: "recognition, then a clear next step",
    visualMetaphor: brief.usefulAbsurdity || "the part as the story's main character",
    creativeTerritory: territory,
    clevelandAngle: brief.clevelandAngle || "Cleveland roads and seasons",
    nickSignature: "road-survival intelligence without panic or sales pressure",
    desiredAction: `save the post and DM "${brief.campaignKeyword}"`,
  };
}

/** Same bridge for carousel briefs. */
export function genomeFromCarouselBrief(
  brief: Pick<CarouselBrief, "topic" | "creativeTerritory" | "campaignKeyword"> & {
    mechanicTruth?: string;
    clevelandAngle?: string;
  },
): CreativeGenome {
  return {
    version: 1,
    objective: "save",
    audienceMoment: brief.topic || "unspecified driver moment",
    driverTension: "unspecified driver tension",
    mechanicTruth: brief.mechanicTruth || "unspecified mechanic truth",
    proprietaryProof: [],
    emotionalTurn: "recognition, then a clear next step",
    visualMetaphor: "one teaching visual per slide",
    creativeTerritory: brief.creativeTerritory,
    clevelandAngle: brief.clevelandAngle || "Cleveland roads and seasons",
    nickSignature: "road-survival intelligence without panic or sales pressure",
    desiredAction: `save the post and DM "${brief.campaignKeyword}"`,
  };
}

// ─── Seeds INTO existing generators (one genome -> today's flows) ───────────

/** Suggested reel vocabulary per campaign territory — a starting point the
 *  reel generator may refine, keeping the two registries bridged instead of
 *  merged. */
export const TERRITORY_TO_REEL: Record<CreativeTerritory, { motionLens: MotionLens; archetype: ReelArchetype }> = {
  cleveland_survival_guide: { motionLens: "hyperreal_cinematic", archetype: "cleveland_road_alert" },
  mechanic_translation: { motionLens: "blueprint_technical", archetype: "myth_vs_reality" },
  csi_evidence_board: { motionLens: "forensic_evidence_scan", archetype: "diagnostic_hud_reveal" },
  myth_courtroom: { motionLens: "hyperreal_cinematic", archetype: "myth_vs_reality" },
  tiny_world: { motionLens: "tilt_shift_miniature", archetype: "tiny_cinematic_story" },
  warning_system: { motionLens: "warning_light_world", archetype: "one_second_hook_payoff" },
  luxury_part_hero: { motionLens: "product_ad_macro", archetype: "satisfying_loop" },
  road_villain: { motionLens: "hyperreal_cinematic", archetype: "caught_on_camera_documentary" },
  car_body_language: { motionLens: "anthropomorphized_object", archetype: "part_as_character_drama" },
  before_the_bill: { motionLens: "extreme_macro_push_in", archetype: "timelapse_transformation" },
  blueprint_xray: { motionLens: "xray_cutaway", archetype: "diagnostic_hud_reveal" },
  premium_product_ad: { motionLens: "product_ad_macro", archetype: "satisfying_loop" },
  weather_local_alert: { motionLens: "weather_radar_overlay", archetype: "cleveland_road_alert" },
};

/** Topic + creative constraints for the EXISTING reel generator (fits the
 *  wizard's 300-char operator-context budget). */
export function genomeToReelSeed(genome: CreativeGenome): {
  topic: string;
  archetype: ReelArchetype;
  motionLens: MotionLens;
} {
  const map = TERRITORY_TO_REEL[genome.creativeTerritory];
  const proof = genome.proprietaryProof.length
    ? ` Proof: ${genome.proprietaryProof[0]}.`
    : " Attach at least one PROOF source note from the accepted families.";
  const topic = `${genome.audienceMoment} Truth: ${genome.mechanicTruth}${proof}`.slice(0, 300);
  return { topic, archetype: map.archetype, motionLens: map.motionLens };
}

/** Topic seed for the EXISTING carousel generator. */
export function genomeToCarouselSeed(genome: CreativeGenome): {
  topic: string;
  creativeTerritory: CreativeTerritory;
} {
  return {
    topic: `${genome.audienceMoment} Teach: ${genome.mechanicTruth}`.slice(0, 300),
    creativeTerritory: genome.creativeTerritory,
  };
}

/** One-image art direction seed (Photo Director arrives in a later wave; the
 *  string works with today's generatePostImage prompt path). */
export function genomeToPhotoSeed(genome: CreativeGenome): string {
  const t = CREATIVE_TERRITORIES[genome.creativeTerritory];
  return [
    `${genome.visualMetaphor}.`,
    `${t.grammar}`,
    `Cleveland context: ${genome.clevelandAngle}.`,
    `One decisive image, overlay-safe negative space, no text or lettering in the image.`,
    `DO NOT INCLUDE: ${t.avoid}, humans, hands, logos, watermarks.`,
  ].join(" ");
}

/** Compact creative fingerprint for repetition control: the parts of a
 *  campaign a viewer would RECOGNIZE as repeated (moment, metaphor,
 *  territory, action) - normalized, order-stable, human-readable. */
export function fingerprintFromGenome(genome: CreativeGenome): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
  return [
    `territory:${genome.creativeTerritory}`,
    `moment:${norm(genome.audienceMoment)}`,
    `metaphor:${norm(genome.visualMetaphor)}`,
    `action:${norm(genome.desiredAction)}`,
  ].join(" | ").slice(0, 512);
}
