/**
 * Twilio SMS Integration for Nick's Tire & Auto
 *
 * UPGRADED: Conversation threading, smart timing (8AM-8PM ET),
 * opt-out management, delivery status tracking, circuit breaker protection.
 *
 * Handles all outbound SMS messaging:
 * - Status update notifications (stage changes)
 * - 24-hour thank-you follow-ups
 * - 7-day review request follow-ups
 * - Callback request confirmations
 * - Booking confirmations
 *
 * All messages identify as Nick's Tire & Auto and include
 * the store phone number (216) 862-0005 for callbacks.
 */
import twilio from "twilio";

import { STORE_PHONE, STORE_NAME } from "@shared/const";
import { createLogger } from "./lib/logger";
import { getOrCreateBreaker } from "./lib/circuit-breaker";

const log = createLogger("sms");

// ─── Circuit Breaker ────────────────────────────────
const twilioCB = getOrCreateBreaker("twilio-sms", {
  failureThreshold: 5,
  cooldownMs: 30_000,
  timeoutMs: 15_000,
});

// ─── TWILIO CLIENT ─────────────────────────────────────

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    log.warn("Twilio credentials not configured");
    return null;
  }

  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER || "";
}

// ─── Smart Timing (8AM-8PM ET) ─────────────────────

function isWithinSendingHours(): boolean {
  const now = new Date();
  // Get current hour in Eastern Time
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = etTime.getHours();
  return hour >= 8 && hour < 20; // 8AM to 8PM
}

function getNextSendWindow(): Date {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = etTime.getHours();

  if (hour >= 20) {
    // After 8PM — schedule for 8AM tomorrow
    etTime.setDate(etTime.getDate() + 1);
    etTime.setHours(8, 0, 0, 0);
  } else if (hour < 8) {
    // Before 8AM — schedule for 8AM today
    etTime.setHours(8, 0, 0, 0);
  }

  return etTime;
}

// ─── Delayed Message Queue (for outside-hours) ─────
interface DelayedMessage {
  to: string;
  body: string;
  scheduledFor: Date;
  opts?: SendSmsOptions;
}

const delayedQueue: DelayedMessage[] = [];
let delayedTimer: ReturnType<typeof setInterval> | null = null;

function queueForLater(to: string, body: string, opts?: SendSmsOptions): void {
  const scheduledFor = getNextSendWindow();
  delayedQueue.push({ to, body, scheduledFor, opts });
  smsStats.queued++;
  log.info("SMS queued for sending window", {
    to: to.slice(-4),
    scheduledFor: scheduledFor.toISOString(),
  });
}

async function processDelayedQueue(): Promise<void> {
  if (delayedQueue.length === 0) return;
  if (!isWithinSendingHours()) return;

  const now = Date.now();
  // Drain ready messages atomically to prevent race with concurrent queueForLater
  const stillPending: DelayedMessage[] = [];
  const ready: DelayedMessage[] = [];
  for (const msg of delayedQueue) {
    if (now >= msg.scheduledFor.getTime()) {
      ready.push(msg);
    } else {
      stillPending.push(msg);
    }
  }
  delayedQueue.length = 0;
  delayedQueue.push(...stillPending);

  for (const msg of ready) {
    // Send with force flag to skip timing check
    await sendSms(msg.to, msg.body, { ...msg.opts, _forceImmediate: true });
  }
}

