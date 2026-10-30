/**
 * 2026-10-30 · the temporal check only judges calls that were timed.
 *
 * Prod: AI SDK 6 tool results carry no duration, so ai-sdk-tool-observation records 0 ms
 * and every call was logged "completed in 0ms (expected >= 5ms)". Two calls of the same tool
 * in one turn also shared one brainMemory key. Synthetic prose, no prod data.
 */
import { describe, it, expect, vi } from "vitest";

const create = vi.hoisted(() => vi.fn(async () => ({})));
// Other post-persist writers (convId set) get inert models; only brainMemory.create is observed.
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, model) => (model === "brainMemory" ? { create } : new Proxy({}, { get: () => vi.fn(async () => null) })),
  }),
}));
vi.mock("@/lib/errors/record-error", () => ({ withErrorCapture: vi.fn() }));
vi.mock("@/lib/ai/track", () => ({ trackGeneration: vi.fn() }));

import { runPostPersistVerification } from "@/lib/services/chat/post-persist-verification";

function run(calls: Array<{ durationMs: number; notRun?: boolean }>) {
  create.mockClear();
  const log = { info: vi.fn(), warn: vi.fn() };
  const input = {
    cleanedText: "Here is the list.",
    reasoningText: "",
    createdAssistantId: null,
    capturedToolCalls: calls.map((c) => ({ name: "getTasks", ok: true, args: {}, resultObserved: true, ...c })),
    envVerification: calls.map(() => ({ toolName: "getTasks", verified: null, reason: "No specific environment verifier exists" })),
    usage: undefined,
    convId: "c1",
    traceId: "t1",
    provider: "ollama",
    modelId: "fake-model",
    mode: "standard",
    personality: "default",
    finalTaskType: "chat",
    userContent: "a synthetic question",
    turnSignal: { intent: "question", outputShape: "short" },
    contextBlocksFired: {},
    deeperContextCount: 0,
    deeperContextTypes: [],
    startedAt: Date.now(),
    firstTokenRef: { value: null },
    critic: null,
    recordTrace: vi.fn(),
    log,
  } as never;
  return { log, done: runPostPersistVerification(input) };
}

const temporalWarns = (log: { warn: ReturnType<typeof vi.fn> }) =>
  log.warn.mock.calls.filter(([event]) => event === "temporal_inconsistency_detected").length;

describe("temporal consistency in post-persist verification", () => {
  it("an untimed call (0 ms) or a never-run call is not judged", async () => {
    const { log, done } = run([{ durationMs: 0 }, { durationMs: 0, notRun: true }]);
    await done;
    expect(temporalWarns(log)).toBe(0);
    expect(create).not.toHaveBeenCalled();
    // The skipped instrument still says so, once per turn.
    expect(log.info).toHaveBeenCalledWith("temporal_untimed", expect.objectContaining({ untimed: 2, total: 2 }));
  });

  it("POSITIVE CONTROL: a timed call faster than its floor is still flagged, one key per call", async () => {
    const { log, done } = run([{ durationMs: 2 }, { durationMs: 3 }]);
    await done;
    expect(temporalWarns(log)).toBe(2);
    const keys = create.mock.calls.map((c) => (c as unknown as [{ data: { key: string } }])[0].data.key);
    expect(new Set(keys).size).toBe(2);
  });
});
