/**
 * Telegram Push Notifications — Real-time alerts to Nour's phone
 *
 * UPGRADED: Message channels, rich formatting, message queuing/batching,
 * delivery tracking, rate limiting awareness, circuit breaker protection.
 *
 * Channels:
 *   CRITICAL  — new leads (high priority), bookings, emergencies → send immediately
 *   REVIEWS   — review alerts → batched into digests
 *   SYSTEM    — vendor health, system errors → batched
 *   DIGEST    — daily summaries, revenue milestones → batched
 *
 * Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars
 */

import { createLogger } from "../lib/logger";
import { getOrCreateBreaker } from "../lib/circuit-breaker";

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
  queued: number;
  batched: number;
  lastSentAt: string | null;
  lastError: string | null;
}

const stats: DeliveryStats = {
  sent: 0,
  failed: 0,
  queued: 0,
  batched: 0,
  lastSentAt: null,
  lastError: null,
};

export function getTelegramStats(): DeliveryStats & { queueSize: number } {
  const queueSize = messageQueue.critical.length +
    messageQueue.reviews.length +
    messageQueue.system.length +
    messageQueue.digest.length;
  return { ...stats, queueSize };
}

// ─── Message Queue ──────────────────────────────────
interface QueuedMessage {
  text: string;
  channel: TelegramChannel;
  queuedAt: number;
}

const messageQueue: Record<TelegramChannel, QueuedMessage[]> = {
  critical: [],
  reviews: [],
  system: [],
  digest: [],
};

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
async function sendRaw(text: string): Promise<boolean> {
  if (!isConfigured()) {
    log.debug("Telegram not configured, skipping");
    return false;
  }

  if (isRateLimited()) {
    log.warn("Telegram rate limited, queuing message");
    stats.queued++;
    return false;
  }

  try {
    const result = await telegramCB.call(async () => {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        }
      );

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Telegram HTTP ${res.status}: ${err.slice(0, 200)}`);
      }

      return true;
    });

    recordSend();
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
  return new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
}

function divider(): string {
  return "─────────────────";
}

// ─── Channel-Aware Send ─────────────────────────────

/**
 * Send a message through a specific channel.
 * Critical channel: immediate send.
 * All other channels: queued for batch digest (every 5 minutes).
 */
export async function sendTelegramMessage(
  text: string,
  channel: TelegramChannel = "system"
): Promise<boolean> {
  if (!isConfigured()) return false;

  if (channel === "critical") {
    // Critical messages bypass the queue
    return sendRaw(text);
  }

  // Queue for batching
  messageQueue[channel].push({
    text,
    channel,
    queuedAt: Date.now(),
  });
  stats.queued++;

  return true;
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
  } catch (e) { console.warn("[services/telegram] operation failed:", e); return false; }
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
  } catch (e) { console.warn("[services/telegram] operation failed:", e); return false; }
}

// ─── Batch Flush (runs every 5 minutes) ─────────────

const BATCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let batchTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Flush all queued messages as batched digests.
 * Groups by channel, sends one message per channel.
 */
export async function flushMessageQueue(): Promise<number> {
  let totalFlushed = 0;

  for (const channel of ["reviews", "system", "digest"] as TelegramChannel[]) {
    const queue = messageQueue[channel];
    if (queue.length === 0) continue;

    // Drain the queue
    const messages = queue.splice(0);
    totalFlushed += messages.length;

    // Build a single batched digest
    const channelLabel = channel.toUpperCase();
    const header = `📋 ${bold(`${channelLabel} DIGEST`)} (${messages.length} item${messages.length > 1 ? "s" : ""})`;
    const body = messages
      .map((m, i) => `${i + 1}. ${m.text}`)
      .join("\n\n");
    const footer = `\n${divider()}\n⏰ ${formatTimestamp()}`;

    const digestText = `${header}\n${divider()}\n\n${body}${footer}`;

    // Telegram max message length is 4096 chars
    if (digestText.length > 4000) {
      // Split into chunks
      const chunks = splitMessage(messages);
      for (const chunk of chunks) {
        await sendRaw(chunk);
        stats.batched++;
      }
    } else {
      await sendRaw(digestText);
      stats.batched++;
    }
  }

  return totalFlushed;
}

function splitMessage(messages: QueuedMessage[]): string[] {
  const chunks: string[] = [];
  let current: QueuedMessage[] = [];
  let currentLength = 0;

  for (const msg of messages) {
    if (currentLength + msg.text.length > 3500 && current.length > 0) {
      chunks.push(formatChunk(current));
      current = [];
      currentLength = 0;
    }
    current.push(msg);
    currentLength += msg.text.length;
  }

  if (current.length > 0) {
    chunks.push(formatChunk(current));
  }

  return chunks;
}

function formatChunk(messages: QueuedMessage[]): string {
  const channel = messages[0]?.channel || "system";
  return [
    `📋 ${bold(`${channel.toUpperCase()} DIGEST`)} (${messages.length} items)`,
    divider(),
    ...messages.map((m, i) => `${i + 1}. ${m.text}`),
    divider(),
    `⏰ ${formatTimestamp()}`,
  ].join("\n");
}

/** Start the batch flush timer */
export function startBatchTimer(): void {
  if (batchTimer) return;
  batchTimer = setInterval(() => {
    flushMessageQueue().catch((err) => {
      log.warn("Telegram batch flush failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, BATCH_INTERVAL_MS);
  log.info("Telegram batch timer started (5 min interval)");
}

/** Stop the batch timer */
export function stopBatchTimer(): void {
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }
}

// NOTE: startBatchTimer() is called from server startup in _core/index.ts
// Do NOT auto-start here — it causes side effects during imports and tests

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
  const lines = [
    `🔔 ${bold("NEW LEAD")}${urgencyTag}`,
    divider(),
    `👤 ${bold(lead.name)}`,
    lead.phone ? `📱 ${link(lead.phone, `tel:${lead.phone.replace(/\D/g, "")}`)}` : "",
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

/** Daily summary — immediate send (scheduled, not batched) */
export function sendDailySummary(data: {
  leads: number;
  bookings: number;
  revenue: number;
  reviews: number;
  avgRating?: number;
  vendorHealth?: string;
}) {
  const lines = [
    `📊 ${bold("DAILY SUMMARY")}`,
    divider(),
    `🔔 Leads: ${bold(String(data.leads))}`,
    `📅 Bookings: ${bold(String(data.bookings))}`,
    `💰 Revenue: ${bold(`$${data.revenue.toLocaleString()}`)}`,
    `⭐ Reviews: ${data.reviews}${data.avgRating ? ` (avg ${data.avgRating.toFixed(1)})` : ""}`,
    data.vendorHealth ? `\n🏥 Systems: ${data.vendorHealth}` : "",
    divider(),
    `— Nick's Tire & Auto`,
    `${link("Admin Panel", "https://nickstire.org/admin")}`,
  ];
  // Daily summary sends immediately (it's a scheduled job)
  return sendRaw(lines.filter(Boolean).join("\n"));
}