export function startDelayedQueueProcessor(): void {
  if (delayedTimer) return;
  delayedTimer = setInterval(() => {
    processDelayedQueue().catch((err) => {
      log.warn("Delayed SMS queue processing failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, 60_000); // Check every minute
  log.info("SMS delayed queue processor started");
}

export function stopDelayedQueueProcessor(): void {
  if (delayedTimer) {
    clearInterval(delayedTimer);
    delayedTimer = null;
  }
}

// NOTE: startDelayedQueueProcessor() is called from server startup in _core/index.ts
// Do NOT auto-start here — it causes side effects during imports and tests

// ─── Conversation Threading ─────────────────────────
interface ConversationThread {
  phone: string;
  messages: Array<{
    direction: "outbound" | "inbound";
    body: string;
    sid?: string;
    timestamp: string;
    status?: string;
  }>;
  lastActivity: string;
  messageCount: number;
}

const conversationThreads = new Map<string, ConversationThread>();
const MAX_THREAD_MESSAGES = 50;
const MAX_CONVERSATION_THREADS = 500;

function getOrCreateThread(phone: string): ConversationThread {
  let thread = conversationThreads.get(phone);
  if (!thread) {
    // Evict oldest thread if at capacity
    if (conversationThreads.size >= MAX_CONVERSATION_THREADS) {
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [key, t] of conversationThreads) {
        const time = new Date(t.lastActivity).getTime();
        if (time < oldestTime) { oldestTime = time; oldestKey = key; }
      }
      if (oldestKey) conversationThreads.delete(oldestKey);
    }
    thread = {
      phone,
      messages: [],
      lastActivity: new Date().toISOString(),
      messageCount: 0,
    };
    conversationThreads.set(phone, thread);
  }
  return thread;
}

function addToThread(
  phone: string,
  direction: "outbound" | "inbound",
  body: string,
  sid?: string,
  status?: string
): void {
  const thread = getOrCreateThread(phone);
  thread.messages.push({
    direction,
    body,
    sid,
    timestamp: new Date().toISOString(),
    status,
  });
  if (thread.messages.length > MAX_THREAD_MESSAGES) {
    thread.messages.shift();
  }
  thread.lastActivity = new Date().toISOString();
  thread.messageCount++;
}

/** Get conversation thread for a phone number */
export function getConversationThread(phone: string): ConversationThread | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return conversationThreads.get(normalized) || null;
}

/** Get all active conversation threads (for admin) */
export function getActiveThreads(limit = 20): ConversationThread[] {
  return Array.from(conversationThreads.values())
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    .slice(0, limit);
}

// ─── Delivery Status Tracking ───────────────────────
interface SmsDeliveryStats {
  totalSent: number;
  totalFailed: number;
  totalDelivered: number;
  totalQueued: number;
  totalOptedOut: number;
  queued: number;
  lastSentAt: string | null;
  lastError: string | null;
  deliveryRate: number;
}

const smsStats: SmsDeliveryStats = {
  totalSent: 0,
  totalFailed: 0,
  totalDelivered: 0,
  totalQueued: 0,
  totalOptedOut: 0,
  queued: 0,
  lastSentAt: null,
  lastError: null,
  deliveryRate: 100,
};

function updateDeliveryRate(): void {
  const total = smsStats.totalSent + smsStats.totalFailed;
  smsStats.deliveryRate = total > 0
    ? Math.round((smsStats.totalSent / total) * 100)
    : 100;
}

export function getSmsStats(): SmsDeliveryStats & { delayedQueueSize: number; activeThreads: number } {
  return {
    ...smsStats,
    delayedQueueSize: delayedQueue.length,
    activeThreads: conversationThreads.size,
  };
}

/**
 * Handle Twilio status callback — call this from your webhook endpoint.
 * Twilio POSTs to your status callback URL with delivery updates.
 */
export function handleDeliveryStatus(data: {
  MessageSid: string;
  MessageStatus: string;
  To?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}): void {
  const { MessageSid, MessageStatus, To, ErrorCode, ErrorMessage } = data;

  log.info("SMS delivery status update", {
    sid: MessageSid,
    status: MessageStatus,
    to: To ? To.slice(-4) : undefined,
  });

  if (MessageStatus === "delivered") {
    smsStats.totalDelivered++;
  } else if (MessageStatus === "failed" || MessageStatus === "undelivered") {
    smsStats.totalFailed++;
    smsStats.lastError = ErrorMessage || `Error ${ErrorCode}`;
    log.warn("SMS delivery failed", {
      sid: MessageSid,
      errorCode: ErrorCode,
      errorMessage: ErrorMessage,
    });
  }

  updateDeliveryRate();

  // Update conversation thread
  if (To) {
    const normalized = normalizePhone(To);
    if (normalized) {
      const thread = conversationThreads.get(normalized);
      if (thread) {
        const msg = thread.messages.find((m) => m.sid === MessageSid);
        if (msg) {
          msg.status = MessageStatus;
        }
      }
    }
  }
}

/**
 * Handle inbound SMS — call this from your Twilio webhook for incoming messages.
 */
export function handleInboundSms(data: {
  From: string;
  Body: string;
  MessageSid: string;
}): { isOptOut: boolean; response?: string } {
  const normalized = normalizePhone(data.From);
  if (!normalized) return { isOptOut: false };

  const body = data.Body.trim().toUpperCase();

  // TCPA opt-out keywords
  const optOutKeywords = ["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
  const optInKeywords = ["START", "YES", "UNSTOP"];

  if (optOutKeywords.includes(body)) {
    // Record opt-out (handled at DB level by the caller)
    smsStats.totalOptedOut++;
    addToThread(normalized, "inbound", data.Body, data.MessageSid);
    log.info("SMS opt-out received", { from: normalized.slice(-4) });
    return {
      isOptOut: true,
      response: `You've been unsubscribed from ${STORE_NAME} messages. Text START to re-subscribe. Call ${STORE_PHONE} for assistance.`,
    };
  }

  if (optInKeywords.includes(body)) {
    addToThread(normalized, "inbound", data.Body, data.MessageSid);
    log.info("SMS opt-in received", { from: normalized.slice(-4) });
    return {
      isOptOut: false,
      response: `You've been re-subscribed to ${STORE_NAME} messages. Reply STOP to unsubscribe.`,
    };
  }

  // Regular inbound message — add to thread
  addToThread(normalized, "inbound", data.Body, data.MessageSid);
  return { isOptOut: false };
}

// ─── CORE SEND FUNCTION ────────────────────────────────

export interface SmsResult {
  success: boolean;
  sid?: string;
  error?: string;
  queued?: boolean;
}

interface SendSmsOptions {
  skipOptOutCheck?: boolean;
  /** Skip timing check — used internally for delayed queue processing */
  _forceImmediate?: boolean;
  /** Transactional SMS (booking confirmations, status updates) bypass timing restrictions */
  transactional?: boolean;
}

// Per-phone daily rate limit (capped at 2000 entries, cleaned hourly)
const smsCountMap = new Map<string, { count: number; resetAt: number }>();
const MAX_SMS_PER_PHONE_PER_DAY = 8;

// Per-phone short-term cooldown (5 min between messages, capped)
const smsLastSentMap = new Map<string, number>();
const SMS_COOLDOWN_MS = 5 * 60 * 1000;

// Periodic cleanup to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  // Clean expired rate limits
  for (const [phone, data] of smsCountMap) {
    if (now > data.resetAt) smsCountMap.delete(phone);
  }
  // Clean stale cooldowns (older than 1 hour)
  for (const [phone, ts] of smsLastSentMap) {
    if (now - ts > 3600_000) smsLastSentMap.delete(phone);
  }
  // Hard cap — if still too big, clear oldest
  if (smsCountMap.size > 2000) smsCountMap.clear();
  if (smsLastSentMap.size > 2000) smsLastSentMap.clear();
}, 60 * 60 * 1000); // Every hour

function checkDailyLimit(phone: string): boolean {
  const now = Date.now();

  // Short-term cooldown
  const lastSent = smsLastSentMap.get(phone);
  if (lastSent && now - lastSent < SMS_COOLDOWN_MS) {
    log.warn("SMS cooldown active", {
      phone: phone.slice(-4),
      secondsAgo: Math.round((now - lastSent) / 1000),
    });
    return false;
  }

  const entry = smsCountMap.get(phone);
  if (!entry || now > entry.resetAt) {
    smsCountMap.set(phone, { count: 1, resetAt: now + 24 * 60 * 60 * 1000 });
    smsLastSentMap.set(phone, now);
    return true;
  }
  if (entry.count >= MAX_SMS_PER_PHONE_PER_DAY) return false;
  entry.count++;
  smsLastSentMap.set(phone, now);
  return true;
}

/**
 * Send an SMS message via Twilio (with circuit breaker + smart timing).
 */
export async function sendSms(to: string, body: string, opts?: SendSmsOptions): Promise<SmsResult> {
  const client = getTwilioClient();
  const from = getFromNumber();

  if (!client || !from) {
    log.warn("Twilio not configured, skipping SMS", { to: to.slice(-4) });
    return { success: false, error: "Twilio not configured" };
  }

  // Normalize phone to E.164 (US numbers)
  const normalized = normalizePhone(to);
  if (!normalized) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }

  // Smart timing: check if within sending hours
  // Transactional messages and forced-immediate skip this check
  if (!opts?.transactional && !opts?._forceImmediate && !isWithinSendingHours()) {
    queueForLater(normalized, body, opts);
    return {
      success: true,
      queued: true,
      error: "Outside sending hours (8AM-8PM ET), queued for next window",
    };
  }

  // Rate limit: max 8 SMS per phone per 24h
  if (!opts?.skipOptOutCheck && !checkDailyLimit(normalized)) {
    return { success: false, error: "Daily SMS limit reached for this number" };
  }

  // TCPA compliance: check SMS opt-out before sending
  if (!opts?.skipOptOutCheck) {
    try {
      const { getDb } = await import("./db");
      const { customers } = await import("../drizzle/schema");
      const { like } = await import("drizzle-orm");
      const db = await getDb();
      if (db) {
        const last10 = normalized.slice(-10);
        const [customer] = await db
          .select({ smsOptOut: customers.smsOptOut })
          .from(customers)
          .where(like(customers.phone, `%${last10}`))
          .limit(1);
        if (customer?.smsOptOut) {
          smsStats.totalOptedOut++;
          return { success: false, error: "Customer opted out of SMS" };
        }
      }
    } catch (err) {
      log.warn("Opt-out check failed, proceeding with send", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Send via circuit breaker
  try {
    const message = await twilioCB.call(async () => {
      const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
      const createOpts: {
        body: string;
        from: string;
        to: string;
        statusCallback?: string;
      } = { body, from, to: normalized };

      if (statusCallbackUrl) {
        createOpts.statusCallback = statusCallbackUrl;
      }

      return client.messages.create(createOpts);
    });

    smsStats.totalSent++;
    smsStats.lastSentAt = new Date().toISOString();
    updateDeliveryRate();

    // Add to conversation thread
    addToThread(normalized, "outbound", body, message.sid);

    return { success: true, sid: message.sid };
  } catch (error: any) {
    const errMsg = error instanceof Error ? error.message : String(error);
    smsStats.totalFailed++;
    smsStats.lastError = errMsg;
    updateDeliveryRate();
    log.error("SMS send failed", { to: normalized.slice(-4), error: errMsg });
    return { success: false, error: errMsg };
  }
}

/**
 * Normalize a phone number to E.164 format for US numbers.
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "");

  if (digits.startsWith("+1") && digits.length === 12) return digits;
  if (digits.startsWith("+") && digits.length >= 11) return digits;

  const justDigits = digits.replace(/\D/g, "");
  if (justDigits.length === 10) return `+1${justDigits}`;
  if (justDigits.length === 11 && justDigits.startsWith("1")) return `+${justDigits}`;

  return null;
}

// ─── MESSAGE TEMPLATES ─────────────────────────────────

/** Booking confirmation SMS */
export function bookingConfirmationSms(name: string, service: string, refCode?: string): string {
  const firstName = name.split(" ")[0];
  const ref = refCode ? ` Ref: #${refCode}` : "";
  return `Hi ${firstName}, your ${service.toLowerCase()} appointment at ${STORE_NAME} has been received. We'll confirm your time slot shortly.${ref}\n\nQuestions? Call ${STORE_PHONE}`;
}

/** Status update SMS */
export function statusUpdateSms(name: string, stage: string, refCode?: string): string {
  const firstName = name.split(" ")[0];
  const ref = refCode ? ` (Ref: #${refCode})` : "";

  const stageMessages: Record<string, string> = {
    received: `your vehicle has been received and is in our queue`,
    inspecting: `our technicians are now inspecting your vehicle`,
    "waiting-parts": `we're waiting for parts to arrive for your repair. We'll update you as soon as they're in`,
    "in-progress": `your vehicle is actively being repaired`,
    "quality-check": `your repair is done and going through our quality check`,
    ready: `your vehicle is READY FOR PICKUP! Come by anytime during business hours (Mon-Sat 8AM-6PM, Sun 9AM-4PM)`,
  };

  const statusMsg = stageMessages[stage] || "your vehicle status has been updated";
  const pickup = stage === "ready" ? "" : `\n\nTrack status: nickstire.org/status`;

  return `Hi ${firstName}, ${statusMsg}.${ref}${pickup}\n\n${STORE_NAME} — ${STORE_PHONE}`;
}

/** 24-hour thank-you SMS */
export function thankYouSms(name: string, service: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}, thank you for choosing ${STORE_NAME} for your ${service.toLowerCase()}. We appreciate your business! If anything doesn't feel right, call us at ${STORE_PHONE}. — Nick's Team`;
}

/** 7-day review request SMS */
export function reviewRequestSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}, hope your vehicle is running great! If you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n\nnickstire.org/review\n\nThank you! — ${STORE_NAME}`;
}

/** Callback confirmation SMS */
export function callbackConfirmationSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Hi ${firstName}, we received your callback request at ${STORE_NAME}. One of our team members will call you back shortly during business hours (Mon-Sat 8AM-6PM, Sun 9AM-4PM). — ${STORE_PHONE}`;
}

/** Maintenance reminder SMS */
export function maintenanceReminderSms(name: string, service: string, mileageNote?: string): string {
  const firstName = name.split(" ")[0];
  const mileage = mileageNote ? ` ${mileageNote}` : "";
  return `Hi ${firstName}, it may be time for your next ${service.toLowerCase()}.${mileage} Call ${STORE_PHONE} or book online at nickstire.org to schedule.\n\n— ${STORE_NAME}`;
}

/** Lead submission confirmation SMS */
export function leadConfirmationSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Thanks for contacting ${STORE_NAME}! We received your request and will call you shortly. Questions? Call us at ${STORE_PHONE}`;
}

/** Appointment reminder — 24 hours before */
export function appointmentReminder24hSms(name: string, service: string, vehicle?: string, preferredTime?: string): string {
  const firstName = name.split(" ")[0];
  const vehicleNote = vehicle ? ` for your ${vehicle}` : "";
  const timeNote = preferredTime ? ` at ${preferredTime}` : "";
  return `Hi ${firstName}, reminder: your ${service.toLowerCase()} appointment${vehicleNote} is tomorrow${timeNote}. If you need to reschedule, call ${STORE_PHONE}.\n\n— ${STORE_NAME}`;
}

/** Appointment reminder — 1 hour before */
export function appointmentReminder1hSms(name: string, vehicle?: string): string {
  const firstName = name.split(" ")[0];
  const vehicleNote = vehicle ? ` with your ${vehicle}` : "";
  return `Hi ${firstName}, your appointment at ${STORE_NAME} is in about 1 hour${vehicleNote}. See you soon! ${STORE_PHONE}`;
}

// ─── EXPORTS ───────────────────────────────────────────

export { normalizePhone, STORE_PHONE, STORE_NAME };
