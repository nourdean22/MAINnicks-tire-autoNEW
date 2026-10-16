/**
 * Telegram Push Notifications — alerts to Nour's phone.
 *
 * Every send is immediate (event-driven). The old "batched" channels were never
 * flushed (the flush timer is a documented no-op), so they are gone: the channel is
 * only a label in the message text. A send dropped by the rate limit is counted
 * (getTelegramStats().rateLimited) and shown in the daily summary.
 *
 * Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars
 */

import { createLogger } from "../lib/logger";
import { getOrCreateBreaker } from "../lib/circuit-breaker";

import { BUSINESS } from "@shared/business";
const log = createLogger("telegram");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// ─── Circuit Breaker ─────────────────────────────────
const telegramCB = getOrCreateBreaker("telegram", {
  failureThreshold: 5,
  cooldownMs: 60_000,
  timeoutMs: 15_000,
});

// ─── Channels ────────────────────────────────────────
export type TelegramChannel = "critical" | "reviews" | "system" | "digest";

// ─── Delivery Tracking ──────────────────────────────
interface DeliveryStats {
  sent: number;
  failed: number;
  /** Dropped before the API call because 20 sends already went out in the last second. */
  rateLimited: number;
  lastSentAt: string | null;
  lastError: string | null;
}

const stats: DeliveryStats = {
  sent: 0,
  failed: 0,
  rateLimited: 0,
  lastSentAt: null,
  lastError: null,
};

/** In-process counters since this server booted (they reset on every deploy). */
export function getTelegramStats(): DeliveryStats {
  return { ...stats };
}

// Rate limiting: Telegram allows 30 msgs/sec, we stay well under
const RATE_LIMIT_WINDOW_MS = 1_000;
const MAX_MESSAGES_PER_WINDOW = 20; // stay under 30/sec limit
let messageSentTimestamps: number[] = [];

function isRateLimited(): boolean {
  const now = Date.now();
  messageSentTimestamps = messageSentTimestamps.filter(
    (ts) => now - ts < RATE_LIMIT_WINDOW_MS
  );
  return messageSentTimestamps.length >= MAX_MESSAGES_PER_WINDOW;
}

function recordSend(): void {
  messageSentTimestamps.push(Date.now());
}

// ─── Configuration Check ────────────────────────────
function isConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}

// ─── Core Send (with circuit breaker + rate limiting) ──

/** Telegram's 400 description when parse_mode "HTML" meets a stray `<` or `&`. */
const HTML_PARSE_ERROR = /can't parse entities/i;

function postMessage(text: string, parseMode: "HTML" | undefined): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      disable_web_page_preview: true,
    }),
  });
}

/**
 * The same alert as plain text: formatting tags dropped and the escapes
 * decoded. A link keeps only its text, so alertNewLead's masked "...0123"
 * never turns into the full number from its tel: target.
 */
