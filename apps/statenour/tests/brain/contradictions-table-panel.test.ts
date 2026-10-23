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
  contradiction: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { contradiction: h.contradiction } }));
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
    claimSource: "ai_detected",
    resolved: false,
    resolvedHow: null,
    createdAt: new Date("2026-10-20T12:00:00Z"),
    updatedAt: new Date("2026-10-20T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  h.contradiction.count.mockResolvedValue(1);
});

describe("listStoredContradictions · table rows reach the panel", () => {
  it("returns the table's open rows keyed tbl:<id>", async () => {
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
      // Provenance travels: an AI-inferred claim must not be labelled as his words.
      claim_source: "ai_detected",
    });
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
    // An auto-expiry is closed but was NOT Nour's answer: its own status, never "dismissed" (his ignore).
    expect(byKey["tbl:r4"].status).toBe("expired");
    expect(byKey["tbl:r4"].resolution_note).toContain("Auto-resolved");
  });

  it("history queries RESOLVED rows directly, so 60+ open rows cannot crowd them out", async () => {
    h.contradiction.findMany.mockResolvedValue([]);
    await listStoredContradictions({ includeResolved: true });
    const arg = h.contradiction.findMany.mock.calls[0][0];
    expect(arg.where.resolved).toBe(true);
    expect(arg.where.deletedAt).toBeNull();
  });

  it("the open list is not capped at 60, and any cap comes with its total (80 open, all returned)", async () => {
    const eighty = Array.from({ length: 80 }, (_, i) => tableRow({ id: `o${i}` }));
    h.contradiction.findMany.mockResolvedValue(eighty);
    h.contradiction.count.mockResolvedValue(80);

    const out = await listStoredContradictions({ includeResolved: false });

    const take = h.contradiction.findMany.mock.calls[0][0].take;
    expect(take === undefined || take >= 80, `open rows capped at ${take}`).toBe(true);
    expect(out.contradictions.filter((c) => c.source === "table")).toHaveLength(80);
    expect(out.table).toEqual({ total: 80, shown: 80 });
    // The count reads the same population as the list.
    expect(h.contradiction.count.mock.calls[0][0].where).toMatchObject({ resolved: false, deletedAt: null });
  });

  it("history is a capped page that SAYS so: shown vs total", async () => {
    h.contradiction.findMany.mockResolvedValue([tableRow({ id: "r1", resolved: true, resolvedHow: "ignore" })]);
    h.contradiction.count.mockResolvedValue(555);
    const out = await listStoredContradictions({ includeResolved: true });
    expect(out.table).toEqual({ total: 555, shown: 1 });
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

  it("answering a row the 30-day expiry already closed reports expired, not ignore", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue(
      tableRow({ resolved: true, resolvedHow: "Auto-resolved after 30 days without action" }),
    );
    const out = await resolveStoredContradiction({ key: "tbl:ck_open_1", status: "old_wins" });
    expect(out.alreadyResolved).toBe(true);
    expect(out.contradiction.status).toBe("expired");
  });

  it("both_valid is not one of the three answers: a 400, and nothing is written", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 1 });
    h.contradiction.findFirst.mockResolvedValue(tableRow());
    await expect(resolveStoredContradiction({ key: "tbl:ck_open_1", status: "both_valid" })).rejects.toMatchObject({
      status: 400,
    });
    expect(h.contradiction.updateMany).not.toHaveBeenCalled();
  });

  it("a missing table row is a 404", async () => {
    h.contradiction.updateMany.mockResolvedValue({ count: 0 });
    h.contradiction.findFirst.mockResolvedValue(null);
    await expect(resolveStoredContradiction({ key: "tbl:nope", status: "dismissed" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("a key without the tbl: prefix is a 404 and writes nothing (the BrainMemory path is gone)", async () => {
    await expect(resolveStoredContradiction({ key: "abc123", status: "dismissed" })).rejects.toMatchObject({ status: 404 });
    expect(h.contradiction.updateMany).not.toHaveBeenCalled();
    expect(h.contradiction.findFirst).not.toHaveBeenCalled();
  });
});
