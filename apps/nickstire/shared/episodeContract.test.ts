import { describe, it, expect } from "vitest";
import {
  preflightEpisode,
  fromReelJobBrief,
  requiresAiDisclosure,
  EPISODE_CONTRACT_VERSION,
  HASHTAG_CAP,
  type EpisodeContract,
} from "./episodeContract";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function contract(over: Partial<EpisodeContract> = {}): EpisodeContract {
  return {
    schemaVersion: EPISODE_CONTRACT_VERSION,
    episodeId: "ep_1",
    createdAt: new Date().toISOString(),
    objective: "UTILITY",
    disclosureMode: "visibly_animated",
    claims: [
      { claimId: "c1", text: "Check tire pressure monthly.", riskTier: "mechanical", evidenceIds: ["e1"], requiredQualifiers: [] },
    ],
    evidence: [
      {
        evidenceId: "e1", claimIds: ["c1"], sourceType: "government",
        sourceRef: "https://example.gov/x", sourceExcerpt: "Check tire pressure monthly.",
        retrievedAt: new Date().toISOString(), expiresAt: FUTURE, entailment: "supported",
      },
    ],
    script: { caption: "Check monthly.", voiceover: "Check monthly.", ctaType: "SAVE", hashtags: ["#tires"] },
    experiment: { experimentId: null, armId: null, primaryVariable: null },
    publication: { idempotencyKey: "ep_1", disclosureRequired: false, captionHash: null, mediaHash: null },
    ...over,
  };
}

describe("a clean episode passes", () => {
  it("allows when every claim is supported and unexpired", () => {
    const r = preflightEpisode(contract());
    expect(r.allowed).toBe(true);
    expect(r.blocks).toEqual([]);
  });
});

describe("the rule that makes this worth having", () => {
  it("BLOCKS on not_evaluated — 'we never checked' is not evidence of support", () => {
    const r = preflightEpisode(contract({
      evidence: [{ ...contract().evidence[0], entailment: "not_evaluated" }],
    }));
    expect(r.allowed).toBe(false);
    expect(r.blocks).toContain("ENTAILMENT_MISSING");
  });

  it("blocks a contradicted source even if another supports it", () => {
    const base = contract();
    const r = preflightEpisode(contract({
      claims: [{ ...base.claims[0], evidenceIds: ["e1", "e2"] }],
      evidence: [
        base.evidence[0],
        { ...base.evidence[0], evidenceId: "e2", entailment: "contradicted" },
      ],
    }));
    expect(r.allowed).toBe(false);
    expect(r.blocks).toContain("CLAIM_CONTRADICTED");
  });

  it("blocks expired evidence", () => {
    const r = preflightEpisode(contract({
      evidence: [{ ...contract().evidence[0], expiresAt: PAST }],
    }));
    expect(r.blocks).toContain("EVIDENCE_EXPIRED");
  });

  it("blocks a claim citing evidence that isn't in the packet", () => {
    const r = preflightEpisode(contract({
      claims: [{ ...contract().claims[0], evidenceIds: ["ghost"] }],
    }));
    expect(r.blocks).toContain("CLAIM_WITHOUT_EVIDENCE");
  });
});

describe("qualifiers must survive into the script", () => {
  it("blocks when a partially-supported claim's qualifier was edited out", () => {
    const r = preflightEpisode(contract({
      claims: [{ ...contract().claims[0], requiredQualifiers: ["can increase the risk"] }],
      evidence: [{ ...contract().evidence[0], entailment: "partially_supported" }],
      script: { caption: "Underinflation causes blowouts.", voiceover: "", ctaType: "SAVE", hashtags: [] },
    }));
    expect(r.blocks).toContain("QUALIFIER_DROPPED");
  });

  it("allows when the qualifier is present", () => {
    const r = preflightEpisode(contract({
      claims: [{ ...contract().claims[0], requiredQualifiers: ["can increase the risk"] }],
      evidence: [{ ...contract().evidence[0], entailment: "partially_supported" }],
      script: { caption: "Underinflation can increase the risk of a blowout.", voiceover: "", ctaType: "SAVE", hashtags: [] },
    }));
    expect(r.allowed).toBe(true);
  });
});

describe("publication shape", () => {
  it("blocks an over-limit caption rather than letting it be truncated", () => {
    const r = preflightEpisode(contract({
      script: { caption: "x".repeat(2300), voiceover: "", ctaType: "SAVE", hashtags: [] },
    }));
    expect(r.blocks).toContain("CAPTION_TOO_LONG");
  });

  it(`enforces the ${HASHTAG_CAP}-hashtag cap`, () => {
    const r = preflightEpisode(contract({
      script: { caption: "c", voiceover: "", ctaType: "SAVE", hashtags: ["#a", "#b", "#c", "#d", "#e", "#f"] },
    }));
    expect(r.blocks).toContain("HASHTAG_CAP_EXCEEDED");
  });

  it("requires Meta disclosure for photorealistic synthetic video", () => {
    expect(requiresAiDisclosure("photorealistic_synthetic")).toBe(true);
    expect(requiresAiDisclosure("realistic_synthetic_audio")).toBe(true);
    expect(requiresAiDisclosure("visibly_animated")).toBe(false);

    const r = preflightEpisode(contract({
      disclosureMode: "photorealistic_synthetic",
      publication: { ...contract().publication, disclosureRequired: false },
    }));
    expect(r.blocks).toContain("DISCLOSURE_MISSING");
  });

  it("rejects half an experiment assignment", () => {
    const r = preflightEpisode(contract({
      experiment: { experimentId: "exp1", armId: null, primaryVariable: "hook_style" },
    }));
    expect(r.blocks).toContain("EXPERIMENT_INCOMPLETE");
  });
});

describe("adoption seam", () => {
  it("reports what a brief could not supply instead of inventing it", () => {
    const { contract: c, missing } = fromReelJobBrief({ id: "42", selectedCaption: "hi", hashtags: ["#a"] });
    expect(c.episodeId).toBe("ep_42");
    expect(c.script.caption).toBe("hi");
    // The point: it does NOT fabricate claims or evidence to look complete.
    expect(missing).toEqual(expect.arrayContaining(["objective", "disclosureMode", "claims", "evidence", "ctaType"]));
  });

  it("a brief-derived contract fails preflight for exactly the reasons it should", () => {
    const { contract: c } = fromReelJobBrief({ id: "42", selectedCaption: "hi" });
    const r = preflightEpisode(c);
    expect(r.allowed).toBe(false);
    expect(r.blocks).toContain("NO_CLAIMS");
  });
});
