/**
 * SMS fact compiler — the anti-hallucination and anti-staleness guards.
 *
 * The templates this replaces asserted stock, price, wait time and a hardcoded
 * closing hour, carried no opt-out, and interpolated none of the facts the
 * assistant had already extracted. Each of those is pinned here.
 */
import { describe, expect, it } from "vitest";

import { BUSINESS } from "./business";
import {
  FORBIDDEN_SMS_PHRASES,
  PAYMENT_PROGRAMS_LINE,
  compileRecoverySms,
  todayHoursPhrase,
  type ObservedCallFacts,
} from "./smsFactCompiler";

/** 2026-09-20 is a Sunday; 2026-09-21 a Monday. Both 2:00 PM Eastern. */
const SUNDAY_2PM = new Date("2026-09-20T18:00:00Z");
const MONDAY_2PM = new Date("2026-09-21T18:00:00Z");
const SUNDAY_8PM = new Date("2026-09-21T00:00:00Z");

const opts = (over: Partial<Parameters<typeof compileRecoverySms>[1]> = {}) => ({
  now: MONDAY_2PM,
  ...over,
});

const TIRE: ObservedCallFacts = {
  tireSize: "215/60R17",
  vehicle: "2023 Honda HR-V",
  quantity: 2,
  condition: "used",
  urgency: "today",
};

/* ───────────────────── the hardcoded-hours defect ───────────────────── */

describe("today's hours are real, never hardcoded", () => {
  it("the shop closes at 4 PM on Sunday, not 6", () => {
    // The replaced template said "before 6 PM today" unconditionally. Sunday
    // hours are 09:00-16:00 in BUSINESS.hours.structured.
    expect(BUSINESS.hours.structured.sunday).toBe("09:00-16:00");
    const phrase = todayHoursPhrase(SUNDAY_2PM);
    expect(phrase).toContain("4:00 PM");
    expect(phrase).not.toContain("6:00 PM");
  });

  it("and at 6 PM Monday through Saturday", () => {
    expect(todayHoursPhrase(MONDAY_2PM)).toContain("6:00 PM");
  });

  it("after close it points at the NEXT opening, not today", () => {
    const phrase = todayHoursPhrase(SUNDAY_8PM);
    expect(phrase).toMatch(/We open/);
    expect(phrase).not.toMatch(/open today/);
  });

  it("no compiled message ever states a closing hour that contradicts the source", () => {
    for (const now of [SUNDAY_2PM, MONDAY_2PM, SUNDAY_8PM]) {
      const body = compileRecoverySms(TIRE, opts({ now })).body;
      expect(body).not.toContain("before 6 PM");
    }
  });
});

/* ──────────────────────── never invent business state ───────────────── */

describe("the compiler refuses claims it cannot verify", () => {
  const CASES: Array<[string, ObservedCallFacts]> = [
    ["tire with size", TIRE],
    ["tire without size", { condition: "used" }],
    ["repair symptom", { symptom: "grinding when I brake", vehicle: "2018 Malibu" }],
    ["transfer failed", { ...TIRE, transferFailed: true }],
    ["callback requested", { callbackRequested: true }],
    ["vehicle already here", { existingVehicleAtShop: true }],
    ["nothing extracted", {}],
  ];

  for (const [label, facts] of CASES) {
    it(`contains no forbidden claim: ${label}`, () => {
      const { body } = compileRecoverySms(facts, opts());
      expect(body.length).toBeGreaterThan(0);
      for (const pattern of FORBIDDEN_SMS_PHRASES) {
        expect(body).not.toMatch(pattern);
      }
    });
  }

  it("POSITIVE CONTROL: the sweep genuinely catches the OLD template copy", () => {
    // The literal strings that shipped in getSmsDraft(). If the sweep above
    // could not flag these, it would be proving nothing.
    const oldTemplates = [
      "We stock all major brands of new tires.",
      "Flat repairs are done while you wait.",
      "Bring the vehicle in for a free diagnostic light check and quote before 6 PM today.",
      "Stop by for a free battery and alternator test.",
    ];
    for (const old of oldTemplates) {
      expect(FORBIDDEN_SMS_PHRASES.some((p) => p.test(old))).toBe(true);
    }
  });

  it("records WHAT it declined to say, not just what it said", () => {
    const c = compileRecoverySms(TIRE, opts());
    expect(c.refusedClaims.join(" ")).toMatch(/stock/i);
    expect(c.refusedClaims.join(" ")).toMatch(/price/i);
  });
});

