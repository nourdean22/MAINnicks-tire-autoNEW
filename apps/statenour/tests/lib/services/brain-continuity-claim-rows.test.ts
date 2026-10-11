/**
 * R3-16 item 4 (review R3 wave A, finding 4a) - every persisted chat turn now
 * writes one active_chat_stream "reply persisted" claim row (a lock row, not a
 * memory; persist-assistant-message.ts). The continuity card's "created in 24h"
 * list (take 25, no category filter), its category roster and its movers board
 * filled with them, pushing real new memories off the card.
 *
 * The store honours where-filters the way the database does, so a read that
 * does not exclude the category gets the claim rows.
 */
import { describe, expect, it, vi } from "vitest";

const { rows } = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

type W = Record<string, unknown>;
function match(r: Record<string, unknown>, w: W): boolean {
  for (const [k, c] of Object.entries(w ?? {})) {
    if (k === "OR") { if (!(c as W[]).some((x) => match(r, x))) return false; continue; }
    const v = r[k] as never;
    if (c === null) { if (v !== null) return false; continue; }
    if (typeof c === "object" && !(c instanceof Date)) {
      const o = c as { in?: unknown[]; notIn?: unknown[]; lt?: unknown; gt?: unknown; gte?: unknown };
      if (o.in && !o.in.includes(v)) return false;
      if (o.notIn && o.notIn.includes(v)) return false;
      if (o.lt !== undefined && !(v < (o.lt as never))) return false;
      if (o.gt !== undefined && !(v > (o.gt as never))) return false;
      if (o.gte !== undefined && !(v >= (o.gte as never))) return false;
      continue;
    }
    if (v !== c) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      count: vi.fn(async (a: { where?: W }) => rows.filter((r) => match(r, a.where ?? {})).length),
      findMany: vi.fn(async (a: { where?: W; take?: number }) =>
        rows
          .filter((r) => match(r, a.where ?? {}))
          .sort((x, y) => (y.createdAt as Date).getTime() - (x.createdAt as Date).getTime())
          .slice(0, a.take ?? Infinity),
      ),
      groupBy: vi.fn(async (a: { where?: W }) => {
        const by = new Map<string, number>();
        for (const r of rows.filter((x) => match(x, a.where ?? {}))) by.set(r.category as string, (by.get(r.category as string) ?? 0) + 1);
        return [...by.entries()].sort((x, y) => y[1] - x[1]).map(([category, n]) => ({ category, _count: { id: n } }));
      }),
    },
  },
}));

import { buildContinuityReport } from "@/lib/services/brain-continuity";

const now = Date.now();
const base = { confidence: 0.6, seenCount: 1, source: "chat", deletedAt: null, expiresAt: null };
function seed() {
  rows.splice(0, rows.length);
  for (let i = 0; i < 30; i++) {
    const t = new Date(now - i * 60_000);
    rows.push({ ...base, id: `claim_${i}`, category: "active_chat_stream", key: `stop:c:${i}`, content: `reply persisted - ${t.toISOString()}`, confidence: 0.1, source: "chat-persist", createdAt: t, updatedAt: t, lastSeen: t, expiresAt: new Date(now + 600_000) });
  }
  for (let i = 0; i < 3; i++) {
    const t = new Date(now - (40 + i) * 60_000);
    rows.push({ ...base, id: `mem_${i}`, category: "insight", key: `k${i}`, content: `Real new memory ${i}`, createdAt: t, updatedAt: t, lastSeen: t });
  }
}

describe("continuity card - per-turn claim rows are not memories", () => {
  it("the created-in-24h list shows the real new memories, no claim rows", async () => {
    seed();
    const r = await buildContinuityReport();
    expect(r.recent.created.map((m) => m.category)).not.toContain("active_chat_stream");
    expect(r.recent.created.map((m) => m.content)).toEqual(expect.arrayContaining(["Real new memory 0", "Real new memory 1", "Real new memory 2"]));
  });

  it("the category roster and the movers board leave the claim category out", async () => {
    seed();
    const r = await buildContinuityReport();
    expect(Object.keys(r.totals.byCategory)).not.toContain("active_chat_stream");
    expect(r.categoryMovers.map((m) => m.category)).not.toContain("active_chat_stream");
    expect(r.categoryMovers.find((m) => m.category === "insight")?.created24h).toBe(3);
  });
});
