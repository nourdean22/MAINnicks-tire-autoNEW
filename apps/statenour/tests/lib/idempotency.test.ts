/**
 * Unit tests for lib/db/idempotency.ts
 *
 * v7.7 · B2.4 · Apr 29 — pure-function helpers covering deterministic
 * key minting, time-bucketed shortcuts, and the upsert wrapper's
 * race-safety contract.
 */

import { describe, it, expect, vi } from "vitest";
import {
  mintIdempotencyKey,
  bucketedIdempotencyKey,
  idempotentCreate,
  idempotencyRecipe,
} from "@/lib/db/idempotency";

describe("mintIdempotencyKey", () => {
  it("returns a stable 32-char hex prefixed with 'idem-'", () => {
    const k = mintIdempotencyKey({ a: 1, b: "x" });
    expect(k).toMatch(/^idem-[a-f0-9]{32}$/);
  });

  it("is deterministic — same input → same key", () => {
    const a = mintIdempotencyKey({ ruleName: "r1", id: "x" });
    const b = mintIdempotencyKey({ ruleName: "r1", id: "x" });
    expect(a).toBe(b);
  });

  it("is order-independent over object keys", () => {
    const a = mintIdempotencyKey({ a: 1, b: 2 });
    const b = mintIdempotencyKey({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it("differs when input differs", () => {
    const a = mintIdempotencyKey({ id: "x" });
    const b = mintIdempotencyKey({ id: "y" });
    expect(a).not.toBe(b);
  });

  it("accepts plain string inputs too", () => {
    const k = mintIdempotencyKey("hello world");
    expect(k).toMatch(/^idem-[a-f0-9]{32}$/);
  });
});

describe("bucketedIdempotencyKey", () => {
  // 1700000000 sec = 5666666.666... × 300 = bucket starts at 5666666 × 300 = 1699999800.
  // So at base ts 1700000000000ms, the bucket spans 1699999800-1700000099 sec
  // (1699999800000-1700000099999 ms). Any t inside that range collides;
  // anything ≥ 1700000100000 ms is in the NEXT 300s bucket.

  it("collides within the same bucket", () => {
    const a = bucketedIdempotencyKey({ ruleName: "r" }, 300, 1700000000000);
    const b = bucketedIdempotencyKey({ ruleName: "r" }, 300, 1700000050000); // 50s later, same 300s bucket
    expect(a).toBe(b);
  });

  it("differs across buckets", () => {
    const a = bucketedIdempotencyKey({ ruleName: "r" }, 300, 1700000000000);
    const b = bucketedIdempotencyKey({ ruleName: "r" }, 300, 1700000300000); // 300s later, next bucket
    expect(a).not.toBe(b);
  });

  it("is exposed as mintIdempotencyKey.bucketed too", () => {
    const a = mintIdempotencyKey.bucketed({ ruleName: "r" }, 300, 1700000000000);
    const b = bucketedIdempotencyKey({ ruleName: "r" }, 300, 1700000000000);
    expect(a).toBe(b);
  });
});

describe("idempotencyRecipe", () => {
  it("autonomousAction recipe collides within bucket", () => {
    const original = Date.now;
    Date.now = () => 1700000000000;
    try {
      const a = idempotencyRecipe.autonomousAction({
        ruleName: "auto_followup",
        targetType: "quote",
        targetId: "qt-1",
        bucketSeconds: 21600,
      });
      const b = idempotencyRecipe.autonomousAction({
        ruleName: "auto_followup",
        targetType: "quote",
        targetId: "qt-1",
        bucketSeconds: 21600,
      });
      expect(a).toBe(b);
    } finally {
      Date.now = original;
    }
  });

  it("scheduledAction recipe stable on a fixed scheduledFor", () => {
    const at = new Date("2026-04-29T17:00:00Z");
    const a = idempotencyRecipe.scheduledAction({
      actionType: "remind",
      entityType: "task",
      entityId: "t-1",
      scheduledFor: at,
    });
    const b = idempotencyRecipe.scheduledAction({
      actionType: "remind",
      entityType: "task",
      entityId: "t-1",
      scheduledFor: at.toISOString(),
    });
    expect(a).toBe(b);
  });

  it("reflection recipe combines date + scope + category", () => {
    const a = idempotencyRecipe.reflection({
      date: "2026-04-29",
      scope: "daily",
      category: "behavior",
    });
    const b = idempotencyRecipe.reflection({
      date: "2026-04-29",
      scope: "daily",
      category: "business",
    });
    expect(a).not.toBe(b);
  });

  it("decisionReplay recipe handles null decisionId", () => {
    const a = idempotencyRecipe.decisionReplay({
      decisionId: null,
      reviewAt: new Date("2026-04-30"),
    });
    expect(a).toMatch(/^idem-[a-f0-9]{32}$/);
  });
});

describe("idempotentCreate", () => {
  // Mock model: in-memory Map of idempotencyKey → row
  function makeMockModel<TRow extends { idempotencyKey: string }>() {
    const store = new Map<string, TRow>();
    let createCallCount = 0;

    const model = {
      findFirst: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        return store.get(where.idempotencyKey) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: TRow }) => {
        createCallCount++;
        if (store.has(data.idempotencyKey)) {
          // simulate Prisma P2002 unique-violation
          const err = new Error("Unique constraint failed");
          (err as { code?: string }).code = "P2002";
          throw err;
        }
        store.set(data.idempotencyKey, data);
        return data;
      }),
    };

    return { model, store, getCreateCallCount: () => createCallCount };
  }

  it("inserts on first call, returns existing on second", async () => {
    const { model } = makeMockModel<{ idempotencyKey: string; name: string }>();
    const key = mintIdempotencyKey({ x: 1 });

    const first = await idempotentCreate({
      model,
      key,
      data: { idempotencyKey: key, name: "first" },
    });
    expect(first.created).toBe(true);
    expect(first.row.name).toBe("first");

    const second = await idempotentCreate({
      model,
      key,
      data: { idempotencyKey: key, name: "second-attempt" },
    });
    expect(second.created).toBe(false);
    expect(second.row.name).toBe("first"); // original wins
  });

  it("recovers from P2002 race (concurrent insert)", async () => {
    const { model, store } = makeMockModel<{ idempotencyKey: string; name: string }>();
    const key = mintIdempotencyKey({ y: 1 });

    // Pre-seed AS IF a concurrent insert just landed
    store.set(key, { idempotencyKey: key, name: "winner" });

    // Override findFirst to return null on the FIRST call (so we hit
    // create) — second call (after P2002) returns the winner.
    let calls = 0;
    model.findFirst = vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
      calls++;
      if (calls === 1) return null;
      return store.get(where.idempotencyKey) ?? null;
    });

    const result = await idempotentCreate({
      model,
      key,
      data: { idempotencyKey: key, name: "loser" },
    });
    expect(result.created).toBe(false);
    expect(result.row.name).toBe("winner");
  });

  it("throws when caller forgets to thread the key into data", async () => {
    const { model } = makeMockModel<{ idempotencyKey: string }>();
    const key = mintIdempotencyKey({ z: 1 });
    await expect(
      idempotentCreate({
        model,
        key,
        data: { idempotencyKey: "DIFFERENT" } as { idempotencyKey: string },
      }),
    ).rejects.toThrow(/data.idempotencyKey must equal/);
  });
});
