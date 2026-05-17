/**
 * v10 Track B.3 · Reflection idempotency contract.
 *
 * v9.1.24 wired runDailyReflection + runWeeklyReflection through
 * idempotentCreate using the {date, scope, category} recipe. If the
 * cron fires twice on the same date (restart, retry, flap), the
 * second run should NOT create duplicate Reflection rows.
 *
 * The full reflection-engine flow is heavy (Venice call + DB).
 * Instead we test the recipe + idempotentCreate semantics directly,
 * which is the contract the wire-up depends on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    reflection: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  idempotencyRecipe,
  idempotentCreate,
} from "@/lib/db/idempotency";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v10 B.3 · reflection idempotency contract (v9.1.24)", () => {
  it("recipe.reflection produces stable keys for same {date, scope, category}", () => {
    const k1 = idempotencyRecipe.reflection({
      date: "2026-04-30",
      scope: "daily",
      category: "behavior",
    });
    const k2 = idempotencyRecipe.reflection({
      date: "2026-04-30",
      scope: "daily",
      category: "behavior",
    });
    expect(k1).toBe(k2); // same inputs → same key
  });

  it("recipe.reflection differs when scope differs (daily vs weekly)", () => {
    const daily = idempotencyRecipe.reflection({
      date: "2026-04-30",
      scope: "daily",
      category: "business",
    });
    const weekly = idempotencyRecipe.reflection({
      date: "2026-04-30",
      scope: "weekly",
      category: "business",
    });
    expect(daily).not.toBe(weekly);
  });

  it("recipe.reflection differs when category differs", () => {
    const a = idempotencyRecipe.reflection({
      date: "2026-04-30",
      scope: "daily",
      category: "business",
    });
    const b = idempotencyRecipe.reflection({
      date: "2026-04-30",
      scope: "daily",
      category: "behavior",
    });
    expect(a).not.toBe(b);
  });

  it("idempotentCreate · second call with same key returns existing row, created=false", async () => {
    const existing = {
      id: "r1",
      date: "2026-04-30",
      scope: "daily",
      category: "business",
      idempotencyKey: "stable-key",
    };
    // First call: no existing row → create.
    vi.mocked(prisma.reflection.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.reflection.create).mockResolvedValueOnce(
      existing as never,
    );

    const r1 = await idempotentCreate({
      model: prisma.reflection,
      key: "stable-key",
      data: {
        date: "2026-04-30",
        scope: "daily",
        category: "business",
        insight: "test",
        evidence: "test",
        confidence: 0.7,
        actionable: true,
        idempotencyKey: "stable-key",
      } as never,
    });
    expect(r1.created).toBe(true);
    expect(prisma.reflection.create).toHaveBeenCalledTimes(1);

    // Second call: existing row found → no create, returned as-is.
    vi.mocked(prisma.reflection.findFirst).mockResolvedValueOnce(
      existing as never,
    );

    const r2 = await idempotentCreate({
      model: prisma.reflection,
      key: "stable-key",
      data: {
        date: "2026-04-30",
        scope: "daily",
        category: "business",
        insight: "second attempt",
        evidence: "second",
        confidence: 0.7,
        actionable: true,
        idempotencyKey: "stable-key",
      } as never,
    });
    expect(r2.created).toBe(false);
    expect(r2.row).toEqual(existing);
    // create was NOT called a second time — that's the dedup contract.
    expect(prisma.reflection.create).toHaveBeenCalledTimes(1);
  });

  it("v9.1.24 caller wire-up · runDaily must mint a key BEFORE create", () => {
    // This is a documentation-as-code test. The v9.1.24 fix moved
    // reflection.create() to go through idempotentCreate. If anyone
    // re-introduces a raw prisma.reflection.create() call without a
    // mint, the cron double-fire will create duplicates again.
    //
    // Lightweight pin: verify the recipe export still exists and is
    // a function. If the recipe is renamed or removed, this fails
    // first — the operator knows to update the wire-up.
    expect(typeof idempotencyRecipe.reflection).toBe("function");
  });
});
