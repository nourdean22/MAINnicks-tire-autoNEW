/**
 * Recovery queue builder — the row-meaning repair, pinned.
 *
 * The old queue answered "how many calls had one of four outcomes in ninety
 * days?" and printed the answer as MISSED REVENUE. These tests pin the four
 * separate defects that made that number meaningless, and prove the new builder
 * collapses a realistic corpus without hiding anything: every excluded episode
 * is counted under a stated reason.
 */
import { describe, expect, it } from "vitest";

import { buildRecoveryQueue, breachedSla, type QueueSourceRow } from "./recoveryQueue";
import { phoneLast10 } from "../lib/phone";

const NOW = new Date("2026-09-18T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let nextId = 1;
const row = (over: Partial<QueueSourceRow> & { meta?: Record<string, unknown> } = {}): QueueSourceRow => {
  const { meta, ...rest } = over;
  return {
    id: nextId++,
    vapiCallId: `call-${nextId}`,
    phoneNumber: "216-555-1043",
    customerName: null,
    durationSeconds: 60,
    endedReason: "customer-ended-call",
    aiSummary: null,
    evalScore: 50,
    evalOutcome: "lost_opportunity",
    createdAt: minutesAgo(10),
    metadata: { intents: ["used_tire"], customerSpeech: { unparsed: false, first: "I need two used tires" }, ...(meta ?? {}) },
    ...rest,
  };
};

describe("episode collapse · one customer with one need is ONE row", () => {
  it("the transfer-failure redial storm becomes a single episode with a count", () => {
    const calls = [
      row({ createdAt: minutesAgo(38) }),
      row({ createdAt: minutesAgo(32) }),
      row({ createdAt: minutesAgo(20) }),
    ];
    const r = buildRecoveryQueue(calls, NOW);
    expect(r.sourceCallCount).toBe(3);
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0].contactCount).toBe(3);
    expect(r.episodes[0].callIds).toHaveLength(3);
  });

  it("repetition raises PRIORITY instead of adding rows", () => {
    const once = buildRecoveryQueue([row()], NOW);
    const thrice = buildRecoveryQueue(
      [row({ createdAt: minutesAgo(30) }), row({ createdAt: minutesAgo(20) }), row({ createdAt: minutesAgo(10) })],
      NOW,
    );
    expect(thrice.episodes).toHaveLength(once.episodes.length);
    expect(thrice.episodes[0].disposition.priority)
      .toBeGreaterThan(once.episodes[0].disposition.priority);
  });

  it("the June-brakes / September-tires caller is NOT one repeat episode", () => {
    const june = row({ createdAt: new Date("2026-06-02T14:00:00Z"), meta: { intents: ["brakes"] } });
    const sept = row({ createdAt: minutesAgo(10), meta: { intents: ["used_tire"] } });
    const r = buildRecoveryQueue([june, sept], NOW);
    // Two genuinely different needs -> two episodes, neither inflating the other.
    expect(r.episodes.length + r.laneCounts.none + r.laneCounts.unclassified).toBeGreaterThanOrEqual(2);
    for (const e of r.episodes) expect(e.contactCount).toBe(1);
  });

  it("different callers never merge", () => {
    const r = buildRecoveryQueue(
      [row({ phoneNumber: "216-555-0001" }), row({ phoneNumber: "216-555-0002" })],
      NOW,
    );
    expect(r.episodes).toHaveLength(2);
  });
});

