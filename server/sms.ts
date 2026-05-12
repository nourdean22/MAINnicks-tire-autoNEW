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
import { normalizePhone } from "./lib/phone";
import { getOrCreateBreaker } from "./lib/circuit-breaker";

import { BUSINESS } from "@shared/business";
const log = createLogger("sms");

// ─── Circuit Breaker ────────────────────────────────
const twilioCB = getOrCreateBreaker("twilio-sms", {
  failureThreshold: 5,
  cooldownMs: 30_000,
  timeoutMs: 15_000,
});

// ─── Opt-out Cache ──────────────────────────────────
// wave-142a — replaces the per-send full-table LIKE scan with an
// in-memory Set of normalized opted-out phones. 5-min TTL, plus
// write-through invalidation via markPhoneOptedOut / markPhoneOptedIn
// so opt-outs propagate immediately for TCPA compliance.
let optOutCache: Set<string> | null = null;
let optOutCacheLoadedAt = 0;
const OPT_OUT_CACHE_TTL_MS = 5 * 60 * 1000;

async function ensureOptOutCache(): Promise<Set<string>> {
  const now = Date.now();
  if (optOutCache && now - optOutCacheLoadedAt < OPT_OUT_CACHE_TTL_MS) {
    return optOutCache;
  }
  try {
    const { getDb } = await import("./db");
    const { customers } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return optOutCache ?? new Set();
    const rows = await db
      .select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    const fresh = new Set<string>();
    for (const r of rows) {
      const norm = (r.phone || "").replace(/\D/g, "").slice(-10);
      if (norm.length === 10) fresh.add(norm);
    }
    optOutCache = fresh;
    optOutCacheLoadedAt = now;
    return fresh;
  } catch (err) {
    log.warn("opt-out cache refresh failed — using stale or empty", {
      error: err instanceof Error ? err.message : String(err),
    });
    return optOutCache ?? new Set();
  }
}

/**
 * Mark a phone as opted out — call this from any code path that sets
 * smsOptOut=1 in the customers table. Updates the cache immediately so
 * the very next sendSms() call respects the opt-out (TCPA requirement).
 */
export function markPhoneOptedOut(phone: string): void {
  const norm = (phone || "").replace(/\D/g, "").slice(-10);
  if (norm.length !== 10) return;
  if (!optOutCache) optOutCache = new Set();
  optOutCache.add(norm);
}

/**
 * Inverse — call when a customer texts START/UNSTOP and smsOptOut goes
 * back to 0. Removes from cache so future sends to this number resume.
 */
export function markPhoneOptedIn(phone: string): void {
  const norm = (phone || "").replace(/\D/g, "").slice(-10);
  if (norm.length !== 10) return;
  optOutCache?.delete(norm);
}

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
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone }));
  const hour = etTime.getHours();
  return hour >= 8 && hour < 20; // 8AM to 8PM
}

function getNextSendWindow(): Date {
  const now = new Date();
  const etTime = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone }));
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

  // Persist to DB so delayed messages survive restarts
  (async () => {
    try {
      const { getDb } = await import("./db");
      const { smsMessages, smsConversations } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return;
      // Find or create conversation for this phone
      let [conv] = await db.select({ id: smsConversations.id })
        .from(smsConversations).where(eq(smsConversations.phone, to)).limit(1);
      if (!conv) {
        const [inserted] = await db.insert(smsConversations).values({ phone: to }).$returningId();
        conv = { id: inserted.id };
      }
      await db.insert(smsMessages).values({
        conversationId: conv.id,
        direction: "outbound",
        body,
        status: "queued",
      });
    } catch (err) {
      log.warn("Failed to persist delayed SMS to DB", { error: err instanceof Error ? err.message : String(err) });
    }
  })();
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

  // Rehydrate pending messages from DB that survived a restart
  (async () => {
    try {
      const { getDb } = await import("./db");
      const { smsMessages, smsConversations } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return;
      const pending = await db.select({
        id: smsMessages.id,
        body: smsMessages.body,
        phone: smsConversations.phone,
      })
        .from(smsMessages)
        .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
        .where(eq(smsMessages.status, "queued"))
        .limit(100);

      if (pending.length > 0) {
        for (const msg of pending) {
          // Only add if not already in the in-memory queue
          const alreadyQueued = delayedQueue.some(q => q.to === msg.phone && q.body === msg.body);
          if (!alreadyQueued) {
            delayedQueue.push({ to: msg.phone, body: msg.body, scheduledFor: getNextSendWindow() });
          }
          // Mark DB row as sent so it won't be rehydrated again
          await db.update(smsMessages).set({ status: "sent" }).where(eq(smsMessages.id, msg.id));
        }
        log.info(`Rehydrated ${pending.length} pending SMS from DB`);
      }
    } catch (err) {
      log.warn("Failed to rehydrate SMS queue from DB", { error: err instanceof Error ? err.message : String(err) });
    }
  })();

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

