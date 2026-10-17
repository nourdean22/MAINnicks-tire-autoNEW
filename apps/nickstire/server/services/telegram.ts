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

// ─── Classes (what Nour can mute) ────────────────────
/**
 * incident  something is broken or a customer is waiting: sent unless telegram_incident_muted
 * digest    a scheduled summary or a once-per-state status: sent unless telegram_digest_muted
 * approval  a draft that needs Nour's yes: sent unless telegram_approval_muted
 * receipt   "this thing happened" confirmations: HELD unless telegram_receipt is ON; they roll into
 *           the daily summary as a count
 * noise     never sent
 * An unclassified send is an incident, so a caller nobody classified keeps alerting exactly as before.
 */
export type TelegramClass = "incident" | "digest" | "approval" | "receipt" | "noise";
export const DEFAULT_TELEGRAM_CLASS: TelegramClass = "incident";
const TELEGRAM_CLASSES: readonly TelegramClass[] = ["incident", "digest", "approval", "receipt", "noise"];

/**
 * Why this class is held right now, or null when it may be sent. incident/digest/approval use PAUSE flags
 * (absent or unreadable = not muted: an unreadable flag table never silences an incident); receipt uses an
 * enable flag (absent or unreadable = held: receipts are the expendable class).
 */
async function classHoldReason(cls: TelegramClass): Promise<string | null> {
  if (cls === "noise") return "noise (never sent)";
  try {
    const { isEnabled } = await import("./featureFlags");
    if (cls === "incident") return (await isEnabled("telegram_incident_muted")) ? "telegram_incident_muted" : null;
    if (cls === "digest") return (await isEnabled("telegram_digest_muted")) ? "telegram_digest_muted" : null;
    if (cls === "approval") return (await isEnabled("telegram_approval_muted")) ? "telegram_approval_muted" : null;
    return (await isEnabled("telegram_receipt")) ? null : "telegram_receipt (off)";
  } catch {
    return cls === "receipt" ? "telegram_receipt (unreadable)" : null;
  }
}

/**
 * Would a send of this class be held right now? Lets a caller that records "sent" (the lead delivery
 * ledger) say "skipped" instead when the class is muted, since a held send is accepted (returns true).
 */
