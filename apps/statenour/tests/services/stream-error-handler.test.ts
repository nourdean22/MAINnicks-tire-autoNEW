/**
 * buildStreamErrorHandler stub-row shape · 2026-07-05 (audit P3 · c)
 *
 * Pre-P3 a mid-stream failure persisted the assistant stub with NO
 * streamingState (schema default "complete"), NO errorDetails, and a
 * "⚠️ Stream interrupted: …" annotation baked into `content` — which
 * hydration replayed to the model as genuine assistant speech, and the
 * error context hid inside the tokenUsage JSON where nothing reads it.
 *
 * These tests pin the honest shape: streamingState "errored",
 * structured errorDetails { code, message, provider, retryable },
 * and content = the bare partial text (or "" on a cold failure) with
 * no annotation. The MessageStatusBadge UI renders the error from
 * streamingState + errorDetails, so content stays clean.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const chatMessageCreateMock = vi.fn().mockResolvedValue({ id: "stub-1" });
const chatMessageUpdateMock = vi.fn().mockResolvedValue({ id: "stub-1" });
const errorLogCreateMock = vi.fn().mockResolvedValue({ id: "err-1" });
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: {
      create: (...args: unknown[]) => chatMessageCreateMock(...args),
      update: (...args: unknown[]) => chatMessageUpdateMock(...args),
    },
    errorLog: { create: (...args: unknown[]) => errorLogCreateMock(...args) },
  },
}));

// The handler dynamically imports the provider module for failure
// marking — mock it so the import never touches real provider state.
const markProviderFailedMock = vi.fn();
const markProviderQuotaExhaustedMock = vi.fn();
vi.mock("@/lib/ai/provider", async (importOriginal) => ({
  // real classifyModelId (the error handler classifies the failing model id);
  // only the side-effecting marks are stubbed.
  ...(await importOriginal<typeof import("@/lib/ai/provider")>()),
  markProviderFailed: (...args: unknown[]) => markProviderFailedMock(...args),
  markProviderQuotaExhausted: (...args: unknown[]) => markProviderQuotaExhaustedMock(...args),
  markGeminiQuotaExhausted: vi.fn(),
}));

import { buildStreamErrorHandler } from "@/lib/services/chat/stream-error-handler";
import type { ToolReceiptsSnapshot } from "@/lib/services/chat/in-flight-tool-calls";

function makeDeps(partialText: string) {
  return {
    convId: "conv-1",
    conversationId: "conv-1",
    model: { modelId: "gemini-3.5-flash" },
    traceId: "trace-1",
    provider: "gemini" as const,
    modelId: "gemini-3.5-flash",
    startedAt: Date.now() - 1500,
    partial: { text: partialText },
    log: { info: vi.fn(), warn: vi.fn() },
    recordTrace: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chatMessageCreateMock.mockResolvedValue({ id: "stub-1" });
  chatMessageUpdateMock.mockResolvedValue({ id: "stub-1" });
  errorLogCreateMock.mockResolvedValue({ id: "err-1" });
});

describe("audit P3c · honest errored stub rows", () => {
  it("persists partial text with streamingState errored + structured errorDetails, no annotation", async () => {
    const partial = "Here is the start of a long answer about your Q3 revenue numbers";
    const onError = buildStreamErrorHandler(makeDeps(partial));

    await onError({ error: new Error("upstream connection reset") });

    expect(chatMessageCreateMock).toHaveBeenCalledTimes(1);
    const { data } = chatMessageCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.streamingState).toBe("errored");
    expect(data.errorDetails).toMatchObject({
      code: "stream_interrupted",
      message: expect.stringContaining("upstream connection reset"),
      provider: "gemini",
      retryable: true,
    });
    // Content is the bare partial reply — exactly what the user saw.
    expect(data.content).toBe(partial);
    expect(String(data.content)).not.toContain("⚠️");
    expect(String(data.content)).not.toMatch(/stream interrupted/i);
  });

  it("cold failure (<20 chars partial) persists an EMPTY content stub, not an error sentence", async () => {
    const onError = buildStreamErrorHandler(makeDeps("Hi"));

    await onError({ error: new Error("HTTP 503 from provider") });

    expect(chatMessageCreateMock).toHaveBeenCalledTimes(1);
    const { data } = chatMessageCreateMock.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(data.streamingState).toBe("errored");
    expect(data.content).toBe("");
    expect(data.errorDetails).toMatchObject({
      code: "stream_interrupted",
      message: expect.stringContaining("HTTP 503"),
      provider: "gemini",
      retryable: true,
    });
  });

  it("still marks the failing provider and writes the trace + error log", async () => {
    const deps = makeDeps("A meaningful partial reply that is long enough.");
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("boom") });

    expect(markProviderFailedMock).toHaveBeenCalledWith("gemini");
    expect(deps.recordTrace).toHaveBeenCalledTimes(1);
    expect(errorLogCreateMock).toHaveBeenCalledTimes(1);
  });

  it("skips the persist entirely when convId is missing", async () => {
    const deps = { ...makeDeps("Some partial text that is long enough."), convId: null };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("boom") });

    expect(chatMessageCreateMock).not.toHaveBeenCalled();
  });
});

/**
 * The errored row used to carry no tokenUsage, so a reload could not tell
 * "no tool ran" from "a tool ran and the record was lost", and Retry was
 * refused only because the whole blob was absent. The row now records which
 * tools were started, or says it cannot. Never `null`, and never a list that
 * claims "no write ran" while the stream can still run one: ai@6 does not treat
 * an error part as terminal, so a tool-call plus finish(tool-calls) after it
 * still executes. Before the stream has ended the row lists only what already
 * counts as a possible write; "nothing ran" is claimed only after the stream
 * has ended (the record is then final), by updating the row.
 */
