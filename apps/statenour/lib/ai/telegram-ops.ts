import { withTimeout } from "@nour/utils";

interface TelegramSendOptions {
  replyMarkup?: any;
}

export async function sendTelegramOpsAlert(text: string, options?: TelegramSendOptions) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_OWNER_ID = process.env.TELEGRAM_OWNER_ID;

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_OWNER_ID) {
    console.warn("[telegram-ops] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_ID. Alert dropped.");
    return false;
  }

  // Strip out unconstrained <think> loops from local reasoning models
  const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!cleanText) return false;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  
  const payload: any = {
    chat_id: TELEGRAM_OWNER_ID,
    text: cleanText,
    parse_mode: "Markdown",
  };
  
  if (options?.replyMarkup) {
    payload.reply_markup = options.replyMarkup;
  }

  try {
    const response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      3000
    );

    if (!response.ok) {
      console.error(`[telegram-ops] Failed to send alert. Status: ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[telegram-ops] Exception sending alert:", error);
    return false;
  }
}
