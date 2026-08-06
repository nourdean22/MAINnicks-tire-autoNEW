/**
 * physical-business · per-turn cache · 2026-08-06
 *
 * The block ran a Postgres round-trip on EVERY /chat turn (864 of 864
 * sampled turns over 30d) for a row the nickstire bridge rewrites every
 * ~4h, while /chat p50 TTFT sat at 10.4s. These tests pin the three
 * things that fix can break:
 *
 *   1. a second call inside the TTL does not re-query
 *   2. invalidatePhysicalBusinessCache() forces a re-query
 *   3. the "sync Nm ago" header still ages from the CACHED createdAt —
 *      i.e. what is cached is the ROW, never the rendered string
 *   4. a DB throw is NOT cached — the .catch() lives OUTSIDE cached(),
 *      so one transient Neon error costs one turn, not 300s of a blank
 *      [PHYSICAL_TRUTH] block
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auditEvent: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: mocks.auditEvent },
}));

// L2 is a no-op here so the assertions measure the L1 mechanism only:
// invalidate() fires redisDel WITHOUT awaiting it, so a live Redis would
// race the "did re-query" assertion.
vi.mock("@/lib/utils/redis", () => ({
  redisGet: async () => null,
  redisSet: async () => false,
  redisDel: async () => false,
  redisDelPrefix: async () => 0,
}));

// Imported AFTER vi.mock so the module picks up the mocked deps.
import {
  buildPhysicalBusinessContextBlock,
  invalidatePhysicalBusinessCache,
} from "@/lib/brain/physical-business";

const PAYLOAD = {
  prioritizedActions: [
    { priority: "high", title: "Bay 2 blocked", detail: "waiting on a 245/45R18" },
  ],
  workOrders: { active: 4, blocked: 1 },
  leads: { active: 3, urgent: 2 },
  revenue: { today: 1820 },
};

function rowAgedMinutes(minutes: number) {
  return { payload: PAYLOAD, createdAt: new Date(Date.now() - minutes * 60_000) };
}

describe("physical-business · context-block cache", () => {
  beforeEach(() => {
    mocks.auditEvent.findFirst.mockReset();
    // The L1 store is module-level and shared across tests in this file.
    invalidatePhysicalBusinessCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("two calls inside the TTL run exactly ONE query and render identically", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue(rowAgedMinutes(5));

    const first = await buildPhysicalBusinessContextBlock();
    const second = await buildPhysicalBusinessContextBlock();

    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toContain("[PHYSICAL_TRUTH]");
    expect(first).toContain("Active Work Orders: 4 (1 blocked)");
  });

  it("invalidatePhysicalBusinessCache() makes the next call re-query", async () => {
    mocks.auditEvent.findFirst.mockResolvedValue(rowAgedMinutes(5));
    await buildPhysicalBusinessContextBlock();
    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1);

    invalidatePhysicalBusinessCache();

    // A fresher row lands (the 4h bridge sync) — the block must show it.
    mocks.auditEvent.findFirst.mockResolvedValue({
      payload: { ...PAYLOAD, workOrders: { active: 9, blocked: 0 } },
      createdAt: new Date(),
    });
    const after = await buildPhysicalBusinessContextBlock();

    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(2);
    expect(after).toContain("Active Work Orders: 9 (0 blocked)");
  });

  it("does NOT cache a DB throw — the next turn retries instead of blanking for 300s", async () => {
    // A hard Neon error, not a soft empty result.
    mocks.auditEvent.findFirst.mockRejectedValueOnce(
      new Error("Neon: connection terminated unexpectedly"),
    );

    const failed = await buildPhysicalBusinessContextBlock();
    expect(failed).toBe(""); // degrades quietly, as the caller expects
    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1);

    // THE ASSERTION THAT MATTERS: the very next turn must hit the DB
    // again. With the .catch() inside cached(), the failure resolves to
    // null and gets STORED — this second call would serve "" from L1 and
    // findFirst would stay at 1 for the full TTL.
    mocks.auditEvent.findFirst.mockResolvedValue(rowAgedMinutes(1));
    const recovered = await buildPhysicalBusinessContextBlock();

    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(2);
    expect(recovered).toContain("Active Work Orders: 4 (1 blocked)");
  });

  it("ages the header from the cached createdAt — the row is cached, not the string", async () => {
    vi.useFakeTimers();
    const t0 = new Date("2026-08-06T12:00:00.000Z");
    vi.setSystemTime(t0);
    mocks.auditEvent.findFirst.mockResolvedValue({
      payload: PAYLOAD,
      createdAt: new Date(t0.getTime() - 5 * 60_000),
    });

    const first = await buildPhysicalBusinessContextBlock();
    expect(first).toContain("(sync 5m ago)");

    // Two minutes later, still well inside the 300s TTL.
    vi.setSystemTime(new Date(t0.getTime() + 2 * 60_000));
    const later = await buildPhysicalBusinessContextBlock();

    expect(mocks.auditEvent.findFirst).toHaveBeenCalledTimes(1); // still cached
    expect(later).toContain("(sync 7m ago)"); // ...but the age moved
  });
});
