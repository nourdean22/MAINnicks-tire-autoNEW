/**
 * brain.resolveContradiction maps the service's 400 (both_valid on a claim-vs-record
 * row) to BAD_REQUEST, not INTERNAL_SERVER_ERROR: the caller sent a wrong answer,
 * the server did not break. Driven through the REAL service, which refuses both_valid
 * before any database call; the control is a missing row, still NOT_FOUND.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  contradiction: { updateMany: vi.fn(), findFirst: vi.fn() },
}));

// Same harness as tests/trpc/ensure-learn-card.test.ts: flags resolved, an audit sink present.
vi.mock("@/lib/feature-flags", () => ({
  getFlag: () => null,
  FLAG_REGISTRY: [],
  getAllFlags: () => [],
  loadFeatureFlagOverrides: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { contradiction: h.contradiction, auditEvent: { create: vi.fn().mockResolvedValue({}) } },
}));

import { brainRouter } from "@/lib/trpc/routers/brain";

const caller = brainRouter.createCaller({
  session: { id: "op", email: "op@statenour.local", role: "owner" },
} as never);

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "resolved";
  } catch (err) {
    return String((err as { code?: unknown }).code);
  }
}

beforeEach(() => {
  h.contradiction.updateMany.mockReset().mockResolvedValue({ count: 0 });
  h.contradiction.findFirst.mockReset().mockResolvedValue(null);
});

describe("brain.resolveContradiction error codes", () => {
  it("both_valid on a table row is BAD_REQUEST, and nothing is written", async () => {
    expect(await codeOf(caller.resolveContradiction({ key: "tbl:x", status: "both_valid" }))).toBe("BAD_REQUEST");
    expect(h.contradiction.updateMany).not.toHaveBeenCalled();
  });

  it("CONTROL · a missing table row is still NOT_FOUND", async () => {
    expect(await codeOf(caller.resolveContradiction({ key: "tbl:x", status: "dismissed" }))).toBe("NOT_FOUND");
  });
});
