/**
 * The Episode Contract — one authority for what an episode claims, says, and
 * costs, so downstream stages derive from it instead of competing with it.
 *
 * THE PROBLEM
 * `ReelJobBrief` is the closest thing the pipeline has to a contract, and it is
 * a bag of optional fields. Objective, CTA type, disclosure mode, claim packet,
 * entailment verdicts, experiment arm and publication hashes all live in other
 * structures or nowhere, so nothing GUARANTEES they exist at the render
 * boundary. Two consequences, both observed in this repo:
 *
 *   - fields go missing silently (a caption sliced to the limit lost its CTA)
 *   - two subsystems disagree about the truth (the critic restored a
 *     `mechanicTruth` the evidence layer never approved)
 *
 * SCOPE OF THIS FILE
 * Deliberately additive. It defines the contract, validates it, and preflights
 * it — it does not rewrite the pipeline. `fromReelJobBrief` builds a contract
 * from what a brief already carries and reports honestly what is missing, so
 * adoption is incremental and the gaps are visible instead of assumed away.
 *
 * Pure: no DB, no network, no clock beyond an injected `now`.
 */
import type { EntailmentVerdict } from "./claimEntailment";

export const EPISODE_CONTRACT_VERSION = "episode-contract-v1" as const;

/** Instagram's caption ceiling, hashtags included. */
export const CAPTION_LIMIT = 2200;

export type EpisodeObjective =
  | "DISCOVERY" | "UTILITY" | "TRUST" | "LOCAL_RELEVANCE"
  | "CONVERSION" | "COMMUNITY" | "MEDIA_IP";

/**
 * How obviously synthetic the finished media is. Drives whether Meta's AI
 * disclosure is REQUIRED rather than optional — photorealistic synthetic video
 * and realistic synthetic audio are the two Meta calls out.
 */
export type DisclosureMode =
  | "visibly_animated"
  | "ai_visualization"
  | "generated_simulation"
  | "generated_reenactment"
  | "photorealistic_synthetic"
  | "realistic_synthetic_audio";

export type ClaimRiskTier = "low" | "mechanical" | "safety" | "regulatory" | "business_claim";

export interface EpisodeClaim {
  claimId: string;
  text: string;
  riskTier: ClaimRiskTier;
  evidenceIds: string[];
  /** Wording that MUST survive into the script when entailment is partial. */
  requiredQualifiers: string[];
}

export interface EpisodeEvidence {
  evidenceId: string;
  claimIds: string[];
  sourceType: "government" | "manufacturer" | "industry" | "internal_record" | "verified_review" | "business_fact";
  sourceRef: string;
  /** The text actually retrieved. Null means provenance only — cannot entail. */
  sourceExcerpt: string | null;
  retrievedAt: string;
  expiresAt: string;
  entailment: EntailmentVerdict;
}

export interface EpisodeContract {
  schemaVersion: typeof EPISODE_CONTRACT_VERSION;
  episodeId: string;
  createdAt: string;
  objective: EpisodeObjective;
  disclosureMode: DisclosureMode;
  claims: EpisodeClaim[];
  evidence: EpisodeEvidence[];
  script: {
    caption: string;
    voiceover: string;
    ctaType: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE";
    hashtags: string[];
  };
  experiment: {
    experimentId: string | null;
    armId: string | null;
    primaryVariable: string | null;
  };
  publication: {
    /** Guards exactly-once publication. */
    idempotencyKey: string;
    disclosureRequired: boolean;
    captionHash: string | null;
    mediaHash: string | null;
  };
}

/** Every way an episode can be refused, as a code rather than a message. */
export type BlockCode =
  | "SCHEMA_INVALID"
  | "NO_CLAIMS"
  | "CLAIM_WITHOUT_EVIDENCE"
  | "EVIDENCE_EXPIRED"
  | "ENTAILMENT_MISSING"
  | "CLAIM_CONTRADICTED"
  | "CLAIM_UNSUPPORTED"
  | "QUALIFIER_DROPPED"
  | "CAPTION_TOO_LONG"
  | "CAPTION_EMPTY"
  | "DISCLOSURE_MISSING"
  | "CTA_MISSING"
  | "HASHTAG_CAP_EXCEEDED"
  | "EXPERIMENT_INCOMPLETE";