function toPlainText(html: string): string {
  return html
    .replace(/<\/?(?:b|strong|i|em|u|ins|s|strike|del|code|pre|a|span|tg-spoiler|blockquote)(?:\s[^<>]*)?>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

async function sendRaw(text: string): Promise<boolean> {
  if (!isConfigured()) {
    log.debug("Telegram not configured, skipping");
    return false;
  }

  if (isRateLimited()) {
    log.warn("Telegram rate limited, dropping message");
    stats.rateLimited++;
    return false;
  }
  // Count the send at admission: a burst started in the same tick must see it.
  recordSend();

  try {
    const result = await telegramCB.call(async () => {
      let res = await postMessage(text, "HTML");

      if (!res.ok) {
        let err = await res.text();
        // Callers build alerts from customer and upstream text (a DVI note, a
        // review, a vendor's HTML error page). A `<` that opens no supported
        // tag makes Telegram reject the whole message. Resend it once as plain
        // text: the alert arrives, and a formatting error is not counted by
        // the breaker as an outage that blocks every other alert.
        if (res.status === 400 && HTML_PARSE_ERROR.test(err)) {
          log.warn("Telegram rejected the HTML; resending as plain text", { error: err.slice(0, 200) });
          res = await postMessage(toPlainText(text), undefined);
          if (res.ok) return true;
          err = await res.text();
        }
        throw new Error(`Telegram HTTP ${res.status}: ${err.slice(0, 200)}`);
      }

      return true;
    });

    stats.sent++;
    stats.lastSentAt = new Date().toISOString();
    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    stats.failed++;
    stats.lastError = errMsg;
    log.warn("Telegram send failed", { error: errMsg });
    return false;
  }
}

// ─── Rich Formatting Templates ──────────────────────

function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

function link(text: string, url: string): string {
  return `<a href="${url}">${escapeHtml(text)}</a>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTimestamp(): string {
  return new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone });
}

function divider(): string {
  return "─────────────────";
}

// ─── Channel-Aware Send ─────────────────────────────

export async function sendTelegramMessage(
  text: string,
  channel: TelegramChannel = "system"
): Promise<boolean> {
  if (!isConfigured()) return false;

  // Real-time dispatch: Bypass the 5-minute queue completely
  return sendRaw(`[${channel.toUpperCase()}] ` + text);
}

/**
 * Legacy compatibility: Send a plain text message (immediate).
 */
export async function sendTelegram(text: string): Promise<boolean> {
  return sendRaw(text);
}

/**
 * Send a photo via Telegram (URL or file_id).
 */
export async function sendTelegramPhoto(photoUrl: string, caption?: string): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        photo: photoUrl,
        caption: caption?.slice(0, 1024) || undefined,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      log.error("Telegram photo send failed:", { status: res.status });
      stats.failed++;
      return false;
    }
    stats.sent++;
    return true;
  } catch (err) {
    log.error("Telegram photo error:", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Send a video via Telegram (URL or file_id).
 */
export async function sendTelegramVideo(videoUrl: string, caption?: string): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        video: videoUrl,
        caption: caption?.slice(0, 1024) || undefined,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      log.error("Telegram video send failed:", { status: res.status });
      stats.failed++;
      return false;
    }
    stats.sent++;
    return true;
  } catch (err) {
    log.error("Telegram video error:", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Send a document/file via Telegram.
 */
export async function sendTelegramDocument(docUrl: string, caption?: string): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        document: docUrl,
        caption: caption?.slice(0, 1024) || undefined,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) return false;
    stats.sent++;
    return true;
  } catch (e) { log.warn("[services/telegram] operation failed:", e); return false; }
}

/**
 * Send a group of photos (album) via Telegram.
 */
export async function sendTelegramMediaGroup(
  media: Array<{ type: "photo" | "video"; url: string; caption?: string }>
): Promise<boolean> {
  if (!isConfigured() || media.length === 0) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        media: media.map((m, i) => ({
          type: m.type,
          media: m.url,
          caption: i === 0 ? m.caption?.slice(0, 1024) : undefined,
          parse_mode: i === 0 ? "HTML" : undefined,
        })),
      }),
    });
    if (!res.ok) return false;
    stats.sent++;
    return true;
  } catch (e) { log.warn("[services/telegram] operation failed:", e); return false; }
}

// ─── Formatted Alert Helpers (UPGRADED with channels + rich formatting) ──

/** New lead alert — CRITICAL channel (immediate) */
export function alertNewLead(lead: {
  name: string;
  phone?: string;
  service?: string;
  source?: string;
  urgencyScore?: number;
}) {
  const urgencyTag = lead.urgencyScore && lead.urgencyScore >= 4
    ? ` 🔴 HIGH PRIORITY`
    : "";
  // wave-122 (MEDIUM S3) — phone-number masking. Telegram messages
  // are stored indefinitely server-side + visible in chat history. If
  // Telegram is compromised or the chat is shared, full customer
  // numbers leak. Show last-4 only in display text; the tel: link
  // target keeps the full number so the operator can still tap-to-call.
  const phoneTail = lead.phone ? lead.phone.replace(/\D/g, "").slice(-4) : "";
  const lines = [
    `🔔 ${bold("NEW LEAD")}${urgencyTag}`,
    divider(),
    `👤 ${bold(lead.name)}`,
    lead.phone ? `📱 ${link(`...${phoneTail}`, `tel:${lead.phone.replace(/\D/g, "")}`)}` : "",
    lead.service ? `🔧 ${lead.service}` : "",
    lead.source ? `📍 Source: ${lead.source}` : "",
    lead.urgencyScore ? `⚡ Urgency: ${lead.urgencyScore}/5` : "",
    divider(),
    `⏰ ${formatTimestamp()}`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "critical");
}

/** New booking alert — CRITICAL channel (immediate) */
export function alertNewBooking(booking: {
  name: string;
  phone?: string;
  service?: string;
  date?: string;
  refCode?: string;
  vehicle?: string;
}) {
  const lines = [
    `📅 ${bold("NEW BOOKING")}`,
    divider(),
    `👤 ${bold(booking.name)}`,
    booking.phone ? `📱 ${link(booking.phone, `tel:${booking.phone.replace(/\D/g, "")}`)}` : "",
    booking.service ? `🔧 ${booking.service}` : "",
    booking.vehicle ? `🚗 ${booking.vehicle}` : "",
    booking.date ? `📆 ${booking.date}` : "",
    booking.refCode ? `🔖 Ref: #${booking.refCode}` : "",
    divider(),
    `⏰ ${formatTimestamp()}`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "critical");
}

/** Low review alert — REVIEWS channel (batched) */
export function alertLowReview(review: {
  rating: number;
  author: string;
  text: string;
  platform?: string;
}) {
  const stars = "⭐".repeat(review.rating);
  const lines = [
    `🚨 ${bold(`LOW REVIEW (${review.rating}/5)`)}`,
    `${stars}`,
    `👤 ${review.author}`,
    review.platform ? `📍 ${review.platform}` : "",
    `"${review.text.slice(0, 150)}${review.text.length > 150 ? "..." : ""}"`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "reviews");
}

/** Positive review alert — REVIEWS channel (batched) */
export function alertGoodReview(review: {
  rating: number;
  author: string;
  text: string;
  platform?: string;
}) {
  const stars = "⭐".repeat(review.rating);
  const lines = [
    `🌟 ${bold(`NEW REVIEW (${review.rating}/5)`)}`,
    `${stars}`,
    `👤 ${review.author}`,
    review.platform ? `📍 ${review.platform}` : "",
    `"${review.text.slice(0, 150)}${review.text.length > 150 ? "..." : ""}"`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "reviews");
}

/** After-hours lead/request — CRITICAL channel (immediate) */
export function alertAfterHours(request: {
  name: string;
  phone?: string;
  type: "lead" | "booking" | "emergency" | "callback";
}) {
  const lines = [
    `🌙 ${bold(`AFTER-HOURS ${request.type.toUpperCase()}`)}`,
    divider(),
    `👤 ${bold(request.name)}`,
    request.phone ? `📱 ${link(request.phone, `tel:${request.phone.replace(/\D/g, "")}`)}` : "",
    `⏰ ${formatTimestamp()}`,
    `💡 Auto-SMS sent to customer`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "critical");
}

/** Revenue milestone — DIGEST channel (batched) */
export function alertRevenueMilestone(data: {
  period: string;
  amount: number;
  milestone: string;
}) {
  const lines = [
    `💰 ${bold("REVENUE MILESTONE")}`,
    `📊 ${data.period}: $${data.amount.toLocaleString()}`,
    `🎯 ${data.milestone}`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "digest");
}

/** System alert (errors, vendor down, etc.) — SYSTEM channel (batched) */
export function alertSystem(title: string, detail: string) {
  return sendTelegramMessage(
    `⚙️ ${bold(title)}\n${detail}`,
    "system"
  );
}

/** Vendor down alert — CRITICAL (immediate, this is important) */
export function alertVendorDown(vendor: string, error?: string) {
  const lines = [
    `🚨 ${bold(`VENDOR DOWN: ${vendor}`)}`,
    divider(),
    error ? `❌ ${error}` : "",
    `⏰ ${formatTimestamp()}`,
    `💡 Circuit breaker activated, using fallbacks`,
  ];
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "critical");
}

