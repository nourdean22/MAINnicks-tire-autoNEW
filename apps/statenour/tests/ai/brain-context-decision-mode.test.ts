/**
 * tests/ai/brain-context-decision-mode.test.ts · brain W3 (2026-10-17)
 *
 * Behavioural wiring pin: run the REAL buildBrainContext and assert the
 * Socratic decision block reaches the system-prompt addendum on a decision
 * turn, and only there. The block is appended after the reranker, so a mocked
 * reranker that drops every block must not drop it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({}),
    groupBy: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue({}),
  });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "$queryRaw" || prop === "$queryRawUnsafe"
          ? () => Promise.resolve([])
          : prop === "$transaction"
            ? (fns: unknown) => Promise.resolve(fns)
            : generic(),
    },
  );
  return { prisma };
});

vi.mock("@/lib/brain/embedding-utils", () => ({
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  semanticSearch: vi.fn().mockResolvedValue([]),
  cosineSimilarity: () => 0,
  storeGenericEmbedding: vi.fn(),
}));

vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  // Everything off except the flag under test, which resolves for real (default ON).
  return { ...actual, getFlag: (key: string) => (key === "NICK_DECISION_MODE" ? actual.getFlag(key) : { key, isOn: false }) };
});

// Drop EVERY reranked block: the decision block must survive anyway.
vi.mock("@/lib/ai/context-reranker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/context-reranker")>();
  return {
    ...actual,
    rerankContextBlocks: async (_e: number[], blocks: Array<{ name: string; content: string }>) =>
      blocks.map((b) => ({ ...b, similarity: 0, kept: false })),
  };
});

import { buildBrainContext } from "@/lib/services/chat/brain-context";
import { DECISION_MODE_ASK } from "@/lib/ai/prompt/policy/decision-mode";
import { DECISION_ASK_NEXT_MOVE } from "@/lib/ai/prompt/policy/decision-mode";
import { finalizeSystemPrompt } from "@/app/api/ai/chat/finalize-system-prompt";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { detectQueryShape } from "@/lib/ai/query-shape";
import { buildResponseContract } from "@/lib/ai/response-contract";

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function build(userContent: string, history: Array<{ role: string; content: string }> = []) {
  return buildBrainContext({
    userContent,
    mode: "standard" as never,
    userEmbedding: [0.1, 0.2, 0.3],
    forceRecall: false,
    // Production shape: v6 UIMessages with parts (route.ts sanitizeMessageHistory passes them through).
    messages: [...history, { role: "user", content: userContent }].map((t) => ({
      role: t.role,
      parts: [{ type: "text", text: t.content }],
    })) as never,
    convId: "conv_w3",
    log: silentLog,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("brain-context · Socratic decision block", () => {
  it("a decision turn carries the ask block and flags decisionAsk", async () => {
    const out = await build("Should I hire Manny full time or keep him part time?");
    expect(out.systemPromptAddendum).toContain(DECISION_MODE_ASK);
    expect(out.contextBlocksFired.decisionAsk).toBe(true);
  });

  it("POSITIVE CONTROL: a non-decision turn carries no decision block", async () => {
    const out = await build("What is the weather in Cleveland today");
    expect(out.systemPromptAddendum).not.toContain("DECISION MODE");
    expect(out.contextBlocksFired.decisionAsk).toBeFalsy();
  });

  it('"just answer" earlier in the conversation keeps the block off', async () => {
    const out = await build("Should I raise the oil change price or hold it?", [
      { role: "user", content: "just answer, quick ones today" },
      { role: "assistant", content: "Ok." },
    ]);
    expect(out.systemPromptAddendum).not.toContain("DECISION MODE");
    expect(out.contextBlocksFired.decisionSkip).toBe(true);
  });

  it("a Private Lab turn carries no decision block", async () => {
    const out = await buildBrainContext({
      userContent: "Should I hire Manny full time or keep him part time?",
      mode: "standard" as never,
      userEmbedding: [],
      forceRecall: false,
      messages: [],
      privateMode: true,
      log: silentLog,
    });
    expect(out.systemPromptAddendum).not.toContain("DECISION MODE");
  });
});

describe("composed prompt · the ask and the contract's next-move rule agree", () => {
  it("a decision turn carries both, and the ask names the next move as answering the four questions", async () => {
    const text = "Should I hire Zach full time or keep him hybrid?";
    const brain = await build(text);
    const turnSignal = classifyTurn(text);
    const queryShape = detectQueryShape(text);
    const { systemPrompt } = await finalizeSystemPrompt({
      // The route passes the brain addendum inside systemPrompt (route.ts rawSystemPrompt + addendum).
      systemPrompt: `BASE PROMPT${brain.systemPromptAddendum}`,
      provider: "ollama",
      personality: "master",
      userContent: text,
      turnSignal,
      contextBlocksFired: brain.contextBlocksFired,
      mode: "standard" as never,
      queryShape,
      contract: buildResponseContract(text, turnSignal, queryShape.shape),
      log: { info: () => {} },
    });
    expect(systemPrompt).toContain("End with one concrete next move.");
    expect(systemPrompt).toContain(DECISION_ASK_NEXT_MOVE);
    expect(DECISION_ASK_NEXT_MOVE).toMatch(/next move.*answer the four questions/i);
    // The ask must not tell Nick to end on anything else.
    expect(DECISION_MODE_ASK).not.toMatch(/^End with:/m);
  });
});
