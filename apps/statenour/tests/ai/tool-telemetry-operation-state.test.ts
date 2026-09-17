import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordToolInvocation, recordMetric, recordMetricStrict } = vi.hoisted(() => ({
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
  /** Kept so the mocked module still exports what other consumers import. */
  recordMetric: vi.fn().mockResolvedValue(undefined),
  // 2026-09-16 · was `recordMetric`. The integrity shadow now uses the
  // PROPAGATING writer, because the fail-soft one could never reject and so
  // made a dead instrument indistinguishable from a clean run. The mock
  // resolves a RECEIPT, matching the real dependency's shape.
  recordMetricStrict: vi.fn().mockResolvedValue({ id: "metric-row-1" }),
}));

vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation,
  isConfigurationError: vi.fn(() => false),
}));
// Both writers, explicitly — NOT `importOriginal()` here.
//
// The hand-written predecessor listed `recordMetric` alone, so when the subject
// switched to `recordMetricStrict` the import resolved a module without it and
// the spy never fired. Spreading the real module is the repo's usual cure, and
// it was tried first: it makes this file's assertions RACE. The real
// `lib/services/metrics` statically imports Prisma, so every dynamic
// `import("@/lib/services/metrics")` inside the fire-and-forget shadow then
// costs a client load — each write landed roughly one `it` block late, and
// `shadowCallFor` saw the PREVIOUS test's conversation.
//
// So the mock stays synthetic and fast, and the drift it risks is covered at
// the source level instead: `tests/lib/observability/instrument-failures.test.ts`
// asserts this subject uses `recordMetricStrict` and has no silent catch.
vi.mock("@/lib/services/metrics", () => ({ recordMetric, recordMetricStrict }));

import { walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";

beforeEach(() => {
  recordToolInvocation.mockClear();
  recordMetricStrict.mockClear();
});

const INTEGRITY_METRIC = "operation.integrity_shadow";

/**
 * Pick the integrity-shadow write belonging to THIS test's conversation.
 *
 * `mock.calls[0]` is not safe here. The integrity shadow is fire-and-forget,
 * so a previous test's write can resolve after `beforeEach` has cleared and
 * land as the next test's first call — the assertion then reads a payload from
 * another case and fails for a reason that has nothing to do with the subject.
 * Selecting by conversationId makes each case independent of arrival order.
 *
 * 2026-09-17 · conversationId ALONE stopped being enough. The same walk now
 * also records `tool.chosen`, which carries a conversationId tag of its own, so
 * a conversation-only filter can return the wrong row and assert the wrong
 * payload. The metric NAME is now part of the selector — the two instruments
 * share a writer and a correlation key, and only the name separates them.
 */
function shadowCallFor(conversationId: string) {
  const call = recordMetricStrict.mock.calls.find(
    (c) =>
      c[0] === INTEGRITY_METRIC &&
      (c[2] as { tags?: { conversationId?: string } } | undefined)?.tags?.conversationId === conversationId,
  );
  if (!call) {
    throw new Error(
      `no integrity-shadow write for ${conversationId}; saw ${JSON.stringify(
        recordMetricStrict.mock.calls.map((c) => [c[0], (c[2] as { tags?: { conversationId?: string } })?.tags?.conversationId]),
      )}`,
    );
  }
  return { value: call[1] as number, opts: call[2] as { tags: Record<string, unknown> } };
}

/** Every `tool.chosen` write recorded so far, newest last. */
function chosenCalls() {
  return recordMetricStrict.mock.calls
    .filter((c) => c[0] === "tool.chosen")
    .map((c) => ({
      value: c[1] as number,
      tags: (c[2] as { tags: Record<string, unknown> }).tags,
    }));
}

/**
 * Wait for the `tool.chosen` row carrying `traceId`, then return it.
 *
 * The lane is fire-and-forget behind a dynamic import, so the write lands after
 * `walkToolTelemetry` returns. A hand-rolled microtask flush was tried first
 * and was not enough — `vi.waitFor` is what the integrity-shadow assertions in
 * this file already use, and it polls on real timers instead of guessing at a
 * tick count. It also throws with the rows it DID see, so a miss reports what
 * actually arrived rather than a bare undefined.
 */
async function waitForChosen(traceId: string) {
  return vi.waitFor(() => {
    const row = chosenCalls().find((c) => c.tags.traceId === traceId);
    if (!row) {
      throw new Error(
        `no tool.chosen row for ${traceId}; saw ${JSON.stringify(
          chosenCalls().map((c) => c.tags.traceId),
        )}`,
      );
    }
    return row;
  });
}

describe("tool telemetry operation-state truth", () => {
  it("a successful read with an observed result is VERIFIED", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [
              { toolName: "getTasks", result: { tasks: [] }, executionDurationMs: 4 },
            ],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.effectClass).toBe("read");
    expect(call.resultObserved).toBe(true);
    expect(call.observationShape).toBe("sdk6-result");
    expect(call.operationState).toBe("VERIFIED");
    expect(call.ok).toBe(true);
    // Reads do not create a side-effect INTEGRITY row: they cannot support a
    // mutation "Done" claim and would only pollute the denominator.
    //
    // Scoped to that metric by name. The blanket `not.toHaveBeenCalled()` this
    // replaces was already wrong when `tool.chosen` shipped on the same writer,
    // and it kept passing only because the lane's dynamic import had not
    // resolved by the time the synchronous assertion ran. A negative assertion
    // that broad forbids instruments it was never written about.
    expect(
      recordMetricStrict.mock.calls.filter((c) => c[0] === INTEGRITY_METRIC),
    ).toEqual([]);
  });

  it("a successful write result is PROVIDER_ACCEPTED, not VERIFIED", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [
              { toolName: "createTask", result: { id: "task-1", ok: true } },
            ],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.effectClass).toBe("write");
    expect(call.operationState).toBe("PROVIDER_ACCEPTED");
    expect(call.operationState).not.toBe("VERIFIED");
  });

  it("AI SDK 7 output/input shape reaches the same write truth state", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [
              {
                toolName: "createTask",
                input: { title: "Call John" },
                output: { id: "task-7", ok: true },
              },
            ],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.args).toEqual({ title: "Call John" });
    expect(call.resultObserved).toBe(true);
    expect(call.observationShape).toBe("sdk7-output");
    expect(call.effectClass).toBe("write");
    expect(call.operationState).toBe("PROVIDER_ACCEPTED");
    expect(call.resultDigest).toContain("task-7");
  });

  it("an attempted write with no terminal result is UNKNOWN_COMPLETION", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolCalls: [{ toolName: "createTask", args: { title: "Call John" } }],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.resultObserved).toBe(false);
    expect(call.observationShape).toBe("call-only");
    expect(call.operationState).toBe("UNKNOWN_COMPLETION");
  });

  it("keeps an unmatched write call when another call in the step returned", () => {
    const calls = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolCalls: [
              { toolName: "getTasks", toolCallId: "tc-read", input: {} },
              {
                toolName: "createTask",
                toolCallId: "tc-write",
                input: { title: "Call John" },
              },
            ],
            toolResults: [
              {
                toolName: "getTasks",
                toolCallId: "tc-read",
                output: { tasks: [] },
              },
            ],
          },
        ],
      },
      convId: "c1",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(
      expect.objectContaining({ name: "getTasks", operationState: "VERIFIED" }),
    );
    expect(calls[1]).toEqual(
      expect.objectContaining({
        name: "createTask",
        observationShape: "call-only",
        operationState: "UNKNOWN_COMPLETION",
      }),
    );
  });

  it("a soft-error return is FAILED_KNOWN rather than SDK success", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [
              { toolName: "getTasks", result: { error: "database unavailable" } },
            ],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.ok).toBe(false);
    expect(call.operationState).toBe("FAILED_KNOWN");
  });

  it("a tool-error content part is FAILED_KNOWN and recorded as failure", async () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolCalls: [
              {
                toolName: "createTask",
                toolCallId: "tc-failed",
                input: { title: "Call John" },
              },
            ],
            content: [
              {
                type: "tool-error",
                toolCallId: "tc-failed",
                error: { message: "database unavailable" },
              },
            ],
          },
        ],
      },
      convId: "c-tool-error",
    });

    expect(call).toEqual(
      expect.objectContaining({
        name: "createTask",
        ok: false,
        args: { title: "Call John" },
        resultObserved: false,
        observationShape: "tool-error-part",
        effectClass: "write",
        operationState: "FAILED_KNOWN",
      }),
    );
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "createTask",
        success: false,
        errorMessage: "database unavailable",
        conversationId: "c-tool-error",
      }),
    );

    await vi.waitFor(() => shadowCallFor("c-tool-error"));
    const { value, opts } = shadowCallFor("c-tool-error");
    expect(value).toBe(1);
    expect(opts.tags.legacySdkSuccesses).toBe(0);
    expect(opts.tags.strictVerified).toBe(0);
    expect(opts.tags.legacyStrictGap).toBe(0);
    expect(opts.tags.operations).toEqual([
      expect.objectContaining({
        tool: "createTask",
        state: "FAILED_KNOWN",
        sdkOk: false,
        retryDecision: "MAY_RETRY",
      }),
    ]);
  });

  it("isError:true on a tool result is FAILED_KNOWN", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [
              {
                toolName: "createTask",
                output: "write rejected",
                isError: true,
              },
            ],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.ok).toBe(false);
    expect(call.observationShape).toBe("sdk7-output");
    expect(call.operationState).toBe("FAILED_KNOWN");
  });

  it("an unknown tool never earns VERIFIED from a plausible result", () => {
    const [call] = walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [{ toolName: "futureUncataloguedTool", result: { ok: true } }],
          },
        ],
      },
      convId: "c1",
    });

    expect(call.effectClass).toBe("unknown");
    expect(call.operationState).toBe("UNKNOWN_COMPLETION");
  });

  it("persists one shadow receipt that measures legacy-ok vs strict-verified gap", async () => {
    walkToolTelemetry({
      ev: {
        steps: [
          {
            toolResults: [
              { toolName: "getTasks", result: { tasks: [] } },
              { toolName: "createTask", result: { id: "task-1", ok: true } },
            ],
          },
        ],
      },
      convId: "conversation-7",
    });

    await vi.waitFor(() => shadowCallFor("conversation-7"));
    const { value, opts } = shadowCallFor("conversation-7");
    const metric = recordMetricStrict.mock.calls.find(
      (c) => (c[2] as { tags?: { conversationId?: string } })?.tags?.conversationId === "conversation-7",
    )![0];
    expect(metric).toBe("operation.integrity_shadow");
    expect(value).toBe(1); // only the write is consequential
    expect(opts.source).toBe("chat");
    expect(opts.tags.conversationId).toBe("conversation-7");
    expect(opts.tags.legacySdkSuccesses).toBe(1);
    expect(opts.tags.strictVerified).toBe(0);
    expect(opts.tags.legacyStrictGap).toBe(1);
    expect(opts.tags.operations).toEqual([
      expect.objectContaining({
        tool: "createTask",
        effectClass: "write",
        state: "PROVIDER_ACCEPTED",
        sdkOk: true,
        retryDecision: "VERIFY_BEFORE_CLAIM",
        mayClaimDoneStrict: false,
      }),
    ]);
  });
});

