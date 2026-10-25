/**
 * tests/ai/chat/alternate-paths-budget.test.ts · 2026-10-25 (bdnick "Nick is stuck")
 *
 * THE DEFECT: the regen lane built the whole reply before any byte reached the
 * client: first draft 119 s, a second draft 64 s, CoVe 35 s, 225 s in all, while
 * the client gives up 180 s after submit. The reply was saved 45 s after nobody
 * was listening.
 *
 * Pinned, on the route's own turn clock (persistBase.startedAt) and the real
 * maybePreStreamRegen:
 *   1. a first draft that leaves too little room ships as is: no second draft,
 *      no pre-flush CoVe, one `lane_budget_skipped` line per skipped step;
 *   2. CONTROL: a fast first draft keeps today's behaviour (second draft and
 *      CoVe both run, nothing logged as skipped).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyTurn } from "@/lib/ai/turn-intelligence";

const flags: Record<string, boolean> = {};
vi.mock("@/lib/feature-flags", () => ({ getFlag: (k: string) => ({ isOn: flags[k] ?? false }) }));

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a), stepCountIs: () => () => false }));
vi.mock("@/lib/observability/langfuse", () => ({ langfuseTelemetry: () => ({}) }));
vi.mock("@/lib/services/chat/tool-telemetry-walk", () => ({ recordToolObservations: async () => undefined }));
const persistEvents: Array<Record<string, unknown>> = [];
vi.mock("@/lib/services/chat/persist-assistant-turn", () => ({
  buildOnFinish: () => async (ev: Record<string, unknown>) => {
    persistEvents.push(ev);
  },
}));
const shippedTexts: string[] = [];
vi.mock("@/lib/ai/chat/simulate-stream-from-text", () => ({
  simulateStreamFromText: ({ text, onComplete }: { text: string; onComplete?: () => unknown }) => {
    shippedTexts.push(text);
    void onComplete?.();
    return new Response("stream");
  },
  simulateReasoningStream: () => new Response("reasoning"),
}));
// What happened, in order: the turn's registry entry, each draft, the entry's completion.
const order: string[] = [];
vi.mock("@/lib/services/chat/active-stream", () => ({
  trackActiveStream: (convId: string, traceId: string) => {
    order.push(`register:${convId}:${traceId}`);
    return () => order.push("complete");
  },
}));
vi.mock("@/lib/services/chat/response-shape", () => ({
  buildChatResponse: ({ streamResponse }: { streamResponse: Response }) => streamResponse,
}));
vi.mock("@/lib/services/metrics", () => ({ recordMetric: async () => undefined, recordMetricStrict: async () => ({}) }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
const verifyAndRevise = vi.fn();
vi.mock("@/lib/ai/chat/chain-of-verification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chat/chain-of-verification")>()),
  verifyAndRevise: (...a: unknown[]) => verifyAndRevise(...a),
}));

import { runAlternatePaths } from "@/app/api/ai/chat/alternate-paths";

// The critic marks this one for repair on a factual turn (tests/ai/chat/pre-stream-regen.test.ts).
const VAGUE_REPLY =
  "Yes that depends on various factors and there are many ways to look at it. " +
  "Consider the options and choose what works best for you in the situation. " +
  "The path forward will take many shapes based on the specifics of your case.";
const CONCRETE_REPLY =
  "Today: 12 leads opened, 3 callbacks pending, 5 estimates worth $4,200. " +
  "autonicks shows 8 drops booked this week. Nick handles 2 jobs at 9:30am.";

const T0 = Date.parse("2026-10-25T02:53:22.400Z");
const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

/** The first draft takes `firstDraftMs` of turn time; the second draft 5 s. */
function modelTaking(firstDraftMs: number) {
  let calls = 0;
  generateText.mockImplementation(async () => {
    calls += 1;
    order.push("draft");
    vi.setSystemTime(Date.now() + (calls === 1 ? firstDraftMs : 5_000));
    return { text: calls === 1 ? VAGUE_REPLY : CONCRETE_REPLY, toolCalls: [], toolResults: [] };
  });
}

function run() {
  const q = "what did the shop make this week and how many callbacks are pending";
  return runAlternatePaths({
    persistBase: { startedAt: T0 },
    provider: "openai",
    modelId: "m",
    model: {},
    sanitizedModelMessages: [],
    prunedTools: {},
    mode: "standard",
    maxOutputTokens: 0,
    userContent: q,
    finalSystemPrompt: "sys",
    turnSignal: { ...classifyTurn(q), intent: "factual", complexity: "simple", temperature: 0.4 },
    actionIntent: null,
    toolsExpected: false,
    convId: "c1",
    traceId: "t_test",
    modeOverride: undefined,
    personality: undefined,
    classification: undefined,
    recalledHits: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    contextBlocksFired: [],
    privateMode: false,
    log,
  } as unknown as Parameters<typeof runAlternatePaths>[0]);
}

