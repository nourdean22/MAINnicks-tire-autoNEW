/**
 * Claim vs record reaches Nick's prompt (2026-10-22).
 *
 * Runs the REAL buildBrainContext. The thinking engine's open contradictions
 * row must land as a CLAIM VS RECORD block and flip contextBlocks.claimGap —
 * the receipt the kill criterion is measured on. CONTROLS: the kill switch off,
 * and a private turn, both leave the block out (a private turn writes nothing).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ flagOn: true, writes: [] as Array<{ model: string; op: string }> }));

vi.mock("@/lib/prisma", () => {
  const WRITE = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  const gapRow = {
    id: "gap_1",
    claim: "I close out every estimate within a day",
    reality: "Nine estimates are older than a week with no follow-up",
    gap: "Stated next-day follow-up, record shows week-old estimates",
    category: "business",
    createdAt: new Date(),
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          if (WRITE.has(op)) {
            return vi.fn(async () => {
              h.writes.push({ model: name, op });
              return { id: `${name}-row` };
            });
          }
          if (op === "findMany") return vi.fn(async () => (name === "contradiction" ? [gapRow] : []));
          if (op === "groupBy") return vi.fn(async () => []);
          if (op === "count") return vi.fn(async () => 0);
          if (op === "aggregate") return vi.fn(async () => ({}));
          return vi.fn(async () => null);
        },
      },
    );
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === "$queryRaw" || prop === "$queryRawUnsafe") return vi.fn(async () => []);
        if (prop === "$executeRaw" || prop === "$executeRawUnsafe") return vi.fn(async () => 0);
        if (prop === "$transaction") return vi.fn(async (x: unknown) => x);
        return model(prop);
      },
    },
  );
  return { prisma };
});

// Constant embedding: every cosine is 1.0, so relevance is not what these tests vary.
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return {
    ...actual,
    getEmbedding: vi.fn(async () => [1, 0, 0]),
    aiChat: vi.fn(async () => ({ content: "", provider: "none", model: "none" })),
  };
});
vi.mock("@/lib/brain/embedding-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/embedding-utils")>();
  return { ...actual, getEmbedding: vi.fn(async () => [1, 0, 0]), semanticSearch: vi.fn(async () => []) };
});
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return { ...actual, getFlag: (key: string) => ({ key, isOn: key === "NICK_CLAIM_GAP" ? h.flagOn : false }) };
});
vi.mock("@/lib/ai/context-reranker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/context-reranker")>();
  return {
    ...actual,
    rerankContextBlocks: async (_e: number[], blocks: Array<{ name: string; content: string; critical?: boolean }>) =>
      blocks.map((b) => ({ ...b, similarity: 1, kept: true })),
  };
});
vi.mock("@/lib/brain/memory-recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/memory-recall")>();
  return { ...actual, recallMemoriesForQuery: async () => ({ hits: [], provenance: "ZERO" }) };
});
vi.mock("@/lib/brain/contextual-recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/contextual-recall")>();
  return { ...actual, getContextualMemories: async () => "" };
});
vi.mock("@/lib/brain/conversation-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/conversation-memory")>();
  return { ...actual, detectCrossSessionThread: async () => null };
});
vi.mock("@/lib/ai/predictive-prefetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/predictive-prefetch")>();
  return { ...actual, prefetchIntents: async () => [] };
});

import { buildBrainContext } from "@/lib/services/chat/brain-context";

const USER = "should I chase the open estimates before the weekend or let them sit";

async function build(opts: { privateMode?: boolean } = {}) {
  return buildBrainContext({
    userContent: USER,
    mode: "standard" as never,
    userEmbedding: [1, 0, 0],
    forceRecall: true,
    messages: [{ role: "user", content: USER }],
    convId: "conv_gap",
    privateMode: opts.privateMode,
    log: { info: () => {}, warn: () => {} },
  } as never);
}

beforeEach(() => {
  h.flagOn = true;
  h.writes.length = 0;
});

describe("buildBrainContext · claim vs record", () => {
  it("an open claim-vs-record row reaches the prompt and is counted", async () => {
    const out = await build();
    expect(out.systemPromptAddendum).toContain("# CLAIM VS RECORD");
    expect(out.systemPromptAddendum).toContain("Nine estimates are older than a week");
    expect(out.contextBlocksFired.claimGap).toBe(true);
  }, 30_000);

  it("CONTROL · NICK_CLAIM_GAP=0 leaves it out", async () => {
    h.flagOn = false;
    const out = await build();
    expect(out.systemPromptAddendum).not.toContain("CLAIM VS RECORD");
    expect(out.contextBlocksFired.claimGap).toBe(false);
  }, 30_000);

  it("CONTROL · a private turn leaves it out", async () => {
    const out = await build({ privateMode: true });
    expect(out.systemPromptAddendum).not.toContain("CLAIM VS RECORD");
  }, 30_000);
});