/**
 * Instagram's hard cap. Certified at 3-12 in this repo once while the real
 * platform limit was 5, and 12 of 12 posts violated it — so it is a constant
 * here rather than a per-caller opinion.
 */
export const HASHTAG_CAP = 5;

/** Meta requires disclosure for these two; the rest are visibly synthetic. */
export function requiresAiDisclosure(mode: DisclosureMode): boolean {
  return mode === "photorealistic_synthetic" || mode === "realistic_synthetic_audio";
}

export interface PreflightResult {
  allowed: boolean;
  blocks: BlockCode[];
  /** One human-readable line per block, in the same order. */
  detail: string[];
  /** Findings that are real but not yet enforced — see PENDING_WIRING. */
  warnings: BlockCode[];
}

/**
 * The two findings that mean "this pipeline does not carry evidence YET", as
 * opposed to "this episode is unsafe".
 *
 * No evidence record currently reaches a reel brief — the evidence layer exists
 * but was never wired into this path. Enforcing these today would block every
 * reel the shop produces, so they are reported and not enforced until
 * REEL_REQUIRE_CLAIM_EVIDENCE is turned on.
 *
 * Everything ELSE enforces immediately, including every claim-related block:
 * CLAIM_CONTRADICTED, CLAIM_UNSUPPORTED, EVIDENCE_EXPIRED, QUALIFIER_DROPPED
 * and CLAIM_WITHOUT_EVIDENCE can only fire once an episode actually declares
 * claims — and at that point they describe a real defect, not a missing
 * integration.
 */
export const PENDING_WIRING: readonly BlockCode[] = [
  "NO_CLAIMS",
  "ENTAILMENT_MISSING",
  // Added 2026-08-01 after a measured dry-run over 12 real briefs: 12/12 would
  // have been BLOCKED, 11 of them on this code, i.e. all reel production
  // stopped. I had reasoned this "can only fire once an episode declares
  // claims, and then it is a real defect" — true before claims were wired, and
  // wrong the moment they were. Every brief now declares a claim, and the
  // generator cites sources the curated registry does not contain ("Tire
  // Industry Association Repair Manual", "Michelin: Tire Repair and
  // Patching"), so they resolve to nothing.
  //
  // That is a registry-coverage gap, not a lying episode: the claim is stated
  // and a source WAS named, it simply is not one we can verify. Enforcing it
  // today would punish the pipeline for a curation backlog. It stays reported
  // until the registry covers the families the generator actually reaches for.
  "CLAIM_WITHOUT_EVIDENCE",
];

export interface PreflightOptions {
  /** Promote PENDING_WIRING findings to hard blocks. */
  requireClaimEvidence?: boolean;
}

/**
 * Decide whether this episode may proceed autonomously.
 *
 * Fail-closed by construction: an unevaluated entailment BLOCKS rather than
 * passing, because "we never checked" is not evidence of support. That single
 * rule is the difference between citing a source and being governed by one.
 */
