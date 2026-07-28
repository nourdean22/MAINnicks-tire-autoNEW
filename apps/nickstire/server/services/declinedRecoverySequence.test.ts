/**
 * Doctrine lock · revenue-truth-correction (2026-07-28)
 *
 * Pins the two invariants of the recovery-sequence truth pass:
 *
 *   1. EVIDENCE-ONLY ROUTING — pickProfile never assigns a psychographic
 *      track from proxies (vehicle marque, service category, decline
 *      rate, customer type, ticket size). Without the customer's own
 *      stated concern, everyone lands on P0 neutral.
 *
 *   2. NO UNSUPPORTED CLAIMS — no variant may claim evidence on file it
 *      can't verify ("photos of the worn parts") or invent a pricing
 *      commitment ("still good", "we'll honor that pricing", "keep that
 *      quote open"). The verifiable fact is the quote is ON FILE.
 *
 * If a future change reintroduces either pattern, these tests are the
 * tripwire — update the doctrine deliberately or fix the regression.
 */
import { describe, it, expect } from "vitest";
import {
  pickProfile,
  buildSequenceMessage,
  variantKey,
  TOUCH_ORDER,
  classifyDeclineReply,
  statedConcernFromDb,
  allowedTouches,
  RECOVERY_CLOSED_SIGNALS,
  type RecoveryProfile,
  type RecoveryTouch,
} from "./declinedRecoverySequence";

const ALL_PROFILES: RecoveryProfile[] = ["P0", "P1", "P2", "P3"];
const ALL_TOUCHES: RecoveryTouch[] = ["3d", "7d", "14d", "30d", "45d"];

// The old psychographic triggers, replayed against the new picker. Each
// of these used to force a non-neutral track.
const LEGACY_TRIGGER_CASES = [
  {
    label: "luxury marque (old: → P3 busy)",
    args: { amountCents: 40_000, serviceDescription: "oil change", vehicleMake: "BMW" },
  },
  {
    label: "brakes service (old: → P2 skeptical)",
    args: { amountCents: 40_000, serviceDescription: "front brake pads and rotors" },
  },
  {
    label: "high decline rate (old: → P1 broke)",
    args: { amountCents: 40_000, serviceDescription: "suspension", declineRate: 0.9 },
  },
  {
    label: "commercial account (old: → P3 busy)",
    args: { amountCents: 40_000, serviceDescription: "maintenance", customerType: "commercial" as const },
  },
  {
    label: "big ticket + infrequent (old: → P1 broke)",
    args: { amountCents: 250_000, serviceDescription: "engine work", totalVisits: 0 },
  },
];

describe("pickProfile · evidence-only routing", () => {
  for (const c of LEGACY_TRIGGER_CASES) {
    it(`no stated concern → P0 despite ${c.label}`, () => {
      expect(pickProfile(c.args)).toBe("P0");
    });
  }

  it("routes P1/P2/P3 only from the customer's stated concern", () => {
    const base = { amountCents: 40_000, serviceDescription: "brakes" };
    expect(pickProfile({ ...base, statedConcern: "price" })).toBe("P1");
    expect(pickProfile({ ...base, statedConcern: "proof" })).toBe("P2");
    expect(pickProfile({ ...base, statedConcern: "time" })).toBe("P3");
    expect(pickProfile({ ...base, statedConcern: null })).toBe("P0");
  });
});

describe("buildSequenceMessage · claim discipline across all 20 variants", () => {
  // Phrases that assert evidence or policy the system cannot verify.
  const BANNED_CLAIMS = [
    /photos? of the worn/i,
    /still good/i,
    /honor that pricing/i,
    /keep that quote open/i,
    /quote open for you/i,
    /back on the lift/i, // memory claim about a prior lift session
  ];

  // Brand-voice kill-list (subset relevant to SMS copy) — the pre-commit
  // linter also enforces this, but the test keeps it visible here.
  const KILL_LIST = [
    /trusted/i, /expert/i, /premium/i, /comprehensive/i,
    /hassle-free/i, /state-of-the-art/i, /top-notch/i,
    /inspection/i, /diagnostic/i, /no surprises/i,
  ];

  for (const profile of ALL_PROFILES) {
    for (const touch of ALL_TOUCHES) {
      it(`${profile}/${touch} · honest, capped, opt-out carried`, () => {
        const msg = buildSequenceMessage({
          touch,
          profile,
          name: "Jordan Smith",
          amountCents: 48_700,
          serviceDescription: "brake pads + rotors",
        });
        expect(msg.length).toBeLessThanOrEqual(320);
        expect(msg).toContain("STOP");
        for (const banned of BANNED_CLAIMS) {
          expect(msg).not.toMatch(banned);
        }
        for (const killed of KILL_LIST) {
          expect(msg).not.toMatch(killed);
        }
      });
    }
  }

  it("P0 variants state the verifiable fact: quote on file / in our system", () => {
    for (const touch of ALL_TOUCHES) {
      const msg = buildSequenceMessage({
        touch,
        profile: "P0",
        name: "Casey",
        amountCents: 30_000,
        serviceDescription: "tire work",
      });
      expect(msg).toMatch(/on file|in our system/i);
    }
  });

  it("variantKey emits the new P0 series alongside legacy P1-P3", () => {
    expect(variantKey("3d", "P0")).toBe("declined_3d_P0");
    expect(variantKey("30d", "P2")).toBe("declined_30d_P2");
  });

  it("TOUCH_ORDER priority order is unchanged (the cron intersects it with allowedTouches)", () => {
    expect(TOUCH_ORDER).toEqual(["30d", "14d", "7d", "45d", "3d"]);
  });
});

