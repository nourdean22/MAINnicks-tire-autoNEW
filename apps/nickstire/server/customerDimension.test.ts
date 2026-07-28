/**
 * Customer dimension tests — the merge is where the bugs live.
 *
 * These pin the two properties that make the object safe to hand to a
 * generator: an inferred link can never present as verified, and a channel
 * nobody queried can never present as a channel with nothing in it.
 */

import { describe, expect, it } from "vitest";

import {
  buildCustomerDimension,
  evidenceOf,
  speakableFacts,
  type FacetInput,
} from "../shared/customerDimension";

const NOW = "2026-07-27T12:00:00.000Z";

const identity = {
  customerId: 4021,
  phoneKey: "2168620005",
  displayName: "Renée O.",
  vehicle: "2016 Honda Odyssey",
  smsOptOut: false,
};

const paidInvoice: FacetInput<unknown> = {
  channel: "money",
  linkage: { method: "direct-id" },
  occurredAt: "2026-05-02T15:00:00.000Z",
  value: { kind: "invoice", cents: 48_900 },
};

const phoneMatchedCall: FacetInput<unknown> = {
  channel: "voice",
  linkage: { method: "phone-key", note: "matched on last 10 digits" },
  occurredAt: "2026-07-01T17:20:00.000Z",
  value: { kind: "vapi_call", outcome: "asked about brakes" },
};

describe("linkage determines evidence, not the caller", () => {
  it("a foreign key is verified; a phone key is not", () => {
    expect(evidenceOf({ method: "direct-id" })).toBe("verified");
    expect(evidenceOf({ method: "operator-confirmed" })).toBe("verified");
    expect(evidenceOf({ method: "phone-key" })).toBe("inferred");
    expect(evidenceOf({ method: "weak-match" })).toBe("inferred");
  });

  it("facets.verified excludes every inferred link", () => {
    const dim = buildCustomerDimension({
      identity,
      facets: [paidInvoice, phoneMatchedCall],
      asOf: NOW,
    });
    expect(dim.facets.all).toHaveLength(2);
    expect(dim.facets.verified).toHaveLength(1);
    expect(dim.facets.verified[0].channel).toBe("money");
    expect(dim.hasInferredLinkage).toBe(true);
    expect(dim.weakestLinkage).toBe("phone-key");
  });

  it("names the household-collision risk in caveats", () => {
    const dim = buildCustomerDimension({ identity, facets: [phoneMatchedCall], asOf: NOW });
    expect(dim.caveats.join(" ")).toMatch(/household lines and recycled numbers/i);
    expect(dim.caveats.join(" ")).toMatch(/ROS-013/);
  });

  it("an all-direct-id dimension carries no inference caveat", () => {
    const dim = buildCustomerDimension({ identity, facets: [paidInvoice], asOf: NOW });
    expect(dim.hasInferredLinkage).toBe(false);
    expect(dim.caveats.join(" ")).not.toMatch(/household/i);
  });
});

describe("unknown is not empty", () => {
  it("a channel that was never queried is unknown, not absent", () => {
    const dim = buildCustomerDimension({
      identity,
      facets: [paidInvoice],
      channelsNotQueried: ["reputation", "voice"],
      asOf: NOW,
    });
    expect(dim.channelsUnknown).toEqual(["voice", "reputation"]);
    expect(dim.caveats.join(" ")).toMatch(/Not queried: voice, reputation/);
  });

  it("a channel that WAS queried and came back empty is not unknown", () => {
    // "We looked and found nothing" is real information. Laundering it into
    // "we don't know" is the mirror image of the ROS-049 false-green class.
    const dim = buildCustomerDimension({
      identity,
      facets: [paidInvoice],
      channelsNotQueried: [],
      asOf: NOW,
    });
    expect(dim.channelsUnknown).toEqual([]);
  });

  it("a queried channel that returned data is never listed unknown", () => {
    const dim = buildCustomerDimension({
      identity,
      facets: [phoneMatchedCall],
      channelsNotQueried: ["voice"],
      asOf: NOW,
    });
    expect(dim.channelsUnknown).not.toContain("voice");
    expect(dim.channelsSeen).toContain("voice");
  });

  it("every timeline field defaults to null, never zero", () => {
    const dim = buildCustomerDimension({ identity, facets: [], asOf: NOW });
    expect(dim.timeline).toEqual({
      firstSeenAt: null,
      lastContactAt: null,
      lastPaidAt: null,
      openDeclinedCents: null,
      lastVisitGapDays: null,
      lifetimePaidCents: null,
    });
    // A measured zero survives as a zero.
    const measured = buildCustomerDimension({
      identity,
      facets: [],
      timeline: { openDeclinedCents: 0 },
      asOf: NOW,
    });
    expect(measured.timeline.openDeclinedCents).toBe(0);
  });

  it("an empty dimension says so rather than looking like a quiet customer", () => {
    const dim = buildCustomerDimension({ identity, facets: [], asOf: NOW });
    expect(dim.caveats.join(" ")).toMatch(/empty dimension, not a quiet customer/i);
  });
});

describe("speakableFacts — what a generator may say out loud", () => {
  it("withholds a money statement when any link is inferred", () => {
    // The failure being prevented: an inferred phone-key match onto somebody
    // else's invoice becomes a confidently wrong sentence about this
    // customer's own car and their own money.
    const dim = buildCustomerDimension({
      identity,
      facets: [paidInvoice, phoneMatchedCall],
      timeline: { openDeclinedCents: 52_313 },
      asOf: NOW,
    });
    expect(speakableFacts(dim).openDeclinedCents).toBeNull();
  });

  it("allows the money statement when every link is verified", () => {
    const dim = buildCustomerDimension({
      identity,
      facets: [paidInvoice],
      timeline: { openDeclinedCents: 52_313 },
      asOf: NOW,
    });
    expect(speakableFacts(dim).openDeclinedCents).toBe(52_313);
  });

  it("hands over identity so replies are not cold (ROS-042 #3)", () => {
    const dim = buildCustomerDimension({ identity, facets: [paidInvoice], asOf: NOW });
    const speak = speakableFacts(dim);
    expect(speak.name).toBe("Renée O.");
    expect(speak.vehicle).toBe("2016 Honda Odyssey");
    // ...and only ever verified facts alongside it.
    expect(speak.facts.every((f) => f.evidence === "verified")).toBe(true);
  });

  it("never leaks an inferred fact into the speakable set", () => {
    const dim = buildCustomerDimension({
      identity,
      facets: [phoneMatchedCall, { ...phoneMatchedCall, linkage: { method: "weak-match" } }],
      asOf: NOW,
    });
    expect(speakableFacts(dim).facts).toEqual([]);
  });
});

describe("identity", () => {
  it("flags a dimension assembled from a phone key with no customers row", () => {
    const dim = buildCustomerDimension({
      identity: { ...identity, customerId: null },
      facets: [phoneMatchedCall],
      asOf: NOW,
    });
    expect(dim.caveats.join(" ")).toMatch(/assembled from the phone key alone/i);
  });

  it("stamps asOf from the caller, never from the clock", () => {
    // A self-stamping builder is untestable and non-deterministic.
    expect(buildCustomerDimension({ identity, facets: [], asOf: NOW }).asOf).toBe(NOW);
  });
});
