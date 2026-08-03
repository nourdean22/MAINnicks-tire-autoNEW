/**
 * adminSignals.test.ts · 2026-08-03
 *
 * Pins the mapping from the shell's existing fetches onto AdminSignal[].
 *
 * THE CASE NOTHING EVER CAUGHT: a PARTIAL bundle failure. getOverviewMediumBundle
 * runs five reads through Promise.allSettled, so one failing slice still resolves
 * the tRPC query — `isError` is false, the DegradedDataBanner never fires, and
 * getAdminActionableCounts turns the failed slice's undefined into [] and reports
 * 0. adminBundle.ts:85-92 records it: "a leads-only or callbacks-only failure
 * rendered a clean queue". The `slices` map that would have revealed it was
 * returned by the server and discarded by the client.
 */
import { describe, expect, it } from "vitest";

import { foldSignals, signalsForSection } from "@shared/adminSignal";

import { type AdminSignalInputs, buildAdminSignals } from "../lib/adminSignals";

const OK = { available: true, error: null };
const DOWN = (error = "read failed") => ({ available: false, error });

const ALL_OK = { stats: OK, bookings: OK, leads: OK, callbacks: OK, health: OK };

const inputs = (over: Partial<AdminSignalInputs> = {}): AdminSignalInputs => ({
  bundleFailed: false,
  slices: ALL_OK,
  counts: {
    newBookings: 2,
    newLeads: 3,
    urgentLeads: 1,
    actionableLeads: 5,
    pendingCallbacks: 1,
    total: 8,
  },
  stats: { tires: { new: 4 }, memberships: { warning: 6 } },
  opsFailed: false,
  opsUnknown: false,
  opsTotal: 7,
  ...over,
});

const badgeFor = (all: ReturnType<typeof buildAdminSignals>, section: string) =>
  foldSignals(signalsForSection(all, section));

describe("healthy path reproduces the previous badge numbers", () => {
  it("overview sums bookings + leads + callbacks + ops, as counts.total + opsTotal did", () => {
    const badge = badgeFor(buildAdminSignals(inputs()), "overview");
    // 2 + 5 + 1 = 8 (counts.total) plus ops 7 = 15.
    expect(badge).toMatchObject({ state: "counted", count: 15 });
  });

  it.each([
    ["leads", 3],
    ["tireOrders", 4],
    ["memberships", 6],
    ["instagram", 7],
  ])("%s badge is %i", (section, expected) => {
    expect(badgeFor(buildAdminSignals(inputs()), section)).toMatchObject({
      state: "counted",
      count: expected,
    });
  });
});

describe("PARTIAL bundle failure — the case that rendered a clean queue", () => {
  it("a leads-only slice failure makes leads unknown", () => {
    const all = buildAdminSignals(inputs({ slices: { ...ALL_OK, leads: DOWN("leads table unreachable") } }));
    expect(badgeFor(all, "leads").state).toBe("unknown");
  });

  it("...while a healthy sibling slice still reports its real count", () => {
    // The failure must not smear across sections that read fine — that would be
    // over-reporting, and it would train the operator to ignore the "?".
    const all = buildAdminSignals(inputs({ slices: { ...ALL_OK, leads: DOWN() } }));
    expect(badgeFor(all, "tireOrders")).toMatchObject({ state: "counted", count: 4 });
    expect(badgeFor(all, "memberships")).toMatchObject({ state: "counted", count: 6 });
  });

  it("...and overview goes unknown, because one of its contributors did", () => {
    const all = buildAdminSignals(inputs({ slices: { ...ALL_OK, leads: DOWN() } }));
    expect(badgeFor(all, "overview").state).toBe("unknown");
  });

  it("a stats-only failure takes tireOrders and memberships, not leads", () => {
    const all = buildAdminSignals(inputs({ slices: { ...ALL_OK, stats: DOWN() } }));
    expect(badgeFor(all, "tireOrders").state).toBe("unknown");
    expect(badgeFor(all, "memberships").state).toBe("unknown");
    expect(badgeFor(all, "leads")).toMatchObject({ state: "counted", count: 3 });
  });

  it("the slice's own error text reaches the reason, so the '?' is diagnosable", () => {
    const all = buildAdminSignals(inputs({ slices: { ...ALL_OK, leads: DOWN("ER_ACCESS_DENIED") } }));
    const badge = badgeFor(all, "leads");
    expect(badge.state).toBe("unknown");
    if (badge.state === "unknown") expect(badge.reason).toContain("ER_ACCESS_DENIED");
  });
});