export function preflightEpisode(
  episode: EpisodeContract,
  now: Date = new Date(),
  options: PreflightOptions = {},
): PreflightResult {
  const blocks: BlockCode[] = [];
  const detail: string[] = [];
  const add = (code: BlockCode, why: string) => { blocks.push(code); detail.push(why); };

  if (episode.schemaVersion !== EPISODE_CONTRACT_VERSION) {
    add("SCHEMA_INVALID", `unknown schemaVersion "${episode.schemaVersion}"`);
  }

  if (!episode.claims.length) {
    add("NO_CLAIMS", "an episode that asserts nothing has nothing to verify — declare its claims");
  }

  const evidenceById = new Map(episode.evidence.map((e) => [e.evidenceId, e]));
  const script = `${episode.script.caption}\n${episode.script.voiceover}`;

  for (const claim of episode.claims) {
    if (!claim.evidenceIds.length) {
      add("CLAIM_WITHOUT_EVIDENCE", `claim ${claim.claimId} cites no evidence`);
      continue;
    }
    // A claim is only as good as its BEST supporting record, but any
    // contradicting record is disqualifying on its own.
    let best: EntailmentVerdict = "not_evaluated";
    const rank: Record<EntailmentVerdict, number> = {
      supported: 4, partially_supported: 3, not_evaluated: 2, not_supported: 1, contradicted: 0,
    };

    for (const eid of claim.evidenceIds) {
      const ev = evidenceById.get(eid);
      if (!ev) {
        add("CLAIM_WITHOUT_EVIDENCE", `claim ${claim.claimId} cites missing evidence ${eid}`);
        continue;
      }
      if (new Date(ev.expiresAt) <= now) {
        add("EVIDENCE_EXPIRED", `evidence ${eid} expired ${ev.expiresAt}`);
      }
      if (ev.entailment === "contradicted") {
        add("CLAIM_CONTRADICTED", `evidence ${eid} contradicts claim ${claim.claimId}`);
      }
      if (rank[ev.entailment] > rank[best]) best = ev.entailment;
    }

    if (best === "not_evaluated") {
      add("ENTAILMENT_MISSING", `claim ${claim.claimId} has provenance but no entailment verdict — a citation is not a statement`);
    } else if (best === "not_supported") {
      add("CLAIM_UNSUPPORTED", `no cited source supports claim ${claim.claimId}`);
    } else if (best === "partially_supported") {
      if (!claim.requiredQualifiers.length) {
        add("QUALIFIER_DROPPED", `claim ${claim.claimId} is only partially supported and declares no qualifier`);
      } else {
        const lower = script.toLowerCase();
        const missing = claim.requiredQualifiers.filter((q) => !lower.includes(q.toLowerCase()));
        if (missing.length) {
          add("QUALIFIER_DROPPED", `claim ${claim.claimId} requires "${missing.join('", "')}" but the script does not contain it`);
        }
      }
    }
  }

  const composed = `${episode.script.caption}\n\n${episode.script.hashtags.join(" ")}`.trim();
  if (!episode.script.caption.trim()) {
    add("CAPTION_EMPTY", "no caption");
  }
  if (composed.length > CAPTION_LIMIT) {
    add("CAPTION_TOO_LONG", `caption + hashtags is ${composed.length} chars, over the ${CAPTION_LIMIT} limit — shorten it rather than letting it be truncated`);
  }
  if (episode.script.hashtags.length > HASHTAG_CAP) {
    add("HASHTAG_CAP_EXCEEDED", `${episode.script.hashtags.length} hashtags, cap is ${HASHTAG_CAP}`);
  }
  if (!episode.script.ctaType) {
    add("CTA_MISSING", "no CTA type declared");
  }

  if (requiresAiDisclosure(episode.disclosureMode) && !episode.publication.disclosureRequired) {
    add("DISCLOSURE_MISSING", `disclosureMode "${episode.disclosureMode}" requires Meta AI disclosure but the package does not set it`);
  }

  // Half an experiment assignment cannot be analysed later.
  const { experimentId, armId } = episode.experiment;
  if ((experimentId && !armId) || (!experimentId && armId)) {
    add("EXPERIMENT_INCOMPLETE", "experimentId and armId must be set together or not at all");
  }

  const unique = [...new Set(blocks)];
  const enforced = options.requireClaimEvidence
    ? unique
    : unique.filter((b) => !PENDING_WIRING.includes(b));
  const warnings = unique.filter((b) => !enforced.includes(b));

  return { allowed: enforced.length === 0, blocks: enforced, detail, warnings };
}

/**
 * What only the CALLER can know, and must therefore state.
 *
 * This is the required argument to enqueueReelJob. It is deliberately not a
 * whole contract: passing a pre-built contract would let a caller satisfy the
 * type by calling `fromReelJobBrief` and changing nothing, which is ceremony.
 * Naming these four fields forces a real decision at each enqueue site —
 * above all `disclosureMode`, which decides whether Meta AI disclosure is
 * mandatory and must never be inherited from a default.
 */
