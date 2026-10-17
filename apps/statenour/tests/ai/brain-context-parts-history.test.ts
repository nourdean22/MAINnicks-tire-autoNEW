/**
 * tests/ai/brain-context-parts-history.test.ts · 2026-10-17
 *
 * app/api/ai/chat/route.ts hands buildBrainContext the v6 UIMessage history:
 * `{ id, role, parts: [{ type: "text", text }] }`, with NO `content` field.
 * The anaphoric-referent lookup read `m.content` only, so on the live client
 * every follow-up ("is that still true?") resolved no referent. The sibling
 * test (brain-context-anaphoric-referent) only ever fed legacy
 * `{ role, content }`, which is why it stayed green.
 *
 * Behavioural: run the REAL buildBrainContext with the history shaped the way
 * the route sends it, and assert what getContextualMemories RECEIVES.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const PRIOR_TURN = "We moved the shop's Instagram cadence to three reels a week.";
const FOLLOW_UP = "is that still true?"; // < 60 chars, contains "that"

const contextualCalls: unknown[][] = [];

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
}));

vi.mock("@/lib/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/feature-flags")>();
  return { ...actual, getFlag: (key: string) => ({ key, isOn: false }) };
});

vi.mock("@/lib/ai/context-reranker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/context-reranker")>();
  return {
    ...actual,
    rerankContextBlocks: async (
      _e: number[],
      blocks: Array<{ name: string; content: string; critical?: boolean }>,
    ) => blocks.map((b) => ({ ...b, similarity: 1, kept: true })),
  };
});

vi.mock("@/lib/brain/contextual-recall", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brain/contextual-recall")>();
  return {
    ...actual,
    getContextualMemories: async (...args: unknown[]) => {
      contextualCalls.push(args);
      return "";
    },
  };
});

import { buildBrainContext } from "@/lib/services/chat/brain-context";

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

/** A v6 UIMessage exactly as route.ts sends it: parts, no `content`. */
const ui = (id: string, role: string, text: string) => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

async function build(userContent: string, messages: unknown[]) {
  return buildBrainContext({
    userContent,
    mode: "standard" as never,
    userEmbedding: [0.1, 0.2, 0.3],
    forceRecall: true,
    messages: messages as never,
    convId: "conv_test",
    log: silentLog,
  });
}

function recallQueryTexts(): string[] {
  expect(contextualCalls.length, "getContextualMemories was called exactly once").toBe(1);
  return contextualCalls[0][0] as string[];
}

beforeEach(() => {
  contextualCalls.length = 0;
  vi.clearAllMocks();
});

describe("brain-context · referent lookup reads the v6 parts history", () => {
  it("a pronoun follow-up resolves to the PRIOR turn when the history is parts-shaped", async () => {
    await build(FOLLOW_UP, [ui("m1", "user", PRIOR_TURN), ui("m2", "user", FOLLOW_UP)]);

    const texts = recallQueryTexts();
    expect(texts).toHaveLength(2);
    expect(texts[1]).toBe(FOLLOW_UP);
    expect(texts[0]).toContain("three reels a week");
  });

  it("the referent is never the current turn (parts-shaped tail is dropped)", async () => {
    await build(FOLLOW_UP, [ui("m1", "user", PRIOR_TURN), ui("m2", "user", FOLLOW_UP)]);
    expect(recallQueryTexts()[0]).not.toBe(FOLLOW_UP);
  });

  it("an assistant parts turn is a valid antecedent too", async () => {
    await build(FOLLOW_UP, [
      ui("m1", "user", "what is the reel cadence"),
      ui("m2", "assistant", PRIOR_TURN),
      ui("m3", "user", FOLLOW_UP),
    ]);
    expect(recallQueryTexts()[0]).toContain("three reels a week");
  });

  it("CONTROL · the legacy { role, content } history still resolves the referent", async () => {
    await build(FOLLOW_UP, [
      { role: "user", content: PRIOR_TURN },
      { role: "user", content: FOLLOW_UP },
    ]);
    const texts = recallQueryTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("three reels a week");
  });
});
