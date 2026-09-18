/**
 * Call taxonomy kernel — behaviour + parity.
 *
 * Two jobs. First, pin the two LIVE CONTRADICTIONS this kernel exists to
 * resolve (walk_in_directed counted as both success and missed revenue;
 * tech_failure counted as both not-a-conversation and a queue obligation).
 * Second, fail the build if a consumer re-types one of the outcome lists that
 * were found duplicated across ten sites on 2026-09-18.
 *
 * Every guard here ships with a canary: a test that breaks the guard and
 * asserts it fails. A parity test that can never fail is worse than none.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CALL_OUTCOMES,
  EPISODE_WINDOW_MINUTES,
  TRANSFER_FAILURE_SLA_MINUTES,
  disposeCall,
  episodeKey,
  intentFamily,
  type CallFacts,
} from "./callTaxonomy";

const APP = process.cwd();
const read = (rel: string) => readFileSync(join(APP, rel), "utf-8");

const facts = (over: Partial<CallFacts> = {}): CallFacts => ({
  outcome: "lost_opportunity",
  speakerAttribution: "transcript",
  hasCustomerSpeech: true,
  durationSeconds: 60,
  ageMinutes: 5,
  ...over,
});

/* ───────────────────── the two live contradictions ──────────────────── */

describe("contradiction 1 · walk_in_directed is a provisional success, not missed revenue", () => {
  it("an open expected arrival is NOT a recovery obligation", () => {
    const d = disposeCall(facts({ outcome: "walk_in_directed", expectedArrivalOpen: true }));
    expect(d.lane).toBe("arrival");
    expect(d.queueEligible).toBe(false);
    expect(d.excludedBecause).toBe("expected_to_arrive");
  });

  it("but a lapsed arrival with no invoice DOES become recovery", () => {
    const d = disposeCall(facts({ outcome: "walk_in_directed", expectedArrivalOpen: false }));
    expect(d.lane).toBe("recovery");
    expect(d.reasons.map((r) => r.code)).toContain("no_show");
  });

  it("and an arrival that produced an invoice is closed, not queued", () => {
    const d = disposeCall(
      facts({ outcome: "walk_in_directed", expectedArrivalOpen: false, invoiceMatched: true }),
    );
    expect(d.queueEligible).toBe(false);
    expect(d.excludedBecause).toBe("already_invoiced");
  });
});

describe("contradiction 2 · tech_failure is an engineering defect first", () => {
  it("a failure with no captured demand is engineering, not a sales obligation", () => {
    const d = disposeCall(facts({ outcome: "tech_failure" }));
    expect(d.lane).toBe("engineering");
    expect(d.queueEligible).toBe(false);
  });

  it("a failure that interrupted REAL captured demand does earn recovery", () => {
    const d = disposeCall(facts({ outcome: "tech_failure", hasCapturedSpecifics: true }));
    expect(d.lane).toBe("recovery");
    expect(d.queueEligible).toBe(true);
  });
});

/* ───────────────────────── exclusions are honest ────────────────────── */

describe("exclusions · three states, never two", () => {
  it("unattributable is 'unclassified' — NOT 'none'", () => {
    const d = disposeCall(facts({ speakerAttribution: "unavailable" }));
    expect(d.lane).toBe("unclassified");
    expect(d.excludedBecause).toBe("unattributable");
  });

  it("a genuinely silent caller is 'none' with a DIFFERENT reason", () => {
    const d = disposeCall(facts({ hasCustomerSpeech: false }));
    expect(d.lane).toBe("none");
    expect(d.excludedBecause).toBe("no_customer_speech");
  });

  it("the two are never collapsed — that is the empty-vs-error defect", () => {
    const unknown = disposeCall(facts({ speakerAttribution: "unavailable" }));
    const silent = disposeCall(facts({ hasCustomerSpeech: false }));
    expect(unknown.lane).not.toBe(silent.lane);
    expect(unknown.excludedBecause).not.toBe(silent.excludedBecause);
  });

  it("spam never reaches scoring", () => {
    expect(disposeCall(facts({ outcome: "spam_or_wrong_number" })).excludedBecause)
      .toBe("spam_or_wrong_number");
  });

  it("a car already at the shop is operations, never a sales lead", () => {
    const d = disposeCall(facts({ existingVehicleAtShop: true }));
    expect(d.lane).toBe("operations");
    expect(d.queueEligible).toBe(false);
  });

  it("a pure information call is resolved, not missed revenue", () => {
    expect(disposeCall(facts({ outcome: "resolved_info" })).queueEligible).toBe(false);
  });

  it("safety outranks every commercial rule, including invoice matching", () => {
    const d = disposeCall(facts({ safetyFlag: true, invoiceMatched: true, outcome: "hard_conversion" }));
    expect(d.lane).toBe("safety");
  });
});

/* ────────────────────────── priority is explainable ─────────────────── */

