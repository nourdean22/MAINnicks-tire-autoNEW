/**
 * Telegram alert diet · nothing claims "sent" that was not accepted, and a lost send is counted.
 *
 * Transport tests run the REAL services/telegram.ts against a stubbed fetch (the Bot API is
 * never reached). Each test loads a fresh module so the in-process counters start at zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "4242";
  return {};
});
void env;

type TelegramModule = typeof import("./services/telegram");
async function load(): Promise<TelegramModule> {
  vi.resetModules();
  return import("./services/telegram");
}

function stubTelegram(handler: (method: string, body: Record<string, unknown>) => Response) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    const method = String(url).split("/").pop() as string;
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ method, body });
    return handler(method, body);
  });
  return calls;
}
const ok = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

describe("transport counters", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a send dropped by the rate limit is counted as dropped, not queued, and returns false", async () => {
    stubTelegram(ok);
    const tg = await load();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => tg.sendTelegram(`msg ${i}`)));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(tg.getTelegramStats()).toMatchObject({ sent: 20, rateLimited: 5, failed: 0 });
  });

  it("a rejected send is counted as failed", async () => {
    stubTelegram(() => new Response("bad request", { status: 500 }));
    const tg = await load();
    expect(await tg.sendTelegram("hello")).toBe(false);
    expect(tg.getTelegramStats()).toMatchObject({ sent: 0, failed: 1 });
  });

  it("the daily summary carries one line with the sent, dropped and failed counts", async () => {
    const calls = stubTelegram(ok);
    const tg = await load();
    await Promise.all(Array.from({ length: 22 }, (_, i) => tg.sendTelegram(`msg ${i}`)));
    vi.setSystemTime(new Date("2026-10-13T15:00:05Z")); // a later rate-limit window
    calls.length = 0;
    await tg.sendDailySummary({ leads: 3, bookings: 2, revenue: 1200, reviews: 1 });
    expect(calls).toHaveLength(1);
    expect(String(calls[0].body.text)).toContain("Telegram: 20 sent, 2 dropped by rate limit, 0 failed");
  });
});

describe("notifyOwner", () => {
  const saved = { ceo: process.env.CEO_EMAIL, hook: process.env.NOTIFICATION_WEBHOOK_URL };
  afterEach(() => {
    vi.unstubAllGlobals();
    if (saved.ceo === undefined) delete process.env.CEO_EMAIL;
    else process.env.CEO_EMAIL = saved.ceo;
    if (saved.hook === undefined) delete process.env.NOTIFICATION_WEBHOOK_URL;
    else process.env.NOTIFICATION_WEBHOOK_URL = saved.hook;
  });

  it("returns false when it only wrote a log line (no webhook configured)", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    delete process.env.NOTIFICATION_WEBHOOK_URL;
    const { notifyOwner } = await import("./_core/notification");
    expect(await notifyOwner({ title: "T", content: "C" })).toBe(false);
  });

  it("returns true only when the webhook accepted it, false when the webhook refused", async () => {
    process.env.CEO_EMAIL = "owner@example.com";
    process.env.NOTIFICATION_WEBHOOK_URL = "https://hooks.example.test/x";
    const { notifyOwner } = await import("./_core/notification");
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));
    expect(await notifyOwner({ title: "T", content: "C" })).toBe(true);
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    expect(await notifyOwner({ title: "T", content: "C" })).toBe(false);
  });
});

describe("vendor health · Telegram", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads degraded when the token is valid but the configured chat id is not", async () => {
    stubTelegram((method) =>
      method === "getChat"
        ? new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 })
        : ok(),
    );
    const { checkTelegram } = await import("./services/vendorHealth");
    const res = await checkTelegram();
    expect(res.status).toBe("degraded");
    expect(res.checks.find((c) => c.name === "chat_verify")).toMatchObject({ passed: false });
  });

  it("reads healthy only when the token and the chat id both check out", async () => {
    const calls = stubTelegram(ok);
    const { checkTelegram } = await import("./services/vendorHealth");
    const res = await checkTelegram();
    expect(res.status).toBe("healthy");
    expect(calls.map((c) => c.method).sort()).toEqual(["getChat", "getMe"]);
    expect(calls.find((c) => c.method === "getChat")?.body).toMatchObject({ chat_id: "4242" });
  });
});
