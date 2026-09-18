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

import { buildRecoveryQueue, breachedSla, phoneLast10, type QueueSourceRow } from "./recoveryQueue";

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
        meta: {
          intents: ["used_tire", "tire_size_request"],
          customerSpeech: { unparsed: false, first: "I need two used 215/60R17 today" },
          transferFailed: true,
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

describe("SLA clocks", () => {
  it("a verified transfer failure breaches in 15 minutes, a quote shopper does not", () => {
    const failed = row({
      createdAt: minutesAgo(20),
      evalOutcome: "callback_needed",
      meta: { intents: ["used_tire"], customerSpeech: { unparsed: false, first: "call me back about tires" }, transferFailed: true },
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
