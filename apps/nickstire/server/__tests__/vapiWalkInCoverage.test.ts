import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS } from "@shared/business";
import {
  UNMEASURED_WALK_IN,
  appendWalkInSuffix,
  detectWalkInCoverage,
  formatWalkInSuffix,
  parseWalkInSuffix,
  type Measured,
  type WalkInFacts,
} from "../services/vapiWalkInCoverage";

/** Invented transcripts only. No real caller words, numbers or names. */
const lines = (...l: string[]) => l.join("\n");

/** "08:00" -> "8 AM", "16:00" -> "4 PM". Test-side spoken form of a structured hour. */
function spoken(hhmm: string): string {
  const h = Number(hhmm.split(":")[0]);
  return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
}
const weekday = BUSINESS.hours.structured.monday.split("-");
const sunday = BUSINESS.hours.structured.sunday.split("-");
const weekdayHours = `${spoken(weekday[0])} to ${spoken(weekday[1])}`;
const sundayHours = `${spoken(sunday[0])} to ${spoken(sunday[1])}`;

const GREETING = `AI: Thanks for calling ${BUSINESS.name}, this is Nick. How can I help?`;

const FULL_INVITE = lines(
  GREETING,
  "User: Do you have a used 205/55R16 tire, and can I get an appointment?",
  "AI: We run first come, first served, so no appointment. Walk in any day and we will take care of you.",
  "User: Where are you?",
  `AI: We are at ${BUSINESS.address.street} in ${BUSINESS.address.city}. Monday through Saturday we are open ${weekdayHours}, and Sunday ${sundayHours}.`,
);

const OTHER_SHOP: WalkInFacts = {
  address: { street: "100 Sample Road" },
  hours: { structured: { monday: "09:00-17:00", sunday: "10:00-14:00" } },
};