/* ───────────────────────────── personalisation ──────────────────────── */

describe("personalisation uses facts the assistant already extracted", () => {
  it("names the size, quantity, condition and vehicle", () => {
    const { body, usedFacts } = compileRecoverySms(TIRE, opts());
    expect(body).toContain("215/60R17");
    expect(body).toContain("2023 Honda HR-V");
    expect(body).toContain("2");
    expect(body).toContain("used");
    expect(usedFacts).toEqual(expect.arrayContaining(["tireSize", "vehicle", "quantity", "condition"]));
  });

  it("a failed transfer leads with the failure and still carries the context", () => {
    const { body } = compileRecoverySms({ ...TIRE, transferFailed: true }, opts());
    expect(body).toMatch(/didn't connect/i);
    expect(body).toContain("215/60R17");
    expect(body).toMatch(/without making you call again/i);
  });

  it("a missing tire size switches channel instead of asking again", () => {
    // Speech recognition mangles "two fifteen sixty R seventeen". Asking for a
    // sidewall photo is the highest-leverage move available to a tire shop.
    const { body } = compileRecoverySms({ condition: "used" }, opts());
    expect(body).toMatch(/photo/i);
    expect(body).toMatch(/sidewall/i);
  });

  it("a repair call never diagnoses and never promises a fix", () => {
    const { body, refusedClaims } = compileRecoverySms(
      { symptom: "grinding when I brake", vehicle: "2018 Malibu" },
      opts(),
    );
    expect(body).toContain("grinding when I brake");
    expect(body).toMatch(/won't guess/i);
    expect(refusedClaims.join(" ")).toMatch(/diagnose/i);
  });

  it("a car already at the shop gets the operations message, not a sales pitch", () => {
    const { body } = compileRecoverySms({ existingVehicleAtShop: true }, opts());
    expect(body).toMatch(/vehicle that's with us/i);
    expect(body).not.toMatch(/stop by|come in/i);
  });

  it("uses the caller's name when it has one, and reads fine when it does not", () => {
    expect(compileRecoverySms({ ...TIRE, customerName: "james" }, opts()).body).toMatch(/^James —/);
    expect(compileRecoverySms(TIRE, opts()).body).toMatch(/^Nick's Tire & Auto here\./);
  });
});

/* ─────────────────────────────── compliance ─────────────────────────── */

describe("compliance mechanics", () => {
  it("the first message in a thread carries opt-out language", () => {
    // Not one of the eight replaced templates did.
    expect(compileRecoverySms(TIRE, opts({ isFirstInThread: true })).body)
      .toContain("Reply STOP to opt out.");
  });

  it("later messages in the same thread do not repeat it", () => {
    expect(compileRecoverySms(TIRE, opts({ isFirstInThread: false })).body)
      .not.toContain("Reply STOP");
  });

  it("an opted-out number compiles to NOTHING, with a stated blocker", () => {
    const c = compileRecoverySms(TIRE, opts({ optedOut: true }));
    expect(c.body).toBe("");
    expect(c.blockers).toContain("opted_out");
  });

  it("quiet hours block the send rather than trimming the message", () => {
    const c = compileRecoverySms(TIRE, opts({ outsideSendingWindow: true }));
    expect(c.body).toBe("");
    expect(c.blockers).toContain("quiet_hours");
  });

  it("a safety call is never automated", () => {
    const c = compileRecoverySms({ symptom: "brake pedal goes to the floor" }, opts({ safetyFlag: true }));
    expect(c.body).toBe("");
    expect(c.blockers).toContain("safety_lane_requires_human");
  });

  it("the address comes from BUSINESS, never a typed literal", () => {
    expect(compileRecoverySms(TIRE, opts()).body).toContain(BUSINESS.address.street);
  });

  it("messages stay within a sane segment count", () => {
    for (const facts of [TIRE, { symptom: "grinding when I brake", vehicle: "2018 Malibu" }, {}]) {
      const c = compileRecoverySms(facts as ObservedCallFacts, opts());
      expect(c.segments).toBeGreaterThan(0);
      expect(c.segments).toBeLessThanOrEqual(3);
    }
  });
});

/* ───────────────────── payment programs · 2026-09-18 ───────────────────── */

describe("payment programs · offered, but sayable only one way", () => {
  // Operator confirmed 2026-09-18 that payment programs ARE offered. Three
  // separate repo rules govern how that may be worded, and an outside proposal
  // reviewed the same day violated all three at once.

  it("is mentioned ONLY when the caller raised cost", () => {
    expect(compileRecoverySms(TIRE, opts()).body).not.toMatch(/payment program/i);
    expect(compileRecoverySms({ ...TIRE, priceHesitation: true }, opts()).body)
      .toMatch(/payment programs/i);
  });

  it("the approved line itself passes the forbidden-phrase sweep", () => {
    // The line contains the URL .../financing — a path, not a self-description.
    for (const pattern of FORBIDDEN_SMS_PHRASES) {
      expect(PAYMENT_PROGRAMS_LINE).not.toMatch(pattern);
    }
  });

  it("promises nothing: no approval, no down payment, no credit outcome", () => {
    const { body, refusedClaims } = compileRecoverySms(
      { ...TIRE, priceHesitation: true },
      opts(),
    );
    expect(body).not.toMatch(/\$\d/);
    expect(body).not.toMatch(/approved/i);
    expect(body).not.toMatch(/credit check/i);
    expect(refusedClaims.join(" ")).toMatch(/provider/i);
  });

  it("POSITIVE CONTROL: the sweep catches the drafts that were actually proposed", () => {
    // Verbatim from an external report reviewed 2026-09-18. Each breaks a
    // different rule, and each reads perfectly reasonable — which is why the
    // guard is mechanical rather than a style note.
    const proposed: Array<[string, string]> = [
      [
        "we actually offer financing starting at just $10 down with no hard credit check",
        "banned self-description + a down payment + a credit-outcome promise",
      ],
      [
        "a lot of our customers just put $10 down and finance a brand new set of 4",
        "a fixed initial payment we may not promise",
      ],
      [
        "We have used tires starting at $25",
        "web-only price stated on a quoting channel, where the anchor is $60",
      ],
    ];
    for (const [draft, why] of proposed) {
      const caught = FORBIDDEN_SMS_PHRASES.some((p) => p.test(draft));
      expect(caught, `should have been caught (${why}): ${draft}`).toBe(true);
    }
  });

  it("no compiled message can carry a banned payment phrase", () => {
    const variants: ObservedCallFacts[] = [
      { ...TIRE, priceHesitation: true },
      { symptom: "brakes grinding", priceHesitation: true },
      { priceHesitation: true },
      { condition: "used", priceHesitation: true },
    ];
    for (const facts of variants) {
      const { body } = compileRecoverySms(facts, opts());
      for (const pattern of FORBIDDEN_SMS_PHRASES) expect(body).not.toMatch(pattern);
    }
  });
});

describe("totality", () => {
  it("never throws, whatever it is handed", () => {
    const nasty: ObservedCallFacts[] = [
      {},
      { tireSize: "", vehicle: "", quantity: 0 },
      { customerName: "", symptom: "" },
      { quantity: -1, condition: null, tireSize: null },
    ];
    for (const f of nasty) {
      expect(() => compileRecoverySms(f, opts())).not.toThrow();
    }
  });
});
