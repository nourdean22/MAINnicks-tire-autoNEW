import { postTelegramText } from "@/lib/services/telegram-post";

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

  const payload: any = {
    chat_id: TELEGRAM_OWNER_ID,
    text: cleanText,
    parse_mode: "Markdown",
  };
  
  if (options?.replyMarkup) {
    payload.reply_markup = options.replyMarkup;
  }

  try {
    // Model-written ops text often breaks Markdown (a lone `_` or `*`); the
    // helper resends it once as plain text instead of dropping the alert.
    const { res: response } = await postTelegramText(TELEGRAM_BOT_TOKEN, "sendMessage", payload);

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
