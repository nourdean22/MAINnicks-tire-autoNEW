/**
 * 2026-11-06 · Today's "Urgent callback · Callback requested" rows from the voice receptionist
 * (escalate wrote utmSource voice-agent, scheduleCallback sourcePage vapi-voice-agent) leave the
 * board: the receptionist makes no callback obligations now, and its old rows go with them. The
 * rows stay in the Callbacks list. A website callback request stays on Today (positive control).
 */
import { describe, expect, it, vi } from "vitest";

const ROWS = [
  { id: 1, name: "Caller", phone: "2165550101", status: "new", utmSource: "voice-agent", sourcePage: null },
  { id: 2, name: "Sam", phone: "2165550102", status: "new", utmSource: null, sourcePage: "vapi-voice-agent" },
  { id: 3, name: "Website Pat", phone: "2165550103", status: "new", utmSource: "google", sourcePage: "/tires" },
];
vi.mock("../db", () => ({ getBookings: async () => [], getCallbackRequests: async () => ROWS }));
vi.mock("../admin-stats", () => ({ getDashboardStats: async () => ({}), getSiteHealth: async () => ({}) }));
vi.mock("./smsResponseJobs", () => ({ listWaitingConversations: async () => [] }));
vi.mock("./callbackServedEvidence", () => ({ getCallbackServedEvidence: async () => ({}) }));
vi.mock("../lib/db-helper", () => ({
  db: async () => ({ select: () => ({ from: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }),
}));

describe("Today's callbacks slice", () => {
  it("leaves out the receptionist's callback rows and keeps a website request", async () => {
    const { getOverviewMediumBundle } = await import("./adminBundle");
    const bundle = await getOverviewMediumBundle();
    expect(bundle.slices.callbacks.available).toBe(true);
    expect((bundle.callbacks ?? []).map((c) => c.id)).toEqual([3]);
  });
});
