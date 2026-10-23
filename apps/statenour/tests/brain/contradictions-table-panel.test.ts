/**
 * The real contradictions reach the /brain panel (2026-10-23).
 *
 * The panel read only BrainMemory category "contradiction" (0 rows, all time)
 * while the thinking engine's `contradictions` TABLE held the real rows (631
 * ever, 0 closed by Nour). listStoredContradictions now returns table rows too,
 * keyed `tbl:<id>`, and resolveStoredContradiction closes them with a
 * compare-and-swap on resolved=false (claim-before-act). Fixtures are made up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  contradiction: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  surfacer: {
    loadRecentContradictions: vi.fn(),
    loadAllContradictions: vi.fn(),
    resolveContradiction: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { contradiction: h.contradiction } }));
vi.mock("@/lib/brain/contradiction-surfacer", () => ({
  loadRecentContradictions: h.surfacer.loadRecentContradictions,
  loadAllContradictions: h.surfacer.loadAllContradictions,
  resolveContradiction: h.surfacer.resolveContradiction,
  countUnresolved: vi.fn(),
  countContradictionsByStatus: vi.fn(),
}));

import { listStoredContradictions, resolveStoredContradiction } from "@/lib/services/contradictions";

function tableRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ck_open_1",
    date: "2026-10-20",
    claim: "I water the plants every morning",
    reality: "The garden log has two entries in ten days",
    gap: "Stated daily, logged twice",
    category: "habit",
    severity: "moderate",
    resolved: false,
    resolvedHow: null,
    createdAt: new Date("2026-10-20T12:00:00Z"),
    updatedAt: new Date("2026-10-20T12:00:00Z"),
    ...overrides,
  };
}

const MEMORY_ROW = {
  key: "abc123",
  new_memory_id: "m2",
  old_memory_id: "m1",
  similarity: 0.81,
  signal: "negation",
  new_excerpt: "I no longer drink coffee",
  old_excerpt: "I drink coffee every day",
  days_apart: 9,
  surfaced_at: "2026-10-20T00:00:00.000Z",
  createdAt: "2026-10-20T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  h.surfacer.loadRecentContradictions.mockResolvedValue([MEMORY_ROW]);
  h.surfacer.loadAllContradictions.mockResolvedValue([MEMORY_ROW]);
});

describe("listStoredContradictions · table rows reach the panel", () => {
  it("returns the table's open rows keyed tbl:<id> beside the memory rows", async () => {
    h.contradiction.findMany.mockResolvedValue([tableRow()]);

    const { contradictions } = await listStoredContradictions({ includeResolved: false });

    const table = contradictions.find((c) => c.key === "tbl:ck_open_1");
    expect(table, "the table row is missing from the panel list").toBeDefined();
    expect(table).toMatchObject({
      source: "table",
      status: "unresolved",
      new_excerpt: "I water the plants every morning",
      old_excerpt: "The garden log has two entries in ten days",
      category: "habit",
    });
    // The memory rows are still there, tagged.
    expect(contradictions.find((c) => c.key === "abc123")).toMatchObject({ source: "memory" });
    // Unresolved tab reads open rows only.
    const where = h.contradiction.findMany.mock.calls[0][0].where;
    expect(where.resolved).toBe(false);
    expect(where.deletedAt).toBeNull();
  });

  it("history maps resolvedHow back onto the panel's statuses", async () => {
    h.contradiction.findMany.mockResolvedValue([
      tableRow({ id: "r1", resolved: true, resolvedHow: "true" }),
      tableRow({ id: "r2", resolved: true, resolvedHow: "outdated" }),
      tableRow({ id: "r3", resolved: true, resolvedHow: "ignore" }),
      tableRow({ id: "r4", resolved: true, resolvedHow: "Auto-resolved after 30 days without action" }),
    ]);

    const { contradictions } = await listStoredContradictions({ includeResolved: true });
    const byKey = Object.fromEntries(contradictions.map((c) => [c.key, c]));

    expect(byKey["tbl:r1"].status).toBe("current_wins");
    expect(byKey["tbl:r2"].status).toBe("old_wins");
    expect(byKey["tbl:r3"].status).toBe("dismissed");
    // An auto-expiry is closed but was not Nour's answer: it shows as closed with its own words.
    expect(byKey["tbl:r4"].status).not.toBe("unresolved");
    expect(byKey["tbl:r4"].resolution_note).toContain("Auto-resolved");
  });

  it("a FAILED table read rejects (the panel renders ERROR), never an empty list", async () => {
    h.contradiction.findMany.mockRejectedValue(new Error("connection reset"));
    await expect(listStoredContradictions({ includeResolved: false })).rejects.toThrow(/connection reset/);
  });
});

describe("resolveStoredContradiction · tbl: keys close the table row", () => {
  it.each([
    ["current_wins", "true"],
    ["old_wins", "outdated"],
    ["both_valid", "outdated"],
    ["dismissed", "ignore"],
  ] as const)("%s writes resolvedHow=%s with a compare-and-swap on resolved=false", async (status, how) => {
    h.contradiction.updateMany.mockResolvedValue({ count: 1 });
    h.contradiction.findFirst.mockResolvedValue(tableRow({ resolved: true, resolvedHow: how }));

    const out = await resolveStoredContradiction({ key: "tbl:ck_open_1", status });

    expect(h.contradiction.updateMany).toHaveBeenCalledTimes(1);
    const arg = h.contradiction.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({ id: "ck_open_1", resolved: false, deletedAt: null });
    expect(arg.data).toEqual({ resolved: true, resolvedHow: how });
    expect(out.contradiction.key).toBe("tbl:ck_open_1");
    expect(out.contradiction.status).not.toBe("unresolved");
    // The memory path is not touched for a table key.
    expect(h.surfacer.resolveContradiction).not.toHaveBeenCalled();
    // No unconditional write by id.
    expect(h.contradiction.update).not.toHaveBeenCalled();
  });

  it("a row someone already closed returns as is: no second write, alreadyResolved", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue(tableRow({ resolved: true, resolvedHow: "ignore" }));

    const out = await resolveStoredContradiction({ key: "tbl:ck_open_1", status: "current_wins" });

    expect(out.alreadyResolved).toBe(true);
    expect(out.contradiction.status).toBe("dismissed");
    expect(h.contradiction.update).not.toHaveBeenCalled();
  });

  it("a missing table row is a 404", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue(null);
    await expect(resolveStoredContradiction({ key: "tbl:nope", status: "dismissed" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("CONTROL · a memory key still goes to the surfacer", async () => {
    h.surfacer.resolveContradiction.mockResolvedValue({ ...MEMORY_ROW, status: "dismissed" });
    await resolveStoredContradiction({ key: "abc123", status: "dismissed" });
    expect(h.surfacer.resolveContradiction).toHaveBeenCalledWith("abc123", "dismissed", undefined);
    expect(h.contradiction.updateMany).not.toHaveBeenCalled();
  });
});