describe("PER-COUNT failure hiding inside a fulfilled slice (PR #1316 review, P1)", () => {
  // getDashboardStats catches each count's error, logs it, and leaves the field
  // at 0 (admin-stats.ts:578-600). The function still FULFILLS, so
  // slices.stats.available stays true AND the whole-pipeline `_degraded` stamp
  // never fires — the inner catch prevents the outer one from seeing anything.
  // Slice availability alone would mark that fabricated zero as `counted`.
  it("a failed tire count is unknown even though its slice is available", () => {
    const all = buildAdminSignals(
      inputs({ stats: { tires: { new: 0 }, memberships: { warning: 6 }, _unavailableCounts: ["tires.new"] } }),
    );
    expect(badgeFor(all, "tireOrders").state).toBe("unknown");
  });

  it("...and its sibling count in the SAME slice still reports its real number", () => {
    const all = buildAdminSignals(
      inputs({ stats: { tires: { new: 0 }, memberships: { warning: 6 }, _unavailableCounts: ["tires.new"] } }),
    );
    expect(badgeFor(all, "memberships")).toMatchObject({ state: "counted", count: 6 });
  });

  it("both counts failing takes both badges, and leaves leads alone", () => {
    const all = buildAdminSignals(
      inputs({
        stats: { tires: { new: 0 }, memberships: { warning: 0 }, _unavailableCounts: ["tires.new", "memberships.warning"] },
      }),
    );
    expect(badgeFor(all, "tireOrders").state).toBe("unknown");
    expect(badgeFor(all, "memberships").state).toBe("unknown");
    expect(badgeFor(all, "leads")).toMatchObject({ state: "counted", count: 3 });
  });

  it("an empty _unavailableCounts is the healthy path, not a failure", () => {
    const all = buildAdminSignals(
      inputs({ stats: { tires: { new: 4 }, memberships: { warning: 6 }, _unavailableCounts: [] } }),
    );
    expect(badgeFor(all, "tireOrders")).toMatchObject({ state: "counted", count: 4 });
    expect(badgeFor(all, "memberships")).toMatchObject({ state: "counted", count: 6 });
  });

  it("names the failed COUNT, not just the slice, so the '?' points somewhere", () => {
    const all = buildAdminSignals(
      inputs({ stats: { tires: { new: 0 }, _unavailableCounts: ["tires.new"] } }),
    );
    const badge = badgeFor(all, "tireOrders");
    expect(badge.state).toBe("unknown");
    if (badge.state === "unknown") expect(badge.reason).toContain("tires.new");
  });
});

describe("whole-query failure and loading", () => {
  it("a failed bundle makes every bundle-derived badge unknown", () => {
    const all = buildAdminSignals(inputs({ bundleFailed: true }));
    for (const s of ["overview", "leads", "tireOrders", "memberships"]) {
      expect(badgeFor(all, s).state, s).toBe("unknown");
    }
  });

  it("a failed bundle does NOT poison instagram, whose source is independent", () => {
    const all = buildAdminSignals(inputs({ bundleFailed: true }));
    expect(badgeFor(all, "instagram")).toMatchObject({ state: "counted", count: 7 });
  });

  it("before the first response there is NO badge, not a zero", () => {
    // counts arrive as 0 from the `?? []` fallbacks while loading. Rendering
    // that as 0 is a false all-clear on every page load.
    const all = buildAdminSignals(inputs({ slices: undefined, stats: null }));
    expect(badgeFor(all, "leads").state).toBe("not_measured");
    expect(badgeFor(all, "tireOrders").state).toBe("not_measured");
  });
});

describe("operationsSignal keeps its existing guarantees", () => {
  it("ops unknown poisons BOTH overview and instagram", () => {
    const all = buildAdminSignals(inputs({ opsUnknown: true, opsTotal: 0 }));
    expect(badgeFor(all, "overview").state).toBe("unknown");
    expect(badgeFor(all, "instagram").state).toBe("unknown");
  });

  it("an ops transport error is unknown even with a stale total present", () => {
    const all = buildAdminSignals(inputs({ opsFailed: true, opsTotal: 7 }));
    expect(badgeFor(all, "instagram").state).toBe("unknown");
  });

  it("ops counting a real zero leaves instagram counted, not unmeasured", () => {
    const all = buildAdminSignals(inputs({ opsTotal: 0 }));
    expect(badgeFor(all, "instagram")).toMatchObject({ state: "counted", count: 0 });
  });
});

describe("unwired sections emit nothing at all", () => {
  // The switch this replaced returned 0 for each of these, which reads as
  // "no problems here" for a question the system never asked.
  it.each([
    "customers",
    "revenue",
    "growth",
    "content",
    "campaigns",
    "voiceReceptionist",
    "opsHub",
    "settings",
    "intelligence",
    "trafficFunnel",
  ])("%s has no signal, so its badge is not_measured", (section) => {
    const all = buildAdminSignals(inputs());
    expect(signalsForSection(all, section)).toHaveLength(0);
    expect(badgeFor(all, section)).toEqual({ state: "not_measured" });
  });
});
