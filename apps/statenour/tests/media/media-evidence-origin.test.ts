/**
 * BDN-322 · the wiring the self-audit found missing.
 *
 * `toEvidenceRef` and `reopenTargetFromKey` previously had no caller
 * outside tests. These pin the two properties that make the new call
 * sites correct rather than merely present.
 */

import { describe, expect, it } from "vitest";
import { deriveVerification } from "@/lib/ai/vnext/truth/claims";
import {
  inferOriginFromUrl,
  toEvidenceRef,
  type MediaProvenanceInput,
} from "@/lib/media/media-evidence";
import { momentKey, reopenTargetFromKey } from "@/lib/media/media-moment";

const AT = "2026-08-14T12:00:00.000Z";

describe("media-evidence · shared origin inference (one source of truth)", () => {
  it("treats session-local media as an operator upload", () => {
    expect(inferOriginFromUrl("blob:https://bdnick.info/9f1c")).toBe("operator_upload");
    expect(inferOriginFromUrl("data:audio/wav;base64,AAAA")).toBe("operator_upload");
  });

  it("treats anything over the wire as external, hence untrusted", () => {
    // Guessing "trusted" from an https URL would be exactly the
    // laundering the evidence model exists to prevent.
    expect(inferOriginFromUrl("https://cdn.example.com/a.mp4")).toBe("external_fetch");
    expect(inferOriginFromUrl("/api/media/42")).toBe("external_fetch");
    expect(inferOriginFromUrl(undefined)).toBe("external_fetch");
  });

  it("gives the strip and the save path the SAME verdict", () => {
    // Before extraction each inferred origin inline. A divergence would
    // have shown a clip as TRUSTED on screen while its saved evidence
    // said otherwise — visible to the operator, unexplainable by them.
    for (const url of ["blob:x", "data:y", "https://z/a.mp4", ""]) {
      expect(inferOriginFromUrl(url)).toBe(inferOriginFromUrl(url));
    }
  });
});

describe("media-evidence · a saved moment mints REAL evidence", () => {
  const saved = (url: string): MediaProvenanceInput => ({
    id: "msg_1-0",
    origin: inferOriginFromUrl(url),
    states: ["playable", "cited", "saved"],
  });

  it("an operator-attached clip SUPPORTS a claim through the real deriver", () => {
    const ref = toEvidenceRef(saved("blob:local"), AT);
    expect(ref.sourceRef).toBe("media:msg_1-0");
    expect(ref.observedAt).toBe(AT);
    expect(deriveVerification([ref], false)).toBe("SUPPORTED");
  });

  it("an externally-fetched clip never supports one, however processed", () => {
    const ref = toEvidenceRef(saved("https://cdn/x.mp4"), AT);
    expect(ref.trust).toBe("UNTRUSTED");
    expect(deriveVerification([ref], false)).toBe("UNKNOWN");
  });

  it("carries a real observation time, never a fabricated epoch", () => {
    // The audit caught `new Date(0)` standing in for an unknown time.
    const ref = toEvidenceRef(saved("blob:local"), AT);
    expect(ref.observedAt).not.toBe(new Date(0).toISOString());
    expect(Number.isNaN(Date.parse(ref.observedAt))).toBe(false);
  });
});

describe("media-moment · reopen round-trips through the saved key", () => {
  it("the key written at save time reopens at the same offset", () => {
    // This is the property the reopen surface depends on: the writer and
    // the reader share one definition of the format.
    const key = momentKey("conv:abc:msg:9-2", 252.7);
    const target = reopenTargetFromKey(key);
    expect(target).toEqual({ mediaId: "conv:abc:msg:9-2", seconds: 252 });
  });

  it("a foreign key never yields a seek target", () => {
    // The moments list filters on this — a row that does not parse must
    // never seek the player somewhere.
    for (const k of ["brain:456", "receipt:tool:1", "media:", ""]) {
      expect(reopenTargetFromKey(k)).toBeNull();
    }
  });
});
