/**
 * tests/ai/chat/arbiter-brain-context.test.ts · 2026-10-16 (Brain W1, the arbiter)
 *
 * Runs the REAL buildBrainContext with NICK_RECALL_ARBITER on and off, against
 * the same prisma double tests/ai/chat/private-brain-context.test.ts uses.
 *
 * Contract when the arbiter is ON: the Evidence Pack block is rendered AND the
 * Context Memories block survives in reduced form (only its graph / cross-
 * source / related lines), so the arbiter adds a block instead of deleting
 * information; the persisted context receipt says arbiter: true and names the
 * rerank backend. CONTROL (flag off): the two lanes render separately as
 * before and the receipt says arbiter: false.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  arbiter: false,
  hits: [] as unknown[],
  contextual: vi.fn(async () => ""),
}));

vi.mock("@/lib/prisma", () => {
  const model = () =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          if (op === "findMany") return vi.fn(async () => []);
          if (op === "groupBy") return vi.fn(async () => []);
          if (op === "count") return vi.fn(async () => 0);
          if (op === "aggregate") return vi.fn(async () => ({}));
          if (op === "create" || op === "update" || op === "upsert") return vi.fn(async () => ({ id: "row" }));
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
        return model();
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
    aiChat: vi.fn(async () => ({ content: "", provider: "none", model: "none" })),
  };
});
vi.mock("@/lib/brain/embedding-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/embedding-utils")>();
  return { ...actual, getEmbedding: vi.fn(async () => [1, 0, 0]), semanticSearch: vi.fn(async () => []) };
});
vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return { ...actual, getFlag: (key: string) => ({ key, isOn: key === "NICK_RECALL_ARBITER" ? h.arbiter : false }) };
});
// No network for the pack's rerank: identity pass, backend "none".
vi.mock("@/lib/brain/rerank", () => ({
  isRerankAvailable: () => false,
  getActiveRerankBackend: () => "none",
  rerank: vi.fn(async () => null),
}));
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
  return {
    ...actual,
    recallMemoriesForQuery: async () => ({ hits: h.hits, provenance: h.hits.length > 0 ? "OK" : "ZERO" }),
  };
});
vi.mock("@/lib/brain/contextual-recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/contextual-recall")>();
  return { ...actual, getContextualMemories: h.contextual };
});
vi.mock("@/lib/brain/conversation-memory", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/conversation-memory")>();
  return { ...actual, detectCrossSessionThread: async () => null };
});
vi.mock("@/lib/ai/predictive-prefetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/predictive-prefetch")>();
  return { ...actual, prefetchIntents: async () => [] };
});
vi.mock("@/lib/skills/skill-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/skill-context")>();
  return { ...actual, getRelevantSkillsBlock: async () => "" };
});
vi.mock("@/lib/ai/greene-message-matcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/greene-message-matcher")>();
  return { ...actual, pickContextualLawsForMessage: async () => [] };
});
vi.mock("@/lib/ai/dark-psychology-matcher", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/dark-psychology-matcher")>();
  return { ...actual, pickDarkPsychologyForMessage: async () => [] };
});

import { buildBrainContext } from "@/lib/services/chat/brain-context";

const USER = "what did I decide about the vendor contract renewal for the Euclid shop?";

const operatorHit = {
  memoryId: "op1",
  category: "preferences",
  key: "pref_1",
  content: "Nour prefers annual vendor contracts",
  confidence: 0.9,
  seenCount: 2,
  ageDays: 3,
  factAgeDays: 30,
  knnDistance: 0.2,
  finalScore: 1,
  trustTier: "OPERATOR",
};

const GRAPH_LINE = "[decision_log] (caused by) the 2026-03 supplier price change";
const RELATED_LINE = "- Mash (operations) owns the renewal call";
const MEMORY_LINE = "- [decision_log] Chose the annual plan over month-to-month";

/** The exact shape fenceRecallBlock emits: heading, then the body in a memory_recall fence. */
function contextualBlock(): string {
  return [
    "## Nick Brain — Context Memories",
    '<tool_data tool="brainRecall" source="memory_recall">',
    "### Directly Relevant",
    MEMORY_LINE,
    "### Connected (linked in your brain graph)",
    GRAPH_LINE,
    "### Related People",
    RELATED_LINE,
    '</tool_data tool="brainRecall">',
  ].join("\n");
}

const rankedRow = {
  id: "ctx1",
  key: "decision_annual_plan",
  category: "decision_log",
  source: "manual",
  relevance: "direct",
  content: "Chose the annual plan over month-to-month",
};

async function build() {
  return buildBrainContext({
    userContent: USER,
    mode: "standard" as never,
    userEmbedding: [1, 0, 0],
    forceRecall: true,
    messages: [{ role: "user", content: USER }],
    convId: "conv_arbiter",
    log: { info: () => {}, warn: () => {} },
  } as never);
}

beforeAll(async () => {
  await build();
}, 60_000);

beforeEach(() => {
  h.hits = [operatorHit];
  h.contextual.mockReset();
  h.contextual.mockImplementation(async (_msgs: unknown, _max: unknown, opts?: { onRanked?: (rows: unknown[]) => void }) => {
    opts?.onRanked?.([rankedRow]);
    return contextualBlock();
  });
});

describe("buildBrainContext · NICK_RECALL_ARBITER (W1)", () => {
  it("CONTROL · flag off: both lanes render separately, no Evidence Pack, receipt.arbiter is false", async () => {
    h.arbiter = false;
    const res = await build();
    expect(res.systemPromptAddendum).not.toContain("# EVIDENCE PACK");
    expect(res.systemPromptAddendum).toContain("### Directly Relevant");
    expect(res.systemPromptAddendum).toContain(GRAPH_LINE);
    expect(res.contextReceipt?.arbiter).toBe(false);
    expect(res.contextReceipt).not.toHaveProperty("rerankBackend");
  }, 30_000);

  it("flag on: the Evidence Pack renders AND the graph / related lines of Context Memories survive, without the memory list", async () => {
    h.arbiter = true;
    const res = await build();
    const addendum = res.systemPromptAddendum;
    expect(addendum).toContain("# EVIDENCE PACK");
    expect(addendum).toContain("Evidence pack (");
    // both lanes' items are in the pack, once each
    expect(addendum).toMatch(/Nour prefers annual vendor contracts/);
    expect(addendum.match(/Chose the annual plan over month-to-month/g)?.length).toBe(1);
    // the reduced Context Memories block: addendum lines kept, memory list gone
    expect(addendum).toContain("# CONTEXT MEMORIES");
    expect(addendum).toContain(GRAPH_LINE);
    expect(addendum).toContain(RELATED_LINE);
    expect(addendum).not.toContain("### Directly Relevant");
    // the receipt lists both blocks and records the arbiter state
    const names = res.contextReceipt?.entries.map((e) => e.name) ?? [];
    expect(names).toContain("Evidence Pack");
    expect(names).toContain("Context Memories");
    expect(names).not.toContain("Hybrid Recall");
    expect(res.contextReceipt?.arbiter).toBe(true);
    expect(res.contextReceipt?.rerankBackend).toBe("none");
    expect(res.evidencePack).toMatchObject({ reranked: "none", droppedValidity: 0 });
  }, 30_000);
});
