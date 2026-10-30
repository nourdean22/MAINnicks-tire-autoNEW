/**
 * W3a · curated wisdom survives the nightly grinder (2026-10-29 wisdom-brain audit).
 *
 * Read-only prod probe: 149 greene_law rows (conf 1.0, no TTL) were
 * soft-deleted at 03:00 UTC on 18 nights between 2026-06-08 and 08-17 and the
 * drip stopped with exactly 3 live rows, where mergeMemories' "more than 3
 * live rows" groupBy stops picking the category. Its CURATED_GUARD covers
 * operator sources and pin:*, but not pack:* (ingest-wisdom-pack.ts), and a
 * merge rewrites a greene_law keeper's prose while its structured metadata
 * (fullText, matchPhrases, chapter) goes stale. A re-load would be ground again.
 *
 * The fake Prisma below APPLIES the where clause the code builds, so these
 * tests assert which rows actually lose their deletedAt, not which keys a
 * query object contains.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  seenCount: number;
  source: string;
  createdBy: string | null;
  deletedAt: Date | null;
  expiresAt: Date | null;
  lastSeen: Date;
  createdAt: Date;
  metadata: unknown;
};

const db = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [field, cond] of Object.entries(where)) {
    if (field === "NOT") {
      const list = Array.isArray(cond) ? cond : [cond];
      if (list.some((c) => matches(row, c as Record<string, unknown>))) return false;
      continue;
    }
    if (field === "AND") {
      if (!(cond as Record<string, unknown>[]).every((c) => matches(row, c))) return false;
      continue;
    }
    const v = row[field];
    if (cond === null) {
      if (v !== null) return false;
      continue;
    }
    if (typeof cond !== "object" || cond instanceof Date) {
      if (v !== cond) return false;
      continue;
    }
    const c = cond as Record<string, unknown>;
    if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
    if ("notIn" in c && (c.notIn as unknown[]).includes(v)) return false;
    if ("not" in c && v === c.not) return false;
    if ("startsWith" in c && !(typeof v === "string" && v.startsWith(c.startsWith as string))) return false;
    if ("lt" in c && !(v !== null && (v as number | Date) < (c.lt as number | Date))) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => {
  const update = async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
    const r = db.rows.find((x) => x.id === where.id)!;
    Object.assign(r, data);
    return r;
  };
  return {
    prisma: {
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
      brainMemory: {
        groupBy: async ({ where }: { where: Record<string, unknown> }) => {
          const counts = new Map<string, number>();
          for (const r of db.rows) {
            if (r.deletedAt === null && matches(r, where)) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
          }
          return [...counts].filter(([, n]) => n > 3).map(([category, n]) => ({ category, _count: { id: n } }));
        },
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          db.rows.filter((r) => matches(r, where)).sort((a, b) => b.confidence - a.confidence),
        update,
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
          const hit = db.rows.filter((r) => matches(r, where));
          for (const r of hit) Object.assign(r, data);
          return { count: hit.length };
        },
        delete: async () => ({}),
      },
    },
  };
});
vi.mock("@/lib/ai/traced-aichat", () => ({
  // Merge every row the grinder offers into one group.
  makeTracedAiChat: () => async (msgs: { content: string }[]) => {
    const n = (msgs[1].content.match(/^\[\d+\]/gm) ?? []).length;
    return { provider: "ollama", content: JSON.stringify([{ indices: [...Array(n).keys()], merged: "merged prose" }]) };
  },
}));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn(async () => undefined) }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));

import { mergeMemories, pruneNoise } from "@/lib/brain/memory-consolidation";

const OLD = new Date("2026-01-01T00:00:00Z");
function rows(n: number, over: Partial<Row>): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${over.category}-${over.source}-${i}`,
    category: "pattern",
    key: `k_${i}`,
    content: `row ${i}`,
    confidence: 1 - i / 100,
    seenCount: 1,
    source: "cron:x",
    createdBy: "system",
    deletedAt: null,
    expiresAt: null,
    lastSeen: OLD,
    createdAt: OLD,
    metadata: {},
    ...over,
  }));
}
const deleted = (category: string) => db.rows.filter((r) => r.category === category && r.deletedAt !== null).length;

beforeEach(() => {
  db.rows = [];
});

describe("mergeMemories leaves curated wisdom alone", () => {
  it("CONTROL: an ordinary machine-made duplicate group still merges", async () => {
    db.rows = rows(5, { category: "pattern", source: "cron:x" });
    await mergeMemories();
    expect(deleted("pattern")).toBe(4);
  });

  it("pack:* wisdom rows survive a run that would have merged them", async () => {
    db.rows = rows(5, { category: "wisdom", source: "pack:naval-ravikant" });
    await mergeMemories();
    expect(deleted("wisdom")).toBe(0);
    expect(db.rows.every((r) => r.content !== "merged prose")).toBe(true);
  });

  it("greene_law seeds survive, whatever their source", async () => {
    db.rows = rows(5, { category: "greene_law", source: "law-seed" });
    await mergeMemories();
    expect(deleted("greene_law")).toBe(0);
  });
});

describe("pruneNoise sweeps never take curated rows", () => {
  const PAST = new Date("2026-02-01T00:00:00Z");

  it("CONTROL: an expired machine row and a dead low-confidence row are swept", async () => {
    db.rows = [
      ...rows(1, { id: "ttl", category: "insight", source: "cron:x", expiresAt: PAST }),
      ...rows(1, { id: "low", category: "insight", source: "cron:x", confidence: 0.05 }),
    ];
    await pruneNoise();
    expect(deleted("insight")).toBe(2);
  });

  it.each([
    ["pack:*", { category: "wisdom", source: "pack:charlie-munger" }],
    ["skill_ingestion", { category: "wisdom", source: "skill_ingestion" }],
    ["pin:*", { category: "pinned_user", source: "pin:chat" }],
    ["greene_law", { category: "greene_law", source: "law-seed" }],
  ])("%s survives a past TTL and a low confidence", async (_label, over) => {
    db.rows = [
      ...rows(1, { ...over, id: "ttl", expiresAt: PAST }),
      ...rows(1, { ...over, id: "low", confidence: 0.05 }),
    ];
    await pruneNoise();
    expect(db.rows.filter((r) => r.deletedAt !== null)).toHaveLength(0);
  });
});
