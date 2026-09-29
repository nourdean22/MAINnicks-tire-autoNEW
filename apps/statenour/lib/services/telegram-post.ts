// ── Telegram Bot API text POST with a plain-text fallback ─────────────

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/telegram-post");

/** Telegram's 400 description when parse_mode meets text it cannot parse. */
const PARSE_ERROR = /can't parse entities/i;

/**
 * The same text without Telegram HTML: formatting tags dropped and the escapes
 * decoded. A link keeps only its text, so a masked phone never turns into the
 * full number from its tel: target.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|a|span|tg-spoiler|blockquote)(?:\s[^<>]*)?>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

async function readBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * POST a text message to the Bot API. Callers build the text from customer and
 * upstream strings, and Telegram rejects the whole message when one of them
 * holds a stray `<` or `&`. On that 400 the message is resent once without
 * parse_mode, so the alert or approval prompt still arrives. The rejected
 * attempt delivered nothing, so the resend cannot duplicate a message. When the
 * result is not ok, its body has been read and Telegram's reason is in `error`.
 * A transport error (timeout, reset) propagates to the caller unchanged.
 */
export async function postTelegramText(
  token: string,
  method: "sendMessage" | "editMessageText",
  payload: { text: string; parse_mode?: "HTML" | "Markdown" } & Record<string, unknown>,
): Promise<{ res: Response; error?: string }> {
  const post = (body: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5_000), // wave-181.92 · alerts are best-effort
      body: JSON.stringify(body),
    });

  const first = await post(payload);
  if (first.ok) return { res: first };
  const error = await readBody(first);
  if (!payload.parse_mode || first.status !== 400 || !PARSE_ERROR.test(error)) {
    return { res: first, error };
  }

  log.warn("send_parse_fallback", { method, error: error.slice(0, 200) });
  const { parse_mode: mode, ...rest } = payload;
  const retry = await post({ ...rest, text: mode === "HTML" ? htmlToPlainText(payload.text) : payload.text });
  if (retry.ok) return { res: retry };
  return { res: retry, error: await readBody(retry) };
}
