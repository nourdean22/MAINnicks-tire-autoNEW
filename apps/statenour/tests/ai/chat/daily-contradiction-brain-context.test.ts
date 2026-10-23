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
  claimedBy: null as string | null,
  writes: [] as Array<{ model: string; op: string; key?: string }>,
  reservedStates: [] as string[],
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
            return vi.fn(async (arg?: { data?: { key?: string; content?: string } }) => {
              if (h.failClaim && name === "brainMemory" && op === "create") throw new Error("connection reset");
              h.writes.push({ model: name, op, key: arg?.data?.key });
              if (arg?.data?.key?.startsWith("claim-gap:")) {
                try {
                  h.reservedStates.push(String(JSON.parse(arg.data.content ?? "{}").state));
                } catch {
                  /* not JSON */
                }
              }
              return { id: `${name}-row` };
            });
          }
          // Today's claim row, when a test says an earlier turn already asked.
          if (op === "findUnique" && name === "brainMemory") {
            return vi.fn(async (arg?: { where?: { category_key?: { key?: string } } }) =>
              h.claimedBy && arg?.where?.category_key?.key?.startsWith("claim-gap:")
                ? { id: "claim", content: JSON.stringify({ contradictionId: "open_1", conversationId: h.claimedBy, kind: "daily", state: "asked" }), lastSeen: new Date() }
                : null,
            );
          }
          // The follow-up reads this conversation's live claims (not only today's key).
          if (op === "findMany" && name === "brainMemory") {
            return vi.fn(async (arg?: { where?: { key?: { startsWith?: string } } }) =>
              h.claimedBy && arg?.where?.key?.startsWith === "claim-gap:"
                ? [{ key: "claim-gap:2026-10-22", content: JSON.stringify({ contradictionId: "open_1", conversationId: h.claimedBy, kind: "daily", state: "asked" }), lastSeen: new Date() }]
                : [],
            );
          }
          if (op === "findMany") return vi.fn(async () => (name === "contradiction" ? [openRow] : []));
          if (op === "findFirst" && name === "contradiction") return vi.fn(async () => openRow);
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

async function build(
  opts: { privateMode?: boolean; ephemeral?: boolean; actionPermission?: "read" | "draft" | "execute"; convId?: string } = {},
) {
  return buildBrainContext({
    userContent: USER,
    mode: "standard" as never,
    userEmbedding: [1, 0, 0],
    forceRecall: true,
    messages: [{ role: "user", content: USER }],
    convId: opts.convId ?? "conv_daily",
    privateMode: opts.privateMode,
    ephemeral: opts.ephemeral,
    actionPermission: opts.actionPermission,
    log: { info: () => {}, warn: () => {} },
  } as never);
}

const dailyClaims = () => h.writes.filter((w) => w.key?.startsWith("claim-gap:"));

beforeEach(() => {
  h.dailyOn = true;
  h.claimGapOn = false;
  h.failClaim = false;
  h.claimedBy = null;
  h.writes.length = 0;
  h.reservedStates.length = 0;
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
    // Exactly one day claim: the claim gap's.
    expect(dailyClaims()).toHaveLength(1);
  }, 30_000);

  it("the NEXT turn of the asking conversation still carries the key to resolve it, without asking again", async () => {
    h.claimedBy = "conv_daily";
    const out = await build();
    expect(out.systemPromptAddendum).toContain("# CONTRADICTION ASKED EARLIER");
    expect(out.systemPromptAddendum).toContain('contradictionKey "tbl:open_1"');
    expect(out.systemPromptAddendum).not.toContain("# ONE OPEN CONTRADICTION");
    expect(dailyClaims()).toHaveLength(0);
  }, 30_000);

  it("the reservation is handed to the persist hook (it becomes 'asked' only after delivery)", async () => {
    const out = await build();
    expect(out.contradictionClaim).toMatchObject({ contradictionId: "open_1", kind: "daily" });
    expect(out.contradictionClaim?.key).toMatch(/^claim-gap:\d{4}-\d{2}-\d{2}$/);
    // The claim write is a reservation, not a receipt.
    expect(h.reservedStates).toContain("reserved");
  }, 30_000);

  it.each([
    ["Read permission", { actionPermission: "read" as const }],
    ["an ephemeral Home command turn", { ephemeral: true, convId: "private" }],
    // Pinned on its own: the placeholder check above would hide a missing ephemeral gate.
    ["an ephemeral turn even with a real conversation id", { ephemeral: true }],
    ["a placeholder conversation id (temp)", { convId: "temp" }],
    ["a placeholder conversation id (private)", { convId: "private" }],
  ])("%s: no claim, no daily question, no follow-up, claim gap included", async (_label, opts) => {
    // Lanes that WOULD fire with no claim yet today: the claim gap and the daily question.
    h.claimGapOn = true;
    const out = await build(opts);
    expect(out.systemPromptAddendum).not.toContain("CLAIM VS RECORD");
    expect(out.systemPromptAddendum).not.toContain("ONE OPEN CONTRADICTION");
    expect(dailyClaims()).toHaveLength(0);
    expect(out.contradictionClaim).toBeUndefined();
    // And the follow-up, with an asked claim recorded under this same id.
    h.claimedBy = opts.convId ?? "conv_daily";
    const later = await build(opts);
    expect(later.systemPromptAddendum).not.toContain("ASKED EARLIER");
  }, 30_000);

  it("CONTROL · Draft permission still asks (only Read refuses the resolve tool)", async () => {
    const out = await build({ actionPermission: "draft" });
    expect(out.systemPromptAddendum).toContain("# ONE OPEN CONTRADICTION");
  }, 30_000);

  it("contradictionAskPending: true on the ask turn and on the follow-up turn, false otherwise", async () => {
    expect((await build()).contradictionAskPending).toBe(true); // the daily question is asked now
    h.claimedBy = "conv_daily";
    expect((await build()).contradictionAskPending).toBe(true); // asked earlier, answer may come now
    h.claimedBy = null;
    h.dailyOn = false;
    expect((await build()).contradictionAskPending).toBe(false);
  }, 30_000);

  it("CONTROL · another conversation gets no follow-up", async () => {
    h.claimedBy = "conv_other";
    const out = await build();
    expect(out.systemPromptAddendum).not.toContain("ASKED EARLIER");
    expect(out.systemPromptAddendum).not.toContain("tbl:open_1");
  }, 30_000);
});
