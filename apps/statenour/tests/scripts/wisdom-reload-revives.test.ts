/**
 * W3 · the curated-wisdom reload actually brings rows back (2026-10-29).
 *
 * Prod (read-only): Naval 11 of 41, Munger 6 of 41, Bezos 4 of 31 live; Buffett,
 * Gates, Musk, Jobs, Satori 0; greene_law 3 of 153. The rest were soft-deleted
 * by the merge grinder (fixed in PR 3359). Every loader's UPDATE branch set
 * content/confidence/metadata but never cleared deletedAt, so a re-run would
 * refresh dead rows and leave them dead (manager read, 644e9268a4). The pack
 * loader also left source "manual" on the 21 live rows it had overwritten.
 *
 * Each test applies a loader's real update to a SOFT-DELETED fixture row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: vi.fn(async ({ where }: { where: { key: string; category?: string } }) =>
        h.rows.find((r) => r.key === where.key && (!where.category || r.category === where.category)) ?? null,
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const r = h.rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.rows.push({ id: `new-${h.rows.length}`, deletedAt: null, ...data });
        return data;
      }),
    },
  },
}));

import { packRowData } from "@/scripts/ingest-wisdom-pack";
import { seedUpdateData as personaUpdate } from "@/scripts/ingest-persona-pack";
import { seedUpdateData as skillsUpdate } from "@/scripts/ingest-wisdom-skills";
import { seedGreeneCorpus } from "@/scripts/seed-greene-corpus";

const DELETED = new Date("2026-06-26T03:00:00Z");
const deadRow = (over: Record<string, unknown>) => ({
  id: "dead",
  category: "wisdom",
  key: "k",
  content: "merge-grinder prose blended from three rows",
  source: "manual",
  deletedAt: DELETED,
  metadata: { deletedBy: "merge-grinder" },
  ...over,
});

beforeEach(() => {
  h.rows = [];
});

describe("ingest-wisdom-pack", () => {
  const pack = { pack: "naval-ravikant", source_credit: "c", entries: [{ text: "Seek wealth, not money or status. Wealth is assets that earn while you sleep.", topic: "money", confidence: 0.9 }] };

  it("an update revives a soft-deleted row, restores the pack text and source", () => {
    const row = deadRow({ key: "wisdom_naval-ravikant_000" });
    const args = packRowData(pack, pack.entries[0], 0)!;
    expect(args.key).toBe("wisdom_naval-ravikant_000");
    Object.assign(row, args.update);
    expect(row.deletedAt).toBeNull();
    expect(row.source).toBe("pack:naval-ravikant");
    expect(row.content).toBe(pack.entries[0].text);
    expect(row.metadata).toMatchObject({ origin: "naval-ravikant" });
  });

  it("CONTROL: an entry the loader skips (short or low confidence) yields no row", () => {
    expect(packRowData(pack, { text: "too short", topic: "x", confidence: 0.9 }, 1)).toBeNull();
    expect(packRowData(pack, { ...pack.entries[0], confidence: 0.3 }, 2)).toBeNull();
  });
});

describe.each([
  ["ingest-persona-pack (Buffett/Gates/Musk)", personaUpdate, "wisdom_buffett_circle_of_competence"],
  ["ingest-wisdom-skills (Jobs/Satori)", skillsUpdate, "wisdom_jobs_simplicity"],
])("%s", (_label, update, key) => {
  it("an update revives a soft-deleted row", () => {
    const row = deadRow({ key });
    Object.assign(row, update({ key, content: "the curated text", origin: "x" }));
    expect(row.deletedAt).toBeNull();
    expect(row.content).toBe("the curated text");
    expect(row.source).toBe("skill_ingestion");
  });
});

describe("seed-greene-corpus", () => {
  it("re-seeding revives a soft-deleted law", async () => {
    h.rows = [deadRow({ id: "law28", category: "greene_law", key: "law_28", source: "skill_ingestion" })];
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await seedGreeneCorpus();
    log.mockRestore();
    const law = h.rows.find((r) => r.id === "law28")!;
    expect(law.deletedAt).toBeNull();
    expect(String(law.content)).toMatch(/^\[Greene/);
  });
});
