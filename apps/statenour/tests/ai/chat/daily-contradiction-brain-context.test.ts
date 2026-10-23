/**
 * One open contradiction a day reaches Nick's prompt (2026-10-23).
 *
 * Runs the REAL buildBrainContext. With NICK_DAILY_CONTRADICTION on and no
 * claim-gap hit, the oldest open table row lands as an ONE OPEN CONTRADICTION
 * block and flips contextBlocks.dailyContradiction. CONTROLS: the flag off, a
 * private turn, a failed day claim, and a turn where the claim gap already
 * fired all leave it out (one contradiction a day, never two).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  dailyOn: true,
  claimGapOn: false,
  failClaim: false,
  writes: [] as Array<{ model: string; op: string; key?: string }>,
}));

vi.mock("@/lib/prisma", () => {
  const WRITE = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
  const openRow = {
    id: "open_1",
    date: "2026-10-12",
    claim: "I stretch every morning before work",
    reality: "The stretch log has one entry in two weeks",
    gap: "Stated daily, logged once",
    category: "habit",
    severity: "severe",
    createdAt: new Date(Date.now() - 10 * 86400_000),
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          if (WRITE.has(op)) {
            return vi.fn(async (arg?: { data?: { key?: string } }) => {
              if (h.failClaim && name === "brainMemory" && op === "create") throw new Error("connection reset");
              h.writes.push({ model: name, op, key: arg?.data?.key });
              return { id: `${name}-row` };
            });
          }
          if (op === "findMany") return vi.fn(async () => (name === "contradiction" ? [openRow] : []));
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

vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return {
    ...actual,
    getEmbedding: vi.fn(async () => [1, 0, 0]),
    getEmbeddingWithModel: vi.fn(async () => ({ vec: [1, 0, 0], model: "test-space" })),
    aiChat: vi.fn(async () => ({ content: "", provider: "none", model: "none" })),
  };
});
vi.mock("@/lib/brain/embedding-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/embedding-utils")>();
  return { ...actual, getEmbedding: vi.fn(async () => [1, 0, 0]), semanticSearch: vi.fn(async () => []) };
});
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return {
    ...actual,
    getFlag: (key: string) => ({
      key,
      isOn: key === "NICK_DAILY_CONTRADICTION" ? h.dailyOn : key === "NICK_CLAIM_GAP" ? h.claimGapOn : false,
    }),
  };
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

const USER = "morning, what should I knock out first today";

async function build(opts: { privateMode?: boolean } = {}) {
  return buildBrainContext({
    userContent: USER,
    mode: "standard" as never,
    userEmbedding: [1, 0, 0],
    forceRecall: true,
    messages: [{ role: "user", content: USER }],
    convId: "conv_daily",
    privateMode: opts.privateMode,
    log: { info: () => {}, warn: () => {} },
  } as never);
}

const dailyClaims = () => h.writes.filter((w) => w.key?.startsWith("claim-gap-daily:"));

beforeEach(() => {
  h.dailyOn = true;
  h.claimGapOn = false;
  h.failClaim = false;
  h.writes.length = 0;
});

describe("buildBrainContext · one open contradiction a day", () => {
  it("the oldest open row is asked, with the tbl key, and counted", async () => {
    const out = await build();
    expect(out.systemPromptAddendum).toContain("# ONE OPEN CONTRADICTION");
    expect(out.systemPromptAddendum).toContain("The stretch log has one entry");
    expect(out.systemPromptAddendum).toContain('contradictionKey "tbl:open_1"');
    expect(out.contextBlocksFired.dailyContradiction).toBe(true);
    expect(out.contextBlocksFired.contradictions).toBe(true);
    expect(dailyClaims()).toHaveLength(1);
  }, 30_000);

  it("CONTROL · NICK_DAILY_CONTRADICTION off leaves it out and claims nothing", async () => {
    h.dailyOn = false;
    const out = await build();
    expect(out.systemPromptAddendum).not.toContain("ONE OPEN CONTRADICTION");
    expect(dailyClaims()).toHaveLength(0);
  }, 30_000);

  it("CONTROL · a private turn leaves it out and claims nothing", async () => {
    const out = await build({ privateMode: true });
    expect(out.systemPromptAddendum).not.toContain("ONE OPEN CONTRADICTION");
    expect(dailyClaims()).toHaveLength(0);
  }, 30_000);

  it("a failed day claim shows nothing (fails closed)", async () => {
    h.failClaim = true;
    const out = await build();
    expect(out.systemPromptAddendum).not.toContain("ONE OPEN CONTRADICTION");
  }, 30_000);

  it("when the claim gap fires this turn, the daily question stays out (never two a day)", async () => {
    h.claimGapOn = true;
    const out = await build();
    expect(out.systemPromptAddendum).toContain("# CLAIM VS RECORD");
    expect(out.systemPromptAddendum).not.toContain("ONE OPEN CONTRADICTION");
    expect(dailyClaims()).toHaveLength(0);
  }, 30_000);
});
