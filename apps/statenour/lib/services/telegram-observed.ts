import { logger as rootLogger } from "@/lib/logger";
import { postTelegramText } from "@/lib/services/telegram-post";

const log = rootLogger.withSurface("services/telegram-observed");

export type TelegramObservedOutcome =
  | { state: "provider_accepted"; messageId?: number }
  | { state: "known_failure"; reason: string; status?: number }
  | { state: "unknown_completion"; reason: string };

/**
 * A Telegram send with transport truth preserved.
 *
 * The legacy `sendTelegram()` returns boolean and intentionally catches fetch
 * errors. That is convenient for best-effort notifications but insufficient for
 * an agentic mutation: once a request is handed to fetch, a timeout/network
 * exception cannot prove whether Telegram committed the message. Retrying that
 * state blindly can duplicate a real side effect.
 *
 * This function is deliberately narrow and used by the NICK chat control plane.
 * Existing cron/notification callers keep their legacy boolean contract.
 */
export async function sendTelegramObserved(
  text: string,
  chatId?: string,
  parseMode: "HTML" | "Markdown" = "HTML",
): Promise<TelegramObservedOutcome> {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const target = chatId ?? process.env.TELEGRAM_CHAT_ID ?? "";

  if (!token) return { state: "known_failure", reason: "not_configured" };
  if (!target) return { state: "known_failure", reason: "no_chat_id" };

  try {
    // A 400 "can't parse entities" is resent once as plain text inside
    // postTelegramText; a resend that times out lands in the catch below.
    const { res, error } = await postTelegramText(token, "sendMessage", {
      chat_id: target,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    });

    if (!res.ok) {
      log.error("send_known_failure", {
        status: res.status,
        error: (error ?? "").slice(0, 200),
      });
      return {
        state: "known_failure",
        reason: `telegram_http_${res.status}`,
        status: res.status,
      };
    }

    const payload = await res.json().catch(() => null) as
      | { result?: { message_id?: number } }
      | null;
    return {
      state: "provider_accepted",
      messageId: payload?.result?.message_id,
    };
  } catch (error) {
    // DNS failure, socket reset, and AbortSignal timeout all land here. Some
    // happen before bytes leave this process; some happen after the provider
    // commits. Without a provider receipt we cannot distinguish them, so the
    // only safe classification is UNKNOWN_COMPLETION.
    log.error("send_unknown_completion", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      state: "unknown_completion",
      reason: error instanceof Error ? error.name || "transport_error" : "transport_error",
    };
  }
}
