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

  it("TOUCH_ORDER retains the 5-touch cadence (cadence redesign is Recovery 2.0, not this pass)", () => {
    expect(TOUCH_ORDER).toEqual(["30d", "14d", "7d", "45d", "3d"]);
  });
});
