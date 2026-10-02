/**
 * telegram-webhook-status · 2026-10-02
 *
 * Pinned: each answer from getWebhookInfo maps to its own state; unknown is
 * never "registered"; the token never appears in what is returned, even when
 * the request fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyWebhook, getTelegramWebhookStatus } from "@/lib/services/telegram-webhook-status";

const TOKEN = "123456:SECRET-token-value";
const answer = (body: unknown) => vi.fn().mockResolvedValue({ json: async () => body }) as unknown as typeof fetch;

beforeEach(() => vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN));
afterEach(() => vi.unstubAllEnvs());

describe("classifyWebhook", () => {
  it("this app's route on a known host is registered; trailing slash tolerated", () => {
    expect(classifyWebhook("https://bdnick.info/api/telegram/webhook")).toEqual({ state: "registered", url: "bdnick.info/api/telegram/webhook" });
    expect(classifyWebhook("https://statenour-web-production.up.railway.app/api/telegram/webhook/").state).toBe("registered");
  });

  it("another route, another host, or no URL is not registered", () => {
    expect(classifyWebhook("https://bdnick.info/api/telegram/revenue-decision-callback").state).toBe("elsewhere");
    expect(classifyWebhook("https://nickstire.org/api/telegram/webhook").state).toBe("elsewhere");
    expect(classifyWebhook("").state).toBe("unregistered");
  });

  it("never shows a query string (a secret could ride in one)", () => {
    expect(classifyWebhook("https://x.example/hook?secret=abc").url).toBe("x.example/hook");
  });
});

describe("getTelegramWebhookStatus", () => {
  it("reports where updates go, pending count and Telegram's last error", async () => {
    const s = await getTelegramWebhookStatus(
      answer({ ok: true, result: { url: "https://old.example/hook", pending_update_count: 42, last_error_message: "Wrong response from the webhook: 404", last_error_date: 1759400000 } }),
    );
    expect(s).toMatchObject({ state: "elsewhere", url: "old.example/hook", pendingUpdates: 42, lastError: "Wrong response from the webhook: 404" });
    expect(s.lastErrorAt).toBe(new Date(1759400000 * 1000).toISOString());
  });

  it("no token, a thrown request, and ok:false are three named unknowns, never registered", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    expect((await getTelegramWebhookStatus(answer({}))).state).toBe("unconfigured");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
    const thrown = await getTelegramWebhookStatus(vi.fn().mockRejectedValue(new Error(`fetch failed for https://api.telegram.org/bot${TOKEN}/getWebhookInfo`)) as unknown as typeof fetch);
    expect(thrown.state).toBe("unreadable");
    expect(JSON.stringify(thrown)).not.toContain("SECRET");
    const notOk = await getTelegramWebhookStatus(answer({ ok: false, description: "Unauthorized" }));
    expect(notOk).toMatchObject({ state: "unreadable", reason: "Unauthorized" });
  });

  it("the token is used in the request and absent from every returned field", async () => {
    const f = answer({ ok: true, result: { url: "https://bdnick.info/api/telegram/webhook", pending_update_count: 0 } });
    const s = await getTelegramWebhookStatus(f);
    expect((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]).toContain(`/bot${TOKEN}/getWebhookInfo`);
    expect(s.state).toBe("registered");
    expect(JSON.stringify(s)).not.toContain("SECRET");
  });
});
