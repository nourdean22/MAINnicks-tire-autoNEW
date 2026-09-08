/**
 * tests/lib/missions/resume-record.test.ts · 2026-09-07 (program U5)
 */
import { describe, it, expect } from "vitest";
import {
  MAX_RESUME_LINKS,
  isAcceptableEvidenceLink,
  normalizeResumeRecord,
  parseResumeRecord,
  resumeAgeLabel,
  resumeRecordSchema,
} from "@/lib/missions/resume-record";

describe("normalizeResumeRecord", () => {
  it("trims, keeps only what was said, and drops links that are not http(s) or in-app paths", () => {
    const rec = normalizeResumeRecord({
      intendedOutcome: "  quote accepted by Friday  ",
      lastVerifiedStep: "",
      evidenceLinks: ["https://example.test/doc", "/missions?id=m1", "javascript:alert(1)", "ftp://x", "//evil.test", 42],
      openQuestion: "does the supplier deliver Saturday?",
    });
    expect(rec).toEqual({
      intendedOutcome: "quote accepted by Friday",
      lastVerifiedStep: null,
      evidenceLinks: ["https://example.test/doc", "/missions?id=m1"],
      openQuestion: "does the supplier deliver Saturday?",
      nextPhysicalAction: null,
    });
  });

  it("an empty form is null, never an empty object in the event payload", () => {
    expect(normalizeResumeRecord({})).toBeNull();
    expect(normalizeResumeRecord({ intendedOutcome: "   ", evidenceLinks: ["nope"] })).toBeNull();
    expect(normalizeResumeRecord(null)).toBeNull();
    expect(normalizeResumeRecord("text")).toBeNull();
  });

  it("caps the link count and the line length", () => {
    const links = Array.from({ length: MAX_RESUME_LINKS + 3 }, (_, i) => `https://example.test/${i}`);
    const rec = normalizeResumeRecord({ evidenceLinks: links, nextPhysicalAction: "x".repeat(1000) });
    expect(rec?.evidenceLinks).toHaveLength(MAX_RESUME_LINKS);
    expect(rec?.nextPhysicalAction).toHaveLength(300);
  });

  it("the tRPC schema accepts a partial record and rejects an oversize one", () => {
    expect(resumeRecordSchema.safeParse({ openQuestion: "why?" }).success).toBe(true);
    expect(resumeRecordSchema.safeParse({ intendedOutcome: "x".repeat(301) }).success).toBe(false);
    expect(resumeRecordSchema.safeParse({ evidenceLinks: new Array(MAX_RESUME_LINKS + 1).fill("https://a.test") }).success).toBe(false);
  });
});

describe("parseResumeRecord (reading a stored parked payload)", () => {
  it("legacy payloads with only a note yield null — no invented record", () => {
    expect(parseResumeRecord({ note: "drywall cut — tape the seam next" })).toBeNull();
    expect(parseResumeRecord(null)).toBeNull();
  });

  it("round-trips a stored record", () => {
    const stored = { note: "n", record: { lastVerifiedStep: "seam taped", evidenceLinks: ["/journal"] } };
    expect(parseResumeRecord(stored)).toMatchObject({ lastVerifiedStep: "seam taped", evidenceLinks: ["/journal"] });
  });
});

describe("resumeAgeLabel", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  it("minutes, hours, then days — the freshness the reader must weigh", () => {
    expect(resumeAgeLabel(new Date("2026-09-07T11:35:00Z"), now)).toBe("parked 25 min ago");
    expect(resumeAgeLabel("2026-09-07T03:00:00Z", now)).toBe("parked 9 h ago");
    expect(resumeAgeLabel("2026-09-04T12:00:00Z", now)).toBe("parked 3 d ago");
  });
  it("unknown or garbage timestamps yield null, not 'parked NaN ago'", () => {
    expect(resumeAgeLabel(null, now)).toBeNull();
    expect(resumeAgeLabel("not a date", now)).toBeNull();
  });
});

describe("isAcceptableEvidenceLink", () => {
  it("accepts https and in-app paths only", () => {
    expect(isAcceptableEvidenceLink("https://a.test/x")).toBe(true);
    expect(isAcceptableEvidenceLink("http://a.test/x")).toBe(true);
    expect(isAcceptableEvidenceLink("/brain?tab=memory")).toBe(true);
    expect(isAcceptableEvidenceLink("//a.test")).toBe(false);
    expect(isAcceptableEvidenceLink("data:text/html,x")).toBe(false);
    expect(isAcceptableEvidenceLink("")).toBe(false);
  });
});