// ─── Recovery 2.0 ───────────────────────────────────────────────────

describe("allowedTouches · 1-3 adaptive touches, never 5", () => {
  it("evidence tracks (P1/P2/P3) get exactly two targeted touches", () => {
    for (const p of ["P1", "P2", "P3"] as const) {
      expect(allowedTouches({ profile: p, amountCents: 500_000, serviceDescription: "brakes" })).toEqual(["7d", "14d"]);
    }
  });

  it("P0 low-value non-safety gets two neutral touches", () => {
    expect(allowedTouches({ profile: "P0", amountCents: 20_000, serviceDescription: "oil change" })).toEqual(["7d", "30d"]);
  });

  it("P0 earns the third touch by value (≥$300) or safety service", () => {
    expect(allowedTouches({ profile: "P0", amountCents: 30_000, serviceDescription: "oil change" })).toEqual(["7d", "14d", "30d"]);
    expect(allowedTouches({ profile: "P0", amountCents: 10_000, serviceDescription: "front brakes" })).toEqual(["7d", "14d", "30d"]);
    // Inflected form — the \b-after-stem trap: "brakes" must count, not just "brake"
    expect(allowedTouches({ profile: "P0", amountCents: 10_000, serviceDescription: "new tires mounted" })).toEqual(["7d", "14d", "30d"]);
  });

  it("3d and 45d are retired from sending for every profile", () => {
    for (const p of ["P0", "P1", "P2", "P3"] as const) {
      const allowed = allowedTouches({ profile: p, amountCents: 100_000, serviceDescription: "brake job" });
      expect(allowed).not.toContain("3d");
      expect(allowed).not.toContain("45d");
    }
  });
});

describe("classifyDeclineReply · observed signals from the customer's own words", () => {
  const CASES: Array<[string, string | null]> = [
    // Closed: repaired elsewhere (inflected forms on purpose)
    ["already got it fixed", "repaired_elsewhere"],
    ["I had it done at another shop", "repaired_elsewhere"],
    ["fixed it myself last weekend", "repaired_elsewhere"],
    ["went to a different shop sorry", "repaired_elsewhere"],
    // Closed: vehicle gone
    ["I sold the car", "no_longer_owns"],
    ["we traded her in last month", "no_longer_owns"],
    ["car got totaled", "no_longer_owns"],
    ["don't have that car anymore", "no_longer_owns"],
    // Closed: not interested
    ["not interested, thanks", "not_interested"],
    ["please don't text me", "not_interested"],
    // Waiting event beats generic time
    ["waiting on my tax refund", "waiting_event"],
    ["can do it after payday", "waiting_event"],
    // Price (inflections)
    ["that's too expensive for me right now", "price"],
    ["can't afford it this month", "price"],
    ["do you have payment plans", "price"],
    // Proof
    ["getting a second opinion first", "proof"],
    ["are you sure it needs all that", "proof"],
    // Time
    ["super busy this week, maybe later", "time"],
    ["out of town until Friday", "time"],
    // Unknown stays unknown — the doctrine forbids guessing
    ["ok", null],
    ["who is this", null],
    ["", null],
  ];
  for (const [text, expected] of CASES) {
    it(`"${text || "(empty)"}" → ${expected}`, () => {
      expect(classifyDeclineReply(text)).toBe(expected);
    });
  }

  it("'thinking about selling it' does NOT close the estimate (intent ≠ done)", () => {
    expect(classifyDeclineReply("thinking about selling it honestly")).not.toBe("no_longer_owns");
  });
});

describe("statedConcernFromDb · routing map", () => {
  it("routes price/proof/time, rides waiting_event on the logistics track", () => {
    expect(statedConcernFromDb("price")).toBe("price");
    expect(statedConcernFromDb("proof")).toBe("proof");
    expect(statedConcernFromDb("time")).toBe("time");
    expect(statedConcernFromDb("waiting_event")).toBe("time");
  });

  it("closed signals and unknowns return null (the cron checks closed separately)", () => {
    for (const closed of RECOVERY_CLOSED_SIGNALS) {
      expect(statedConcernFromDb(closed)).toBeNull();
    }
    expect(statedConcernFromDb(null)).toBeNull();
    expect(statedConcernFromDb("garbage")).toBeNull();
  });
});
