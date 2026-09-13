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
    expect(call.operationState).toBe("UNKNOWN_COMPLETION");
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
