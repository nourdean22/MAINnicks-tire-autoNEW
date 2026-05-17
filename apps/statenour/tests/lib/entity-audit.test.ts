/**
 * Unit tests for lib/db/entity-audit.ts
 *
 * v8.0 · B5.6 · Apr 29 — Phase 2A — covers:
 *   · diffData: shallow JSON-safe diff w/ null/Date semantics
 *   · stripNoise: drops audit-irrelevant timestamp keys
 *   · recordAudit: writes a row, captures actor, swallows P2002 races
 *   · logCreate / logUpdate / logSoftDelete / logRestore / logPurge:
 *     convenience constructors + idempotency-aware no-op on no-diff
 *   · getEntityHistory / getActorActivity: read paths
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted bridge so the prisma mock factory can reach the spies.
const mocks = vi.hoisted(() => ({
  entityAudit: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  currentActor: vi.fn(() => "user"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { entityAudit: mocks.entityAudit },
}));

vi.mock("@/lib/db/actor", () => ({
  currentActor: () => mocks.currentActor(),
}));

import {
  diffData,
  stripNoise,
  recordAudit,
  logCreate,
  logUpdate,
  logSoftDelete,
  logRestore,
  logPurge,
  getEntityHistory,
  getActorActivity,
} from "@/lib/db/entity-audit";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentActor.mockReturnValue("user");
  mocks.entityAudit.create.mockResolvedValue({ id: "a1" });
  mocks.entityAudit.findMany.mockResolvedValue([]);
});

// ─────────────────────────────────────────────────────────────────
// DIFF
// ─────────────────────────────────────────────────────────────────

describe("diffData", () => {
  it("returns empty diff when inputs are identical", () => {
    const r = diffData({ a: 1, b: 2 }, { a: 1, b: 2 });
    expect(r.changedKeys).toEqual([]);
    expect(r.beforeDiff).toEqual({});
    expect(r.afterDiff).toEqual({});
  });

  it("captures only changed keys", () => {
    const r = diffData({ a: 1, b: 2, c: 3 }, { a: 1, b: 99, c: 3 });
    expect(r.changedKeys).toEqual(["b"]);
    expect(r.beforeDiff).toEqual({ b: 2 });
    expect(r.afterDiff).toEqual({ b: 99 });
  });

  it("treats null and undefined as equivalent (DB nullable round-trip)", () => {
    const r = diffData({ a: null }, { a: undefined });
    expect(r.changedKeys).toEqual([]);
  });

  it("notices added keys (in after, not before)", () => {
    const r = diffData({ a: 1 }, { a: 1, b: 2 });
    expect(r.changedKeys).toEqual(["b"]);
    expect(r.beforeDiff).toEqual({ b: null });
    expect(r.afterDiff).toEqual({ b: 2 });
  });

  it("notices removed keys (in before, not after)", () => {
    const r = diffData({ a: 1, b: 2 }, { a: 1 });
    expect(r.changedKeys).toEqual(["b"]);
    expect(r.beforeDiff).toEqual({ b: 2 });
    expect(r.afterDiff).toEqual({ b: null });
  });

  it("compares Dates by getTime", () => {
    const d1 = new Date("2026-04-29");
    const d2 = new Date("2026-04-29");
    const d3 = new Date("2026-04-30");
    expect(diffData({ at: d1 }, { at: d2 }).changedKeys).toEqual([]);
    expect(diffData({ at: d1 }, { at: d3 }).changedKeys).toEqual(["at"]);
  });

  it("structural-compares arrays + objects", () => {
    expect(diffData({ a: [1, 2] }, { a: [1, 2] }).changedKeys).toEqual([]);
    expect(diffData({ a: [1, 2] }, { a: [1, 3] }).changedKeys).toEqual(["a"]);
    expect(diffData({ a: { x: 1 } }, { a: { x: 1 } }).changedKeys).toEqual([]);
    expect(diffData({ a: { x: 1 } }, { a: { x: 2 } }).changedKeys).toEqual(["a"]);
  });

  it("handles null/undefined inputs gracefully", () => {
    expect(diffData(null, null).changedKeys).toEqual([]);
    expect(diffData(undefined, undefined).changedKeys).toEqual([]);
    expect(diffData(null, { a: 1 }).changedKeys).toEqual(["a"]);
  });
});

// ─────────────────────────────────────────────────────────────────
// STRIP NOISE
// ─────────────────────────────────────────────────────────────────

describe("stripNoise", () => {
  it("removes timestamp keys that flip every save", () => {
    const out = stripNoise({
      id: "x",
      title: "y",
      updatedAt: new Date(),
      createdAt: new Date(),
      lastSeen: new Date(),
    });
    expect(out).toEqual({ id: "x", title: "y" });
  });

  it("keeps every other field including nulls", () => {
    const out = stripNoise({ id: "x", note: null, count: 0, flag: false });
    expect(out).toEqual({ id: "x", note: null, count: 0, flag: false });
  });
});

// ─────────────────────────────────────────────────────────────────
// RECORD AUDIT
// ─────────────────────────────────────────────────────────────────

describe("recordAudit", () => {
  it("writes a row with the active actor", async () => {
    mocks.currentActor.mockReturnValue("nick");
    const ok = await recordAudit({
      entityType: "task",
      entityId: "t1",
      action: "updated",
      before: { title: "A" },
      after: { title: "B" },
      reason: "Nick reframed it",
      source: "service:updateTask",
    });
    expect(ok).toBe(true);
    expect(mocks.entityAudit.create).toHaveBeenCalledOnce();
    const arg = mocks.entityAudit.create.mock.calls[0][0];
    expect(arg.data.entityType).toBe("task");
    expect(arg.data.entityId).toBe("t1");
    expect(arg.data.action).toBe("updated");
    expect(arg.data.actor).toBe("nick");
    expect(arg.data.reason).toBe("Nick reframed it");
    expect(arg.data.idempotencyKey).toMatch(/^idem-/);
  });

  it("respects an explicit actor override", async () => {
    await recordAudit({
      entityType: "task",
      entityId: "t1",
      action: "soft_deleted",
      actor: "cron:weekly-review",
    });
    const arg = mocks.entityAudit.create.mock.calls[0][0];
    expect(arg.data.actor).toBe("cron:weekly-review");
  });

  it("swallows P2002 unique-violation races silently", async () => {
    const err = Object.assign(new Error("dup"), { code: "P2002" });
    mocks.entityAudit.create.mockRejectedValueOnce(err);
    const ok = await recordAudit({
      entityType: "task",
      entityId: "t1",
      action: "created",
    });
    expect(ok).toBe(true); // P2002 is a no-op success
  });

  it("returns false on unexpected errors but never throws", async () => {
    mocks.entityAudit.create.mockRejectedValueOnce(new Error("db is down"));
    const ok = await recordAudit({
      entityType: "task",
      entityId: "t1",
      action: "created",
    });
    expect(ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// CONVENIENCE CONSTRUCTORS
// ─────────────────────────────────────────────────────────────────

describe("logCreate", () => {
  it("logs action=created with `after` only", async () => {
    await logCreate("mission", "m1", { title: "Build the cave" });
    const arg = mocks.entityAudit.create.mock.calls[0][0];
    expect(arg.data.action).toBe("created");
    expect(arg.data.after).toEqual({ title: "Build the cave" });
    expect(arg.data.before).toBeUndefined();
  });
});

describe("logUpdate", () => {
  it("emits when there's a real diff", async () => {
    await logUpdate("task", "t1", { title: "A", status: "INBOX" }, { title: "B", status: "INBOX" });
    expect(mocks.entityAudit.create).toHaveBeenCalledOnce();
    const arg = mocks.entityAudit.create.mock.calls[0][0];
    expect(arg.data.action).toBe("updated");
    expect(arg.data.before).toEqual({ title: "A" }); // diff only
    expect(arg.data.after).toEqual({ title: "B" });
  });

  it("skips when before === after (no audit churn on idempotent update)", async () => {
    const ok = await logUpdate("task", "t1", { title: "A" }, { title: "A" });
    expect(ok).toBe(false);
    expect(mocks.entityAudit.create).not.toHaveBeenCalled();
  });
});

describe("logSoftDelete / logRestore / logPurge", () => {
  it("logSoftDelete writes action=soft_deleted with no diff", async () => {
    await logSoftDelete("brainMemory", "b1", { source: "lib/db/soft-delete" });
    const arg = mocks.entityAudit.create.mock.calls[0][0];
    expect(arg.data.action).toBe("soft_deleted");
    expect(arg.data.before).toBeUndefined();
    expect(arg.data.after).toBeUndefined();
    expect(arg.data.source).toBe("lib/db/soft-delete");
  });

  it("logRestore writes action=restored", async () => {
    await logRestore("brainMemory", "b1");
    expect(mocks.entityAudit.create.mock.calls[0][0].data.action).toBe("restored");
  });

  it("logPurge writes action=purged", async () => {
    await logPurge("brainMemory", "b1");
    expect(mocks.entityAudit.create.mock.calls[0][0].data.action).toBe("purged");
  });
});

// ─────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────

describe("getEntityHistory", () => {
  it("queries with default limit + descending createdAt", async () => {
    await getEntityHistory("task", "t1");
    const arg = mocks.entityAudit.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ entityType: "task", entityId: "t1" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.take).toBe(50);
    expect(arg.skip).toBe(0);
  });

  it("clamps limit to [1, 500]", async () => {
    await getEntityHistory("task", "t1", { limit: 9999 });
    expect(mocks.entityAudit.findMany.mock.calls[0][0].take).toBe(500);

    mocks.entityAudit.findMany.mockClear();
    await getEntityHistory("task", "t1", { limit: 0 });
    expect(mocks.entityAudit.findMany.mock.calls[0][0].take).toBe(1);
  });

  it("merges optional filters", async () => {
    const since = new Date("2026-04-28");
    await getEntityHistory("task", "t1", {
      since,
      actor: "nick",
      action: "updated",
    });
    const where = mocks.entityAudit.findMany.mock.calls[0][0].where;
    expect(where.entityType).toBe("task");
    expect(where.entityId).toBe("t1");
    expect(where.actor).toBe("nick");
    expect(where.action).toBe("updated");
    expect(where.createdAt).toEqual({ gte: since });
  });
});

describe("getActorActivity", () => {
  it("queries by actor with default limit 50", async () => {
    await getActorActivity("nick");
    const arg = mocks.entityAudit.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ actor: "nick" });
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.take).toBe(50);
  });

  it("respects since filter", async () => {
    const since = new Date("2026-04-29");
    await getActorActivity("cron:brain-cycle", { since });
    expect(mocks.entityAudit.findMany.mock.calls[0][0].where).toEqual({
      actor: "cron:brain-cycle",
      createdAt: { gte: since },
    });
  });
});
