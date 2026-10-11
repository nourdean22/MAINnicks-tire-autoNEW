/**
 * 08-F6d (audit 2026-10-10): a task-queue read that TIMES OUT must reach the
 * prompt as TASK_QUEUE_UNAVAILABLE, the same notice a failed read already gets.
 * brain-context used to race the read with a "" fallback, so a slow DB told
 * Nick the queue was empty ("nothing in progress").
 *
 * Runs the REAL buildBrainContext; only the task read and the IO-heavy lanes are
 * faked (mock set copied from tests/ai/chat/private-brain-context.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ taskBlock: vi.fn<() => Promise<string>>() }));

vi.mock("@/lib/brain/task-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/task-context")>();
  return { ...actual, buildTaskContextBlock: () => h.taskBlock() };
});

vi.mock("@/lib/prisma", () => {
  const model = () =>
    new Proxy(
      {},
      {
        get: (_t, op: string) => {
          if (op === "findMany" || op === "groupBy") return vi.fn(async () => []);
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
        if (prop.startsWith("$query") || prop.startsWith("$execute")) return vi.fn(async () => []);
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
  return { ...actual, getFlag: (key: string) => ({ key, isOn: false }) };
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
import { TASK_QUEUE_UNAVAILABLE } from "@/lib/brain/task-context";

const QUEUE_BLOCK = "## Nour's task queue\n- DOING: call the tire supplier";

async function build() {
  return buildBrainContext({
    userContent: "what am I working on right now?",
    mode: "standard" as never,
    userEmbedding: [1, 0, 0],
    forceRecall: true,
    messages: [{ role: "user", content: "what am I working on right now?" }],
    convId: "conv_tasks",
    log: { info: () => {}, warn: () => {} },
  } as never);
}

// Braces matter: a function returned from beforeEach is run as teardown.
beforeEach(() => {
  h.taskBlock.mockReset();
});

describe("buildBrainContext · task-queue read", () => {
  it("a task read that never resolves reaches the prompt as TASK_QUEUE_UNAVAILABLE, not as silence", async () => {
    h.taskBlock.mockImplementation(() => new Promise<string>(() => {}));
    const out = await build();
    expect(out.systemPromptAddendum).toContain(TASK_QUEUE_UNAVAILABLE);
  }, 30_000);

  it("CONTROL: a resolved queue block is injected as-is", async () => {
    h.taskBlock.mockResolvedValue(QUEUE_BLOCK);
    const out = await build();
    expect(out.systemPromptAddendum).toContain(QUEUE_BLOCK);
    expect(out.systemPromptAddendum).not.toContain(TASK_QUEUE_UNAVAILABLE);
  }, 30_000);

  it("CONTROL: a genuinely empty queue stays silent (a measured empty is not a failure)", async () => {
    h.taskBlock.mockResolvedValue("");
    const out = await build();
    expect(out.systemPromptAddendum).not.toContain(TASK_QUEUE_UNAVAILABLE);
  }, 30_000);
});