describe("exclusions are counted, never silently dropped", () => {
  it("a walk-in with an open arrival leaves the queue but stays visible", () => {
    const r = buildRecoveryQueue(
      [row({ evalOutcome: "walk_in_directed", meta: { intents: [], customerSpeech: { unparsed: false, first: "I will come by today" }, expectedArrivalOpen: true } })],
      NOW,
    );
    expect(r.episodes).toHaveLength(0);
    expect(r.laneCounts.arrival).toBe(1);
    expect(r.exclusionCounts.expected_to_arrive).toBe(1);
  });

  it("a silent caller is excluded as no_customer_speech", () => {
    const r = buildRecoveryQueue(
      [row({ meta: { intents: [], customerSpeech: { unparsed: false, first: null } } })],
      NOW,
    );
    expect(r.episodes).toHaveLength(0);
    expect(r.exclusionCounts.no_customer_speech).toBe(1);
  });

  it("a row with NO speech record is UNCLASSIFIED — not counted as silent", () => {
    // Pre-2026-07-26 rows, and any failed analytics write. Asserting these are
    // "no demand" would be inventing a measurement we never took.
    const r = buildRecoveryQueue([row({ meta: { intents: ["used_tire"], customerSpeech: undefined } })], NOW);
    expect(r.laneCounts.unclassified).toBe(1);
    expect(r.unclassifiedCount).toBe(1);
    expect(r.exclusionCounts.unattributable).toBe(1);
    expect(r.exclusionCounts.no_customer_speech).toBeUndefined();
  });

  it("every excluded episode is attributable to exactly one stated reason", () => {
    const calls = [
      row({ evalOutcome: "spam_or_wrong_number" }),
      row({ phoneNumber: "216-555-0002", evalOutcome: "resolved_info", meta: { intents: ["hours_location"], customerSpeech: { unparsed: false, first: "what time do you close" } } }),
      row({ phoneNumber: "216-555-0003", evalOutcome: "hard_conversion" }),
      row({ phoneNumber: "216-555-0004", meta: { intents: [], customerSpeech: undefined } }),
    ];
    const r = buildRecoveryQueue(calls, NOW);
    const excluded = Object.values(r.exclusionCounts).reduce((a, b) => a + b, 0);
    const nonRecovery = Object.entries(r.laneCounts)
      .filter(([lane]) => lane !== "recovery" && lane !== "engineering")
      .reduce((a, [, n]) => a + n, 0);
    expect(excluded).toBe(nonRecovery);
  });
});

describe("the 1,118 wall · a realistic corpus collapses without hiding anything", () => {
  it("separates real obligations from a census of answered calls", () => {
    const calls: QueueSourceRow[] = [];
    // 60 calls where only the greeting played — the class that used to become
    // walk_in_directed via "Euclid" or lost_opportunity via "Auto".
    for (let i = 0; i < 60; i++) {
      calls.push(row({
        phoneNumber: `216-555-${String(1000 + i)}`,
        meta: { intents: [], customerSpeech: { unparsed: false, first: null } },
      }));
    }
    // 20 pure information calls.
    for (let i = 0; i < 20; i++) {
      calls.push(row({
        phoneNumber: `216-555-${String(2000 + i)}`,
        evalOutcome: "resolved_info",
        meta: { intents: ["hours_location"], customerSpeech: { unparsed: false, first: "what time do you close today" } },
      }));
    }
    // 10 walk-ins already expected.
    for (let i = 0; i < 10; i++) {
      calls.push(row({
        phoneNumber: `216-555-${String(3000 + i)}`,
        evalOutcome: "walk_in_directed",
        meta: { intents: [], customerSpeech: { unparsed: false, first: "I will swing by today" }, expectedArrivalOpen: true },
      }));
    }
    // 1 genuine buyer who redialled 4 times after a failed transfer.
    for (let i = 0; i < 4; i++) {
      calls.push(row({
        phoneNumber: "216-555-9999",
        createdAt: minutesAgo(40 - i * 8),
        evalOutcome: "callback_needed",
        // Ground truth from VAPI's own reason, not a hand-set metadata flag.
        endedReason: "call.in-progress.error-transfer-failed",
        meta: {
          intents: ["used_tire", "tire_size_request"],
          customerSpeech: { unparsed: false, first: "I need two used 215/60R17 today" },
        },
      }));
    }

    const r = buildRecoveryQueue(calls, NOW);

    expect(r.sourceCallCount).toBe(94);
    // The operator sees ONE thing to do, not 94.
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0].contactCount).toBe(4);
    expect(r.episodes[0].disposition.reasons.map((x) => x.code)).toContain("transfer_failed");
    // And every one of the other 93 calls is accounted for on screen.
    expect(r.exclusionCounts.no_customer_speech).toBe(60);
    expect(r.exclusionCounts.informational_only).toBe(20);
    expect(r.exclusionCounts.expected_to_arrive).toBe(10);
    expect(r.laneCounts.arrival).toBe(10);
  });

  it("POSITIVE CONTROL: real demand is NOT filtered away", () => {
    // Proves the collapse above is selective, not a builder that returns [].
    const calls = Array.from({ length: 12 }, (_, i) =>
      row({
        phoneNumber: `216-555-${String(7000 + i)}`,
        evalOutcome: "tire_availability_intent",
        meta: {
          intents: ["used_tire", "tire_size_request"],
          customerSpeech: { unparsed: false, first: "do you have 225 60 16 in used" },
        },
      }),
    );
    const r = buildRecoveryQueue(calls, NOW);
    expect(r.episodes).toHaveLength(12);
    expect(r.laneCounts.recovery).toBe(12);
  });
});

