import { beforeEach, describe, expect, it, vi } from "vitest";

const recordToolInvocation = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/ai/tool-telemetry", () => ({
  recordToolInvocation,
  isConfigurationError: () => false,
}));

import { walkToolTelemetry } from "@/lib/services/chat/tool-telemetry-walk";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("walkToolTelemetry · control-plane outcomes", () => {
  it("marks an explicit soft error as not OK and preserves the state in resultDigest", () => {
    const calls = walkToolTelemetry({
      convId: "conv-test",
      ev: {
        steps: [
          {
            toolResults: [
              {
                toolName: "sendTelegram",
                result: {
                  sent: false,
                  state: "unknown_completion",
                  error: "Telegram completion is unknown; do not retry blindly.",
                },
              },
            ],
          },
        ],
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: "sendTelegram", ok: false });
    expect(calls[0].resultDigest).toContain("unknown_completion");
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "sendTelegram",
        success: false,
        errorMessage: expect.stringContaining("unknown"),
      }),
    );
  });

  it("keeps a provider-accepted result OK when no error field exists", () => {
    const calls = walkToolTelemetry({
      convId: "conv-test",
      ev: {
        steps: [
          {
            toolResults: [
              {
                toolName: "sendTelegram",
                result: {
                  sent: true,
                  state: "provider_accepted",
                  messageId: 42,
                },
              },
            ],
          },
        ],
      },
    });

    expect(calls[0]).toMatchObject({ name: "sendTelegram", ok: true });
    expect(calls[0].resultDigest).toContain("provider_accepted");
    expect(recordToolInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "sendTelegram", success: true }),
    );
  });
});
