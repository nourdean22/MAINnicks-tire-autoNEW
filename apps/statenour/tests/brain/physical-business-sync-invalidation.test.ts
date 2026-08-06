/**
 * POST /api/sync/business → physical-business cache · 2026-08-06
 *
 * invalidatePhysicalBusinessCache() was exported and called by NOTHING,
 * so TTL expiry was the only freshness mechanism: the nickstire bridge
 * could write a fresh ceo_business_context row and /chat would keep
 * rendering the previous one for up to 300s.
 *
 * There is exactly ONE writer of that eventType (this route), so this
 * drives the REAL handler — only prisma, redis, auth and the drift
 * engine are mocked — and asserts the MECHANISM end to end: after the
 * POST, the next context-block build re-queries and renders the row the
 * POST just wrote.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  prisma: {
    auditEvent: mocks.auditEvent,
    apiRequestLog: mocks.apiRequestLog,
    errorLog: mocks.errorLog,
  },
  resetQueryCount: vi.fn(),
  getQueryCount: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/mastery/drift-engine", () => ({
  getUnresolvedAlerts: vi.fn().mockResolvedValue([]),
}));

// L2 no-op — invalidate() fires redisDel without awaiting it, so a live
// Redis would race the "did re-query" assertion.
vi.mock("@/lib/utils/redis", () => ({
  redisGet: async () => null,
  redisSet: async () => false,
  redisDel: async () => false,
  redisDelPrefix: async () => 0,
}));

import { POST } from "@/app/api/sync/business/route";
import {
  buildPhysicalBusinessContextBlock,
  invalidatePhysicalBusinessCache,
} from "@/lib/brain/physical-business";

function ceoRow(activeWorkOrders: number) {
  return {
    payload: {
      prioritizedActions: [],
      workOrders: { active: activeWorkOrders, blocked: 0 },
      leads: { active: 1, urgent: 0 },
      revenue: { today: 100 },
    },
    createdAt: new Date(),
  };
}

function syncRequest(body: unknown) {
  return new Request("https://bdnick.info/api/sync/business", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-key": "test-key" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sync/business · invalidates the [PHYSICAL_TRUTH] cache", () => {
  beforeEach(() => {
    mocks.auditEvent.create.mockReset().mockResolvedValue({ id: "evt" });
    mocks.auditEvent.findFirst.mockReset();
    mocks.auditEvent.findMany.mockReset().mockResolvedValue([]);
    mocks.apiRequestLog.create.mockReset().mockResolvedValue({});
    mocks.errorLog.create.mockReset().mockResolvedValue({});
    invalidatePhysicalBusinessCache();
  });

  it("a nickstire sync makes the very next chat turn read the row it just wrote", async () => {
    // A chat turn caches the OLD row.
    mocks.auditEvent.findFirst.mockResolvedValue(ceoRow(4));
    const before = await buildPhysicalBusinessContextBlock();
    expect(before).toContain("Active Work Orders: 4 (0 blocked)");
    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1);

    // The bridge posts a fresh snapshot.
    const res = await POST(syncRequest({
      source: "nickstire",
      workOrders: { active: 9, blocked: 0 },
      leads: { active: 1, urgent: 0 },
      revenue: { today: 100 },
    }));
    expect(res.status).toBe(200);

    // Both rows written: the raw payload + the normalized CEO context.
    const eventTypes = mocks.auditEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { eventType: string } }).data.eventType,
    );
    expect(eventTypes).toContain("business_metrics_sync");
    expect(eventTypes).toContain("ceo_business_context");

    // THE ASSERTION THAT MATTERS. Unwired, findFirst stays at 1 and the
    // block still says 4 for the rest of the 300s TTL.
    mocks.auditEvent.findFirst.mockResolvedValue(ceoRow(9));
    const after = await buildPhysicalBusinessContextBlock();

    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(2);
    expect(after).toContain("Active Work Orders: 9 (0 blocked)");
  });

  it("a non-nickstire payload writes no CEO row and leaves the cache alone", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue(ceoRow(4));
    await buildPhysicalBusinessContextBlock();
    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1);

    const res = await POST(syncRequest({ source: "somewhere-else", revenue: { today: 5 } }));
    expect(res.status).toBe(200);

    const eventTypes = mocks.auditEvent.create.mock.calls.map(
      (c) => (c[0] as { data: { eventType: string } }).data.eventType,
    );
    expect(eventTypes).not.toContain("ceo_business_context");

    // No new CEO row means nothing to refresh — the cache must survive,
    // or every unrelated sync would cost a chat turn a DB round-trip.
    await buildPhysicalBusinessContextBlock();
    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1);
  });
});
