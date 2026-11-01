/**
 * loadIdentityHistory returns the LATEST N days, chronological, live rows only (2026-11-01).
 *
 * Prod 11-01: `orderBy: key asc, take: N` returned the oldest N history rows
 * (from 2026-05-26), so sparklines, the 14-day projection and the journey lens
 * read May-August; the soft-deleted prose row history:2026-05-26 logged
 * "1 malformed identity history rows skipped" on every read (26 in 7 days).
 */
import { describe, it, expect, vi } from "vitest";

type Row = { key: string; content: string; deletedAt: Date | null };
const snap = (v: number) => JSON.stringify({ axes: { velocity: { value: v, manual: null } } });
const ROWS: Row[] = [
  { key: "history:2026-05-26", content: "Velocity shows mid-range clustering (18-67)...", deletedAt: new Date("2026-08-17") },
  { key: "history:2026-07-12", content: snap(11), deletedAt: null },
  { key: "history:2026-07-13", content: snap(12), deletedAt: null },
  { key: "history:2026-10-30", content: snap(30), deletedAt: null },
  { key: "history:2026-10-31", content: snap(31), deletedAt: null },
];
const logged: unknown[] = [];

vi.mock("@/lib/utils/error-log", () => ({ logError: (...a: unknown[]) => logged.push(a) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: async (args: { where: { deletedAt?: null }; orderBy: { key: "asc" | "desc" }; take: number }) =>
        ROWS.filter((r) => (args.where.deletedAt === null ? r.deletedAt === null : true))
          .sort((a, b) => (args.orderBy.key === "asc" ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key)))
          .slice(0, args.take),
    },
  },
}));

import { loadIdentityHistory } from "@/lib/brain/identity-snapshot";

describe("loadIdentityHistory", () => {
  it("returns the newest N days in chronological order", async () => {
    const out = await loadIdentityHistory(2);
    expect(out.map((r) => r.date)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(out[1].axes.velocity).toBe(31);
  });

  it("skips soft-deleted rows, so a consolidated prose row is never read or logged", async () => {
    logged.length = 0;
    const out = await loadIdentityHistory(30);
    expect(out.map((r) => r.date)).not.toContain("2026-05-26");
    expect(logged).toEqual([]);
  });
});