/**
 * Wave-103 — record an inbound SMS that arrived through the shop's
 * SMS Gateway app (customer texted 216-862-0005 directly). Webhook
 * handler at /api/webhooks/sms-gateway calls this so customer replies
 * land in the same conversation thread as Twilio-routed traffic.
 */
export function recordInboundShopSms(
  phone: string,
  body: string,
  gatewayMessageId?: string
): { normalized: string | null } {
  const normalized = normalizePhone(phone);
  if (!normalized) return { normalized: null };
  addToThread(normalized, "inbound", body, gatewayMessageId);
  return { normalized };
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
    // TCPA-defensible compliance log entry
    import("./services/complianceLog")
      .then(({ logSmsOptOut }) => logSmsOptOut({ phone: normalized, via: "keyword", keyword: body }))
      .catch(() => { /* log only, don't block */ });
    return {
      isOptOut: true,
      response: `You've been unsubscribed from ${STORE_NAME} messages. Text START to re-subscribe. Call ${STORE_PHONE} for assistance.`,
    };
  }

  if (optInKeywords.includes(body)) {
    addToThread(normalized, "inbound", data.Body, data.MessageSid);
    log.info("SMS opt-in received", { from: normalized.slice(-4) });
    // TCPA-defensible compliance log entry
    import("./services/complianceLog")
      .then(({ logSmsOptIn }) => logSmsOptIn({ phone: normalized, source: `start_keyword:${body}` }))
      .catch(() => { /* log only, don't block */ });
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
  /**
   * Wave-103 — routing override.
   * - "twilio" (default): send via Twilio API (current behavior)
   * - "shop": send via the shop's Verizon line through SMS Gateway app on
   *   the Samsung F25e. Customer sees the text from 216-862-0005.
   *   Requires SHOP_SMS_GATEWAY_* env vars + the SMS Gateway app running.
   *   Falls back to Twilio + Telegram alert if shop gateway is offline.
   */
  via?: "twilio" | "shop";
}

// ─── Wave-103: SMS Gateway (Samsung F25e) integration ───
// The shop owner's Verizon-line phone runs the SMS Gateway by Capevace
// app (https://sms-gate.app). Backend POSTs to their cloud relay, the
// app fires the message via Android's native SmsManager, customer sees
// the text from the shop's real number 216-862-0005.
//
// Env required:
//   SHOP_SMS_GATEWAY_URL       — base URL (default https://api.sms-gate.app/3rdparty/v1)
//   SHOP_SMS_GATEWAY_USERNAME  — auth username from the app
//   SHOP_SMS_GATEWAY_PASSWORD  — auth password from the app
//
// If env vars are absent → sendSmsViaShopGateway returns failure
// immediately and the caller falls back to Twilio.

interface ShopGatewayResult {
  success: boolean;
  gatewayMessageId?: string;
  error?: string;
}