describe("errored turns record which tools were started, or say they cannot", () => {
  const writeRow = {
    toolName: "createTask",
    category: "personal_write",
    sideEffecting: true,
    verifiable: true,
    status: "partial",
    verificationState: "UNKNOWN_COMPLETION",
    entityType: null,
    entityId: null,
  };
  const erroredTokenUsage = () => {
    const { data } = chatMessageCreateMock.mock.calls[0][0] as { data: Record<string, unknown> };
    return data.tokenUsage;
  };
  const failWith = (toolReceipts: unknown) =>
    buildStreamErrorHandler({ ...makeDeps("Created the task and then"), toolReceipts } as never)({ error: new Error("provider dropped") });

  const readRow = { ...writeRow, toolName: "searchMemories", category: "brain", sideEffecting: false };
  const unplacedRow = { ...writeRow, toolName: "notInTheCatalog", category: "unknown", sideEffecting: false, verifiable: false };
  const snapshot = (receipts: unknown[], terminal: boolean): (() => ToolReceiptsSnapshot) => () =>
    ({ trustworthy: true, terminal, receipts }) as ToolReceiptsSnapshot;

  it("while the stream may still run tools: a write already seen is listed, as a lower bound", async () => {
    await failWith(snapshot([writeRow], false));

    expect(erroredTokenUsage()).toEqual({ traceId: "trace-1", toolReceipts: [writeRow] });
  });

  it("while the stream may still run tools: a tool the classifier cannot place is listed too", async () => {
    await failWith(snapshot([unplacedRow], false));

    expect(erroredTokenUsage()).toEqual({ traceId: "trace-1", toolReceipts: [unplacedRow] });
  });

  // The unsound claim this replaces: a snapshot taken at the first error part
  // wrote toolReceipts: [] ("nothing ran") although a tool-call and a
  // finish(tool-calls) could still follow and execute.
  it.each([
    ["nothing seen yet", []],
    ["only reads seen so far", [readRow]],
  ])("while the stream may still run tools: %s is NOT claimed, the row says receiptsUnavailable", async (_label, receipts) => {
    await failWith(snapshot(receipts, false));

    const usage = erroredTokenUsage();
    expect(usage).toEqual({ traceId: "trace-1", receiptsUnavailable: true });
    expect(usage).not.toHaveProperty("toolReceipts");
  });

  it("once the stream has ended, a final record of no tool is claimed as [] (nothing ran)", async () => {
    await failWith(snapshot([], true));

    expect(erroredTokenUsage()).toEqual({ traceId: "trace-1", toolReceipts: [] });
  });

  it("once the stream has ended, a final record of reads only is claimed as it stands", async () => {
    await failWith(snapshot([readRow], true));

    expect(erroredTokenUsage()).toEqual({ traceId: "trace-1", toolReceipts: [readRow] });
  });

  it("an untrustworthy accumulator writes receiptsUnavailable and NO toolReceipts key at all", async () => {
    await failWith((): ToolReceiptsSnapshot => ({ trustworthy: false }));

    const usage = erroredTokenUsage();
    expect(usage).toEqual({ traceId: "trace-1", receiptsUnavailable: true });
    expect(usage).not.toHaveProperty("toolReceipts");
  });

  it.each([
    ["no accumulator wired", undefined],
    ["an accumulator that returns nothing", () => undefined],
    ["an accumulator that throws", () => { throw new Error("accumulator broke"); }],
  ])("%s: receiptsUnavailable, never a guess", async (_label, getter) => {
    await failWith(getter);

    const usage = erroredTokenUsage();
    expect(usage).toEqual({ traceId: "trace-1", receiptsUnavailable: true });
    expect(usage).not.toHaveProperty("toolReceipts");
  });

  it("a broken accumulator still writes the row and still terminates the stream", async () => {
    const deps = { ...makeDeps("Created the task and then"), onWorkComplete: vi.fn() };
    const onError = buildStreamErrorHandler({ ...deps, toolReceipts: () => { throw new Error("accumulator broke"); } } as never);

    await onError({ error: new Error("provider dropped") });

    expect(chatMessageCreateMock).toHaveBeenCalledTimes(1);
    expect(deps.onWorkComplete).toHaveBeenCalledTimes(1);
  });

  describe("when the stream ends, the errored row is settled to what the final record says", () => {
    // The handler hands the accumulator a callback; the route runs it when the
    // stream is drained. Here the test is the route.
    function wire(initial: () => ToolReceiptsSnapshot) {
      let current = initial;
      let settle: (() => Promise<void> | void) | undefined;
      const onError = buildStreamErrorHandler({
        ...makeDeps("Created the task and then"),
        toolReceipts: () => current(),
        afterTerminal: (cb: () => Promise<void> | void) => {
          settle = cb;
        },
      } as never);
      return {
        onError,
        endStream: async (final: () => ToolReceiptsSnapshot) => {
          current = final;
          await settle?.();
        },
        registered: () => settle !== undefined,
      };
    }

    it("a cold failure (nothing ran) goes from receiptsUnavailable to [] on the same row: Retry becomes safe", async () => {
      const w = wire(snapshot([], false));
      await w.onError({ error: new Error("provider dropped") });
      expect(erroredTokenUsage()).toEqual({ traceId: "trace-1", receiptsUnavailable: true });

      await w.endStream(snapshot([], true));

      expect(chatMessageUpdateMock).toHaveBeenCalledTimes(1);
      expect(chatMessageUpdateMock).toHaveBeenCalledWith({ where: { id: "stub-1" }, data: { tokenUsage: { traceId: "trace-1", toolReceipts: [] } } });
    });

    it("a tool that ran after the error part is recorded on the row once the stream ends", async () => {
      const w = wire(snapshot([], false));
      await w.onError({ error: new Error("provider dropped") });

      await w.endStream(snapshot([writeRow], true));

      expect(chatMessageUpdateMock).toHaveBeenCalledWith({ where: { id: "stub-1" }, data: { tokenUsage: { traceId: "trace-1", toolReceipts: [writeRow] } } });
    });

    it("an untrustworthy final record leaves the row as it was: never overwritten with a guess", async () => {
      const w = wire(snapshot([writeRow], false));
      await w.onError({ error: new Error("provider dropped") });

      await w.endStream((): ToolReceiptsSnapshot => ({ trustworthy: false }));

      expect(chatMessageUpdateMock).not.toHaveBeenCalled();
    });

    it("nothing is registered when the stub row could not be written (no id to settle)", async () => {
      chatMessageCreateMock.mockRejectedValue(new Error("db down"));
      const w = wire(snapshot([], false));

      await w.onError({ error: new Error("provider dropped") });

      expect(w.registered()).toBe(false);
    });

    it("a failing settle never throws into the stream", async () => {
      chatMessageUpdateMock.mockRejectedValue(new Error("db down"));
      const w = wire(snapshot([], false));
      await w.onError({ error: new Error("provider dropped") });

      await expect(w.endStream(snapshot([], true))).resolves.toBeUndefined();
    });

    it("without afterTerminal wired the row stays receiptsUnavailable for good", async () => {
      await failWith(snapshot([], false));

      expect(erroredTokenUsage()).toEqual({ traceId: "trace-1", receiptsUnavailable: true });
      expect(chatMessageUpdateMock).not.toHaveBeenCalled();
    });
  });
});

