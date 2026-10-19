/**
 * Customer names and phones never reach the bdnick database (2026-10-18, wave 3 group 7).
 *
 * `business_metrics_sync` stored the nickstire payload verbatim every 15 minutes, including
 * customerIntelligence.atRiskCustomers[].{name,phone}, topSpenders[].name, the actionPlan
 * sentence that names the same people, declinedWork.topItems[].{customer,phone} and
 * customerJourneys[].customer. apps/nickstire/AGENTS.md section 5 wants customer PII minimised.
 *
 * Every assertion reads what prisma was asked to STORE (or what GET hands back), never the input.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditEvent: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  apiRequestLog: { create: vi.fn() },
  errorLog: { create: vi.fn() },
}));

vi.mock("@/lib/auth-guard", () => ({
  requireSyncAuth: vi.fn(),
  requireCronAuth: vi.fn(),
  requireSession: vi.fn().mockResolvedValue({ user: "operator" }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: mocks.auditEvent, apiRequestLog: mocks.apiRequestLog, errorLog: mocks.errorLog },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/mastery/drift-engine", () => ({ getUnresolvedAlerts: vi.fn().mockResolvedValue([]) }));

import { GET, POST } from "@/app/api/sync/business/route";

const NAME = "Jane Roe";
const NAME2 = "Sam Doe";
const PHONE = "2165550199";

const withPii = () => ({
  source: "nickstire",
  version: "v2",
  revenue: { today: 100, weekRevenue: 700 },
  leads: { urgent: 2, total: 5 },
  customerIntelligence: {
    available: true,
    totalCustomers: 40,
    retentionRate: 61,
    topSpenders: [{ name: NAME2, total: 4200, visits: 9 }],
    atRiskCustomers: [{ name: NAME, phone: PHONE, lastVisit: "2025-12-01", daysSince: 321 }],
    actionPlan: `\nCUSTOMER ACTION PLAN:\n• CALL NOW: ${NAME} (${PHONE}) — 321d since last visit. They're about to become a lost customer.\n• PROTECT: ${NAME2} is your #1 spender ($4200, 9 visits). Make sure they're getting VIP treatment.\n• MOMENTUM: 3 new customers this month.`,
  },
  declinedWork: {
    totalRecoverable: 900,
    customerCount: 1,
    safetyItemCount: 1,
    topItems: [{ workOrderId: 7, customer: NAME, phone: PHONE, vehicle: "2015 Test Sedan", value: 900 }],
  },
  customerJourneys: [{ customer: NAME, events: ["booking", "invoice"], hoursActive: 5 }],
});

const req = (body: unknown) =>
  new Request("https://bdnick.info/api/sync/business", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": "test-key" },
    body: JSON.stringify(body),
  });

const stored = () => mocks.auditEvent.create.mock.calls.map((c) => (c[0] as { data: { eventType: string; payload: unknown } }).data);

beforeEach(() => {
  mocks.auditEvent.create.mockReset().mockResolvedValue({ id: "evt" });
  mocks.auditEvent.findFirst.mockReset();
  mocks.auditEvent.findMany.mockReset().mockResolvedValue([]);
  mocks.apiRequestLog.create.mockReset().mockResolvedValue({});
  mocks.errorLog.create.mockReset().mockResolvedValue({});
});

describe("POST /api/sync/business stores no customer name or phone", () => {
  it("neither stored row (raw sync, CEO context) carries a name or a phone", async () => {
    const res = await POST(req(withPii()));
    expect(res.status).toBe(200);
    const rows = stored();
    expect(rows.map((r) => r.eventType).sort()).toEqual(["business_metrics_sync", "ceo_business_context"]);
    for (const row of rows) {
      const text = JSON.stringify(row.payload);
      expect(text).not.toContain(NAME);
      expect(text).not.toContain(NAME2);
      expect(text).not.toContain(PHONE);
    }
  });

  it("keeps the numbers: daysSince, lastVisit, total, visits, counts and revenue", async () => {
    await POST(req(withPii()));
    const raw = stored().find((r) => r.eventType === "business_metrics_sync")!.payload as Record<string, any>;
    expect(raw.customerIntelligence.atRiskCustomers).toEqual([{ lastVisit: "2025-12-01", daysSince: 321 }]);
    expect(raw.customerIntelligence.topSpenders).toEqual([{ total: 4200, visits: 9 }]);
    expect(raw.customerIntelligence.totalCustomers).toBe(40);
    expect(raw.customerIntelligence.retentionRate).toBe(61);
    expect(raw.revenue).toEqual({ today: 100, weekRevenue: 700 });
    expect(raw.declinedWork.topItems[0]).toMatchObject({ workOrderId: 7, vehicle: "2015 Test Sedan", value: 900 });
    expect(raw.customerJourneys[0]).toMatchObject({ events: ["booking", "invoice"], hoursActive: 5 });
  });

  it("the action plan says how many to chase and where to find them, not who", async () => {
    await POST(req(withPii()));
    const raw = stored().find((r) => r.eventType === "business_metrics_sync")!.payload as Record<string, any>;
    expect(raw.customerIntelligence.actionPlan).toContain("MOMENTUM: 3 new customers this month.");
    expect(raw.customerIntelligence.actionPlan).toMatch(/1 at-risk customer.*Customers in the admin/);
    expect(raw.customerIntelligence.actionPlan).not.toMatch(/CALL NOW|PROTECT/);
  });

  it("a payload that never had the fields still persists unchanged", async () => {
    const plain = { source: "nickstire", revenue: { today: 5 }, leads: { urgent: 0, total: 1 } };
    const res = await POST(req(plain));
    expect(res.status).toBe(200);
    expect(stored().find((r) => r.eventType === "business_metrics_sync")!.payload).toEqual(plain);
  });

  it("an unavailable customer read stays unavailable, with no list invented", async () => {
    const down = { source: "nickstire", customerIntelligence: { available: false, reason: "read failed" } };
    await POST(req(down));
    expect(stored().find((r) => r.eventType === "business_metrics_sync")!.payload).toEqual(down);
  });
});

describe("GET /api/sync/business hides names still sitting in rows written before the fix", () => {
  it("returns the old row without name or phone", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue({ payload: withPii(), createdAt: new Date("2026-10-01T00:00:00Z") });
    const res = await GET(new Request("https://bdnick.info/api/sync/business", { headers: { "x-sync-key": "test-key" } }));
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(NAME2);
    expect(text).not.toContain(PHONE);
    expect(text).toContain("321");
  });
});
