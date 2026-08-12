/**
 * computePromiseIntegrity vocabulary-mismatch regression (2026-08-12).
 *
 * The kept-filter recognized only "kept"/"done"/"fulfilled" — status
 * strings NOTHING in this codebase ever writes. The two live completion
 * paths (completeCommitment chat tool → "completed"; verifyCommitment
 * service → "verified") were invisible to it. Prod evidence the same
 * day: 7 completed + 1 verified vs 1 broken, yet the axis read
 * `"0 kept · 1 broken"` — a promise_integrity score mathematically
 * forced to 0 regardless of actual follow-through. This pins the fix
 * and locks the "abandoned never counts as broken" design choice
 * (declined machine-proposed commitments shouldn't penalize the
 * operator's own follow-through).
 */
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { commitment: { findMany: (...args: unknown[]) => mocks.findMany(...args) } },
}));

import { computePromiseIntegrity } from "@/lib/brain/identity-snapshot";

describe("computePromiseIntegrity — status vocabulary", () => {
  it("recognizes 'completed' (the completeCommitment chat tool's status) as kept", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { status: "completed" }, { status: "completed" }, { status: "active" },
    ]);
    const result = await computePromiseIntegrity();
    expect(result.value).toBe(100);
    expect(result.evidence[0]).toContain("2 kept");
  });

  it("recognizes 'verified' (the blueprint verifyCommitment status) as kept", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { status: "verified" }, { status: "active" }, { status: "active" },
    ]);
    const result = await computePromiseIntegrity();
    expect(result.value).toBe(100);
  });

  it("reproduces the exact prod snapshot (7 completed, 1 verified, 1 broken → ~89, not 0)", async () => {
    const rows = [
      ...Array(7).fill({ status: "completed" }),
      { status: "verified" },
      { status: "broken" },
      ...Array(62).fill({ status: "active" }),
    ];
    mocks.findMany.mockResolvedValueOnce(rows);
    const result = await computePromiseIntegrity();
    // 8 kept / (8 kept + 1 broken) = 88.9%
    expect(result.value).toBeGreaterThan(85);
    expect(result.value).toBeLessThan(95);
    expect(result.evidence[0]).toBe("8 kept · 1 broken");
  });

  it("'abandoned' counts as neither kept nor broken (declined proposals must not penalize follow-through)", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { status: "completed" },
      { status: "abandoned" }, { status: "abandoned" }, { status: "abandoned" },
    ]);
    const result = await computePromiseIntegrity();
    // resolved = 1 kept + 0 broken → ratio 100, regardless of 3 abandoned rows
    expect(result.value).toBe(100);
    expect(result.evidence[0]).toBe("1 kept · 0 broken");
  });

  it("still recognizes legacy 'kept'/'done'/'fulfilled'/'missed' strings (no regression)", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { status: "kept" }, { status: "done" }, { status: "fulfilled" }, { status: "missed" },
    ]);
    const result = await computePromiseIntegrity();
    expect(result.evidence[0]).toBe("3 kept · 1 broken");
  });

  it("falls back to the neutral 60 when nothing has resolved yet", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { status: "active" }, { status: "active" }, { status: "active" },
    ]);
    const result = await computePromiseIntegrity();
    expect(result.value).toBe(60);
    expect(result.evidence[0]).toContain("none resolved yet");
  });

  it("falls back to 60 with too little data (<3 commitments in the 60d window)", async () => {
    mocks.findMany.mockResolvedValueOnce([{ status: "completed" }]);
    const result = await computePromiseIntegrity();
    expect(result.value).toBe(60);
  });
});
