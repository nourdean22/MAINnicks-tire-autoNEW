import { describe, expect, it } from "vitest";
import corpus from "./fixtures/q32-recall-corpus-v1.json";

describe("Q-32 committed recall corpus contract", () => {
  it("is explicitly versioned and de-identified", () => {
    expect(corpus.version).toMatch(/^q32-recall-v\d+-\d{4}-\d{2}-\d{2}$/);
    expect(corpus.deidentified).toBe(true);
    expect(corpus.cases.length).toBeGreaterThanOrEqual(20);
  });

  it("has stable unique case ids and no private-real provenance", () => {
    const ids = corpus.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of corpus.cases) {
      expect(c.provenance).toBe("deidentified-q32");
      expect(c.id).not.toMatch(/^real-/);
      expect(c.query).not.toMatch(/@|\+1\s*\(?\d{3}\)?|\b\d{3}-\d{3}-\d{4}\b/i);
    }
  });

  it("contains positive, contradiction/update, and abstention controls", () => {
    expect(corpus.cases.some((c) => c.relevantKeys.length > 0)).toBe(true);
    expect(corpus.cases.some((c) => c.forbiddenKeys.length > 0)).toBe(true);
    expect(corpus.cases.some((c) => c.kind === "abstention" && c.acceptableAbstention === true)).toBe(true);
  });

  it("never uses the private harvested-corpus provenance vocabulary", () => {
    const json = JSON.stringify(corpus);
    for (const marker of ["chat_claim_warn:", "outcome:", "trace:", "operator correction", "verbatim operator"]) {
      expect(json.toLowerCase()).not.toContain(marker.toLowerCase());
    }
  });
});