export async function isTelegramClassMuted(cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<boolean> {
  return (await classHoldReason(normalizeClass(cls))) !== null;
}

/**
 * The three honest outcomes of a send. "held" is a decision (a muted class, a receipt turned off, noise),
 * not a failure and not a delivery: callers that tell the operator "sent" must not say it for a held send.
 */
export interface TelegramSendResult {
  status: "delivered" | "held" | "failed";
  /** The flag (or rule) that held it, when status is "held". */
  heldBy?: string;
}

/** Counts a held send and returns the result to hand back, or null when the class may be sent. */
async function holdIfMuted(cls: TelegramClass): Promise<TelegramSendResult | null> {
  const heldBy = await classHoldReason(cls);
  if (heldBy === null) return null;
  stats.muted[cls]++;
  log.debug("Telegram send held by class", { cls, heldBy });
  return { status: "held", heldBy };
}

function normalizeClass(cls: string): TelegramClass {
  return (TELEGRAM_CLASSES as readonly string[]).includes(cls) ? (cls as TelegramClass) : DEFAULT_TELEGRAM_CLASS;
}

// ─── Delivery Tracking ──────────────────────────────
interface DeliveryStats {
  sent: number;
  failed: number;
  /** Dropped before the API call because 20 sends already went out in the last second. */
  rateLimited: number;
  /** Held by class (a muted class, held receipts, noise): decisions, not failures. */
  muted: Record<TelegramClass, number>;
  lastSentAt: string | null;
  lastError: string | null;
}

const stats: DeliveryStats = {
  sent: 0,
  failed: 0,
  rateLimited: 0,
  muted: { incident: 0, digest: 0, approval: 0, receipt: 0, noise: 0 },
  lastSentAt: null,
  lastError: null,
};

/** In-process counters since this server booted (they reset on every deploy). */
export function getTelegramStats(): DeliveryStats {
  return { ...stats, muted: { ...stats.muted } };
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

async function sendRawResult(text: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<TelegramSendResult> {
  if (!isConfigured()) {
    log.debug("Telegram not configured, skipping");
    return { status: "failed" };
  }
  const held = await holdIfMuted(normalizeClass(cls));
  if (held) return held;

  if (isRateLimited()) {
    log.warn("Telegram rate limited, dropping message");
    stats.rateLimited++;
    return { status: "failed" };
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
    return result ? { status: "delivered" } : { status: "failed" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    stats.failed++;
    stats.lastError = errMsg;
    log.warn("Telegram send failed", { error: errMsg });
    return { status: "failed" };
  }
}

/** Boolean form for the many callers that only need "accepted" (delivered OR held). */
async function sendRaw(text: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<boolean> {
  return (await sendRawResult(text, cls)).status !== "failed";
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
  channel: TelegramChannel = "system",
  cls: TelegramClass = DEFAULT_TELEGRAM_CLASS,
): Promise<boolean> {
  if (!isConfigured()) return false;

  return sendRaw(`[${channel.toUpperCase()}] ` + text, cls);
}

/**
 * Legacy compatibility: send a plain text message (immediate). The boolean means ACCEPTED: the message was
 * delivered OR deliberately held by a class mute. It is false only for a failure (unconfigured, rate-limited
 * or rejected). Use sendTelegramResult when you report "sent" to the operator.
 */
export async function sendTelegram(text: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<boolean> {
  return sendRaw(text, cls);
}

/** Same send with the honest outcome: delivered, held (and by which flag), or failed. */
export async function sendTelegramResult(text: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<TelegramSendResult> {
  return sendRawResult(text, cls);
}

/** POSTs one media request. Every failure path (HTTP error and exception) is counted, like the text path. */
async function postMedia(method: string, body: Record<string, unknown>, cls: TelegramClass): Promise<TelegramSendResult> {
  if (!isConfigured()) return { status: "failed" };
  const held = await holdIfMuted(normalizeClass(cls));
  if (held) return held;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, ...body }),
    });
    if (!res.ok) {
      log.error(`Telegram ${method} failed`, { status: res.status });
      stats.failed++;
      stats.lastError = `Telegram ${method} HTTP ${res.status}`;
      return { status: "failed" };
    }
    stats.sent++;
    stats.lastSentAt = new Date().toISOString();
    return { status: "delivered" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    stats.failed++;
    stats.lastError = errMsg;
    log.error(`Telegram ${method} error`, { error: errMsg });
    return { status: "failed" };
  }
}

const caption1024 = (caption?: string) => caption?.slice(0, 1024) || undefined;

/** Send a photo via Telegram (URL or file_id). */
export function sendTelegramPhotoResult(photoUrl: string, caption?: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<TelegramSendResult> {
  return postMedia("sendPhoto", { photo: photoUrl, caption: caption1024(caption), parse_mode: "HTML" }, cls);
}

/** Send a video via Telegram (URL or file_id). */
export function sendTelegramVideoResult(videoUrl: string, caption?: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<TelegramSendResult> {
  return postMedia("sendVideo", { video: videoUrl, caption: caption1024(caption), parse_mode: "HTML" }, cls);
}

/** Send a document/file via Telegram. */
export function sendTelegramDocumentResult(docUrl: string, caption?: string, cls: TelegramClass = DEFAULT_TELEGRAM_CLASS): Promise<TelegramSendResult> {
  return postMedia("sendDocument", { document: docUrl, caption: caption1024(caption), parse_mode: "HTML" }, cls);
}

/** Send a group of photos (album) via Telegram. */
export function sendTelegramMediaGroupResult(
  media: Array<{ type: "photo" | "video"; url: string; caption?: string }>,
  cls: TelegramClass = DEFAULT_TELEGRAM_CLASS,
): Promise<TelegramSendResult> {
  if (media.length === 0) return Promise.resolve({ status: "failed" });
  return postMedia(
    "sendMediaGroup",
    {
      media: media.map((m, i) => ({
        type: m.type,
        media: m.url,
        caption: i === 0 ? caption1024(m.caption) : undefined,
        parse_mode: i === 0 ? "HTML" : undefined,
      })),
    },
    cls,
  );
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
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "reviews", "incident");
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
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "reviews", "receipt");
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
  return sendTelegramMessage(lines.filter(Boolean).join("\n"), "digest", "digest");
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
  const held = Object.entries(t.muted)
    .filter(([, n]) => n > 0)
    .map(([cls, n]) => `${n} ${cls === "receipt" ? "receipts held" : `${cls} muted`}`);
  return `📨 Telegram: ${t.sent} sent, ${t.rateLimited} dropped by rate limit, ${t.failed} failed${held.length ? `, ${held.join(", ")}` : ""} (since last restart)`;
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
  return sendRaw(lines.filter(Boolean).join("\n"), "digest");
}
