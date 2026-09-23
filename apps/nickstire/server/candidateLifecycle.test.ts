/**
 * shared/candidateLifecycle.ts — the vocabulary written into VARCHAR(32)
 * columns on TiDB, where an over-width write is REJECTED and the row lost
 * (nickstire-tidb-ddl). Plus the referral-code parser that turns
 * /careers?ref=<code> into attribution.
 */
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_INTENTS,
  CANDIDATE_SLA_OPEN_STATUSES,
  CANDIDATE_CONTACT_IMPLIED_STATUSES,
  CANDIDATE_STATUSES,
  MOVE_REASONS,
  parseMoveReasons,
  refCodeFromLandingPage,
  referralLinkFor,
  slugifyRefCode,
} from "../shared/candidateLifecycle";
import { isUnknownColumnError } from "./db";

describe("every value fits the columns it is written to", () => {
  it("status and intent values fit VARCHAR(32)", () => {
    for (const v of [...CANDIDATE_STATUSES, ...CANDIDATE_INTENTS]) expect(v.length, v).toBeLessThanOrEqual(32);
  });

  it("all move reasons joined fit moveReasons VARCHAR(500)", () => {
    expect(MOVE_REASONS.join(",").length).toBeLessThanOrEqual(500);
  });

  it("the original six statuses are still valid (rows written before 0129 keep their meaning)", () => {
    for (const s of ["new", "contacted", "interviewing", "hired", "declined", "withdrew"]) {
      expect(CANDIDATE_STATUSES).toContain(s);
    }
  });

  it("no status is both 'still waiting for a first reply' and 'a human reached them'", () => {
    for (const s of CANDIDATE_SLA_OPEN_STATUSES) expect(CANDIDATE_CONTACT_IMPLIED_STATUSES).not.toContain(s);
  });
});

describe("referral codes from the landing page", () => {
  it("reads ?ref= from an absolute or relative landing URL, lowercased", () => {
    expect(refCodeFromLandingPage("https://nickstire.org/careers?ref=Mike-SnapOn&utm_source=x")).toBe("mike-snapon");
    expect(refCodeFromLandingPage("/careers/tire-technician?ref=tric")).toBe("tric");
  });

  it("rejects anything that is not a code we could have issued", () => {
    expect(refCodeFromLandingPage("https://nickstire.org/careers?ref=<script>")).toBeNull();
    expect(refCodeFromLandingPage("https://nickstire.org/careers?ref=" + "a".repeat(65))).toBeNull();
    expect(refCodeFromLandingPage("https://nickstire.org/careers")).toBeNull();
    expect(refCodeFromLandingPage(null)).toBeNull();
    expect(refCodeFromLandingPage("::::not a url")).toBeNull();
  });

  it("a printed link round-trips back to its code", () => {
    const code = slugifyRefCode("Mike (Snap-on) Euclid");
    expect(code).toBe("mike-snap-on-euclid");
    expect(refCodeFromLandingPage(referralLinkFor(code, "https://nickstire.org"))).toBe(code);
  });

  it("parseMoveReasons drops unknown keys instead of rendering them", () => {
    expect(parseMoveReasons("schedule,bogus, equipment")).toEqual(["schedule", "equipment"]);
    expect(parseMoveReasons(null)).toEqual([]);
  });
});

describe("isUnknownColumnError — the pre-0129 fallback trigger", () => {
  it("recognises 1054 directly and through a drizzle-wrapped cause", () => {
    expect(isUnknownColumnError({ code: "ER_BAD_FIELD_ERROR" })).toBe(true);
    expect(isUnknownColumnError({ errno: 1054 })).toBe(true);
    expect(isUnknownColumnError({ message: "Failed query", cause: { code: "ER_BAD_FIELD_ERROR" } })).toBe(true);
    expect(isUnknownColumnError(new Error("Unknown column 'intent' in 'field list'"))).toBe(true);
  });

  it("does NOT fire on other failures — those must still surface as 'call us instead'", () => {
    expect(isUnknownColumnError({ code: "ER_NO_SUCH_TABLE", errno: 1146 })).toBe(false);
    expect(isUnknownColumnError({ code: "ER_DUP_ENTRY" })).toBe(false);
    expect(isUnknownColumnError(new Error("connect ETIMEDOUT"))).toBe(false);
    expect(isUnknownColumnError(null)).toBe(false);
  });
});