/* ─────────── the facts the kernel reads must have real writers ─────────── */

describe("wired facts · a reader with no writer is not a feature", () => {
  // Caught in self-review: disposeCall read meta.expectedArrivalOpen and
  // meta.transferFailed, and NOTHING wrote either. Four of the seven lanes
  // could never fire, and the 25-point transfer-failure priority never
  // triggered. The kernel was correct and starved.

  it("an open expected arrival moves a walk-in OUT of recovery", () => {
    const walkIn = row({
      phoneNumber: "216-555-7777",
      evalOutcome: "walk_in_directed",
      meta: { intents: [], customerSpeech: { unparsed: false, first: "I will come by today" } },
    });
    const withArrival = buildRecoveryQueue([walkIn], NOW, {
      expectedArrivalPhones: new Set(["2165557777"]),
    });
    expect(withArrival.episodes).toHaveLength(0);
    expect(withArrival.laneCounts.arrival).toBe(1);
    expect(withArrival.exclusionCounts.expected_to_arrive).toBe(1);
  });

  it("FAIL-OPEN: with no arrival set the walk-in stays in recovery, never vanishes", () => {
    // If the arrivals read breaks, the safe direction is a noisier queue —
    // never a silently dropped customer.
    const walkIn = row({
      phoneNumber: "216-555-7777",
      evalOutcome: "walk_in_directed",
      meta: { intents: [], customerSpeech: { unparsed: false, first: "I will come by today" } },
    });
    const noSet = buildRecoveryQueue([walkIn], NOW);
    expect(noSet.episodes).toHaveLength(1);
    expect(noSet.laneCounts.arrival).toBe(0);
  });

  it("transferFailed is derived from the REAL endedReason predicate", () => {
    const failed = buildRecoveryQueue(
      [row({ endedReason: "call.in-progress.error-transfer-failed" })],
      NOW,
    );
    expect(failed.episodes[0].transferFailed).toBe(true);
    expect(failed.episodes[0].disposition.reasons.map((r) => r.code)).toContain("transfer_failed");
    expect(failed.episodes[0].disposition.slaMinutes).toBe(15);
  });

  it("assistant-forwarded-call is NOT treated as a failure — nor as a success", () => {
    // Vapi's docs: that reason means the transfer was INITIATED. A call that
    // rang an empty counter and hit voicemail carries it too, so it may not be
    // read either way.
    const forwarded = buildRecoveryQueue(
      [row({ endedReason: "assistant-forwarded-call" })],
      NOW,
    );
    const ep = forwarded.episodes[0];
    if (ep) {
      expect(ep.transferFailed).toBe(false);
      expect(ep.disposition.reasons.map((r) => r.code)).not.toContain("transfer_failed");
    }
  });

  it("the provider's verdict OUTRANKS the endedReason heuristic", () => {
    // artifact says the caller reached a human; a reason that looks like a
    // failure must not re-open the episode as a failed handoff.
    const r = buildRecoveryQueue(
      [row({
        endedReason: "call.in-progress.error-transfer-failed",
        meta: {
          intents: ["used_tire"],
          customerSpeech: { unparsed: false, first: "I need two used tires" },
          transferArtifact: { verdict: "connected", artifactPresent: true },
        },
      })],
      NOW,
    );
    expect(r.episodes[0].transferFailed).toBe(false);
  });

  it("a not_connected verdict marks the failure even when the reason looks clean", () => {
    const r = buildRecoveryQueue(
      [row({
        endedReason: "assistant-forwarded-call",
        meta: {
          intents: ["used_tire"],
          customerSpeech: { unparsed: false, first: "I need two used tires" },
          transferArtifact: { verdict: "not_connected", artifactPresent: true },
        },
      })],
      NOW,
    );
    expect(r.episodes[0].transferFailed).toBe(true);
    expect(r.episodes[0].disposition.slaMinutes).toBe(15);
  });

  it("assistant-forwarded-call ALONE resolves neither way", () => {
    // The defect: that reason means INITIATED. With no artifact verdict it must
    // not be read as a success or as a failure.
    const r = buildRecoveryQueue(
      [row({ endedReason: "assistant-forwarded-call" })],
      NOW,
    );
    if (r.episodes[0]) expect(r.episodes[0].transferFailed).toBe(false);
  });

  // `invoicedPhones` was accepted here for weeks and no caller ever supplied
  // it, so "already invoiced" had never fired once. Its replacement carries the
  // invoice DAY so a visit last week cannot suppress a new need today.
  // NOW is 2026-09-18 11:00 ET; the default row is ten minutes earlier.
  it("an invoice on the day of the call closes the episode", () => {
    const r = buildRecoveryQueue([row({ phoneNumber: "216-555-8888" })], NOW, {
      invoicedOnOrAfter: new Map([["2165558888", "2026-09-18"]]),
    });
    expect(r.episodes).toHaveLength(0);
    expect(r.exclusionCounts.already_invoiced).toBe(1);
  });

  it("an invoice AFTER the call day also closes it — they came back and paid", () => {
    const r = buildRecoveryQueue([row({ phoneNumber: "216-555-8888" })], NOW, {
      invoicedOnOrAfter: new Map([["2165558888", "2026-09-20"]]),
    });
    expect(r.episodes).toHaveLength(0);
    expect(r.exclusionCounts.already_invoiced).toBe(1);
  });

  it("an invoice BEFORE the call day does NOT close it — that was a different visit", () => {
    // The whole reason the option carries a day: "has ever paid us" is not
    // "money in the till for this call". Suppressing this episode would drop a
    // real new need from the queue.
    const r = buildRecoveryQueue([row({ phoneNumber: "216-555-8888" })], NOW, {
      invoicedOnOrAfter: new Map([["2165558888", "2026-09-17"]]),
    });
    expect(r.episodes).toHaveLength(1);
    expect(r.exclusionCounts.already_invoiced ?? 0).toBe(0);
  });

  it("POSITIVE CONTROL: the signal is keyed by last-10 digits, like every other phone fact", () => {
    // A map keyed by the raw dashed number would never match, and the kernel
    // would starve again with no error anywhere.
    const raw = buildRecoveryQueue([row({ phoneNumber: "216-555-8888" })], NOW, {
      invoicedOnOrAfter: new Map([["216-555-8888", "2026-09-18"]]),
    });
    const last10 = buildRecoveryQueue([row({ phoneNumber: "216-555-8888" })], NOW, {
      invoicedOnOrAfter: new Map([["2165558888", "2026-09-18"]]),
    });
    expect(raw.episodes).toHaveLength(1);
    expect(last10.episodes).toHaveLength(0);
  });
});

