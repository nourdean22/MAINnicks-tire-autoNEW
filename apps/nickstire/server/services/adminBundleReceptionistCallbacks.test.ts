/**
 * 2026-11-06 · Today's "Urgent callback · Callback requested" rows from the voice receptionist
 * (escalate wrote utmSource voice-agent, scheduleCallback sourcePage vapi-voice-agent) leave the
 * board: the receptionist makes no callback obligations now, and its old rows go with them. The
 * rows stay in the Callbacks list. A website callback request stays on Today (positive control).
 */
import { describe, expect, it, vi } from "vitest";

const ROWS = [
  { id: 1, name: "Caller", phone: "2165550101", status: "new", utmSource: "voice-agent", utmMedium: "phone", utmCampaign: "vapi-receptionist", sourcePage: null, context: "[VOICE-AGENT · HIGH] callId=c1 — rack check" },
  { id: 2, name: "Sam", phone: "2165550102", status: "new", utmSource: null, utmMedium: null, utmCampaign: null, sourcePage: "vapi-voice-agent", context: "[VOICE-AGENT CALLBACK] callId=c2 — alignment" },
  { id: 3, name: "Website Pat", phone: "2165550103", status: "new", utmSource: "google", utmMedium: null, utmCampaign: null, sourcePage: "/tires", context: "brakes" },
  // Codex c=4495402006: a website request whose URL carried utm_source=voice-agent is a real request.
  { id: 4, name: "Website Lee", phone: "2165550104", status: "new", utmSource: "voice-agent", utmMedium: null, utmCampaign: null, sourcePage: "/", context: "quote please" },
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
    expect((bundle.callbacks ?? []).map((c) => c.id)).toEqual([3, 4]);
  });
});