async function sendSmsViaShopGateway(
  to: string,
  body: string
): Promise<ShopGatewayResult> {
  const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";
  const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
  const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;

  if (!username || !password) {
    return {
      success: false,
      error: "SHOP_SMS_GATEWAY credentials not configured. Install the SMS Gateway app on the shop's phone and set env vars.",
    };
  }

  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const payload = {
    message: body,
    phoneNumbers: [to],
  };

  try {
    const res = await fetch(`${baseUrl}/message`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log.warn("Shop SMS gateway returned non-OK", { status: res.status, body: text.slice(0, 200) });
      return { success: false, error: `Gateway returned ${res.status}: ${text.slice(0, 100)}` };
    }

    const data = await res.json() as { id?: string; state?: string };
    log.info("Shop SMS gateway accepted", { id: data.id, state: data.state, to: to.slice(-4) });
    return { success: true, gatewayMessageId: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Shop SMS gateway threw", { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Wave-103 — fire a Telegram alert when the shop gateway falls back to
 * Twilio. Operator needs to know if the phone went offline so they can
 * fix it before too many sends bypass the shop number.
 */
async function alertShopGatewayFallback(reason: string, to: string): Promise<void> {
  try {
    const { sendTelegram } = await import("./services/telegram");
    await sendTelegram(
      `⚠️ Shop SMS gateway offline · falling back to Twilio for ${to.slice(-4)}\nReason: ${reason}\n\nCheck the SMS Gateway app on the F25e — it may need to be reopened or the phone may be offline.`
    );
  } catch {
    // Don't break the SMS flow if Telegram is also down
  }
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
 * Send an SMS message (Twilio or shop gateway, with circuit breaker +
 * smart timing).
 *
 * KILL SWITCH: when SMS_KILL_SWITCH=true is set in env, the **Twilio**
 * path short-circuits immediately and returns a degraded response.
 * Used during Twilio outages so phone-AI flows (Nick) don't sit on a
 * 15s circuit-breaker timeout during a live call.
 *
 * Wave-106: the kill switch NO LONGER blocks the shop-gateway path
 * (opts.via === "shop"). The shop gateway is independent of Twilio —
 * it routes through the F25e on Verizon. So when Twilio is down we
 * leave SMS_KILL_SWITCH=true to skip the broken Twilio path, while
 * VAPI / admin / booking flows that opt in via:"shop" keep working.
 *
 * Set SMS_KILL_SWITCH=false (or unset) when Twilio is restored.
 */
export async function sendSms(to: string, body: string, opts?: SendSmsOptions): Promise<SmsResult> {
  // Normalize phone first — both routes need it
  const normalizedEarly = normalizePhone(to);
  if (!normalizedEarly) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }

  // ─── Wave-103/106: shop gateway routing (NOT blocked by kill switch) ───
  // Caller explicitly opted in via opts.via === "shop" → try Capevace
  // gateway first, fall back to Twilio + Telegram alert on failure.
  // Kill switch is checked AFTER this so an active kill switch still
  // allows shop-gateway sends to flow through the F25e.
  if (opts?.via === "shop") {
    const gw = await sendSmsViaShopGateway(normalizedEarly, body);
    if (gw.success) {
      smsStats.totalSent++;
      smsStats.lastSentAt = new Date().toISOString();
      updateDeliveryRate();
      addToThread(normalizedEarly, "outbound", body, gw.gatewayMessageId);
      return { success: true, sid: gw.gatewayMessageId };
    }
    // Fallback path
    log.warn(`Shop gateway failed (${gw.error}) — falling back to Twilio for ${normalizedEarly.slice(-4)}`);
    await alertShopGatewayFallback(gw.error || "unknown", normalizedEarly);
    // Drop through to normal Twilio flow below
  }

  // ─── Kill switch (Twilio-only — wave-106) ────────────
  // Blocks the Twilio path when SMS_KILL_SWITCH=true. Shop gateway
  // already returned above if it succeeded; if we're here, either the
  // caller didn't opt-in to shop, or shop fell back. Either way we're
  // about to hit Twilio — and if Twilio is down, this short-circuits
  // before the 15s circuit-breaker timeout slows things down.
  if (process.env.SMS_KILL_SWITCH === "true") {
    log.warn("SMS kill switch active (Twilio path) — skipping send", { to: to.slice(-4) });
    return { success: false, error: "sms_disabled" };
  }

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

  // TCPA compliance: check SMS opt-out before sending.
  // wave-142a — was `like(customers.phone, '%${last10}')` which is a
  // leading-wildcard that MySQL/TiDB cannot index, meaning every single
  // outbound SMS did a full sequential scan of the customers table.
  // At bulk-campaign volume (thousands of sends/min) this was the dominant
  // cost. Now: in-memory Set<string> of opted-out normalized phones,
  // refreshed lazily (5 min TTL) + invalidated on opt-out write via
  // markPhoneOptedOut/markPhoneOptedIn (called from smsBot + responseParser).
  // First send after process boot pays for the scan once; every subsequent
  // send is O(1).
  if (!opts?.skipOptOutCheck) {
    try {
      const last10 = normalized.slice(-10);
      const optOuts = await ensureOptOutCache();
      if (optOuts.has(last10)) {
        smsStats.totalOptedOut++;
        return { success: false, error: "Customer opted out of SMS" };
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

// normalizePhone now lives in ./lib/phone — imported above, re-exported below.

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
  return `Hi ${firstName}, it may be time for your next ${service.toLowerCase()}.${mileage} Call ${STORE_PHONE} or schedule a drop-off at nickstire.org. First-come, first-served.\n\n— ${STORE_NAME}`;
}

/** Lead submission confirmation SMS */
export function leadConfirmationSms(name: string): string {
  const firstName = name.split(" ")[0];
  return `Thanks for contacting ${STORE_NAME}! We received your request and will call you shortly. Questions? Call us at ${STORE_PHONE}`;
}

/** Booking confirmation request SMS — asks customer to reply YES */
export function bookingConfirmationRequestSms(name: string, preferredTime?: string): string {
  const firstName = name.split(" ")[0];
  const timeNote = preferredTime && preferredTime !== "no-preference" ? ` (${preferredTime})` : "";
  return `Hi ${firstName}, confirming your visit to ${STORE_NAME}${timeNote}. Reply YES to confirm or call ${STORE_PHONE} to reschedule.`;
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