const skipLines = () => log.info.mock.calls.filter((c) => c[0] === "lane_budget_skipped").map((c) => c[1]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 7_500); // prompt built, as on 2026-10-25
  for (const k of Object.keys(flags)) delete flags[k];
  flags.NICK_VERIFIED_REGEN = true;
  flags.NICK_COVE = true;
  generateText.mockReset();
  verifyAndRevise.mockReset();
  verifyAndRevise.mockResolvedValue({ changed: true, revised: "verified reply", questions: ["q"] });
  log.info.mockClear();
  persistEvents.length = 0;
  shippedTexts.length = 0;
  order.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("buffered lanes · one wall-clock budget from turn start", () => {
  it("a slow first draft ships as is: no second draft, no pre-flush CoVe, each skip logged", async () => {
    modelTaking(119_000); // 2026-10-25: first draft 118.7 s
    const res = await run();

    expect(res, "the first draft must ship, never fall through").not.toBeNull();
    expect(generateText, "the second regen draft ran past the budget").toHaveBeenCalledTimes(1);
    expect(verifyAndRevise, "CoVe ran past the budget").not.toHaveBeenCalled();
    expect(shippedTexts).toEqual([VAGUE_REPLY]);
    expect(persistEvents[0]?.coveDone, "a skipped CoVe must stay owed to persist").toBeUndefined();
    const skips = skipLines();
    expect(skips).toEqual([
      expect.objectContaining({ lane: "regen", step: "second_draft" }),
      expect.objectContaining({ lane: "regen", step: "cove" }),
    ]);
    // The elapsed time comes from persistBase.startedAt, the route's clock.
    expect(skips[0].elapsedMs).toBe(126_500);
  });

  it("CONTROL: a fast first draft keeps today's behaviour", async () => {
    modelTaking(10_000);
    const res = await run();

    expect(res).not.toBeNull();
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(verifyAndRevise).toHaveBeenCalledTimes(1);
    expect(shippedTexts).toEqual(["verified reply"]);
    expect(persistEvents[0]?.coveDone).toBe(true);
    expect(skipLines()).toEqual([]);
  });
});

// Round 3 (Codex P1): the preflight check is only an estimate. A second draft or a CoVe pass that
// runs longer than expected must be cut at the remaining budget, and the draft in hand ships.
describe("buffered lanes · the remaining budget bounds the optional step itself", () => {
  const cutLines = () => log.info.mock.calls.filter((c) => c[0] === "lane_budget_cut").map((c) => c[1]);
  /** Full fake timers (setTimeout too), keeping the turn clock where beforeEach put it. */
  function fakeAllTimers() {
    const now = Date.now();
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  }
  /** A step that would finish only after `takesMs`; the test's clock runs past it meanwhile. */
  function slow<T>(value: T, takesMs: number): Promise<T> {
    const p = new Promise<T>((res) => setTimeout(() => res(value), takesMs));
    // After the caller has started waiting on it, as a real slow call would be.
    queueMicrotask(() => vi.advanceTimersByTime(takesMs + 1_000));
    return p;
  }

  it("a second draft still running at the budget is cut and the first draft ships", async () => {
    fakeAllTimers();
    let calls = 0;
    generateText.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        vi.setSystemTime(Date.now() + 10_000); // fast first draft: the preflight lets a repair run
        return { text: VAGUE_REPLY, toolCalls: [], toolResults: [] };
      }
      return slow({ text: CONCRETE_REPLY, toolCalls: [], toolResults: [] }, 200_000);
    });

    const res = await run();

    expect(res).not.toBeNull();
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(generateText.mock.calls[1][0], "the provider call itself must be cancellable").toHaveProperty("abortSignal");
    expect(shippedTexts, "the repair outlived the budget: the first draft ships").toEqual([VAGUE_REPLY]);
    expect(cutLines()).toEqual([expect.objectContaining({ lane: "regen", step: "second_draft" })]);
  });

  it("a CoVe pass past the budget is cut and the unrevised draft ships", async () => {
    fakeAllTimers();
    generateText.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 10_000);
      return { text: CONCRETE_REPLY, toolCalls: [], toolResults: [] }; // passes the critic: no repair
    });
    verifyAndRevise.mockImplementation(() => slow({ changed: true, revised: "verified reply", questions: ["q"] }, 200_000));

    const res = await run();

    expect(res).not.toBeNull();
    expect(verifyAndRevise).toHaveBeenCalledTimes(1);
    expect(shippedTexts).toEqual([CONCRETE_REPLY]);
    expect(persistEvents[0]?.coveDone, "a cut CoVe stays owed to persist").toBeUndefined();
    expect(cutLines()).toEqual([expect.objectContaining({ lane: "regen", step: "cove" })]);
  });
});

// The client's stall reattach asks the active-stream registry whether this turn is still running.
// A buffered lane used to register only once its reply existed, so for the whole generation the
// registry said "nothing in flight" and the reattach could only report stuck.
describe("buffered lanes · the turn is in the registry while it is generated", () => {
  it("registers once, before the first draft, and completes after the ship", async () => {
    modelTaking(10_000);
    await run();
    expect(order).toEqual(["register:c1:t_test", "draft", "draft", "complete"]);
  });
});