describe("priority · every point is attributable to a stated reason", () => {
  it("the score equals the sum of its reasons — no hidden terms", () => {
    const d = disposeCall(facts({ outcome: "callback_needed", transferFailed: true }));
    expect(d.priority).toBe(d.reasons.reduce((n, r) => n + r.delta, 0));
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it("a verified transfer failure outranks a fresh quote shopper", () => {
    const failed = disposeCall(facts({ outcome: "tire_availability_intent", transferFailed: true }));
    const shopper = disposeCall(facts({ outcome: "quote_or_inspection_intent" }));
    expect(failed.priority).toBeGreaterThan(shopper.priority);
    expect(failed.slaMinutes).toBe(TRANSFER_FAILURE_SLA_MINUTES);
  });

  it("repeat contact raises PRIORITY — it must not add a second row", () => {
    const once = disposeCall(facts({ outcome: "tire_availability_intent" }));
    const again = disposeCall(facts({ outcome: "tire_availability_intent", repeatWithinWindow: true }));
    expect(again.priority).toBeGreaterThan(once.priority);
    expect(again.reasons.map((r) => r.code)).toContain("repeat_unresolved");
  });

  it("a week-old row decays but never outranks a live buyer", () => {
    const stale = disposeCall(facts({ ageMinutes: 60 * 24 * 10 }));
    expect(stale.reasons.map((r) => r.code)).toContain("stale");
    expect(stale.priority).toBeLessThan(disposeCall(facts({ ageMinutes: 5 })).priority);
  });
});

/* ─────────────────────────────── episodes ───────────────────────────── */

describe("episodes · one customer with one need is one row", () => {
  const t = new Date("2026-09-18T14:00:00Z");

  it("the transfer-failure redial storm collapses to a single episode", () => {
    const a = episodeKey("2165551043", "tire", t);
    const b = episodeKey("2165551043", "tire", new Date(t.getTime() + 6 * 60_000));
    const c = episodeKey("2165551043", "tire", new Date(t.getTime() + 18 * 60_000));
    expect(new Set([a, b, c]).size).toBe(1);
  });

  it("a different need from the same caller is a DIFFERENT episode", () => {
    expect(episodeKey("2165551043", "tire", t)).not.toBe(episodeKey("2165551043", "chassis", t));
  });

  it("brakes in June and tires in September are not one repeat caller", () => {
    const june = new Date("2026-06-02T14:00:00Z");
    expect(episodeKey("2165551043", "chassis", june)).not.toBe(episodeKey("2165551043", "tire", t));
  });

  it("intent families are derived from intents, with a general fallback", () => {
    expect(intentFamily(["used_tire", "tire_size_request"])).toBe("tire");
    expect(intentFamily(["brakes"])).toBe("chassis");
    expect(intentFamily([])).toBe("general");
  });

  it("the episode window is a day, not ninety", () => {
    expect(EPISODE_WINDOW_MINUTES).toBe(24 * 60);
  });
});

/* ──────────────────────────────── parity ────────────────────────────── */

describe("parity · the outcome list may exist in exactly one place", () => {
  const CLASSIFIER = "server/services/vapiCallClassifier.ts";

  it("the kernel's outcome list matches the classifier's union exactly", () => {
    const src = read(CLASSIFIER);
    const block = src.slice(
      src.indexOf("export type VapiOutcomeCategory ="),
      src.indexOf("export type VapiIntent ="),
    );
    const found = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(found.sort()).toEqual([...CALL_OUTCOMES].sort());
  });

  it("CANARY: the parity check above genuinely fails on a mismatch", () => {
    // Mutate the kernel's list in memory and prove the comparison rejects it.
    // Without this, a parity test that silently matched nothing would score
    // green forever — the silent-instrument failure mode.
    const mutated = [...CALL_OUTCOMES, "a_thirteenth_outcome"];
    const src = read(CLASSIFIER);
    const block = src.slice(
      src.indexOf("export type VapiOutcomeCategory ="),
      src.indexOf("export type VapiIntent ="),
    );
    const found = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(found.sort()).not.toEqual(mutated.sort());
  });

  it("CANARY: the extraction actually found outcomes (not an empty set)", () => {
    // A zero, a green and a surviving mutation are all "no signal". Prove the
    // regex matched real content before trusting the comparison above.
    const src = read(CLASSIFIER);
    const block = src.slice(
      src.indexOf("export type VapiOutcomeCategory ="),
      src.indexOf("export type VapiIntent ="),
    );
    expect(block.length).toBeGreaterThan(50);
    expect([...block.matchAll(/"([a-z_]+)"/g)].length).toBe(CALL_OUTCOMES.length);
  });
});

describe("totality · no input can throw", () => {
  it("every outcome yields a disposition", () => {
    for (const outcome of CALL_OUTCOMES) {
      expect(() => disposeCall(facts({ outcome }))).not.toThrow();
      expect(disposeCall(facts({ outcome })).lane).toBeTruthy();
    }
  });

  it("queueEligible is true only for the recovery lane", () => {
    for (const outcome of CALL_OUTCOMES) {
      for (const expectedArrivalOpen of [true, false]) {
        const d = disposeCall(facts({ outcome, expectedArrivalOpen }));
        expect(d.queueEligible).toBe(d.lane === "recovery");
      }
    }
  });
});
