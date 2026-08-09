import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SMS_OPT_OUT_KEYWORDS,
  isOptOutBody,
} from "../../shared/smsOptOutKeywords";

/**
 * The opt-out vocabulary had drifted into three copies: the index query that
 * decides suppression matched ten words, the inbound handler that reacts in the
 * moment matched five, and the instrumentation that ATTRIBUTES opt-outs matched
 * a third set. Nobody went un-suppressed — the index re-derives from raw inbound
 * bodies and is the real net — but a customer texting STOPALL or REVOKE got no
 * confirmation, no compliance row, and stayed sendable until the 5-minute cache
 * turned over.
 *
 * The JS copies now import the shared constant. The SQL literals cannot import
 * anything, so they are pinned HERE by parsing them out of the source: if
 * someone widens one list and forgets the other, this fails and names the
 * missing words. That is the property a comment could not provide.
 */

const APP = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(APP, p), "utf8");

/** pull the words out of an `IN ('A','B',...)` literal following a marker */
function sqlInList(source: string, marker: RegExp): string[] {
  const m = source.match(marker);
  expect(m, `could not find the opt-out IN(...) literal — did the query move?`).toBeTruthy();
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const CANON = [...SMS_OPT_OUT_KEYWORDS].sort();

describe("SMS opt-out vocabulary", () => {
  it("canary: the shared list is non-trivial and contains the carrier-required words", () => {
    expect(SMS_OPT_OUT_KEYWORDS.length).toBeGreaterThanOrEqual(10);
    for (const required of ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]) {
      expect(SMS_OPT_OUT_KEYWORDS).toContain(required);
    }
  });

  it("the opt-out INDEX query matches the shared vocabulary exactly", () => {
    const words = sqlInList(read("server/sms.ts"), /UPPER\(TRIM\(m\.body\)\)\s+IN\s*\(([^)]+)\)/);
    expect(words.sort()).toEqual(CANON);
  });

  it("the eligibility query matches the shared vocabulary exactly", () => {
    const words = sqlInList(
      read("server/lib/sms-eligibility.ts"),
      /UPPER\(TRIM\(sm\.body\)\)\s+IN\s*\(([^)]+)\)/,
    );
    expect(words.sort()).toEqual(CANON);
  });

  it("no file redefines the vocabulary as its own array literal", () => {
    for (const f of ["server/sms.ts", "server/services/smsInstrumentation.ts"]) {
      const src = read(f);
      expect(
        /\[\s*"STOP"\s*,\s*"UNSUBSCRIBE"/.test(src),
        `${f} still hardcodes a private opt-out list`,
      ).toBe(false);
    }
  });

  it("recognises every keyword, including the ones the old handler missed", () => {
    for (const word of SMS_OPT_OUT_KEYWORDS) {
      expect(isOptOutBody(word), `${word} must opt out`).toBe(true);
      expect(isOptOutBody(` ${word.toLowerCase()} `), `${word} must opt out when messy`).toBe(true);
    }
    // the four the inbound handler used to ignore
    for (const missed of ["STOPALL", "STOP ALL", "REVOKE", "OPT OUT"]) {
      expect(isOptOutBody(missed)).toBe(true);
    }
  });

  it("collapses internal whitespace so STOP  ALL still opts out", () => {
    expect(isOptOutBody("STOP  ALL")).toBe(true);
    expect(isOptOutBody("stop\tall")).toBe(true);
  });

  it("does NOT opt out on a spam footer — exact match is deliberate", () => {
    expect(isOptOutBody("Win a gift card! Reply STOP to end")).toBe(false);
    expect(isOptOutBody("please stop texting me")).toBe(false); // plain-English revocation is a human-review case, not a silent claim
  });
});
