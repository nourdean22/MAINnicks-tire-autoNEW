/**
 * completeActiveCommitment / abandonActiveCommitment (2026-08-12) — the
 * resolve path the pulse ticker's Done/Drop buttons call. Both are
 * status-guarded updateMany (0 or 1 rows), matching the idempotent
 * pattern the rest of commitments.ts already uses (acceptCommitment,
 * verifyCommitment, dismissProposed) — a second tap, or a race with the
 * completeCommitment chat tool, is a silent no-op, never a P2025 throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { commitment: { updateMany: (...args: unknown[]) => mocks.updateMany(...args) } },
}));

import { completeActiveCommitment, abandonActiveCommitment } from "@/lib/services/commitments";

beforeEach(() => {
  mocks.updateMany.mockReset();
});

describe("completeActiveCommitment", () => {
  it("returns true and writes status 'completed' — the SAME status the chat tool writes", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await completeActiveCommitment(320);
    expect(ok).toBe(true);
    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 320, status: "active", deletedAt: null });
    expect(call.data.status).toBe("completed");
  });

  it("returns false on a no-op match (already resolved / wrong id) — never throws", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(completeActiveCommitment(999)).resolves.toBe(false);
  });
});

describe("abandonActiveCommitment", () => {
  it("returns true and writes status 'abandoned'", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const ok = await abandonActiveCommitment(324);
    expect(ok).toBe(true);
    const call = mocks.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 324, status: "active", deletedAt: null });
    expect(call.data.status).toBe("abandoned");
  });

  it("only ever targets status:'active' rows — cannot resolve a proposed/already-resolved commitment", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const ok = await abandonActiveCommitment(1);
    expect(ok).toBe(false);
    expect(mocks.updateMany.mock.calls[0][0].where.status).toBe("active");
  });
});
