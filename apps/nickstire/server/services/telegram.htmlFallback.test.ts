/**
 * An owner alert that is not valid Telegram HTML still arrives (2026-09-29).
 *
 * sendRaw posts every alert with parse_mode "HTML", and its callers build the
 * text from customer and upstream strings: a DVI note, a review, a vendor's
 * HTML error page in alertVendorDown. Telegram answers 400 "can't parse
 * entities" to a `<` that opens no supported tag, and the alert was dropped.
 * Each rejection also counted toward the 5-failure circuit breaker, so a few
 * such alerts in a row blocked every owner alert for the next minute.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type SentBody = { chat_id?: string; text?: string; parse_mode?: string };

const PARSE_ERROR = JSON.stringify({
  ok: false,
  error_code: 400,
  description: 'Bad Request: can\'t parse entities: Unsupported start tag "3" at byte offset 12',
});
const CHAT_NOT_FOUND = JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: chat not found" });

/** Telegram's HTML rule, reduced: a `<` must open or close a supported tag. */
function isInvalidTelegramHtml(text: string): boolean {
  return /<(?!\/?(?:b|strong|i|em|u|s|a|code|pre)\b)/i.test(text);
}

function fakeTelegram(reject: (body: SentBody) => string | null) {
  const sent: SentBody[] = [];
  const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as SentBody;
    sent.push(body);
    const error = reject(body);
    return error
      ? new Response(error, { status: 400 })
      : new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return sent;
}

const telegramRejectsBadHtml = (body: SentBody) =>
  body.parse_mode === "HTML" && isInvalidTelegramHtml(String(body.text)) ? PARSE_ERROR : null;

/** Fresh module: BOT_TOKEN, the rate limiter and the breaker registry are module state. */
async function loadTelegram() {
  vi.resetModules();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_CHAT_ID", "12345");
  return import("./telegram");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("sendTelegram · text Telegram cannot parse as HTML", () => {
  it("resends it as plain text, and the alert arrives", async () => {
    const sent = fakeTelegram(telegramRejectsBadHtml);
    const { sendTelegram } = await loadTelegram();
    const text = 'DVI decision: Test Customer APPROVED "Brakes"\nNote: <3 thanks, is it < $500?';

    await expect(sendTelegram(text)).resolves.toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[0]?.parse_mode).toBe("HTML");
    expect(sent[1]?.parse_mode).toBeUndefined();
    expect(sent[1]?.text).toBe(text);
  });

  it("the plain resend drops formatting tags and keeps a masked phone masked", async () => {
    const sent = fakeTelegram(telegramRejectsBadHtml);
    const { sendTelegram } = await loadTelegram();
    const html =
      '<b>NEW LEAD</b>\n<b>Tom &amp; Jerry</b>\n<a href="tel:2165550123">...0123</a>\nService: rotors <3';

    await expect(sendTelegram(html)).resolves.toBe(true);

    expect(sent[1]?.text).toBe("NEW LEAD\nTom & Jerry\n...0123\nService: rotors <3");
    expect(sent[1]?.text).not.toContain("2165550123");
  });

  it("CONSUMER: a vendor-down alert carrying an HTML error page reaches the owner", async () => {
    const sent = fakeTelegram(telegramRejectsBadHtml);
    const { alertVendorDown } = await loadTelegram();

    await expect(alertVendorDown("Twilio", "HTTP 502: <html><head><title>502 Bad Gateway</title>")).resolves.toBe(true);

    expect(sent).toHaveLength(2);
    expect(sent[1]?.text).toContain("VENDOR DOWN: Twilio");
    expect(sent[1]?.text).toContain("502 Bad Gateway");
  });

  it("formatting errors do not open the circuit breaker for real alerts", async () => {
    // Before: five rejected alerts opened the breaker for 60 s, so the next
    // alert, valid text included, was never attempted.
    const sent = fakeTelegram(telegramRejectsBadHtml);
    const { sendTelegram } = await loadTelegram();

    for (let i = 0; i < 6; i++) {
      await expect(sendTelegram(`lead ${i}: <3`)).resolves.toBe(true);
    }
    await expect(sendTelegram("<b>NEW BOOKING</b> valid")).resolves.toBe(true);
    expect(sent.at(-1)).toMatchObject({ text: "<b>NEW BOOKING</b> valid", parse_mode: "HTML" });
  });
});

describe("sendTelegram · controls", () => {
  it("valid HTML goes out once, formatted", async () => {
    const sent = fakeTelegram(telegramRejectsBadHtml);
    const { sendTelegram } = await loadTelegram();

    await expect(sendTelegram("<b>NEW LEAD</b> Test Customer")).resolves.toBe(true);

    expect(sent).toEqual([expect.objectContaining({ text: "<b>NEW LEAD</b> Test Customer", parse_mode: "HTML" })]);
  });

  it("a 400 for any other reason is not resent and still reports failure", async () => {
    const sent = fakeTelegram(() => CHAT_NOT_FOUND);
    const { sendTelegram } = await loadTelegram();

    await expect(sendTelegram("<3 test")).resolves.toBe(false);

    expect(sent).toHaveLength(1);
  });

  it("a plain resend that also fails reports failure", async () => {
    const sent = fakeTelegram((body) => (body.parse_mode === "HTML" ? PARSE_ERROR : CHAT_NOT_FOUND));
    const { sendTelegram } = await loadTelegram();

    await expect(sendTelegram("<3 test")).resolves.toBe(false);

    expect(sent).toHaveLength(2);
  });
});
