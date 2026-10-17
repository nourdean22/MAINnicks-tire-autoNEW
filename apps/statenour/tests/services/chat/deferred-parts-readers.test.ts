/**
 * Brain FU4 (2026-10-17): the two post-turn readers in runDeferredBackgroundWork that read
 * `.content` on the chat history. The route sends v6 UIMessages (`parts`, no `content`), so:
 *
 *   - chat-pattern stats (every 10th message) measured every user message as 0 chars and wrote
 *     "Avg msg: 0 chars. N/N short" into BRAIN_CATEGORIES.CHAT_PATTERN / latest_session;
 *   - content-feedback capture read "" for the prior assistant turn, so its hashtag/marker gate
 *     always returned and persistContentFeedback never ran on live chat. Starting those writes
 *     feeds the content-mode prompt (augment-final-prompt.ts), so they ship behind
 *     CHAT_CONTENT_FEEDBACK_WRITES, default OFF, until the operator decides.
 *
 * Behavioural: the REAL runDeferredBackgroundWork and the REAL content-feedback module run
 * against a recording prisma; the assertions read the rows that reach the store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const calls: Array<{ op: string; args: any }> = [];
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method) => {
          if (typeof method !== "string" || method === "then") return undefined;
          return (args: unknown) => {
            calls.push({ op: `${name}.${method}`, args });
            return Promise.resolve(null);
          };
        },
      },
    );
  const prisma = new Proxy(
    {},
    { get: (_t, name) => (typeof name === "string" && name !== "then" ? model(name) : undefined) },
  );
  return { calls, prisma };
});
vi.mock("@/lib/prisma", () => ({ prisma: db.prisma }));

vi.mock("@/lib/ai/chat/brain-dump-detector", () => ({ looksLikeBrainDump: () => false }));
vi.mock("@/lib/ai/nick-agent", () => ({ parseActions: () => [], executeActions: vi.fn(async () => []) }));
vi.mock("@/lib/ai/memory", () => ({ recordInteraction: async () => undefined }));
vi.mock("@/lib/brain/pipeline-controller", () => ({ processConversation: async () => undefined }));
vi.mock("@/lib/brain/conversation-memory", () => ({ summarizeAndStoreConversation: async () => undefined }));
vi.mock("@/lib/brain/people-intelligence", () => ({ runPeopleIntelligence: async () => null }));
vi.mock("@/lib/chat/auto-rename", () => ({ maybeAutoRename: async () => undefined }));
vi.mock("@/lib/services/metrics", () => ({
  metricRecordedForTrace: async () => true,
  recordMetricStrict: async () => ({}),
}));
vi.mock("@/lib/ai/receipts/action-done-shadow-recorder", () => ({
  ACTION_DONE_SHADOW_METRIC: "action_done_shadow",
  recordActionDoneShadow: async () => "skipped",
}));
vi.mock("@/lib/ai/chat/recommendation-novelty-shadow", () => ({
  RECOMMENDATION_NOVELTY_METRIC: "recommendation_novelty",
  recordRecommendationNoveltyShadow: async () => undefined,
}));
vi.mock("@/lib/services/chat/prior-recommendations", () => ({ loadPriorRecommendations: async () => [] }));
vi.mock("@/lib/personal/friction-tracker", () => ({
  detectFriction: () => null,
  persistFriction: async () => undefined,
}));
vi.mock("@/lib/ai/suggestion-cache", () => ({ warmSuggestionCache: () => undefined, heuristicSuggestions: () => [] }));
vi.mock("@/lib/utils/error-log", () => ({ logError: () => undefined }));

import { runDeferredBackgroundWork } from "@/lib/services/chat/deferred-background-work";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const FLAG = "CHAT_CONTENT_FEEDBACK_WRITES";

/** A v6 UIMessage exactly as the route sends it: parts, no `content`. */
const ui = (id: string, role: string, text: string) => ({ id, role, parts: [{ type: "text", text }] });

const baseCtx = (userContent: string, messages: unknown[]) =>
  ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    convId: "c1",
    traceId: "t-readers",
    provider: "openai",
    modelId: "m",
    mode: "standard",
    personality: "master",
    topicTier: "core",
    startedAt: Date.now(),
    userContent,
    cleanedText: "On it.",
    text: "On it.",
    messages,
    createdAssistantId: "a1",
  }) as unknown as Parameters<typeof runDeferredBackgroundWork>[0];

