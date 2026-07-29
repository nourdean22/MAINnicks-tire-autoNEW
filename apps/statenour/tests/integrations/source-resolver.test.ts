/**
 * tests/integrations/source-resolver.test.ts — (2026-07-29) the pure
 * layer only: identifier classification, Crossref mapping, and the
 * load-bearing honesty rule — metadata absence never renders as clean.
 * No network in the gate.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIdentifier,
  correctionStatusFromCrossref,
  evidenceFromCrossref,
  unresolvedEvidence,
  describeEvidence,
} from "@/lib/integrations/source-resolver";

const NOW = "2026-07-29T12:00:00.000Z";

describe("classifyIdentifier", () => {
  it("extracts a DOI from a bare id, a URL, and trailing punctuation", () => {
    expect(classifyIdentifier("10.1038/s41586-024-07487-w")).toEqual({
      idType: "doi",
      id: "10.1038/s41586-024-07487-w",
    });
    expect(classifyIdentifier("https://doi.org/10.1000/xyz123")?.id).toBe("10.1000/xyz123");
    expect(classifyIdentifier("(10.1000/xyz123).")?.id).toBe("10.1000/xyz123");
  });

  it("recognizes PMIDs and OpenAlex work ids", () => {
    expect(classifyIdentifier("PMID: 39284152")).toEqual({ idType: "pmid", id: "39284152" });
    expect(classifyIdentifier("https://openalex.org/W2741809807")).toEqual({
      idType: "openalex",
      id: "W2741809807",
    });
  });

  it("returns null for junk rather than guessing", () => {
    expect(classifyIdentifier("")).toBeNull();
    expect(classifyIdentifier("just some prose")).toBeNull();
  });
});

describe("correctionStatusFromCrossref — absence is never cleanliness", () => {
  it("NO relation field → unknown (cannot distinguish clean from unreported)", () => {
    expect(correctionStatusFromCrossref({}).status).toBe("unknown");
    expect(correctionStatusFromCrossref({ title: ["x"] }).status).toBe("unknown");
  });

  it("relation field present but empty → none_found (a real inspection happened)", () => {
    expect(correctionStatusFromCrossref({ relation: {} }).status).toBe("none_found");
  });

  it("retraction outranks correction when both are present", () => {
    const r = correctionStatusFromCrossref({
      relation: { "is-retracted-by": [{}], "is-corrected-by": [{}] },
    });
    expect(r.status).toBe("retracted");
    expect(r.sources).toContain("is-retracted-by");
  });

  it("expression of concern and correction map to their own statuses", () => {
    expect(
      correctionStatusFromCrossref({ relation: { "has-expression-of-concern": [{}] } }).status,
    ).toBe("expression_of_concern");
    expect(correctionStatusFromCrossref({ relation: { "has-correction": [{}] } }).status).toBe(
      "corrected",
    );
  });
});

describe("evidenceFromCrossref", () => {
  const msg = {
    title: ["A Study of Things"],
    author: [{ given: "Ada", family: "Lovelace" }, { name: "Consortium X" }],
    issued: { "date-parts": [[2025, 3, 7]] },
    "container-title": ["Journal of Things"],
    relation: {},
    URL: "https://doi.org/10.1000/xyz123",
  };

  it("maps title, authors, date, and journal without inventing missing fields", () => {
    const e = evidenceFromCrossref("10.1000/xyz123", msg, NOW);
    expect(e.title).toBe("A Study of Things");
    expect(e.authors).toEqual(["Ada Lovelace", "Consortium X"]);
    expect(e.publishedAt).toBe("2025-03-07");
    expect(e.sourceName).toBe("Journal of Things");
    expect(e.provenance).toEqual(["crossref"]);
  });

  it("a year-only issued date yields a year, not a fabricated month/day", () => {
    const e = evidenceFromCrossref("10.1000/x", { ...msg, issued: { "date-parts": [[2024]] } }, NOW);
    expect(e.publishedAt).toBe("2024");
  });

  it("missing metadata stays null — never empty-string placeholders", () => {
    const e = evidenceFromCrossref("10.1000/x", { relation: {} }, NOW);
    expect(e.title).toBeNull();
    expect(e.sourceName).toBeNull();
    expect(e.authors).toEqual([]);
  });
});

describe("failure + rendering honesty", () => {
  it("every failure mode resolves to unknown, never none_found", () => {
    for (const reason of ["crossref HTTP 500", "crossref unreachable: timeout", "unrecognized identifier"]) {
      const e = unresolvedEvidence("10.1000/x", "doi", reason, NOW);
      expect(e.correctionStatus).toBe("unknown");
      expect(e.error).toBe(reason);
    }
  });

  it("describeEvidence never calls an unverified source clean", () => {
    const line = describeEvidence(unresolvedEvidence("10.1000/x", "doi", "network down", NOW));
    expect(line).toContain("UNVERIFIED");
    expect(line).toContain("NOT proof");
    expect(line).not.toMatch(/^✓/);
  });

  it("a retracted work renders as a hard stop, and a checked-clean one says what was checked", () => {
    const retracted = evidenceFromCrossref("10.1000/x", { relation: { "is-retracted-by": [{}] } }, NOW);
    expect(describeEvidence(retracted)).toContain("RETRACTED");
    const clean = evidenceFromCrossref("10.1000/x", { title: ["T"], relation: {} }, NOW);
    expect(describeEvidence(clean)).toContain("Crossref relations checked");
  });
});
