/**
 * Durable approval re-dispatch · 2026-07-07.
 *
 * Prior behavior: pendingExecutions (in-memory) was the only execution
 * source for approved requests, with a 5-entry hand-maintained TOOL_MAP
 * fallback — so an approval arriving after a pod restart failed with
 * "No execution function found" for every tool outside those 5, and the
 * operator's approval silently did nothing. These tests pin the fix:
 * every policy-gated withGuardian wrap registers a durable executor at
 * module init, and executeApprovedToolAsync re-dispatches from the DB
 * row's (toolId, payload) when the in-memory entry is gone.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/tools/tool-policy", () => ({
  evaluateToolAction: () => ({
    decision: "allow",
    riskClass: "low",
    reason: "mocked",
  }),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    approvalRequest: {
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// executeApprovedToolAsync dynamically imports the tools module to trigger
// wrap-time registration; stub it so tests don't load the real tool tree.
vi.mock("@/lib/ai/tools", () => ({ nourTools: {} }));

import {
  withGuardian,
  durableToolExecutors,
  pendingExecutions,
  executeApprovedToolAsync,
} from "@/lib/tools/guardian";

beforeEach(() => {
  vi.clearAllMocks();
  pendingExecutions.clear();
  durableToolExecutors.clear();
});

describe("durableToolExecutors · wrap-time registration", () => {
  it("registers policy-gated wraps under their toolId", () => {
    const fn = vi.fn(async () => "ok");
    withGuardian("test.durable_reg", fn);
    expect(durableToolExecutors.has("test.durable_reg")).toBe(true);
  });

  it("does NOT register reliabilityOnly sub-ops", () => {
    const fn = vi.fn(async () => "ok");
    withGuardian("internal-sub-op", fn, { reliabilityOnly: true });
    expect(durableToolExecutors.has("internal-sub-op")).toBe(false);
  });
});

describe("executeApprovedToolAsync · restart survival", () => {
  it("re-dispatches from the DB payload via the durable registry when pendingExecutions is empty", async () => {
    const inner = vi.fn(async (payload: unknown) => ({ sent: true, got: payload }));
    withGuardian("test.restart_tool", inner);
    // Simulate pod restart: request row exists, in-memory map is empty.
    prismaMock.approvalRequest.findUnique.mockResolvedValue({
      id: "req-restart",
      toolId: "test.restart_tool",
      payload: { to: "customer", body: "hello" },
    });

    await executeApprovedToolAsync("req-restart");

    expect(inner).toHaveBeenCalledWith({ to: "customer", body: "hello" });
    const finalUpdate = prismaMock.approvalRequest.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate?.data?.status).toBe("executed");
    expect(finalUpdate?.data?.resultPayload).toEqual({
      sent: true,
      got: { to: "customer", body: "hello" },
    });
  });

  it("prefers the exact in-memory closure when it survived", async () => {
    const durableInner = vi.fn(async () => "durable");
    withGuardian("test.precedence_tool", durableInner);
    const originalFn = vi.fn(async () => "original-closure");
    pendingExecutions.set("req-live", { fn: originalFn, args: [{ a: 1 }] });
    prismaMock.approvalRequest.findUnique.mockResolvedValue({
      id: "req-live",
      toolId: "test.precedence_tool",
      payload: { a: 1 },
    });

    await executeApprovedToolAsync("req-live");

    expect(originalFn).toHaveBeenCalledWith({ a: 1 });
    expect(durableInner).not.toHaveBeenCalled();
  });

  it("marks the request failed when no executor exists anywhere", async () => {
    prismaMock.approvalRequest.findUnique.mockResolvedValue({
      id: "req-orphan",
      toolId: "tool.never_registered",
      payload: {},
    });

    await executeApprovedToolAsync("req-orphan");

    const finalUpdate = prismaMock.approvalRequest.update.mock.calls.at(-1)?.[0];
    expect(finalUpdate?.data?.status).toBe("failed");
    expect(String((finalUpdate?.data?.resultPayload as { error?: string })?.error)).toContain(
      "No execution function found",
    );
  });
});