/** The fire-and-forget phases settle on later ticks; give them a few. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10));
};

beforeEach(() => {
  db.calls.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chat-pattern stats (every 10th message) read the history text, not `.content`", () => {
  // Five user turns of known length between five assistant replies = 10 messages.
  const LENGTHS = [10, 10, 20, 100, 250]; // avg 78, short (<30) 3, long (>200) 1
  const EXPECTED = "Avg msg: 78 chars. 3/5 short (<30ch), 1/5 long (>200ch).";
  const userTexts = LENGTHS.map((n, i) => `${i}`.repeat(n));
  // A current turn long enough to be non-lightweight (>= 40 chars).
  const CURRENT = "x".repeat(60);

  const partsHistory = userTexts.flatMap((t, i) => [ui(`u${i}`, "user", t), ui(`a${i}`, "assistant", "reply")]);
  const contentHistory = userTexts.flatMap((t) => [
    { role: "user", content: t },
    { role: "assistant", content: "reply" },
  ]);

  const patternRows = () =>
    db.calls.filter(
      (c) => c.op === "brainMemory.upsert" && c.args?.where?.category_key?.category === BRAIN_CATEGORIES.CHAT_PATTERN,
    );

  it("a 10-message parts-only history yields the real average and short/long counts", async () => {
    expect(partsHistory).toHaveLength(10);
    await runDeferredBackgroundWork(baseCtx(CURRENT, partsHistory));
    await settle();
    const rows = patternRows();
    expect(rows, "the chat-pattern upsert ran once").toHaveLength(1);
    expect(rows[0].args.create.content).toContain(EXPECTED);
    expect(rows[0].args.update.content).toContain(EXPECTED);
  });

  it("CONTROL - the same history as legacy { role, content } rows gives the identical stats", async () => {
    expect(contentHistory).toHaveLength(10);
    await runDeferredBackgroundWork(baseCtx(CURRENT, contentHistory));
    await settle();
    const rows = patternRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].args.create.content).toContain(EXPECTED);
  });
});

describe("content-feedback capture reads the prior assistant parts, behind CHAT_CONTENT_FEEDBACK_WRITES", () => {
  const FEEDBACK = "this is garbage, too corporate for the reel caption";
  const CAPTION_TURN = "Caption: fresh tires, same day. #tires #cleveland #euclid";

  const exchange = (assistant: unknown) => [ui("u0", "user", "write a caption"), assistant, ui("u1", "user", FEEDBACK)];
  const partsExchange = () => exchange(ui("a0", "assistant", CAPTION_TURN));
  const legacyExchange = () => exchange({ id: "a0", role: "assistant", content: CAPTION_TURN });

  const feedbackWrites = () =>
    db.calls.filter((c) => c.op === "brainMemory.create" && c.args?.data?.category === "content_feedback");

  it("flag OFF (the default): a matching parts-only exchange writes no content_feedback row", async () => {
    await runDeferredBackgroundWork(baseCtx(FEEDBACK, partsExchange()));
    await settle();
    expect(feedbackWrites()).toHaveLength(0);
  });

  it("flag OFF: the legacy content-string exchange writes none either", async () => {
    await runDeferredBackgroundWork(baseCtx(FEEDBACK, legacyExchange()));
    await settle();
    expect(feedbackWrites()).toHaveLength(0);
  });

  it("flag \"true\": the matching parts-only exchange writes one content_feedback row about the caption", async () => {
    vi.stubEnv(FLAG, "true");
    await runDeferredBackgroundWork(baseCtx(FEEDBACK, partsExchange()));
    await vi.waitFor(() => expect(feedbackWrites()).toHaveLength(1));
    const data = feedbackWrites()[0].args.data;
    expect(data.content).toContain("too corporate");
    expect(data.content).toContain("fresh tires, same day");
    expect(data.metadata.conversationId).toBe("c1");
  });

  it("flag \"true\", CONTROL: the legacy content-string exchange still writes", async () => {
    vi.stubEnv(FLAG, "true");
    await runDeferredBackgroundWork(baseCtx(FEEDBACK, legacyExchange()));
    await vi.waitFor(() => expect(feedbackWrites()).toHaveLength(1));
  });

  it("flag \"true\", CONTROL: feedback about a non-content reply (no hashtags, no marker) writes nothing", async () => {
    vi.stubEnv(FLAG, "true");
    await runDeferredBackgroundWork(baseCtx(FEEDBACK, exchange(ui("a0", "assistant", "The shop opens at nine."))));
    await settle();
    expect(feedbackWrites()).toHaveLength(0);
  });

  it("any value but exactly \"true\" keeps the writes off", async () => {
    vi.stubEnv(FLAG, "1");
    await runDeferredBackgroundWork(baseCtx(FEEDBACK, partsExchange()));
    await settle();
    expect(feedbackWrites()).toHaveLength(0);
  });
});
