/**
 * tests/ai/brain-context-anaphoric-referent.test.ts · 2026-09-17
 *
 * queryPlan.referent (lib/brain/query-plan.ts, anaphoric_followup) was the
 * THIRD dark wire in brain-context.ts — computed every turn, consumed by
 * nothing. exactTerms was the first (wired 2026-09-15), the `correction`
 * class the second (wired earlier in this PR).
 *
 * Wiring it exposed a second, worse defect: `recentTurns` was fed
 * `messages.slice(-4)`, and `messages` is the AI-SDK history, which ENDS
 * with the current user turn. Since planQuery takes `referent =
 * recentTurns[last]`, every referent resolved to the QUESTION ITSELF rather
 * than the turn its pronoun points at — so the naive wiring would have fed
 * `[userContent, userContent]` into topic derivation, double-weighting the
 * current turn instead of adding the prior turn's vocabulary.
 *
 * Behavioural, not presence: run the REAL buildBrainContext and assert what
 * getContextualMemories actually RECEIVES. A source-text scan of the ternary
 * would stay green through both defects.
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

// The seam under test: capture what the recall lane is actually handed.
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

import { buildBrainContext, buildRecallMessages } from "@/lib/services/chat/brain-context";

const silentLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

async function build(userContent: string, messages: Array<{ role: string; content: string }>) {
  return buildBrainContext({
    userContent,
    mode: "standard" as never,
    userEmbedding: [0.1, 0.2, 0.3],
    forceRecall: true,
    messages,
    convId: "conv_test",
    log: silentLog,
  });
}

/** The first positional arg of the single getContextualMemories call. */
function recallQueryTexts(): string[] {
  expect(contextualCalls.length, "getContextualMemories was called exactly once").toBe(1);
  return contextualCalls[0][0] as string[];
}

beforeEach(() => {
  contextualCalls.length = 0;
  vi.clearAllMocks();
});

/**
 * buildRecallMessages decides what the contextual lane derives TOPICS from,
 * and topics drive the lexical lane, cross-source search and the reranker.
 *
 * 2026-09-18 · REWRITTEN. This block used to assert that a stopword-only turn
 * GAINS the prior turn ("it would otherwise recall NOTHING relevant"). That was
 * true when written: zero topics meant getFallbackMemories(), i.e. top-N by
 * confidence with the query thrown away.
 *
 * #2425 made zero topics a GOOD outcome — it routes to the semantic and KNN
 * lanes on the user's own embedding — which removed the justification, and
 * review on #2433 found the heuristic had become harmful: "is everything done"
 * is not classified anaphoric, derives zero topics, and was therefore handed an
 * unrelated prior turn's topics to search with.
 *
 * The rule is now simply: prepend the referent, nothing else.
 */
describe("buildRecallMessages · only the referent is ever prepended", () => {
  const PRIOR_SUBJECT = "what is my rent on the euclid apartment";

  it("a referent is prepended — the anaphoric case still works", () => {
    expect(buildRecallMessages("REF", "is it still true")).toEqual(["REF", "is it still true"]);
  });

  it("NO referent: the turn recalls on its own text, even with zero topics", () => {
    // The #2433 regression, pinned. Previously this returned
    // [PRIOR_SUBJECT, "is everything done"] and searched the prior subject.
    expect(buildRecallMessages(undefined, "is everything done")).toEqual(["is everything done"]);
    expect(buildRecallMessages(undefined, "what do you think?")).toEqual(["what do you think?"]);
  });

  it("a topic-bearing turn is untouched, referent or not", () => {
    const rich = "what did the alignment rack cost";
    expect(buildRecallMessages(undefined, rich)).toEqual([rich]);
    expect(buildRecallMessages("REF", rich)).toEqual(["REF", rich]);
  });

  it("no prior turn can leak in — there is no history parameter left to leak from", () => {
    // The old signature took the full prior-turn array; the shape of the bug
    // was that it could reach the output without an anaphoric signal. The
    // parameter is gone, so that is now unrepresentable rather than guarded.
    expect(buildRecallMessages.length).toBe(2);
    expect(buildRecallMessages(undefined, PRIOR_SUBJECT)).toEqual([PRIOR_SUBJECT]);
  });
});

describe("brain-context · anaphoric referent reaches the recall lane", () => {
  it("a pronoun follow-up prepends the PRIOR turn — not the question itself", async () => {
    await build(FOLLOW_UP, [
      { role: "user", content: PRIOR_TURN },
      { role: "user", content: FOLLOW_UP },
    ]);

    const texts = recallQueryTexts();
    expect(texts).toHaveLength(2);
    // Order is load-bearing: deriveFastTopics walks BACKWARDS and lets the
    // LAST element's terms win the 8-topic cap, so the current turn must stay
    // last and the referent must lead.
    expect(texts[1]).toBe(FOLLOW_UP);
    expect(texts[0]).toContain("three reels a week");
  });

  it("REGRESSION · the referent is never the current turn (the messages-includes-current defect)", async () => {
    await build(FOLLOW_UP, [
      { role: "user", content: PRIOR_TURN },
      { role: "user", content: FOLLOW_UP },
    ]);

    const texts = recallQueryTexts();
    // Before the recentTurns fix this was [FOLLOW_UP, FOLLOW_UP]: the tail of
    // `messages` IS the current turn, so referent resolved to the question.
    expect(texts[0]).not.toBe(FOLLOW_UP);
  });

  it("BOUNDED LOOKBACK · empty recent turns yield NO referent, not an ancient one", async () => {
    // The window is deliberately bounded and sliced BEFORE empties are
    // filtered. It matters in exactly one case, which is this one: when the
    // recent turns carry no text (tool-only turns, empty parts), an unbounded
    // filter-then-slice reaches back until it finds *something* and hands a
    // years-old turn to the recall lane as the antecedent of "that".
    //
    // A pronoun refers to what was just said. No referent is the correct
    // answer here; a stale one is worse than none. A self-audit of this change
    // briefly introduced exactly that regression — this pins it.
    const ANCIENT = "Back in 2019 we used a different tire supplier called Greenline.";
    const messages = [
      { role: "user", content: ANCIENT },
      ...Array.from({ length: 6 }, () => ({ role: "assistant", content: "" })),
      { role: "user", content: FOLLOW_UP },
    ];

    await build(FOLLOW_UP, messages);

    const texts = recallQueryTexts();
    expect(texts).toEqual([FOLLOW_UP]);
    expect(JSON.stringify(texts)).not.toContain("Greenline");
  });

  it("negative control · a self-contained question passes ONLY its own text", async () => {
    const standalone = "how much did I pay for the alignment rack in March";
    await build(standalone, [{ role: "user", content: standalone }]);

    expect(recallQueryTexts()).toEqual([standalone]);
  });

  it("negative control · a pronoun turn with NO prior history stays single-query", async () => {
    // planQuery requires a prior turn to classify anaphoric_followup at all;
    // with the current turn correctly excluded there is nothing left to point at.
    await build(FOLLOW_UP, [{ role: "user", content: FOLLOW_UP }]);

    expect(recallQueryTexts()).toEqual([FOLLOW_UP]);
  });
});
