/**
 * A Telegram message Telegram cannot parse under its parse_mode still arrives
 * (2026-09-29).
 *
 * Every sender here posts with parse_mode "HTML" (or "Markdown"), and callers
 * build the text from customer and upstream strings. A `<` that opens no
 * supported tag makes Telegram answer 400 "can't parse entities", and the alert,
 * the approval prompt or the NICK control-plane send was dropped. The failure
 * log also printed "[object Object]" instead of Telegram's reason, because it
 * stringified parsed JSON.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const errors = vi.hoisted(() => [] as Array<[string, Record<string, unknown>]>);

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      error: (event: string, meta: Record<string, unknown>) => errors.push([event, meta]),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

type Sent = { url: string; body: { text?: string; parse_mode?: string; reply_markup?: unknown } };

const PARSE_ERROR = JSON.stringify({
  ok: false,
  error_code: 400,
  description: 'Bad Request: can\'t parse entities: Unsupported start tag "3" at byte offset 12',
});
const CHAT_NOT_FOUND = JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" });

/** Telegram's HTML rule, reduced: a `<` must open or close a supported tag. */
const invalidHtml = (text: string) => /<(?!\/?(?:b|strong|i|em|u|s|a|code|pre)\b)/i.test(text);

function fakeTelegram(reject: (body: Sent["body"]) => string | null) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Sent["body"];
      sent.push({ url, body });
      const error = reject(body);
      return error
        ? new Response(error, { status: 400 })
        : new Response(JSON.stringify({ ok: true, result: { message_id: 100 + sent.length } }), { status: 200 });
    }),
  );
  return sent;
}

const rejectsBadHtml = (body: Sent["body"]) =>
  body.parse_mode === "HTML" && invalidHtml(String(body.text)) ? PARSE_ERROR : null;

/** telegram.ts reads the token at import time, so each test imports fresh. */
async function load() {
  vi.resetModules();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "123");
  return {
    telegram: await import("@/lib/services/telegram"),
    observed: await import("@/lib/services/telegram-observed"),
  };
}

afterEach(() => {
  errors.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Telegram senders · text Telegram cannot parse", () => {
  it("sendTelegram resends it as plain text, and the alert arrives", async () => {
    const sent = fakeTelegram(rejectsBadHtml);
    const { telegram } = await load();
    const html = '<b>NEW LEAD — Tom &amp; Jerry</b>\n<a href="tel:2165550123">...0123</a>\nNote: <3 is it < $500?';

    await expect(telegram.sendTelegram(html)).resolves.toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[0]?.body.parse_mode).toBe("HTML");
    expect(sent[1]?.body.parse_mode).toBeUndefined();
    expect(sent[1]?.body.text).toBe("NEW LEAD — Tom & Jerry\n...0123\nNote: <3 is it < $500?");
    expect(sent[1]?.body.text).not.toContain("2165550123");
  });

  it("a Markdown message is resent unchanged, without parse_mode", async () => {
    const sent = fakeTelegram((body) => (body.parse_mode === "Markdown" ? PARSE_ERROR : null));
    const { telegram } = await load();

    await expect(telegram.sendTelegram("*Brakes* for Test_Customer", undefined, "Markdown")).resolves.toBe(true);

    expect(sent.map((s) => s.body.parse_mode)).toEqual(["Markdown", undefined]);
    expect(sent[1]?.body.text).toBe("*Brakes* for Test_Customer");
  });

  it("an approval prompt keeps its buttons on the plain resend", async () => {
    const sent = fakeTelegram(rejectsBadHtml);
    const { telegram } = await load();
    const buttons = [[{ text: "Approve", callback_data: "approve:1" }]];

    await expect(telegram.sendTelegramWithButtons("Approve refund for <3 customer?", buttons)).resolves.toEqual({
      ok: true,
      messageId: 102,
    });

    expect(sent[1]?.body.parse_mode).toBeUndefined();
    expect(sent[1]?.body.reply_markup).toEqual({ inline_keyboard: buttons });
  });

  it("an edited message is resent as plain text", async () => {
    const sent = fakeTelegram(rejectsBadHtml);
    const { telegram } = await load();

    await expect(telegram.editTelegramMessage(7, "Approved: rotors <3")).resolves.toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[1]?.url).toContain("/editMessageText");
  });

  it("CONSUMER: a NICK control-plane send reports the resent message as provider_accepted", async () => {
    const sent = fakeTelegram(rejectsBadHtml);
    const { observed } = await load();

    await expect(observed.sendTelegramObserved("Lead note: <3")).resolves.toEqual({
      state: "provider_accepted",
      messageId: 102,
    });
    expect(sent).toHaveLength(2);
  });
});

describe("Telegram senders · controls", () => {
  it("valid HTML goes out once, formatted", async () => {
    const sent = fakeTelegram(rejectsBadHtml);
    const { telegram } = await load();

    await expect(telegram.sendTelegram("<b>NEW LEAD</b> Test Customer")).resolves.toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.parse_mode).toBe("HTML");
  });

  it("a 400 for any other reason is not resent, and the log carries Telegram's reason", async () => {
    const sent = fakeTelegram(() => CHAT_NOT_FOUND);
    const { telegram, observed } = await load();

    await expect(telegram.sendTelegram("<3 test")).resolves.toBe(false);
    await expect(observed.sendTelegramObserved("<3 test")).resolves.toEqual({
      state: "known_failure",
      reason: "telegram_http_400",
      status: 400,
    });

    expect(sent).toHaveLength(2);
    expect(JSON.stringify(errors)).toContain("chat not found");
    expect(JSON.stringify(errors)).not.toContain("[object Object]");
  });

  it("a resend that times out is UNKNOWN completion, never a known failure", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) return new Response(PARSE_ERROR, { status: 400 });
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }),
    );
    const { observed } = await load();

    await expect(observed.sendTelegramObserved("Lead note: <3")).resolves.toEqual({
      state: "unknown_completion",
      reason: "TimeoutError",
    });
  });
});