/**
 * 2026-07-16 chat audit · quota-breaker wiring + unknown-modelId fallback.
 *
 * (1) The openai/anthropic quota breakers existed in provider.ts but were
 *     UNWIRED — mark was never exported and the handler special-cased
 *     gemini only, so a 429/insufficient_quota on the paid lanes never
 *     tripped their breaker and the 07-15 outage burned ~29s/call
 *     re-trying dead lanes. Every provider failure must now route
 *     through markProviderQuotaExhausted(provider, errMsg).
 * (2) When the modelId can't be classified, marking used to silently
 *     no-op — the dead lane was re-picked every retry. The handler
 *     KNOWS the selected lane (deps.provider) — it must fall back to it
 *     and log loudly.
 */
describe("2026-07-16 audit · quota breakers wired + no silent no-op marking", () => {
  it("routes an openai quota error through markProviderQuotaExhausted", async () => {
    const deps = {
      ...makeDeps("A meaningful partial reply that is long enough."),
      model: { modelId: "gpt-4o" },
      provider: "openai" as const,
      modelId: "gpt-4o",
    };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("429 insufficient_quota — you exceeded your current quota") });

    expect(markProviderFailedMock).toHaveBeenCalledWith("openai");
    expect(markProviderQuotaExhaustedMock).toHaveBeenCalledWith(
      "openai",
      expect.stringContaining("insufficient_quota"),
    );
  });

  it("routes an anthropic billing error through markProviderQuotaExhausted", async () => {
    const deps = {
      ...makeDeps("A meaningful partial reply that is long enough."),
      model: { modelId: "claude-3-5-sonnet-latest" },
      provider: "anthropic" as const,
      modelId: "claude-3-5-sonnet-latest",
    };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("Your credit balance is too low to access the Anthropic API") });

    expect(markProviderFailedMock).toHaveBeenCalledWith("anthropic");
    expect(markProviderQuotaExhaustedMock).toHaveBeenCalledWith(
      "anthropic",
      expect.stringContaining("credit balance"),
    );
  });

  it("falls back to the KNOWN deps.provider when the modelId is unclassifiable (no silent no-op)", async () => {
    const deps = {
      ...makeDeps("A meaningful partial reply that is long enough."),
      model: { modelId: "mystery-model-9000" },
      provider: "openai" as const,
      modelId: "mystery-model-9000",
    };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("upstream 503") });

    // Pre-fix: classifyModelId → null → marking silently skipped.
    expect(markProviderFailedMock).toHaveBeenCalledWith("openai");
    // …and the inference failure is logged loudly, with the modelId.
    expect(deps.log.warn).toHaveBeenCalledWith(
      "provider_marking_inference_failed_using_known_provider",
      expect.objectContaining({ modelId: "mystery-model-9000", fallbackProvider: "openai" }),
    );
  });
});

