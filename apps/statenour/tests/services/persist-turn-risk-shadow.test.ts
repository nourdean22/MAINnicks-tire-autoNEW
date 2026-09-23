/**
 * The E3 shadow that buildOnFinish persists replays the ROUTING-TIME toolsExpected (review on
 * #2509 P1; behavioural per #2560 P1 - a source contract would stay green if the wiring went dead).
 *
 * Drives the real buildOnFinish through the same prisma/logger mocks as persist-empty-tool-turn.test.ts
 * and reads the stamp off the persisted row's tokenUsage.evidenceGate.turnRisk. The user text is a
 * lookup ("who is …") that trips nothing else in assessTurnRisk, so toolsExpected alone decides the
 * verdict: false -> buffer (factual lookup with no tool), true -> stream.
 *
 *   routed true   -> toolsExpected true,  source "routing",    buffer false (even with NO tool call)
 *   routed false  -> toolsExpected false, source "routing",    buffer true  (even WITH a tool call)
 *   absent        -> recomputed from the tool calls that ran, source "recomputed"
 *
 * The middle two are the cases the recompute got backwards. Positive control (recorded): against the
 * pre-#2560 writer the routed cases fail (no source stamp; toolsExpected follows the tool calls).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockChatMessageCreate = vi.fn();
vi.mock("@/lib/prisma", () => {
  const passthrough = {
    create: () => Promise.resolve({ id: "x" }),
    update: () => Promise.resolve({ id: "x" }),
    upsert: () => Promise.resolve({ id: "x" }),
    delete: () => Promise.resolve({ id: "x" }),
    findFirst: () => Promise.resolve(null),
    findUnique: () => Promise.resolve(null),
    findMany: () => Promise.resolve([]),
    count: () => Promise.resolve(0),
    updateMany: () => Promise.resolve({ count: 0 }),
    createMany: () => Promise.resolve({ count: 0 }),
    groupBy: () => Promise.resolve([]),
  };
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === "chatMessage") {
            return {
              ...passthrough,
              create: (args: unknown) => {
                mockChatMessageCreate(args);
                return Promise.resolve({ id: "m-1" });
              },
            };
          }
          if (prop === "$queryRaw" || prop === "$executeRaw") return () => Promise.resolve([]);
          return passthrough;
        },
      },
    ),
  };
});

vi.mock("@/lib/errors/record-error", () => ({
  recordError: () => {},
  withErrorCapture: (_label: string, fn: () => unknown) => {
    try {
      void fn();
    } catch {
      /* swallowed like the real wrapper */
    }
  },
}));

vi.mock("@/lib/logger", () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return { logger: { withSurface: () => noop, ...noop } };
});

import { buildOnFinish } from "@/lib/services/chat/persist-assistant-turn";

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
// A lookup shape: LOOKUP_RE ("who is") fires; no resource ask, health, technical, number or
// commitment phrase, so toolsExpected is the only input that moves `buffer`.
const LOOKUP_ASK = "who is the founder of the shop across the street from ours";

function makeDeps(toolsExpected: boolean | undefined) {
  return {
    log: noopLog,
    conversationId: "conv-1",
    convId: "conv-1",
    provider: "ollama",
    modelId: "deepseek-v4-pro",
    model: "deepseek-v4-pro",
    mode: "standard",
    personality: "nick",
    contentMode: null,
    finalSystemPrompt: "sys",
    systemPrompt: "sys",
    finalTaskType: "reason",
    userContent: LOOKUP_ASK,
    ...(toolsExpected === undefined ? {} : { toolsExpected }),
    turnSignal: { temperature: 0.5 },
    contextBlocksFired: [],
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { current: null },
    traceId: "t_test",
    recordTrace: vi.fn(),
    messages: [],
    topicTier: null,
    modeOverride: null,
  } as never;
}

interface Stamp {
  buffer: boolean;
  toolsFired: number;
  toolsExpected: boolean;
  toolsExpectedSource: "routing" | "recomputed";
}

async function persist(toolsExpected: boolean | undefined, withToolCall: boolean): Promise<Stamp> {
  const onFinish = buildOnFinish(makeDeps(toolsExpected));
  await onFinish({
    text: "The shop across the street was founded by someone I would have to look up.",
    finishReason: "stop",
    // The telemetry walk reads ev.steps[].toolResults (tool-telemetry-walk.ts), not top-level toolCalls.
    steps: withToolCall ? [{ toolResults: [{ toolName: "webSearch", result: { ok: true } }] }] : [],
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  } as never);
  expect(mockChatMessageCreate).toHaveBeenCalledTimes(1);
  const created = mockChatMessageCreate.mock.calls[0][0] as { data: { tokenUsage?: { evidenceGate?: { turnRisk?: Stamp } } } };
  const stamp = created.data.tokenUsage?.evidenceGate?.turnRisk;
  expect(stamp, "the persisted row carries evidenceGate.turnRisk").toBeTruthy();
  return stamp as Stamp;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persist-assistant-turn · the E3 shadow replays the routing-time toolsExpected", () => {
  it("routed true with NO tool call: the shadow trusts routing and streams (the recompute said buffer)", async () => {
    const s = await persist(true, false);
    expect(s.buffer, "verdict follows routing, not the tool calls").toBe(false);
    expect(s.toolsFired).toBe(0);
    expect(s.toolsExpected).toBe(true);
    expect(s.toolsExpectedSource).toBe("routing");
  });

  it("routed false WITH a tool call: the shadow trusts routing and buffers (the recompute said stream)", async () => {
    const s = await persist(false, true);
    expect(s.buffer, "verdict follows routing, not the tool calls").toBe(true);
    expect(s.toolsFired).toBe(1);
    expect(s.toolsExpected).toBe(false);
    expect(s.toolsExpectedSource).toBe("routing");
  });

  it("CONTROL: absent (a caller that never routed) recomputes from the tool calls and says so", async () => {
    const s = await persist(undefined, true);
    expect(s.toolsExpected).toBe(true);
    expect(s.toolsExpectedSource).toBe("recomputed");
    expect(s.buffer).toBe(false);
  });

  it("CONTROL: absent with no tool call recomputes false and buffers", async () => {
    const s = await persist(undefined, false);
    expect(s.toolsExpected).toBe(false);
    expect(s.toolsExpectedSource).toBe("recomputed");
    expect(s.buffer).toBe(true);
  });
});
