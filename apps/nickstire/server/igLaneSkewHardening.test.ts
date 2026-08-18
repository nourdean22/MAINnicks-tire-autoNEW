/**
 * IG-lane hardening sweep, 2026-08-18 — the same two defect classes, hunted
 * everywhere instead of fixed where they happened to bite:
 *
 *  1. BARE JSON.parse ON LLM CONTENT. The daily-reel lane received HTTP 200 whose
 *     content was a plain "Aborted: c..." string; JSON.parse's SyntaxError showed
 *     ten characters of it, and diagnosis burned six live probes. The same bare
 *     parse existed SEVEN more times in contentManufacturing.
 *
 *  2. DRIVER CLOCK SKEW. mysql2 decodes DATETIME as connection-local while this
 *     DB returns UTC, so every driver-parsed Date reads +4h on an ET host, and
 *     `Date.now() - parsed` runs ~4h negative. Measured casualties: the keepalive
 *     staleness guard (fixed in this PR's parent), the comment responder's
 *     "first-hour" bonus (true for ~5 hours), and the admin MFA freshness window
 *     (12h silently accepted ~16h).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMfaVerificationFresh } from "./services/adminSecurity";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("MFA freshness uses the DB-computed age, fail closed", () => {
  it("a fresh verification passes; the window boundary holds exactly", () => {
    expect(isMfaVerificationFresh(30)).toBe(true);
    expect(isMfaVerificationFresh(720)).toBe(true); // 12h exactly — inclusive
    expect(isMfaVerificationFresh(721)).toBe(false);
  });

  it("an unknown age requires re-verification — never assumed fresh", () => {
    // Number(null) === 0 burned the liveness helper the same day; null must be
    // handled BEFORE coercion, and coercion garbage must fail closed too.
    expect(isMfaVerificationFresh(null)).toBe(false);
    expect(isMfaVerificationFresh(Number.NaN)).toBe(false);
  });

  it("a NEGATIVE age is rejected — that is the skew signature, not freshness", () => {
    // Under the driver skew the old Date-based comparison produced exactly this:
    // a verification timestamp ~4h in the future. Accepting it would rebuild the
    // stretched window this fix removes.
    expect(isMfaVerificationFresh(-235)).toBe(false);
  });

  it("the users SELECT computes the age server-side", () => {
    const src = read("server/services/adminSecurity.ts");
    expect(src).toContain("TIMESTAMPDIFF(MINUTE, mfaVerifiedAt, UTC_TIMESTAMP())");
    // The skewed derivation must not come back.
    expect(src).not.toContain("Date.now() - at.getTime()");
  });

  it("every caller passes the age, not the parsed Date", () => {
    for (const p of ["server/_core/trpc.ts", "server/routers/adminSecurity.ts"]) {
      const src = read(p);
      expect(src, p).not.toMatch(/isMfaVerificationFresh\((?:security\??\.)?mfaVerifiedAt/);
    }
  });
});

describe("no LLM completion is bare-JSON.parsed in the IG manufacturing lane", () => {
  it("contentManufacturing routes every completion through the tolerant parser", () => {
    const src = read("server/services/contentManufacturing.ts");
    // The landmine pattern, by shape rather than by count, so a NEW bare parse
    // fails this test the day it is written.
    expect(src).not.toMatch(/JSON\.parse\([A-Za-z]+\.choices\[0\]\.message\.content/);
    expect(src).toContain('import { parseReelJson } from "./reelBriefGen"');
  });
});

describe("the comment responder's first-hour bonus is computed by the database", () => {
  it("age math happens in SQL, and the phantom publishedAt column is gone", () => {
    const src = read("server/services/commentResponder.ts");
    expect(src).toContain("TIMESTAMPDIFF(MINUTE");
    // The skewed derivation: Date.now() minus a driver-parsed job timestamp.
    expect(src).not.toMatch(/Date\.now\(\) - pubDate/);
    // reel_jobs has no publishedAt column — the old code consulted one anyway,
    // so the fallback branch was the only branch that ever ran. Anchored on the
    // DECLARATION shape, because the fix's own comment names the phantom column
    // (a bare not.toContain matched that prose — the seventh time this arc a
    // scan assertion hit its own explanation).
    expect(src).not.toMatch(/const pubDate = job\.publishedAt/);
  });
});