// ── 2026-07-25 · provider-drought incident · errored streams terminate ──
//
// Two verified defects on the errored-stream leg: (1) onFinish does not fire
// when the stream fails before its first step, so unless onError resolves the route's
// onFinishPromise the SSE zombie-heartbeats to maxDuration; (2) ai@6's
// default toUIMessageStreamResponse onError echoes error.message verbatim
// to the client (API-key leak class). These pins keep both fixes honest.

import {
  categorizeStreamError,
  clientSafeStreamErrorText,
  CLIENT_SAFE_STREAM_ERROR_TEXT,
} from "@/lib/services/chat/stream-error-handler";

describe("2026-07-25 · errored streams resolve onFinishPromise", () => {
  it("calls onWorkComplete after the persist completes (stream terminates)", async () => {
    const deps = { ...makeDeps("a long enough partial reply to persist"), onWorkComplete: vi.fn() };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("provider dropped mid-stream") });

    expect(deps.onWorkComplete).toHaveBeenCalledTimes(1);
    // Ordering: the errored ChatMessage row is written BEFORE the resolver
    // fires, so a fast client reload can't race an unpersisted row.
    expect(chatMessageCreateMock).toHaveBeenCalledTimes(1);
    expect(deps.onWorkComplete.mock.invocationCallOrder[0]).toBeGreaterThan(
      chatMessageCreateMock.mock.invocationCallOrder[0],
    );
  });

  it("still calls onWorkComplete when the persist writes reject", async () => {
    // Note: these rejections are .catch()'d inside the handler, so this case
    // does NOT exercise `finally` — it is covered separately below.
    chatMessageCreateMock.mockRejectedValue(new Error("db down"));
    errorLogCreateMock.mockRejectedValue(new Error("db down"));
    const deps = { ...makeDeps("partial text long enough to persist"), onWorkComplete: vi.fn() };
    const onError = buildStreamErrorHandler(deps);

    await onError({ error: new Error("provider dropped mid-stream") });

    expect(deps.onWorkComplete).toHaveBeenCalledTimes(1);
  });

  it("calls onWorkComplete when the try block itself THROWS (real finally semantics)", async () => {
    // 2026-07-28 audit fix: the previous version of this test claimed to
    // prove `finally` but only rejected promises the handler already
    // swallows — it passed identically with a plain call at the end of the
    // try. Throwing from the logger enters the outer catch, so only a real
    // `finally` still fires the resolver. Without it the SSE would hang.
    const deps = {
      ...makeDeps("some partial"),
      log: {
        info: vi.fn(),
        warn: vi.fn(() => {
          throw new Error("logger blew up mid-handler");
        }),
      },
      onWorkComplete: vi.fn(),
    };
    const onError = buildStreamErrorHandler(deps);

    await expect(onError({ error: new Error("boom") })).resolves.toBeUndefined();
    expect(deps.onWorkComplete).toHaveBeenCalledTimes(1);
  });

  it("stays optional — handler still resolves without onWorkComplete", async () => {
    const onError = buildStreamErrorHandler(makeDeps("some partial"));
    await expect(onError({ error: new Error("boom") })).resolves.toBeUndefined();
  });
});

