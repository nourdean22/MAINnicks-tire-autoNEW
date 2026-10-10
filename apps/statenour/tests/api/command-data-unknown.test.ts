/**
 * /api/command/data: a shop metric no source carried is null, not 0 (audit
 * wave 2, P1 item 4). Revenue already had this rule (deriveShopRevenue); the
 * bookings / ticket / walk-rate / leads / callbacks chains still ended in
 * `?? 0`, so a dead bridge plus no pushed payload read as "0 urgent leads".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { fetchShopSnapshot } = vi.hoisted(() => ({ fetchShopSnapshot: vi.fn() }));

const rejecting = () => Promise.reject(new Error("db down in test"));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    { get: () => ({ findFirst: rejecting, findMany: rejecting, groupBy: rejecting }) },
  ),
}));
vi.mock("@/lib/services/dashboard", () => ({ getDailyCommandBrief: async () => ({}) }));
vi.mock("@/lib/services/runner-state", () => ({ getNourStatusSnapshot: async () => ({ services: {} }) }));
vi.mock("@/lib/services/bridge", () => ({ fetchShopSnapshot }));
vi.mock("@/lib/auth-guard", () => ({ requireSession: async () => undefined }));
vi.mock("@/lib/utils/cache", () => ({ cached: (_k: string, _t: number, fn: () => unknown) => fn() }));
vi.mock("@/lib/mastery/drift-engine", () => ({ getUnresolvedAlerts: async () => [] }));

import { GET } from "@/app/api/command/data/route";

async function shop(): Promise<Record<string, unknown>> {
  const res = await GET(new Request("http://localhost/api/command/data"));
  const body = (await res.json()) as { data: { shop: Record<string, unknown> } };
  return body.data.shop;
}

beforeEach(() => fetchShopSnapshot.mockReset());

describe("command data shop metrics", () => {
  it("no bridge and no pushed payload -> every metric is null, not 0", async () => {
    fetchShopSnapshot.mockResolvedValue(null);
    const s = await shop();
    for (const k of ["todayBookings", "avgTicket", "walkRate", "urgentLeads", "pendingCallbacks", "activeLeads"]) {
      expect(s[k], k).toBeNull();
    }
  });

  it("a counted zero from the bridge stays 0", async () => {
    fetchShopSnapshot.mockResolvedValue({
      bookings: { todayCount: 0 },
      leads: { urgentCount: 0, totalActive: 0 },
      callbacks: { pendingCount: 0 },
    });
    const s = await shop();
    expect(s.todayBookings).toBe(0);
    expect(s.urgentLeads).toBe(0);
    expect(s.pendingCallbacks).toBe(0);
    expect(s.activeLeads).toBe(0);
  });
});
