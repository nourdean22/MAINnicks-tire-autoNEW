import { describe, expect, it } from "vitest";
import { getAdminActionableCounts, isOpenLead, isWaitingLead } from "@/lib/adminActionableCounts";

describe("getAdminActionableCounts", () => {
  it("does not count an urgent new lead twice", () => {
    const counts = getAdminActionableCounts({
      bookings: [],
      callbacks: [],
      leads: [{ status: "new", urgencyScore: 5, source: "popup" }],
    });

    expect(counts.newLeads).toBe(1);
    expect(counts.urgentLeads).toBe(1);
    expect(counts.actionableLeads).toBe(1);
    expect(counts.total).toBe(1);
  });

  it("excludes callback-linked duplicate leads", () => {
    const counts = getAdminActionableCounts({
      bookings: [],
      leads: [{ status: "new", source: "callback", callbackId: 42 }],
      callbacks: [{ status: "pending" }],
    });

    expect(counts.actionableLeads).toBe(0);
    expect(counts.pendingCallbacks).toBe(1);
    expect(counts.total).toBe(1);
  });

  it("keeps unlinked voice leads actionable", () => {
    const counts = getAdminActionableCounts({
      leads: [{ status: "new", source: "callback", callbackId: null, utmCampaign: "vapi-rack-check" }],
    });

    expect(counts.actionableLeads).toBe(1);
    expect(counts.total).toBe(1);
  });

  it("a contacted or qualified lead is waiting on the customer, not actionable: the badge drops it like the board", () => {
    const counts = getAdminActionableCounts({
      leads: [
        { status: "contacted", urgencyScore: 5, source: "popup" },
        { status: "qualified", source: "chat" },
      ],
    });

    expect(counts).toMatchObject({ actionableLeads: 0, urgentLeads: 0, total: 0 });
  });

  it("career applicants are not sales leads: neither open nor waiting, and not counted", () => {
    // LeadsSection drops source "careers" before bucketing (they live on the Hiring tab).
    expect(isOpenLead({ status: "new", source: "careers" })).toBe(false);
    expect(isWaitingLead({ status: "contacted", source: "careers" })).toBe(false);
    // The control: the same rows from a sales source are open and waiting.
    expect(isOpenLead({ status: "new", source: "popup" })).toBe(true);
    expect(isWaitingLead({ status: "contacted", source: "popup" })).toBe(true);
    expect(getAdminActionableCounts({ leads: [{ status: "new", source: "careers" }, { status: "new", source: "popup" }] }).actionableLeads).toBe(1);
  });

  it("adds non-overlapping bookings, leads, and callbacks", () => {
    const counts = getAdminActionableCounts({
      bookings: [{ status: "new" }, { status: "confirmed" }],
      leads: [
        { status: "new", source: "popup" },
        { status: "contacted", source: "chat" },
        { status: "won", source: "manual" },
      ],
      callbacks: [{ status: "new" }, { status: "completed" }],
    });

    expect(counts).toMatchObject({
      newBookings: 1,
      newLeads: 1,
      actionableLeads: 1,
      pendingCallbacks: 1,
      total: 3,
    });
  });
});
