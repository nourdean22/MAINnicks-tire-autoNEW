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
import { buildPre0129CandidateInsert, CANDIDATE_0129_COLUMNS, isUnknownColumnError } from "./db";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql2";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { candidates } from "../drizzle/schema";

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

describe("the pre-0129 fallback insert names no 0129 column (production 500, 2026-09-23)", () => {
  // Drizzle's MySQL insert lists EVERY schema column (`default` for unsupplied
  // ones). The first fallback reused db.insert() and failed exactly like the
  // original insert, so every careers application 500'd in production until
  // 0129 was applied. This renders the REAL SQL the fallback sends.
  const dialect = new MySqlDialect();
  const q = dialect.sqlToQuery(
    buildPre0129CandidateInsert({ name: "A", phone: "2165550100", source: "careers", intent: "confidential", phoneE164: "+12165550100" }),
  );

  it("contains none of the 0129 columns, even when the input object carries them", () => {
    const cols = q.sql.slice(q.sql.indexOf("(") + 1, q.sql.indexOf(")"));
    for (const c of CANDIDATE_0129_COLUMNS) expect(cols, c).not.toMatch(new RegExp(`\\b${c}\\b`));
  });

  it("every column it names exists in schema.ts and is not a 0129 addition", () => {
    const schemaCols = new Set(getTableConfig(candidates).columns.map((c) => c.name));
    const cols = q.sql.slice(q.sql.indexOf("(") + 1, q.sql.indexOf(")")).split(",").map((s) => s.trim());
    for (const c of cols) expect(schemaCols.has(c), c).toBe(true);
    expect(cols.length).toBe(13);
    expect(q.params).toHaveLength(13);
  });

  it("positive control: drizzle's own insert DOES name 0129 columns — the reason the raw path exists", () => {
    const drizzleSql = drizzle.mock().insert(candidates).values({ name: "A", phone: "1" }).toSQL().sql;
    expect(drizzleSql).toMatch(/`intent`/);
  });
});
