import { IntelligenceSignalPayload } from "../types";

export async function triggerInterruptProtocol(signal: IntelligenceSignalPayload) {
  console.log(`[AIE Interrupt] Actionability: ${signal.actionabilityIndex}`);
  
  const message = `🚨 AIE INTERRUPT: ${signal.title}\n\n${signal.derivativeContext}\n\nSuggested Action: ${signal.metadata?.suggestedAction || "Review immediately."}`;

  // 1. Capevace Delivery (Placeholder for Capevace API)
  try {
    console.log(`[Capevace] Pushing priority signal...`);
    // await fetch("https://api.capevace.com/v1/notify", { ... })
  } catch (err) {
    console.error("[Capevace] Delivery failed", err);
  }

  // 2. Telegram Delivery
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (telegramBotToken && telegramChatId) {
    try {
      console.log(`[Telegram] Pushing priority signal...`);
      const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: message,
          parse_mode: "HTML"
        })
      });
    } catch (err) {
      console.error("[Telegram] Delivery failed", err);
    }
  } else {
    console.warn("[Telegram] Missing credentials, skipping delivery.");
  }
}