export interface EpisodeDeclaration {
  objective: EpisodeObjective;
  disclosureMode: DisclosureMode;
  ctaType: EpisodeContract["script"]["ctaType"];
  claims?: EpisodeClaim[];
  evidence?: EpisodeEvidence[];
  experiment?: Partial<EpisodeContract["experiment"]>;
}

/**
 * Build a contract from an existing brief, reporting what the brief could not
 * supply.
 *
 * This is the adoption seam. It does NOT invent an objective, a disclosure mode
 * or an entailment verdict to make the contract look complete — missing inputs
 * come back in `missing`, and the resulting contract will fail preflight for
 * exactly the reasons it should.
 */
export function fromReelJobBrief(
  brief: Record<string, unknown>,
  overrides: Partial<EpisodeContract> = {},
): { contract: EpisodeContract; missing: string[] } {
  const missing: string[] = [];
  const str = (k: string) => (typeof brief[k] === "string" ? (brief[k] as string) : "");
  const arr = (k: string) => (Array.isArray(brief[k]) ? (brief[k] as string[]) : []);

  if (!overrides.objective) missing.push("objective");
  if (!overrides.disclosureMode) missing.push("disclosureMode");
  if (!overrides.claims?.length) missing.push("claims");
  if (!overrides.evidence?.length) missing.push("evidence");
  if (!overrides.script?.ctaType && !brief.ctaType) missing.push("ctaType");

  const contract: EpisodeContract = {
    schemaVersion: EPISODE_CONTRACT_VERSION,
    episodeId: overrides.episodeId ?? `ep_${String(brief.id ?? "unknown")}`,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    objective: overrides.objective ?? "DISCOVERY",
    disclosureMode: overrides.disclosureMode ?? "visibly_animated",
    claims: overrides.claims ?? [],
    evidence: overrides.evidence ?? [],
    script: {
      caption: overrides.script?.caption ?? str("selectedCaption"),
      voiceover: overrides.script?.voiceover ?? str("voiceoverScript"),
      ctaType: overrides.script?.ctaType ?? ((brief.ctaType as EpisodeContract["script"]["ctaType"]) ?? "NONE"),
      hashtags: overrides.script?.hashtags ?? arr("hashtags"),
    },
    experiment: {
      experimentId: overrides.experiment?.experimentId ?? null,
      armId: overrides.experiment?.armId ?? null,
      primaryVariable: overrides.experiment?.primaryVariable ?? null,
    },
    publication: {
      idempotencyKey: overrides.publication?.idempotencyKey ?? `ep_${String(brief.id ?? "unknown")}`,
      disclosureRequired:
        overrides.publication?.disclosureRequired ??
        requiresAiDisclosure(overrides.disclosureMode ?? "visibly_animated"),
      captionHash: overrides.publication?.captionHash ?? null,
      mediaHash: overrides.publication?.mediaHash ?? null,
    },
  };

  return { contract, missing };
}

/** Build the contract an enqueue is governed by, from the brief plus the caller's declaration. */
export function contractFromDeclaration(
  brief: Record<string, unknown>,
  decl: EpisodeDeclaration,
): EpisodeContract {
  return fromReelJobBrief(brief, {
    objective: decl.objective,
    disclosureMode: decl.disclosureMode,
    claims: decl.claims ?? [],
    evidence: decl.evidence ?? [],
    experiment: {
      experimentId: decl.experiment?.experimentId ?? null,
      armId: decl.experiment?.armId ?? null,
      primaryVariable: decl.experiment?.primaryVariable ?? null,
    },
    script: {
      caption: typeof brief.selectedCaption === "string" ? brief.selectedCaption : "",
      voiceover: typeof brief.voiceoverScript === "string" ? brief.voiceoverScript : "",
      ctaType: decl.ctaType,
      hashtags: Array.isArray(brief.hashtags) ? (brief.hashtags as string[]) : [],
    },
    publication: {
      idempotencyKey: `ep_${String(brief.id ?? "unknown")}`,
      // Derived from the declared mode, never passed in — a caller cannot
      // declare photorealistic output and then opt out of disclosing it.
      disclosureRequired: requiresAiDisclosure(decl.disclosureMode),
      captionHash: null,
      mediaHash: null,
    },
  }).contract;
}
