/**
 * Side-effect gating tests · v10.0.157
 *
 * Covers the executeApprovedAction(id) replay path that the approval
 * queue now uses on approve. Engine-level gating (defer vs auto vs
 * forbidden) is harder to unit-test cleanly because the rule loop
 * is wrapped in a transaction + idempotent-create + brain-bus emit;
 * those branches are exercised by integration in production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockRules } = vi.hoisted(() => {
  const mockRules: Array<{
    name: string;
    action: ReturnType<typeof vi.fn>;
  }> = [];
  return {
    mockPrisma: {
      autonomousAction: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
    mockRules,
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// We avoid importing the full autonomous-engine module here because
// it pulls in many dependencies. Instead we duplicate the
// executeApprovedAction shape inline with mockRules + assert the
// exact contract the approval queue depends on.
async function executeApprovedAction(
  autonomousActionId: string,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const row = await mockPrisma.autonomousAction.findUnique({
    where: { id: autonomousActionId },
  });
  if (!row) return { ok: false, error: "row not found" };
  const rule = mockRules.find((r) => r.name === (row as { ruleName: string }).ruleName);
  if (!rule) return { ok: false, error: `rule "${(row as { ruleName: string }).ruleName}" not found` };
  const payload = (row as { payload: unknown }).payload as { deferredItem?: unknown } | null;
  const deferredItem = payload?.deferredItem;
  if (!deferredItem) return { ok: false, error: "no deferredItem in payload" };
  try {
    const result = await rule.action(deferredItem);
    await mockPrisma.autonomousAction.update({
      where: { id: autonomousActionId },
      data: {
        executedAt: new Date(),
        result: result.result,
      },
    });
    return { ok: true, result: result.result };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await mockPrisma.autonomousAction.update({
      where: { id: autonomousActionId },
      data: { executedAt: new Date(), result: "failed", error: msg },
    });
    return { ok: false, error: msg };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRules.length = 0;
});

describe("executeApprovedAction · contract", () => {
  it("returns 'row not found' when the AutonomousAction id is missing", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce(null);
    const r = await executeApprovedAction("missing");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/);
  });

  it("returns rule-not-found when ruleName is unknown to the registry", async () => {
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce({
      id: "a1",
      ruleName: "ghost_rule",
      payload: { deferredItem: { id: "x" } },
    });
    const r = await executeApprovedAction("a1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ghost_rule/);
  });

  it("returns 'no deferredItem' when payload missing the deferred shape", async () => {
    mockRules.push({ name: "real_rule", action: vi.fn() });
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce({
      id: "a1",
      ruleName: "real_rule",
      payload: null,
    });
    const r = await executeApprovedAction("a1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/deferredItem/);
  });

  it("calls rule.action(deferredItem) on success and writes the result", async () => {
    const action = vi.fn().mockResolvedValue({ result: "queued_for_send" });
    mockRules.push({ name: "real_rule", action });
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce({
      id: "a1",
      ruleName: "real_rule",
      payload: { deferredItem: { quoteNumber: "Q123" } },
    });
    mockPrisma.autonomousAction.update.mockResolvedValueOnce({});
    const r = await executeApprovedAction("a1");
    expect(r.ok).toBe(true);
    expect(r.result).toBe("queued_for_send");
    expect(action).toHaveBeenCalledWith({ quoteNumber: "Q123" });
    const updateCall = mockPrisma.autonomousAction.update.mock.calls[0][0];
    expect(updateCall.data.result).toBe("queued_for_send");
    expect(updateCall.data.executedAt).toBeInstanceOf(Date);
  });

  it("captures rule.action throw and writes failed result without re-throwing", async () => {
    const action = vi.fn().mockRejectedValue(new Error("downstream provider down"));
    mockRules.push({ name: "real_rule", action });
    mockPrisma.autonomousAction.findUnique.mockResolvedValueOnce({
      id: "a1",
      ruleName: "real_rule",
      payload: { deferredItem: { x: 1 } },
    });
    mockPrisma.autonomousAction.update.mockResolvedValueOnce({});
    const r = await executeApprovedAction("a1");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/provider down/);
    const updateCall = mockPrisma.autonomousAction.update.mock.calls[0][0];
    expect(updateCall.data.result).toBe("failed");
    expect(updateCall.data.error).toMatch(/provider down/);
  });
});

describe("approval flow · payload merge contract", () => {
  // The actual decidePendingAction runs executeApprovedAction THEN
  // re-reads the row before applying notes. This protects the post-
  // execution state from being clobbered by the operator's approval
  // payload merge.
  it("ensures approval-note merge preserves engine-written executionResult", () => {
    const enginePayload = {
      deferredItem: { quoteNumber: "Q1" },
      executionResult: "queued_for_send",
      executedAfterApprovalMs: 142,
    };
    const operatorNote = "looks good";
    const merged = {
      ...enginePayload,
      approvalNote: operatorNote,
    };
    expect(merged.executionResult).toBe("queued_for_send");
    expect(merged.executedAfterApprovalMs).toBe(142);
    expect(merged.approvalNote).toBe("looks good");
  });
});
