/**
 * The open-contradiction count is ONE number (2026-10-23, brain plan item 3).
 *
 * Home and the ticker show "N open contradictions" as a count chip, never row
 * text. The count must be the panel's own open total (same `where` on the
 * `contradictions` table), and a failed read must reject: the chips turn that
 * into their unknown state, never into a 0 (empty-vs-error). Fixtures are made up.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  contradiction: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: { contradiction: h.contradiction } }));
const surfacer = vi.hoisted(() => ({ loadRecentContradictions: vi.fn(), loadAllContradictions: vi.fn() }));
vi.mock("@/lib/brain/contradiction-surfacer", () => ({
  loadRecentContradictions: surfacer.loadRecentContradictions,
  loadAllContradictions: surfacer.loadAllContradictions,
  resolveContradiction: vi.fn(),
  countUnresolved: vi.fn(),
  countContradictionsByStatus: vi.fn(),
}));

import { countUnresolvedContradictions, listStoredContradictions } from "@/lib/services/contradictions";

beforeEach(() => {
  vi.resetAllMocks();
  h.contradiction.findMany.mockResolvedValue([]);
  surfacer.loadRecentContradictions.mockResolvedValue([]);
  surfacer.loadAllContradictions.mockResolvedValue([]);
});

describe("countUnresolvedContradictions", () => {
  it("returns the table's open total", async () => {
    h.contradiction.count.mockResolvedValue(80);
    expect(await countUnresolvedContradictions()).toBe(80);
  });

  it("counts with the SAME where the panel's open list totals with", async () => {
    h.contradiction.count.mockResolvedValue(3);
    await listStoredContradictions({ includeResolved: false });
    const panelWhere = h.contradiction.count.mock.calls[0][0].where;
    h.contradiction.count.mockClear();

    await countUnresolvedContradictions();
    expect(h.contradiction.count.mock.calls[0][0].where).toEqual(panelWhere);
    expect(panelWhere).toEqual({ deletedAt: null, resolved: false });
  });

  it("rejects when the read fails: a failed count is never 0", async () => {
    h.contradiction.count.mockRejectedValue(new Error("db down"));
    await expect(countUnresolvedContradictions()).rejects.toThrow("db down");
  });

  it("returns a measured zero as 0 (control: the reject test is not a stub)", async () => {
    h.contradiction.count.mockResolvedValue(0);
    expect(await countUnresolvedContradictions()).toBe(0);
  });
});