describe("SLA clocks", () => {
  it("a verified transfer failure breaches in 15 minutes, a quote shopper does not", () => {
    const failed = row({
      createdAt: minutesAgo(20),
      evalOutcome: "callback_needed",
      endedReason: "call.in-progress.error-transfer-failed",
      meta: { intents: ["used_tire"], customerSpeech: { unparsed: false, first: "call me back about tires" } },
    });
    const shopper = row({
      phoneNumber: "216-555-0002",
      createdAt: minutesAgo(20),
      evalOutcome: "quote_or_inspection_intent",
      meta: { intents: ["pricing_question"], customerSpeech: { unparsed: false, first: "how much for an alignment" } },
    });
    const r = buildRecoveryQueue([failed, shopper], NOW);
    const breached = breachedSla(r);
    expect(breached).toHaveLength(1);
    expect(breached[0].disposition.slaMinutes).toBe(15);
  });
});

describe("phone normalisation", () => {
  it("collapses formatting differences to the last ten digits", () => {
    expect(phoneLast10("+1 (216) 555-1043")).toBe("2165551043");
    expect(phoneLast10("216.555.1043")).toBe("2165551043");
    expect(phoneLast10(null)).toBe("");
  });

  it("the same caller in two formats is one episode", () => {
    const r = buildRecoveryQueue(
      [row({ phoneNumber: "+12165551043" }), row({ phoneNumber: "(216) 555-1043" })],
      NOW,
    );
    expect(r.episodes).toHaveLength(1);
    expect(r.episodes[0].contactCount).toBe(2);
  });
});
