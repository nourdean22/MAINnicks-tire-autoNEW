// ── Telegram Bot Integration ───────────────────────────────────────────

import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/telegram");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DEFAULT_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

/**
 * Send a message via Telegram Bot API.
 * Returns true on success, false if not configured.
 */
export async function sendTelegram(
  text: string,
  chatId?: string,
  parseMode: "HTML" | "Markdown" = "HTML"
): Promise<boolean> {
  if (!BOT_TOKEN) {
    log.info("send_skipped", { reason: "not_configured", preview: text.slice(0, 80) });
    return false;
  }

  const target = chatId ?? DEFAULT_CHAT_ID;
  if (!target) {
    log.warn("send_skipped", { reason: "no_chat_id" });
    return false;
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000), // wave-181.92 · alerts are best-effort
        body: JSON.stringify({
          chat_id: target,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log.error("send_failed", { status: res.status, error: String(err).slice(0, 200) });
      return false;
    }

    return true;
  } catch (error) {
    log.error("send_error", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/**
 * Format a structured notification for Telegram.
 * Uses HTML parse mode for rich formatting.
 */
export function formatTelegramNotification(
  title: string,
  body: string,
  urgency?: "low" | "medium" | "high"
): string {
  const icon = urgency === "high" ? "🔴" : urgency === "medium" ? "🟡" : "🟢";
  return `${icon} <b>${escapeHtml(title)}</b>\n\n${escapeHtml(body)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Inline Keyboard Buttons
// ---------------------------------------------------------------------------

export interface InlineButton {
  text: string;
  callback_data?: string; // For callback_query handling
  url?: string;           // Opens URL in browser
}

/**
 * Send a Telegram message with inline keyboard buttons.
 * Buttons appear below the message and trigger callbacks or open URLs.
 */
export async function sendTelegramWithButtons(
  text: string,
  buttons: InlineButton[][],
  chatId?: string
): Promise<{ ok: boolean; messageId?: number }> {
  if (!BOT_TOKEN) {
    log.info("send_buttons_skipped", { reason: "not_configured", preview: text.slice(0, 80) });
    return { ok: false };
  }

  const target = chatId ?? DEFAULT_CHAT_ID;
  if (!target) return { ok: false };

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000), // wave-181.92
        body: JSON.stringify({
          chat_id: target,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      log.error("send_buttons_failed", { error: String(err).slice(0, 200) });
      return { ok: false };
    }

    const data = await res.json();
    return { ok: true, messageId: data.result?.message_id };
  } catch (error) {
    log.error("send_buttons_error", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false };
  }
}

/**
 * Answer a callback query (dismiss the loading spinner on inline button).
 * Optionally show a toast notification.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  if (!BOT_TOKEN) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000), // wave-181.92
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text: text ?? "Done",
          show_alert: false,
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Edit an existing message (e.g., to update after approval).
 */
export async function editTelegramMessage(
  messageId: number,
  text: string,
  chatId?: string,
  buttons?: InlineButton[][]
): Promise<boolean> {
  if (!BOT_TOKEN) return false;

  const target = chatId ?? DEFAULT_CHAT_ID;
  if (!target) return false;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5_000), // wave-181.92
        body: JSON.stringify({
          chat_id: target,
          message_id: messageId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
