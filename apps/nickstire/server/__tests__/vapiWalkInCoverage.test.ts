import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS } from "@shared/business";
import {
  UNMEASURED_WALK_IN,
  appendWalkInSuffix,
  detectWalkInForDetail,
  parseWalkInSuffix,
  type Measured,
  type WalkInFacts,
} from "../services/vapiWalkInCoverage";

/** The cron's entry point, fed a transcript/messages pair the way a VAPI call detail carries them. */
const detectWalkInCoverage = (transcript: unknown, messages: unknown = null, facts?: WalkInFacts) =>
  detectWalkInForDetail({ transcript, messages }, facts);

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
    expect(detectWalkInCoverage(FULL_INVITE, null, OTHER_SHOP)).toEqual({ walkInInvited: true, addressAndHoursGiven: false });
  });

  it("follows the facts it is handed: a different shop's address and hours pass against that shop", () => {
    const t = lines(
      GREETING,
      "User: Are you open?",
      "AI: Come by any time. We are at 100 Sample Road, open 9 AM to 5 PM most days.",
    );
    expect(detectWalkInCoverage(t, null, OTHER_SHOP)).toEqual({ walkInInvited: true, addressAndHoursGiven: true });
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

  it("does not read a different time as the shop's hours (8 to 6:30, 8:30 to 6, a word ending in 'eight')", () => {
    const say = (hours: string) =>
      lines(GREETING, "User: hi", `AI: Come by, ${BUSINESS.address.street}. ${hours}`);
    expect(detectWalkInCoverage(say("We run 8 AM to 6:30 PM.")).addressAndHoursGiven).toBe(false);
    expect(detectWalkInCoverage(say("We run 8:30 AM to 6 PM.")).addressAndHoursGiven).toBe(false);
    expect(detectWalkInCoverage(say("It is a weight to six cars a day.")).addressAndHoursGiven).toBe(false);
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

  it("never throws, on any transcript or on facts with no usable address or hours (a throw would leave the call unscored and retried)", () => {
    const hostile: unknown[] = [undefined, 0, 42, [], [1, 2], "AI:", "AI: ", "\n\n", "AI: (((", "x".repeat(200_000), Symbol.iterator.toString()];
    for (const t of hostile) expect(() => detectWalkInCoverage(t)).not.toThrow();
    const noFacts: WalkInFacts = { address: { street: "Main" }, hours: { structured: { monday: "", sunday: "closed", friday: "xx:yy-zz:ww" } } };
    const t = lines(GREETING, "User: hi", "AI: Walk in any time, we are on Main, open 8 to 6.");
    expect(() => detectWalkInCoverage(t, null, noFacts)).not.toThrow();
    expect(detectWalkInCoverage(t, null, noFacts)).toEqual({ walkInInvited: true, addressAndHoursGiven: false });
  });

  it("scores an answered call with no invitation as a measured miss", () => {
    const t = lines(GREETING, "User: Do you fix brakes?", "AI: Yes, we do brakes. Anything else?");
    expect(detectWalkInCoverage(t)).toEqual({ walkInInvited: false, addressAndHoursGiven: false });
  });
});

describe("invitation wording: refusals and look-alikes are not invitations", () => {
  const invited = (line: string) => detectWalkInCoverage(lines(GREETING, "User: hi", `AI: ${line}`)).walkInInvited;

  it("(a) a refusal naming walk-ins is not an invitation", () => {
    expect(invited("Sorry, we do not take walk-ins.")).toBe(false);
    expect(invited("We can't do walk-ins today.")).toBe(false);
  });

  it("(b) a bare 'come in' for a booked visit is not an invitation", () => {
    expect(invited("Sure, come in tomorrow at 3 PM for your appointment.")).toBe(false);
  });

  it("(c) 'no appointment' as a lookup result is not an invitation", () => {
    expect(invited("I see no appointment on file for you.")).toBe(false);
  });

  it("still counts 'no appointment needed', 'without an appointment' and 'come on in'", () => {
    expect(invited("No appointment needed, we work in order of arrival.")).toBe(true);
    expect(invited("You can be seen without an appointment.")).toBe(true);
    expect(invited("Come on in whenever you like.")).toBe(true);
  });

  it("more refusals stay false", () => {
    expect(invited("Sorry, no walk-ins today.")).toBe(false);
    expect(invited("We're not doing walk-ins right now.")).toBe(false);
    expect(invited("We don't accept any walk-ins.")).toBe(false);
  });

  it("1. a negation elsewhere in the sentence does not cancel 'just walk in'", () => {
    expect(invited("You don't need an appointment, just walk in.")).toBe(true);
  });

  it("2. a negated appointment does not cancel 'walk-ins are welcome'", () => {
    expect(invited("We don't take appointments, but walk-ins are welcome.")).toBe(true);
  });

  it("3. a negated slot does not cancel 'first come, first served'", () => {
    expect(invited("We can't hold a slot, it is first come, first served.")).toBe(true);
  });

  it("a refusal and an invitation in the same sentence: the refusal is stripped, the invitation stays", () => {
    expect(invited("Sorry, we can't do walk-ins today, but come by tomorrow.")).toBe(true);
  });

  it("a negation in one sentence does not cancel an invitation in the next", () => {
    expect(invited("We do not take walk-ins on holidays. Walk in any day otherwise.")).toBe(true);
  });
});

describe("auxiliary words between the negator and the refusal word", () => {
  const invited = (line: string) => detectWalkInCoverage(lines(GREETING, "User: hi", `AI: ${line}`)).walkInInvited;

  it("1a. 'Walk-ins cannot be accepted today.'", () => {
    expect(invited("Walk-ins cannot be accepted today.")).toBe(false);
  });

  it("2a. 'Walk-ins cannot be offered today.'", () => {
    expect(invited("Walk-ins cannot be offered today.")).toBe(false);
  });

  it("3a. 'Walk-ins can not be accepted today.' (two words)", () => {
    expect(invited("Walk-ins can not be accepted today.")).toBe(false);
  });

  it("controls: 'can be accepted' has no negator, and a 'cannot' in the next clause is not a refusal of walk-ins", () => {
    expect(invited("Walk-ins can be accepted any day.")).toBe(true);
    expect(invited("Walk-ins are welcome, we cannot wait to see you.")).toBe(true);
  });

  it("1. \"Walk-ins won't be available today.\"", () => {
    expect(invited("Walk-ins won't be available today.")).toBe(false);
  });

  it("2. 'Walk-ins will not be available today.'", () => {
    expect(invited("Walk-ins will not be available today.")).toBe(false);
  });

  it("3. 'Walk-ins are not going to be available today.'", () => {
    expect(invited("Walk-ins are not going to be available today.")).toBe(false);
  });

  it("controls: no negator, no refusal word, 'turned away' is not a refusal word", () => {
    expect(invited("Walk-ins will be available any day.")).toBe(true);
    expect(invited("Walk-ins are not going to be a problem.")).toBe(true);
    expect(invited("Walk-ins are not going to be turned away.")).toBe(true);
  });
});

describe("a refusal that comes AFTER the walk-in term is still a refusal", () => {
  const invited = (line: string) => detectWalkInCoverage(lines(GREETING, "User: hi", `AI: ${line}`)).walkInInvited;

  it("1. 'Walk-ins are not accepted today.'", () => {
    expect(invited("Walk-ins are not accepted today.")).toBe(false);
  });

  it("2. \"Walk-ins aren't available.\"", () => {
    expect(invited("Walk-ins aren't available.")).toBe(false);
  });

  it("3. 'Walk-in service is unavailable.'", () => {
    expect(invited("Walk-in service is unavailable.")).toBe(false);
  });

  it("4. 'Walk-in service is not available on Sundays.'", () => {
    expect(invited("Walk-in service is not available on Sundays.")).toBe(false);
  });

  it("controls: welcome, a negator with no refusal word, a negator in the next clause, available without a negator", () => {
    expect(invited("Walk-ins are welcome.")).toBe(true);
    expect(invited("Walk-ins are not a problem.")).toBe(true);
    expect(invited("Walk-ins are always welcome, we're not busy.")).toBe(true);
    expect(invited("Walk-ins are available any day.")).toBe(true);
    expect(invited("We do not take walk-ins on Sunday. Walk-ins are welcome the rest of the week.")).toBe(true);
  });

  it("control: 'closed' later in the same clause as a welcome is not a refusal of walk-ins", () => {
    expect(invited("Walk-ins welcome till we're closed.")).toBe(true);
  });
});

describe("measured on archived calls: lookups are not invitations, the street word and close-only hours count", () => {
  const say = (line: string) => lines(GREETING, "User: hi", `AI: ${line}`);
  const invited = (line: string) => detectWalkInCoverage(say(line)).walkInInvited;
  const street = BUSINESS.address.street.split(" ")[1]; // the word the agent says, taken from the facts
  const closeAt = spoken(weekday[1]);

  it("a lookup phrased with pull up, come up or come down is not an invitation", () => {
    expect(invited("Let me pull up your information.")).toBe(false);
    expect(invited("I can pull up the inventory.")).toBe(false);
    expect(invited("Let me come up with a quote for you.")).toBe(false);
    expect(invited("I will come down the list with you.")).toBe(false);
  });

  it("swing by, head over, come on by and a real walk-in term stay invitations", () => {
    expect(invited("Swing by anytime.")).toBe(true);
    expect(invited("Just head over.")).toBe(true);
    expect(invited("Come on by.")).toBe(true);
    expect(invited("Pull up your info and walk-ins are welcome.")).toBe(true);
  });

  it("the street spoken without a house number counts as the address", () => {
    const t = say(`We are on ${street}, open ${weekdayHours}.`);
    expect(detectWalkInCoverage(t).addressAndHoursGiven).toBe(true);
    // the same street word is not the address of another shop
    expect(detectWalkInCoverage(t, null, OTHER_SHOP).addressAndHoursGiven).toBe(false);
  });

  it("a close-only phrase counts as hours: 'open till', 'we close at', 'closes at'", () => {
    for (const phrase of [`We're open till ${closeAt}.`, `We close at ${closeAt}.`, "The shop closes at six.", `Open until ${closeAt} today.`]) {
      expect(detectWalkInCoverage(say(`We are on ${street}. ${phrase}`)).addressAndHoursGiven).toBe(true);
    }
  });

  it("close-only hours follow the facts: another shop's closing time is not the real one, and the reverse", () => {
    const fiveOther = say("We are on Sample. We're open till five.");
    expect(detectWalkInCoverage(fiveOther, null, OTHER_SHOP).addressAndHoursGiven).toBe(true);
    expect(detectWalkInCoverage(fiveOther).addressAndHoursGiven).toBe(false);
    const realOnly = say(`We are on ${street}. We close at ${closeAt}.`);
    expect(detectWalkInCoverage(realOnly, null, OTHER_SHOP).addressAndHoursGiven).toBe(false);
  });

  it("a time that is not a closing or opening time, or a count of days or hours, is not hours", () => {
    const hoursOf = (line: string) => detectWalkInCoverage(say(`We are on ${street}. ${line}`)).addressAndHoursGiven;
    expect(hoursOf("We are open six days a week.")).toBe(false);
    expect(hoursOf("We close at seven.")).toBe(false);
    expect(hoursOf("It will be done in about six hours.")).toBe(false);
  });

  it("the street alone, or the hours alone, is still not both", () => {
    expect(detectWalkInCoverage(say(`Come by, we are on ${street}.`)).addressAndHoursGiven).toBe(false);
    expect(detectWalkInCoverage(say(`Come by, we close at ${closeAt}.`)).addressAndHoursGiven).toBe(false);
  });
});

describe("the detector finds the transcript and messages wherever VAPI put them (the cron still gates on the score)", () => {
  const SPOKEN = FULL_INVITE; // prefix transcript with a full invitation
  const MEASURED = { walkInInvited: true, addressAndHoursGiven: true };
  const botMessages = (role: string) => [
    { role: "user", message: "Where are you?" },
    { role, message: "Opening line." },
    { role, message: `Walk in any day. We are at ${BUSINESS.address.street}, open ${weekdayHours}.` },
  ];

  it("(1) a transcript only under artifact.transcript reads measured", () => {
    expect(detectWalkInForDetail({ artifact: { transcript: SPOKEN } })).toEqual(MEASURED);
  });

  it("(2) only role-tagged artifact.messages (bot and assistant) reads measured", () => {
    expect(detectWalkInForDetail({ artifact: { messages: botMessages("bot") } })).toEqual(MEASURED);
    expect(detectWalkInForDetail({ artifact: { messages: botMessages("assistant") } })).toEqual(MEASURED);
    expect(detectWalkInForDetail({ messages: botMessages("bot") })).toEqual(MEASURED);
  });

  it("(3) messages and a disagreeing prefix transcript: messages win", () => {
    const silentTranscript = lines(GREETING, "User: hi", "AI: Anything else I can help with?");
    expect(detectWalkInForDetail({ transcript: silentTranscript, messages: botMessages("bot") })).toEqual(MEASURED);
    const talkingTranscript = SPOKEN;
    const quietMessages = [{ role: "bot", message: "Opening." }, { role: "bot", message: "Brakes, yes we do." }];
    expect(detectWalkInForDetail({ transcript: talkingTranscript, messages: quietMessages })).toEqual({
      walkInInvited: false,
      addressAndHoursGiven: false,
    });
  });

  it("(4) neither a transcript nor messages: UNMEASURED", () => {
    expect(detectWalkInForDetail({})).toEqual(UNMEASURED_WALK_IN);
    expect(detectWalkInForDetail({ transcript: "  ", messages: [], artifact: { transcript: "", messages: [] } })).toEqual(
      UNMEASURED_WALK_IN,
    );
  });

  it("(5) a null or malformed detail: UNMEASURED and no throw", () => {
    for (const d of [null, undefined, 7, "x", [], { artifact: null }, { artifact: "x", messages: "x" }, { messages: [null, 3] }]) {
      expect(() => detectWalkInForDetail(d)).not.toThrow();
      expect(detectWalkInForDetail(d)).toEqual(UNMEASURED_WALK_IN);
    }
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
    expect(appendWalkInSuffix("", { walkInInvited: true, addressAndHoursGiven: false })).toBe(
      " · walk_in=true · addr_hours=false",
    );
    expect(appendWalkInSuffix("", UNMEASURED_WALK_IN)).toBe(" · walk_in=unmeasured · addr_hours=unmeasured");
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
    expect(cron).toContain("result.score == null ? UNMEASURED_WALK_IN : detectWalkInForDetail(detail)");
  });

  it("the admin call list returns the parsed fields next to evalReasoning, so the reader has a caller", () => {
    const router = readFileSync(new URL("../routers/vapi.ts", import.meta.url), "utf8");
    expect(router).toContain("walkIn: parseWalkInSuffix(r.evalReasoning)");
  });

  it("the quality score itself is not touched by the new fields", () => {
    expect(cron).toContain("evalScore: result.score,");
    expect(cron).not.toMatch(/evalScore:[^\n]*walkIn/);
  });
});