/** Vendor recovered — SYSTEM channel (batched) */
export function alertVendorRecovered(vendor: string) {
  return sendTelegramMessage(
    `✅ ${bold(`VENDOR RECOVERED: ${vendor}`)}\n⏰ ${formatTimestamp()}`,
    "system"
  );
}

/** One line from the live counters: how many alerts went out, were dropped by the rate limit, or failed (since boot). */
function telegramStatsLine(): string {
  const t = getTelegramStats();
  return `📨 Telegram: ${t.sent} sent, ${t.rateLimited} dropped by rate limit, ${t.failed} failed (since last restart)`;
}

/** Daily summary — immediate send (scheduled, not batched) */
export function sendDailySummary(data: {
  leads: number;
  bookings: number;
  /** null = the revenue read failed. Rendered as unknown, never as $0 (METRICS-CONTRACT · Unknown is not zero). */
  revenue: number | null;
  reviews: number;
  avgRating?: number;
  vendorHealth?: string;
}) {
  const lines = [
    `📊 ${bold("DAILY SUMMARY")}`,
    divider(),
    `🔔 Leads: ${bold(String(data.leads))}`,
    `📅 Bookings: ${bold(String(data.bookings))}`,
    `💰 Revenue: ${data.revenue === null ? bold("unknown (read failed)") : bold(`$${data.revenue.toLocaleString()}`)}`,
    `⭐ Reviews: ${data.reviews}${data.avgRating ? ` (avg ${data.avgRating.toFixed(1)})` : ""}`,
    data.vendorHealth ? `\n🏥 Systems: ${data.vendorHealth}` : "",
    telegramStatsLine(),
    divider(),
    `— Nick's Tire & Auto`,
    `${link("Admin Panel", "https://nickstire.org/admin")}`,
  ];
  // Daily summary sends immediately (it's a scheduled job)
  return sendRaw(lines.filter(Boolean).join("\n"));
}
