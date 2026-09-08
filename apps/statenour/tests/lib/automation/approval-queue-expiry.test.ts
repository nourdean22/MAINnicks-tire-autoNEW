/**
 * tests/lib/automation/approval-queue-expiry.test.ts · 2026-09-07
 *
 * Expire authorization, not obligations (program D12). A pending autonomous
 * action past its freshness window:
 *   · is still LISTED, flagged `expired`, with its `expiresAt` visible;
 *   · cannot be APPROVED — the deferred side effect must never execute
 *     against state that no longer holds;
 *   · can still be REJECTED by a human (that is a human decision);
 *   · is counted separately in the queue summary so Home can say
 *     "N waiting · M expired" instead of one misleading total.
 * No row is deleted, no decline is fabricated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    autonomousAction: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    automationPolicy: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({ logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }));
const engine = vi.hoisted(() => ({ executeApprovedAction: vi.fn(async () => ({ ok: true, result: "stubbed" })) }));
vi.mock("@/lib/brain/autonomous-engine", () => ({ executeApprovedAction: engine.executeApprovedAction }));
vi.mock("@/lib/automation/policy", () => ({ getPolicy: vi.fn(async () => null) }));

import { decidePendingAction, listPendingActions, summarizeQueue } from "@/lib/automation/approval-queue";

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000);
const row = (over: Partial<{ id: string; actionType: string; createdAt: Date; approval: string }>) => ({
  id: over.id ?? "a1",
  ruleName: "auto_followup_expired_quote",
  trigger: "trig",
  actionType: over.actionType ?? "send_email",
  targetType: "lead",
  targetId: "L1",
  payload: null,
  approval: over.approval ?? "pending",
  approvedBy: null,
  result: "pending",
  error: null,
  executedAt: null,
  createdAt: over.createdAt ?? hoursAgo(1),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.automationPolicy.findMany.mockResolvedValue([]);
  mockPrisma.autonomousAction.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    ...row({ id: where.id }),
    ...data,
  }));
});

describe("listPendingActions marks expired rows instead of hiding them", () => {
  it("a fresh and a 330-hour-old email approval both list; only the old one is expired", async () => {
    mockPrisma.autonomousAction.findMany.mockResolvedValue([
      row({ id: "fresh", createdAt: hoursAgo(1) }),
      row({ id: "stale", createdAt: hoursAgo(330) }),
    ]);
    const rows = await listPendingActions();
    expect(rows.map((r) => [r.id, r.expired])).toEqual([["fresh", false], ["stale", true]]);
    expect(rows[1].expiresAt.getTime()).toBe(rows[1].createdAt.getTime() + 3 * 86_400_000);
  });
});

describe("summarizeQueue separates live from expired", () => {
  it("counts both, and the total still equals every pending row", async () => {
    mockPrisma.autonomousAction.findMany.mockResolvedValue([
      { ruleName: "r1", actionType: "send_email", createdAt: hoursAgo(2) },
      { ruleName: "r1", actionType: "send_email", createdAt: hoursAgo(200) },
      { ruleName: "r2", actionType: "update_record", createdAt: hoursAgo(100) },
    ]);
    const s = await summarizeQueue();
    expect(s.total).toBe(3);
    expect(s.live).toBe(2);
    expect(s.expired).toBe(1);
    expect(s.live + s.expired).toBe(s.total);
  });
});

describe("decidePendingAction refuses to execute an expired authorization", () => {
  it("approve on an expired action → 409, and the side effect never runs", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValue(row({ id: "stale", createdAt: hoursAgo(330) }));
    await expect(decidePendingAction("stale", "approved")).rejects.toMatchObject({ status: 409 });
    expect(engine.executeApprovedAction).not.toHaveBeenCalled();
    expect(mockPrisma.autonomousAction.update).not.toHaveBeenCalled();
  });

  it("the refusal tells the operator to re-request or dismiss — it does not say declined", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValue(row({ id: "stale", createdAt: hoursAgo(330) }));
    await expect(decidePendingAction("stale", "approved")).rejects.toThrow(/re-request/);
    await expect(decidePendingAction("stale", "approved")).rejects.not.toThrow(/declined/i);
  });

  it("reject on an expired action is still a human decision and is recorded", async () => {
    const stale = row({ id: "stale", createdAt: hoursAgo(330) });
    mockPrisma.autonomousAction.findUnique.mockResolvedValue(stale);
    mockPrisma.autonomousAction.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...stale, ...data }));
    const out = await decidePendingAction("stale", "rejected", "nour", "no longer relevant");
    expect(mockPrisma.autonomousAction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "stale" }, data: expect.objectContaining({ approval: "rejected" }) }),
    );
    expect(engine.executeApprovedAction).not.toHaveBeenCalled();
    expect(out.expired).toBe(true);
  });

  it("positive control: approve on a fresh action executes exactly as before", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValue(row({ id: "fresh", createdAt: hoursAgo(1) }));
    const out = await decidePendingAction("fresh", "approved");
    expect(engine.executeApprovedAction).toHaveBeenCalledWith("fresh");
    expect(out.expired).toBe(false);
  });
});
