import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordToolInvocation, recordMetric } = vi.hoisted(() => ({
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
  recordMetric: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation,
  isConfigurationError: vi.fn(() => false),
}));
vi.mock("@/lib/services/metrics", () => ({ recordMetric }));

import { walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";

beforeEach(() => {
  recordToolInvocation.mockClear();
  recordMetric.mockClear();
});

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
    // Reads do not create a side-effect integrity row: they cannot support a
    // mutation "Done" claim and would only pollute the denominator.
    expect(recordMetric).not.toHaveBeenCalled();
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

    await vi.waitFor(() => expect(recordMetric).toHaveBeenCalledTimes(1));
    const [, value, opts] = recordMetric.mock.calls[0];
    expect(value).toBe(1);
    expect(opts.tags.legacySdkSuccesses).toBe(0);
    expect(opts.tags.strictVerified).toBe(0);
    expect(opts.tags.legacyStrictGap).toBe(0);
    expect(opts.tags.operations).toEqual([
      expect.objectContaining({
        tool: "createTask",
        state: "FAILED_KNOWN",
        sdkOk: false,
        retryDecision: "RETRY_ALLOWED",
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

    await vi.waitFor(() => expect(recordMetric).toHaveBeenCalledTimes(1));
    const [metric, value, opts] = recordMetric.mock.calls[0];
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
