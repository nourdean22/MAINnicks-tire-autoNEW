/**
 * Recall floor, 2026-10-31 (manager-approved after U2, the chat evidence panel).
 *
 * Before: hybrid recall handed the model whatever the lanes fused, so a turn whose best dense match
 * was 23-24% still filled the prompt's recall block with those rows (the same rows Nour saw in the
 * Context & Evidence panel at 12:50 on 2026-10-30). Now a memory found ONLY by a dense lane needs
 * cosine >= 0.35; a memory any text lane found (lexical or exact) always stays, because those scores
 * are not cosine. Pinned against the real recallMemoriesForQuery with each lane's SQL answered
 * by a fixture.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, unknown>;
const lanes: { main: Row[]; durable: Row[]; lexical: Row[]; exact: Row[] } = { main: [], durable: [], lexical: [], exact: [] };
const answer = (sql: unknown): Promise<Row[]> => {
  const s = String(sql);
  if (s.includes("ILIKE ANY($1)")) return Promise.resolve(lanes.exact);
  if (s.includes("ts_rank_cd")) return Promise.resolve(lanes.lexical);
  if (s.includes("WITH durable")) return Promise.resolve(lanes.durable);
  return Promise.resolve(lanes.main);
};
const queryRawUnsafe = vi.fn((sql: unknown) => answer(sql));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (sql: unknown) => queryRawUnsafe(sql),
    $executeRawUnsafe: async () => 0,
    $transaction: (fn: (tx: unknown) => unknown) =>
      Promise.resolve(fn({ $queryRawUnsafe: (sql: unknown) => queryRawUnsafe(sql), $executeRawUnsafe: async () => 0 })),
    brainMemory: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    systemMetric: { create: async () => ({}) },
  },
}));
vi.mock("@/lib/feature-flags", () => ({ getFlag: () => ({ isOn: false }) }));

import { DENSE_RECALL_MIN_SIMILARITY, recallMemoriesForQuery } from "@/lib/brain/memory-recall";

const EMBEDDING = Array.from({ length: 1536 }, () => 0.01);
function row(id: string, similarity: number): Row {
  return {
    memory_id: id,
    category: "insight",
    key: `k:${id}`,
    content: `content ${id}`,
    confidence: 0.8,
    seen_count: 1,
    last_seen: new Date(),
    created_at: new Date(),
    distance: 1 - similarity,
    source: "manual",
    created_by: "user",
  };
}
const ids = async (q = "what do I like for breakfast") =>
  (await recallMemoriesForQuery(q, { embedding: EMBEDDING, limit: 8, sideEffects: false })).hits.map((h) => h.memoryId);

beforeEach(() => {
  lanes.main = [];
  lanes.durable = [];
  lanes.lexical = [];
  lanes.exact = [];
});

describe("recall floor (dense-only matches under 35% never reach the prompt)", () => {
  it("a 23% dense-only match is dropped and a 40% one stays", async () => {
    lanes.main = [row("m40", 0.4), row("m23", 0.23)];
    expect(await ids()).toEqual(["m40"]);
  });

  it("the durable lane obeys the same floor", async () => {
    lanes.durable = [row("d24", 0.24), row("d55", 0.55)];
    expect((await ids()).sort()).toEqual(["d55"]);
  });

  it("CONTROL: a memory the lexical lane found stays even with a low score (ts_rank_cd is not cosine)", async () => {
    lanes.main = [row("both", 0.2)];
    lanes.lexical = [row("both", 0.1), row("lexOnly", 0.05)];
    expect((await ids()).sort()).toEqual(["both", "lexOnly"]);
  });

  it("CONTROL: an exact-identifier hit (distance 0 by construction) stays", async () => {
    lanes.exact = [row("ex", 1)];
    const report = await recallMemoriesForQuery("status of BDN-310", { embedding: EMBEDDING, limit: 8, exactTerms: ["BDN-310"], sideEffects: false });
    expect(report.hits.map((h) => h.memoryId)).toEqual(["ex"]);
  });

  it("the slots a dropped match frees go to the next real match (floor before the limit)", async () => {
    // w1 sits in two dense lanes, so the fusion ranks it above s1; with limit 1 it took the slot.
    lanes.main = [row("w1", 0.2), row("s1", 0.5)];
    lanes.durable = [row("w1", 0.2)];
    const report = await recallMemoriesForQuery("q", { embedding: EMBEDDING, limit: 1, sideEffects: false });
    expect(report.hits.map((h) => h.memoryId)).toEqual(["s1"]);
  });

  it("the floor is the measured wisdom floor (lib/brain/contextual-recall.ts)", () => {
    const src = readFileSync(join(__dirname, "..", "..", "lib", "brain", "contextual-recall.ts"), "utf8");
    const m = src.match(/export const WISDOM_SLOT_MIN_SIMILARITY = ([0-9.]+);/);
    expect(Number(m![1])).toBe(DENSE_RECALL_MIN_SIMILARITY);
  });
});
