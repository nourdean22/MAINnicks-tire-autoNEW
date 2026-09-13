import { beforeEach, describe, expect, it, vi } from "vitest";

const { recordToolInvocation } = vi.hoisted(() => ({
  recordToolInvocation: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation,
  isConfigurationError: vi.fn(() => false),
}));

import { walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";

beforeEach(() => {
  recordToolInvocation.mockClear();
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
});