describe("T1 criteria are built from business.ts facts at runtime", () => {
  it("scores a full walk-in invitation (invite + address + hours) against the real BUSINESS facts", () => {
    expect(detectWalkInCoverage(FULL_INVITE)).toEqual({ walkInInvited: true, addressAndHoursGiven: true });
  });

  it("does not hard-code the shop: the real address and hours fail against a different shop's facts", () => {
    expect(detectWalkInCoverage(FULL_INVITE, OTHER_SHOP)).toEqual({ walkInInvited: true, addressAndHoursGiven: false });
  });

  it("follows the facts it is handed: a different shop's address and hours pass against that shop", () => {
    const t = lines(
      GREETING,
      "User: Are you open?",
      "AI: Come by any time. We are at 100 Sample Road, open 9 AM to 5 PM most days.",
    );
    expect(detectWalkInCoverage(t, OTHER_SHOP)).toEqual({ walkInInvited: true, addressAndHoursGiven: true });
    // and the real shop's facts reject that same speech
    expect(detectWalkInCoverage(t).addressAndHoursGiven).toBe(false);
  });

  it("holds no literal address, street name or hours in the module source", () => {
    const src = readFileSync(new URL("../services/vapiWalkInCoverage.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(new RegExp(BUSINESS.address.street.split(" ")[0]));
    expect(src).not.toMatch(new RegExp(BUSINESS.address.street.split(" ")[1], "i"));
    expect(src).not.toMatch(/\b(8|9)\s*(AM|a\.m\.)/i);
  });

  it("gives address but not hours (or the reverse) as NOT given, not as given", () => {
    const addressOnly = lines(GREETING, "User: hi", `AI: Come by, we are at ${BUSINESS.address.street}.`);
    const hoursOnly = lines(GREETING, "User: hi", `AI: Come by, we are open ${weekdayHours}.`);
    expect(detectWalkInCoverage(addressOnly)).toEqual({ walkInInvited: true, addressAndHoursGiven: false });
    expect(detectWalkInCoverage(hoursOnly)).toEqual({ walkInInvited: true, addressAndHoursGiven: false });
  });

  it("accepts spoken-out hours and a Sunday-only pair", () => {
    const t = lines(GREETING, "User: hi", `AI: Stop in, ${BUSINESS.address.street}. We run eight to six on weekdays.`);
    expect(detectWalkInCoverage(t).addressAndHoursGiven).toBe(true);
    const sun = lines(GREETING, "User: hi", `AI: Drop in on Sunday, ${BUSINESS.address.street}, ${sundayHours}.`);
    expect(detectWalkInCoverage(sun).addressAndHoursGiven).toBe(true);
  });
});

describe("assistant speech only, and the opening line is not evidence", () => {
  it("does not count an address and hours that only the CALLER said", () => {
    const t = lines(
      GREETING,
      `User: Are you the one at ${BUSINESS.address.street}, open ${weekdayHours}?`,
      "AI: Yes. What do you need?",
    );
    expect(detectWalkInCoverage(t)).toEqual({ walkInInvited: false, addressAndHoursGiven: false });
  });

  it("does not count the greeting: a greeting that names the address and hours is not an invitation", () => {
    const t = lines(
      `AI: Nick's here, ${BUSINESS.address.street}, open ${weekdayHours}. Walk-ins welcome.`,
      "User: How much is an oil change?",
      "AI: I do not have a price for that on the phone. A tech can tell you in person.",
    );
    expect(detectWalkInCoverage(t)).toEqual({ walkInInvited: false, addressAndHoursGiven: false });
  });

  it("reads a call with no assistant speech past the greeting as UNMEASURED, not as a miss", () => {
    expect(detectWalkInCoverage(lines(GREETING, "User: hello?"))).toEqual(UNMEASURED_WALK_IN);
  });

  it("reads an unlabeled transcript, an empty one and a non-string as UNMEASURED", () => {
    expect(detectWalkInCoverage("just some words with no speaker labels")).toEqual(UNMEASURED_WALK_IN);
    expect(detectWalkInCoverage("")).toEqual(UNMEASURED_WALK_IN);
    expect(detectWalkInCoverage(null)).toEqual(UNMEASURED_WALK_IN);
    expect(detectWalkInCoverage({ not: "a string" })).toEqual(UNMEASURED_WALK_IN);
  });

  it("scores an answered call with no invitation as a measured miss", () => {
    const t = lines(GREETING, "User: Do you fix brakes?", "AI: Yes, we do brakes. Anything else?");
    expect(detectWalkInCoverage(t)).toEqual({ walkInInvited: false, addressAndHoursGiven: false });
  });
});

describe("T2 the suffix round-trips through eval_reasoning", () => {
  const values: Measured[] = [true, false, null];
  for (const walkInInvited of values) {
    for (const addressAndHoursGiven of values) {
      it(`round-trips walkIn=${walkInInvited} addrHours=${addressAndHoursGiven}`, () => {
        const base = "outcome=resolved_info · speaker=transcript · evidence=operational_information_request · quality=80 · quality_version=vapi-quality-v1";
        const stored = appendWalkInSuffix(base, { walkInInvited, addressAndHoursGiven });
        expect(stored.startsWith(base)).toBe(true);
        expect(parseWalkInSuffix(stored)).toEqual({ walkInInvited, addressAndHoursGiven });
      });
    }
  }

  it("writes the two fields as plain key=value tokens an operator can read", () => {
    expect(formatWalkInSuffix({ walkInInvited: true, addressAndHoursGiven: false })).toBe(
      " · walk_in=true · addr_hours=false",
    );
    expect(formatWalkInSuffix(UNMEASURED_WALK_IN)).toBe(" · walk_in=unmeasured · addr_hours=unmeasured");
  });
});

describe("T3 a reasoning string written before this field existed parses as UNMEASURED", () => {
  it("v1-shaped reasoning has neither field", () => {
    const old = "outcome=walk_in_directed · speaker=messages · evidence=walk_in_language_detected · quality=85 · quality_version=vapi-quality-v1";
    expect(parseWalkInSuffix(old)).toEqual(UNMEASURED_WALK_IN);
  });

  it("null, undefined and empty reasoning parse as UNMEASURED", () => {
    expect(parseWalkInSuffix(null)).toEqual(UNMEASURED_WALK_IN);
    expect(parseWalkInSuffix(undefined)).toEqual(UNMEASURED_WALK_IN);
    expect(parseWalkInSuffix("")).toEqual(UNMEASURED_WALK_IN);
  });

  it("one field present and the other absent keeps the present one", () => {
    expect(parseWalkInSuffix("outcome=x · walk_in=true")).toEqual({ walkInInvited: true, addressAndHoursGiven: null });
  });
});

describe("T4 a malformed value is UNMEASURED, never false", () => {
  const bad = ["yes", "no", "1", "0", "True", "FALSE", "truex", "", "null", "maybe"];
  for (const v of bad) {
    it(`walk_in=${JSON.stringify(v)} and addr_hours=${JSON.stringify(v)} read as UNMEASURED`, () => {
      expect(parseWalkInSuffix(`outcome=x · walk_in=${v} · addr_hours=${v}`)).toEqual(UNMEASURED_WALK_IN);
    });
  }

  it("a token buried inside another word is not read", () => {
    expect(parseWalkInSuffix("outcome=x · prewalk_in=true · myaddr_hours=false")).toEqual(UNMEASURED_WALK_IN);
  });
});

describe("consumer end: the cron writes the suffix and the measured gate is the score", () => {
  const cron = readFileSync(new URL("../cron/jobs/vapiCallEval.ts", import.meta.url), "utf8");

  it("evalReasoning for an inbound call goes through appendWalkInSuffix", () => {
    expect(cron).toContain("evalReasoning: appendWalkInSuffix(result.reasoning, walkIn)");
  });

  it("a call with no quality score (not a customer conversation, or a tech failure) stays UNMEASURED", () => {
    expect(cron).toContain("result.score == null ? UNMEASURED_WALK_IN : detectWalkInCoverage(detail.transcript)");
  });

  it("the quality score itself is not touched by the new fields", () => {
    expect(cron).toContain("evalScore: result.score,");
    expect(cron).not.toMatch(/evalScore:[^\n]*walkIn/);
  });
});