// The card used to say "tap Retry to continue". Retry after a stream error now reads
// the saved turn first and holds when a tool may already have run, so no authored
// sentence may promise a bare Retry: each one that mentions Retry says it checks.
describe("the authored error sentences never promise a Retry the gate may refuse", () => {
  const sentences = [
    CLIENT_SAFE_STREAM_ERROR_TEXT,
    categorizeStreamError(new Error("image_url unsupported")),
    categorizeStreamError(new Error("429 quota exceeded")),
    categorizeStreamError(new Error("ETIMEDOUT")),
  ];

  it.each(sentences.map((s) => [s]))("%s", (sentence) => {
    expect(sentence).toMatch(/Retry/);
    expect(sentence).toMatch(/to check and continue/i);
  });

  it("the sentences that never mention Retry are left alone", () => {
    expect(categorizeStreamError(new Error("maximum context length exceeded"))).not.toMatch(/Retry/);
  });
});

describe("2026-07-25 · client-visible stream error text never echoes the error", () => {
  it("returns the constant for any error — including key-bearing auth failures", () => {
    // Assembled at runtime — a key-shaped LITERAL in source trips the
    // gitleaks hard gate (it can't know a fixture from a leak, correctly).
    const fakeKey = ["sk", "abc123SECRET"].join("-");
    const leaky = new Error(`Invalid API key: ${fakeKey}`);
    expect(clientSafeStreamErrorText(leaky)).toBe(CLIENT_SAFE_STREAM_ERROR_TEXT);
    expect(clientSafeStreamErrorText(leaky)).not.toContain(fakeKey);
    expect(clientSafeStreamErrorText({ message: `401 ${fakeKey}` })).toBe(CLIENT_SAFE_STREAM_ERROR_TEXT);
    expect(clientSafeStreamErrorText(undefined)).toBe(CLIENT_SAFE_STREAM_ERROR_TEXT);
  });

  it("does not contain the client transport auto-retry trigger substrings", () => {
    const lower = CLIENT_SAFE_STREAM_ERROR_TEXT.toLowerCase();
    for (const trigger of ["failed to fetch", "networkerror", "fetch failed"]) {
      expect(lower).not.toContain(trigger);
    }
  });
});