/**
 * `tool.chosen` — the numerator `tool.surfaced` never had.
 *
 * prepare-tools.ts has recorded the per-turn OFFERED set for months. Nothing
 * recorded what was actually CHOSEN on that turn, so every conversion question
 * fell back to `tool_telemetry`, which is lifetime-aggregate and cannot tell
 * "offered 109 times and declined" from "never offered". Sharing `traceId`
 * with the surfaced row turns that from a guess into a join.
 */
describe("tool.chosen · the per-turn numerator", () => {
  const step = (toolResults: unknown[]) => ({ steps: [{ toolResults }] });

  it("records the invoked names against the SAME traceId as tool.surfaced", async () => {
    walkToolTelemetry({
      ev: step([
        { toolName: "getTasks", result: { tasks: [] } },
        { toolName: "searchWebVerified", result: { hits: 2 } },
      ]),
      convId: "c-chosen-1",
      traceId: "trace-abc",
    });
    const row = await waitForChosen("trace-abc");
    // Sorted + distinct, so the value is directly comparable with the
    // surfaced row's count of distinct offered names.
    expect(row.tags.tools).toEqual(["getTasks", "searchWebVerified"]);
    expect(row.value).toBe(2);
  });

  it("CANARY: a turn where the model chose NOTHING still writes a row", async () => {
    // This is the entire reason the lane is unconditional. A turn that offered
    // 24 tools and used none is the most informative row a prune decision has.
    // Drop it and those turns leave the denominator, which makes "surfaced but
    // never chosen" read as "never surfaced" — the exact confound the tool
    // census exists to resolve. #2381 shipped this defect once already, as a
    // shadow recorder nested inside `if (actions.length > 0)`.
    walkToolTelemetry({ ev: { steps: [] }, convId: "c-chosen-empty", traceId: "trace-empty" });
    // If this throws, a zero-tool turn wrote NO row and those turns are now
    // invisible to the census — which is the defect this test exists to catch.
    const row = await waitForChosen("trace-empty");
    expect(row.value).toBe(0);
    expect(row.tags.tools).toEqual([]);
  });

  it("counts a tool called twice ONCE, and keeps the raw count separately", async () => {
    // Otherwise one retried tool reads as two conversions and inflates every
    // per-tier rate computed from this lane.
    walkToolTelemetry({
      ev: step([
        { toolName: "getTasks", result: { tasks: [] } },
        { toolName: "getTasks", result: { tasks: [1] } },
      ]),
      convId: "c-chosen-dup",
      traceId: "trace-dup",
    });
    const row = await waitForChosen("trace-dup");
    expect(row.tags.tools).toEqual(["getTasks"]);
    expect(row.value).toBe(1);
    expect(row.tags.invocations).toBe(2);
  });

  it("separates a FAILED invocation from a successful one", async () => {
    // A tool the model chose and that then failed is still a choice: it counts
    // as surfaced-and-wanted. Conflating it with success would overstate how
    // well the surfaced set performed.
    walkToolTelemetry({
      ev: step([
        { toolName: "getTasks", result: { tasks: [] } },
        { toolName: "sendTelegram", result: { error: "no chat id" } },
      ]),
      convId: "c-chosen-fail",
      traceId: "trace-fail",
    });
    const row = await waitForChosen("trace-fail");
    expect(row.tags.tools).toEqual(["getTasks", "sendTelegram"]);
    expect(row.tags.failed).toEqual(["sendTelegram"]);
  });

  it("POSITIVE CONTROL: the lane is not simply firing on everything", async () => {
    // Every assertion above would also be satisfied by a writer that emitted a
    // constant row. Two different turns must produce two different payloads.
    walkToolTelemetry({
      ev: step([{ toolName: "dailyPulse", result: { ok: true } }]),
      convId: "c-ctl-a",
      traceId: "trace-ctl-a",
    });
    walkToolTelemetry({
      ev: step([{ toolName: "createTask", result: { id: "t1" } }]),
      convId: "c-ctl-b",
      traceId: "trace-ctl-b",
    });
    const a = await waitForChosen("trace-ctl-a");
    const b = await waitForChosen("trace-ctl-b");
    expect(a.tags.tools).toEqual(["dailyPulse"]);
    expect(b.tags.tools).toEqual(["createTask"]);
    expect(a.tags.tools).not.toEqual(b.tags.tools);
  });
});
