/**
 * BDN-313 · media as evidence for the INCUMBENT claim ledger.
 *
 * The two properties that carry the design:
 *   1. trust is decided by ORIGIN alone — running our own transcription
 *      over hostile input does not launder it;
 *   2. capability states (transcribed/analyzed/…) are ORTHOGONAL to the
 *      evidence ladder and must never promote an item up it.
 */

import { describe, expect, it } from "vitest";
import { EVIDENCE_STRENGTH, deriveVerification } from "@/lib/ai/vnext/truth/claims";
import {
  MEDIA_STATES,
  buildMediaProvenance,
  canSupportAlone,
  evidenceClassForOrigin,
  mediaSourceRef,
  toEvidenceRef,
  trustForOrigin,
  type MediaProvenanceInput,
} from "@/lib/media/media-evidence";

const AT = "2026-08-14T12:00:00.000Z";

const media = (over: Partial<MediaProvenanceInput> = {}): MediaProvenanceInput => ({
  id: "m1",
  origin: "operator_upload",
  observedAt: AT,
  states: ["playable"],
  ...over,
});

describe("media-evidence · trust by origin (load-bearing)", () => {
  it("trusts what the operator attached and what our own instruments captured", () => {
    expect(trustForOrigin("operator_upload")).toBe("TRUSTED");
    expect(trustForOrigin("system_capture")).toBe("TRUSTED");
  });

  it("never trusts externally fetched media", () => {
    expect(trustForOrigin("external_fetch")).toBe("UNTRUSTED");
  });

  it("processing does NOT launder untrusted media", () => {
    // A scraped clip we transcribed and analyzed ourselves is still
    // hostile input. Running our pipeline over it changes usability,
    // not provenance.
    const processed = media({
      origin: "external_fetch",
      states: ["playable", "transcribed", "analyzed", "cited", "saved"],
    });
    expect(toEvidenceRef(processed).trust).toBe("UNTRUSTED");
    expect(canSupportAlone(processed)).toBe(false);
  });
});

describe("media-evidence · ladder mapping", () => {
  it("maps each origin to the incumbent evidence classes", () => {
    expect(evidenceClassForOrigin("operator_upload")).toBe("operator_stated");
    expect(evidenceClassForOrigin("system_capture")).toBe("direct_observation");
    expect(evidenceClassForOrigin("external_fetch")).toBe("external_source");
  });

  it("does not let capability states change the ladder position", () => {
    const bare = evidenceClassForOrigin(media().origin);
    const rich = evidenceClassForOrigin(
      media({ states: ["playable", "transcribed", "analyzed"] }).origin,
    );
    expect(rich).toBe(bare);
    expect(EVIDENCE_STRENGTH[rich]).toBe(EVIDENCE_STRENGTH[bare]);
  });

  it("operator uploads sit at the top rung", () => {
    expect(EVIDENCE_STRENGTH[evidenceClassForOrigin("operator_upload")]).toBe(
      EVIDENCE_STRENGTH.operator_stated,
    );
  });
});

describe("media-evidence · EvidenceRef shape feeds the real ledger", () => {
  it("namespaces sourceRef beside brain:/receipt:", () => {
    expect(mediaSourceRef("abc")).toBe("media:abc");
  });

  it("omits contentHash rather than emitting an empty one", () => {
    expect(toEvidenceRef(media())).not.toHaveProperty("contentHash");
    expect(toEvidenceRef(media({ contentHash: "deadbeef" })).contentHash).toBe("deadbeef");
  });

  it("a trusted operator upload SUPPORTS a claim through the real deriver", () => {
    // The point of the whole module: this value is consumed by
    // claims.ts's own logic, not by a parallel implementation.
    expect(deriveVerification([toEvidenceRef(media())], false)).toBe("SUPPORTED");
  });

  it("an untrusted external clip yields UNKNOWN through the real deriver", () => {
    const ref = toEvidenceRef(media({ origin: "external_fetch" }));
    expect(deriveVerification([ref], false)).toBe("UNKNOWN");
  });

  it("a contradiction demotes even a trusted upload", () => {
    expect(deriveVerification([toEvidenceRef(media())], true)).toBe("PARTIAL");
  });
});

describe("media-evidence · provenance view", () => {
  it("reports reached and missing states in pipeline order", () => {
    const v = buildMediaProvenance(media({ states: ["playable", "analyzed"] }));
    expect(v.states).toEqual(["playable", "analyzed"]);
    expect(v.missing).toEqual(["transcribed", "cited", "saved"]);
  });

  it("covers every declared state across reached + missing", () => {
    const v = buildMediaProvenance(media({ states: ["playable"] }));
    expect([...v.states, ...v.missing].sort()).toEqual([...MEDIA_STATES].sort());
  });

  it("warns that an untranscribed item has only been played, not read", () => {
    const v = buildMediaProvenance(media());
    expect(v.caveats.join(" ")).toContain("only played");
  });

  it("flags the worst case: cited without a transcript", () => {
    // A citation with no transcript means the model referred to media it
    // could not have read — the highest-value caveat in the set.
    const v = buildMediaProvenance(media({ states: ["playable", "cited"] }));
    expect(v.caveats.join(" ")).toContain("not grounded in its contents");
  });

  it("stays quiet when an item is fully processed and trusted", () => {
    const v = buildMediaProvenance(
      media({ states: ["playable", "transcribed", "analyzed", "cited", "saved"] }),
    );
    expect(v.caveats).toEqual([]);
    expect(v.canSupportAlone).toBe(true);
  });

  it("an external item carries the can-inform-but-not-support caveat", () => {
    const v = buildMediaProvenance(media({ origin: "external_fetch" }));
    expect(v.caveats.join(" ")).toContain("never support one on its own");
    expect(v.canSupportAlone).toBe(false);
  });
});
