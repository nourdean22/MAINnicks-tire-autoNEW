/**
 * Telegram alert diet, review round · a send has three honest outcomes, and a media failure is counted.
 *
 * sendTelegram() stays a boolean for the ~170 existing callers and now means "accepted": the message was
 * delivered OR deliberately held by a class mute. Callers that report to the operator ("digest sent",
 * "media sent") use the tri-state result so a held send is never reported as delivered. Every media
 * failure path (HTTP error and exception) bumps the failed counter, like the text path.
 *
 * The REAL transport runs against a stubbed fetch; only the flag reader is faked.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const savedEnv = { token: process.env.TELEGRAM_BOT_TOKEN, chat: process.env.TELEGRAM_CHAT_ID };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "4242";
  return { flags: {} as Record<string, boolean>, savedEnv };
});

afterAll(() => {
  if (h.savedEnv.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = h.savedEnv.token;
  if (h.savedEnv.chat === undefined) delete process.env.TELEGRAM_CHAT_ID;
  else process.env.TELEGRAM_CHAT_ID = h.savedEnv.chat;
});

vi.mock("./services/featureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/featureFlags")>()),
  isEnabled: vi.fn(async (key: string) => h.flags[key] === true),
}));

type TelegramModule = typeof import("./services/telegram");
async function load(): Promise<TelegramModule> {
  vi.resetModules();
  return import("./services/telegram");
}
function stubFetch(mode: "ok" | "http" | "throw") {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url).split("/").pop() as string);
    if (mode === "throw") throw new Error("network down");
    return mode === "http" ? new Response("bad", { status: 500 }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return calls;
}

describe("sendTelegramResult", () => {
  beforeEach(() => {
    h.flags = {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is delivered when the Bot API accepted it", async () => {
    stubFetch("ok");
    const tg = await load();
    expect(await tg.sendTelegramResult("hello", "incident")).toEqual({ status: "delivered" });
  });

  it("is held, naming the flag, when the class is muted; nothing is sent", async () => {
    const calls = stubFetch("ok");
    h.flags.telegram_digest_muted = true;
    const tg = await load();
    expect(await tg.sendTelegramResult("brief", "digest")).toEqual({ status: "held", heldBy: "telegram_digest_muted" });
    expect(calls).toHaveLength(0);
  });

  it("holds a receipt by default, naming telegram_receipt", async () => {
    stubFetch("ok");
    const tg = await load();
    const res = await tg.sendTelegramResult("job done", "receipt");
    expect(res.status).toBe("held");
    expect(res.heldBy).toContain("telegram_receipt");
  });

  it("is failed when the Bot API rejected it", async () => {
    stubFetch("http");
    const tg = await load();
    expect((await tg.sendTelegramResult("hello", "incident")).status).toBe("failed");
  });

  it("the boolean sendTelegram means accepted: true for delivered AND held, false for failed", async () => {
    stubFetch("ok");
    h.flags.telegram_digest_muted = true;
    const tg = await load();
    expect(await tg.sendTelegram("a", "incident")).toBe(true);
    expect(await tg.sendTelegram("b", "digest")).toBe(true);
    stubFetch("http");
    expect(await tg.sendTelegram("c", "incident")).toBe(false);
  });
});

describe("media sends", () => {
  beforeEach(() => {
    h.flags = {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const kinds = [
    ["photo", (tg: TelegramModule) => tg.sendTelegramPhotoResult("https://x.test/a.jpg", "cap")],
    ["video", (tg: TelegramModule) => tg.sendTelegramVideoResult("https://x.test/a.mp4", "cap")],
    ["document", (tg: TelegramModule) => tg.sendTelegramDocumentResult("https://x.test/a.pdf", "cap")],
    ["media group", (tg: TelegramModule) => tg.sendTelegramMediaGroupResult([{ type: "photo", url: "https://x.test/a.jpg" }])],
  ] as const;

  it.each(kinds)("%s: an HTTP error is failed and counted", async (_name, send) => {
    stubFetch("http");
    const tg = await load();
    expect((await send(tg)).status).toBe("failed");
    expect(tg.getTelegramStats().failed).toBe(1);
  });

  it.each(kinds)("%s: an exception is failed and counted", async (_name, send) => {
    stubFetch("throw");
    const tg = await load();
    expect((await send(tg)).status).toBe("failed");
    expect(tg.getTelegramStats().failed).toBe(1);
  });

  it.each(kinds)("%s: success is delivered and counted as sent", async (_name, send) => {
    stubFetch("ok");
    h.flags.telegram_receipt = true;
    const tg = await load();
    expect((await send(tg)).status).toBe("delivered");
    expect(tg.getTelegramStats()).toMatchObject({ sent: 1, failed: 0 });
  });
});
