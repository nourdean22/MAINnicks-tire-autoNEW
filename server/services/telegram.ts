/**
 * Telegram Push Notifications — Real-time alerts to Nour's phone
 * Sends critical shop events: new leads, low reviews, after-hours requests,
 * revenue milestones, and system alerts.
 *
 * Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars
 */

import { createLogger } from "../lib/logger";

const log = createLogger("telegram");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

function isConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}

/** Send a plain text message to the owner's Telegram */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!isConfigured()) {
    log.debug("Telegram not configured, skipping");
    return false;
  }

  try {
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
      log.warn("Telegram send failed", { status: res.status, err });
      return false;
    }

    return true;
  } catch (err) {
    log.warn("Telegram send error", { err });
    return false;
  }
}

// ─── Formatted Alert Helpers ────────────────────────

/** New lead alert */
export function alertNewLead(lead: {
  name: string;
  phone?: string;
  service?: string;
  source?: string;
}) {
  const lines = [
    `🔔 <b>NEW LEAD</b>`,
    `👤 ${lead.name}`,
    lead.phone ? `📱 ${lead.phone}` : "",
    lead.service ? `🔧 ${lead.service}` : "",
    lead.source ? `📍 Source: ${lead.source}` : "",
    `⏰ ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
  ];
  return sendTelegram(lines.filter(Boolean).join("\n"));
}

/** New booking alert */
export function alertNewBooking(booking: {
  name: string;
  phone?: string;
  service?: string;
  date?: string;
}) {
  const lines = [
    `📅 <b>NEW BOOKING</b>`,
    `👤 ${booking.name}`,
    booking.phone ? `📱 ${booking.phone}` : "",
    booking.service ? `🔧 ${booking.service}` : "",
    booking.date ? `📆 ${booking.date}` : "",
  ];
  return sendTelegram(lines.filter(Boolean).join("\n"));
}

/** Low review alert */
export function alertLowReview(review: {
  rating: number;
  author: string;
  text: string;
  platform?: string;
}) {
  const stars = "⭐".repeat(review.rating);
  const lines = [
    `🚨 <b>LOW REVIEW (${review.rating}/5)</b>`,
    `${stars}`,
    `👤 ${review.author}`,
    review.platform ? `📍 ${review.platform}` : "",
    `"${review.text.slice(0, 150)}${review.text.length > 150 ? "..." : ""}"`,
  ];
  return sendTelegram(lines.filter(Boolean).join("\n"));
}

/** After-hours lead/request */
export function alertAfterHours(request: {
  name: string;
  phone?: string;
  type: "lead" | "booking" | "emergency" | "callback";
}) {
  const lines = [
    `🌙 <b>AFTER-HOURS ${request.type.toUpperCase()}</b>`,
    `👤 ${request.name}`,
    request.phone ? `📱 ${request.phone}` : "",
    `⏰ ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}`,
    `💡 Auto-SMS sent to customer`,
  ];
  return sendTelegram(lines.filter(Boolean).join("\n"));
}

/** Revenue milestone */
export function alertRevenueMilestone(data: {
  period: string;
  amount: number;
  milestone: string;
}) {
  const lines = [
    `💰 <b>REVENUE MILESTONE</b>`,
    `📊 ${data.period}: $${data.amount.toLocaleString()}`,
    `🎯 ${data.milestone}`,
  ];
  return sendTelegram(lines.filter(Boolean).join("\n"));
}

/** System alert (errors, vendor down, etc.) */
export function alertSystem(title: string, detail: string) {
  return sendTelegram(`⚙️ <b>${title}</b>\n${detail}`);
}

/** Daily summary */
export function sendDailySummary(data: {
  leads: number;
  bookings: number;
  revenue: number;
  reviews: number;
  avgRating?: number;
}) {
  const lines = [
    `📊 <b>DAILY SUMMARY</b>`,
    `🔔 Leads: ${data.leads}`,
    `📅 Bookings: ${data.bookings}`,
    `💰 Revenue: $${data.revenue.toLocaleString()}`,
    `⭐ Reviews: ${data.reviews}${data.avgRating ? ` (avg ${data.avgRating.toFixed(1)})` : ""}`,
    ``,
    `— Nick's Tire & Auto`,
  ];
  return sendTelegram(lines.join("\n"));
}
