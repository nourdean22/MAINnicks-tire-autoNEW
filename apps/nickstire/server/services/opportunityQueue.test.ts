/**
 * Opportunity Queue · pure-logic contract tests (Wave 4).
 *
 * Pins the three doctrine rules that make the queue trustworthy:
 *   1. `won` is unreachable through canTransition — verified outcomes only
 *      (recordOutcome, which requires a real invoice, is the sole path).
 *   2. Terminal states are terminal; do_not_contact is reachable from any
 *      live state (consent supremacy).
 *   3. Ranking is transparent — score is exactly the visible factors
 *      multiplied, no hidden inputs.
 *
 * DB paths (upsert/list/transition/collectors) are exercised in prod via
 * the graceful-degrade contract and stay out of unit scope — no mocks,
 * no DB, singleFork-safe.
 */
import { describe, it, expect } from "vitest";
import {
  OPPORTUNITY_STATES,
  TERMINAL_STATES,
  canTransition,
  rankOpportunity,
  captureComplaintOpportunity,
  type OpportunityState,
} from "./opportunityQueue";

describe("state machine · roadmap Wave-4 vocabulary", () => {
  it("uses exactly the roadmap's 12 states", () => {
    expect([...OPPORTUNITY_STATES].sort()).toEqual([
      "arrived", "assigned", "attempted", "contacted", "do_not_contact",
      "duplicate", "lost", "new", "no_response", "scheduled",
      "walk_in_expected", "won",
    ].sort());
  });

  it("won is unreachable via canTransition from EVERY state", () => {
    for (const from of OPPORTUNITY_STATES) {
      expect(canTransition(from, "won"), `canTransition(${from} -> won)`).toBe(false);
    }
  });

  it("terminal states allow no exits", () => {
    for (const from of TERMINAL_STATES) {
      for (const to of OPPORTUNITY_STATES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("do_not_contact is reachable from every live state (consent supremacy)", () => {
    const live = OPPORTUNITY_STATES.filter((s) => !TERMINAL_STATES.includes(s));
    for (const from of live) {
      expect(canTransition(from, "do_not_contact"), `${from} -> do_not_contact`).toBe(true);
    }
  });

  it("supports the happy path new -> assigned -> attempted -> contacted -> scheduled -> arrived", () => {
    const path: OpportunityState[] = ["new", "assigned", "attempted", "contacted", "scheduled", "arrived"];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it("re-attempt is legal (attempted -> attempted) so the attempts counter can bump", () => {
    expect(canTransition("attempted", "attempted")).toBe(true);
  });

  it("no_response can be retried or closed, not skipped to arrival", () => {
    expect(canTransition("no_response", "attempted")).toBe(true);
    expect(canTransition("no_response", "lost")).toBe(true);
    expect(canTransition("no_response", "arrived")).toBe(false);
  });
});

describe("ranking · transparent factors, no fake precision", () => {
  it("score is exactly valueDollars × urgencyWeight × qualityWeight (rounded)", () => {
    const r = rankOpportunity({ expectedRevenueCents: 84_600, urgency: "today", dataQuality: "inferred" });
    expect(r.factors).toEqual({ valueDollars: 846, urgencyWeight: 2, qualityWeight: 0.8 });
    expect(r.score).toBe(Math.round(846 * 2 * 0.8));
  });

  it("unknown value never fabricates dollars — but urgency still carries the row", () => {
    const callback = rankOpportunity({ expectedRevenueCents: null, urgency: "critical", dataQuality: "verified" });
    expect(callback.factors.valueDollars).toBe(0);
    expect(callback.score).toBe(0); // no invented dollars in the score
    // The topDecisions sort is urgency-first, score-second: a critical
    // value-unknown callback outranks a this_week $500 estimate because
    // 3 (critical) > 1.5 (this_week) on the primary axis — without ever
    // assigning the callback a fake dollar value.
    const estimate = rankOpportunity({ expectedRevenueCents: 50_000, urgency: "this_week", dataQuality: "inferred" });
    expect(callback.factors.urgencyWeight).toBeGreaterThan(estimate.factors.urgencyWeight);
  });

  it("verified beats inferred at equal value and urgency", () => {
    const verified = rankOpportunity({ expectedRevenueCents: 50_000, urgency: "this_week", dataQuality: "verified" });
    const inferred = rankOpportunity({ expectedRevenueCents: 50_000, urgency: "this_week", dataQuality: "inferred" });
    expect(verified.score).toBeGreaterThan(inferred.score);
  });
});

describe("captureComplaintOpportunity · classify-first short-circuit", () => {
  it("non-complaint inbound texts exit before any DB work", async () => {
    // The intent router is pure; only complaint_or_comeback proceeds to
    // the (DB-backed) upsert. These must all return captured:false
    // without touching a database.
    for (const body of ["what time do you close", "how much for an oil change", "ok thanks", ""]) {
      const res = await captureComplaintOpportunity("+12165550142", body);
      expect(res.captured, body).toBe(false);
    }
  });

  it("bad phone exits even when the text is complaint-shaped", async () => {
    const res = await captureComplaintOpportunity("123", "my brakes still grind after the repair");
    expect(res.captured).toBe(false);
  });
});
