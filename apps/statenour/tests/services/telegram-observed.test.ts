import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
  },
}));

import { sendTelegramObserved } from "@/lib/services/telegram-observed";

function configured() {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "123");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendTelegramObserved", () => {
  it("classifies a provider 200 + message id as provider_accepted", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    }));

    await expect(sendTelegramObserved("hello")).resolves.toEqual({
      state: "provider_accepted",
      messageId: 42,
    });
  });

  it("classifies an explicit provider rejection as known_failure", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, description: "Too Many Requests" }),
    }));

    await expect(sendTelegramObserved("hello")).resolves.toEqual({
      state: "known_failure",
      reason: "telegram_http_429",
      status: 429,
    });
  });

  it("classifies a transport timeout/rejection as UNKNOWN completion, never known failure", async () => {
    configured();
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));

    await expect(sendTelegramObserved("hello")).resolves.toEqual({
      state: "unknown_completion",
      reason: "TimeoutError",
    });
  });

  it("does not touch the network when Telegram is not configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendTelegramObserved("hello")).resolves.toEqual({
      state: "known_failure",
      reason: "not_configured",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
