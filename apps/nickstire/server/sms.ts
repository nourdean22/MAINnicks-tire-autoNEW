/**
 * SMS Integration for Nick's Tire & Auto
 *
 * Outbound SMS routes shop-first (wave-181.60): the F25e Capevace
 * gateway at 216-862-0005 is the primary sender. When it's offline,
 * messages QUEUE and auto-deliver once it checks back in (operator
 * directive 2026-06 · Twilio not set up). Inbound replies arrive via
 * the SMS Gateway webhook (routes/webhooks/sms-gateway.ts).
 *
 * Features: conversation threading, smart timing (8AM-8PM ET), opt-out
 * management, delivery status tracking, circuit breaker protection.
 *
 * Handles outbound SMS messaging:
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
import { isGatewayOnline } from "./lib/gateway-device";

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
    const { customers, smsPreferences } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return optOutCache ?? new Set();
    const fresh = new Set<string>();
    const addNorm = (phone: string | null) => {
      const norm = (phone || "").replace(/\D/g, "").slice(-10);
      if (norm.length === 10) fresh.add(norm);
    };
    const rows = await db
      .select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    for (const r of rows) addNorm(r.phone);
    // code-review 2026-07-09 · UNION the durable sms_preferences store so
    // opt-outs from phones with NO customers row (leads, VAPI callers) survive
    // this rebuild. Before, `fresh` came from customers.smsOptOut ONLY, so a
    // non-customer STOP was silently dropped within 5 min (TCPA exposure).
    const prefRows = await db
      .select({ phone: smsPreferences.phone })
      .from(smsPreferences)
      .where(eq(smsPreferences.optedOut, true));
    for (const r of prefRows) addNorm(r.phone);
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
 * code-review 2026-07-09 · durably persist the opt-out/in state to the
 * phone-keyed sms_preferences table so it survives the 5-min cache rebuild,
 * process restarts, and other pods. The in-memory cache write in the callers
 * already blocks the next send from THIS process; this makes it stick
 * everywhere. Best-effort fire-and-forget: if the table is missing (schema
 * drift) the catch degrades to the prior in-memory-only behavior.
 */
async function persistOptOutPreference(phone10: string, optedOut: boolean): Promise<void> {
  try {
    const { getDb } = await import("./db");
    const { smsPreferences } = await import("../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    const stamp = optedOut ? { optedOutAt: new Date() } : { optedInAt: new Date() };
    await db
      .insert(smsPreferences)
      .values({ phone: phone10, optedOut, ...stamp })
      .onDuplicateKeyUpdate({ set: { optedOut, ...stamp } });
  } catch (err) {
    log.warn("sms_preferences persist failed — opt-out is in-memory only", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Mark a phone as opted out — call this from any code path that sets
 * smsOptOut=1 in the customers table. Updates the cache immediately so
 * the very next sendSms() call respects the opt-out (TCPA requirement) AND
 * persists durably to sms_preferences (survives the cache rebuild / restart).
 */
export function markPhoneOptedOut(phone: string): void {
  const norm = (phone || "").replace(/\D/g, "").slice(-10);
  if (norm.length !== 10) return;
  if (!optOutCache) optOutCache = new Set();
  optOutCache.add(norm);
  void persistOptOutPreference(norm, true);
}

/**
 * Inverse — call when a customer texts START/UNSTOP and smsOptOut goes
 * back to 0. Removes from cache so future sends to this number resume, and
 * clears the durable sms_preferences flag.
 */
export function markPhoneOptedIn(phone: string): void {
  const norm = (phone || "").replace(/\D/g, "").slice(-10);
  if (norm.length !== 10) return;
  optOutCache?.delete(norm);
  void persistOptOutPreference(norm, false);
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
  /**
   * wave-181.102 (#3b) — smsMessages row id. processDelayedQueue() stamps
   * the row "sent" after a successful send so a later process restart's
   * rehydrate does NOT re-send this message (a customer double-text).
   */
  dbId?: number;
}

const delayedQueue: DelayedMessage[] = [];
let delayedTimer: ReturnType<typeof setInterval> | null = null;

function queueForLater(to: string, body: string, opts?: SendSmsOptions): void {
  const scheduledFor = getNextSendWindow();
  // wave-181.102 (#3b) — keep a reference to the queued object so the
  // DB-persist IIFE below can stamp its smsMessages row id back onto it.
  // processDelayedQueue() needs dbId to mark the row "sent" after the
  // send — without it the row stays "queued" and the next restart's
  // rehydrate re-sends the message (a customer double-text). scheduledFor
  // is always hours out (next 8AM window), so dbId is set long before
  // the message becomes eligible to send.
  const queued: DelayedMessage = { to, body, scheduledFor, opts };
  delayedQueue.push(queued);
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
      // Find or create conversation for this phone. Key on the 10-digit form
      // (matches getOrCreateConversation + logOutboundSms) so the durable-queue
      // path can't create a "+1..." duplicate of an existing 10-digit thread
      // (the conversation-split bug fixed 2026-06).
      const convPhone = to.replace(/\D/g, "").slice(-10);
      let [conv] = await db.select({ id: smsConversations.id })
        .from(smsConversations).where(eq(smsConversations.phone, convPhone)).limit(1);
      if (!conv) {
        const [inserted] = await db.insert(smsConversations).values({ phone: convPhone }).$returningId();
        conv = { id: inserted.id };
      }
      const [row] = await db.insert(smsMessages).values({
        conversationId: conv.id,
        direction: "outbound",
        body,
        status: "queued",
        // wave-2026-06 (telemetry dedup) — carry the caller's tier onto the
        // durable queued row so a QUEUED tagged send is ONE tiered row, not
        // an untagged queueForLater row + a tagged logOutboundSms row. The
        // cron skips logOutboundSms when result.queued is true.
        variantKey: opts?.variantKey ?? null,
      }).$returningId();
      queued.dbId = row?.id;
    } catch (err) {
      log.warn("Failed to persist delayed SMS to DB", { error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

async function processDelayedQueue(): Promise<void> {
  if (delayedQueue.length === 0) return;
  if (!isWithinSendingHours()) return;
  // Operator directive (2026-06) — only drain when the F25e is actually
  // back online. A drained send while offline would fail (Twilio is off)
  // and leave the claimed row stuck in 'sending'. Hold until it returns;
  // the queued rows persist + rehydrate, so nothing is lost. Skip the gate
  // when the gateway isn't configured (dev/test keeps draining as before).
  if (isShopGatewayConfigured() && !(await isShopGatewayReachable())) return;

  const now = Date.now();
  // Drain ready messages atomically to prevent race with concurrent queueForLater
  const stillPending: DelayedMessage[] = [];
  const ready: DelayedMessage[] = [];
  for (const msg of delayedQueue) {
    // dbId race guard -- a just-queued message may not have its smsMessages
    // row id stamped back yet (queueForLater persists async). Draining
    // before dbId lands means the post-send "sent" update is skipped, the
    // row stays "queued", and a restart rehydrates + RE-SENDS it (a dupe).
    // Hold it one more cycle until dbId is set.
    if (msg.dbId == null) {
      stillPending.push(msg);
    } else if (now >= msg.scheduledFor.getTime()) {
      ready.push(msg);
    } else {
      stillPending.push(msg);
    }
  }
  delayedQueue.length = 0;
  delayedQueue.push(...stillPending);

  for (const msg of ready) {
    // Send with force flag to skip timing check
    const result = await sendSms(msg.to, msg.body, { ...msg.opts, _forceImmediate: true });
    // wave-181.102 (#3b) — mark the persisted row terminal on a real
    // success so a later process restart's rehydrate does NOT re-send
    // this message (the customer-double-text bug). A failure leaves the
    // row claimable so a genuine send failure isn't silently dropped.
    if (result.success && msg.dbId != null) {
      try {
        const { getDb } = await import("./db");
        const { smsMessages } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (db) {
          await db.update(smsMessages)
            .set({ status: "sent" })
            .where(eq(smsMessages.id, msg.dbId));
        }
      } catch (err) {
        log.warn("Failed to mark delayed SMS row sent", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

export function startDelayedQueueProcessor(): void {
  if (delayedTimer) return;

  // Rehydrate pending messages from DB that survived a restart
  (async () => {
    try {
      const { getDb } = await import("./db");
      const { smsMessages, smsConversations } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
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

      let rehydrated = 0;
      for (const msg of pending) {
        // wave-181.59 · atomic queued -> sending claim. Walks the enum
        // forward correctly — the row stays accurately "in-flight" until
        // the gateway actually responds via processDelayedQueue ->
        // sendSms, instead of being stamped "sent" the moment we pulled
        // it off disk (the prior bug · false-positive every restart).
        // The WHERE status='queued' guard makes the claim race-safe — if
        // a parallel worker already grabbed this row we silently skip
        // and don't re-enqueue it.
        const claim = await db
          .update(smsMessages)
          .set({ status: "sending" })
          .where(and(eq(smsMessages.id, msg.id), eq(smsMessages.status, "queued")));
        const claimedRows = (claim as unknown as { rowsAffected?: number; affectedRows?: number })?.rowsAffected
          ?? (claim as unknown as { rowsAffected?: number; affectedRows?: number })?.affectedRows
          ?? 0;
        if (claimedRows < 1) continue;

        // Only add if not already in the in-memory queue
        const alreadyQueued = delayedQueue.some(q => q.to === msg.phone && q.body === msg.body);
        if (!alreadyQueued) {
          // wave-181.102 (#3b) — carry the row id so the post-send update
          // marks THIS row "sent" — else a later restart re-sends it.
          delayedQueue.push({ to: msg.phone, body: msg.body, scheduledFor: getNextSendWindow(), dbId: msg.id });
        }
        rehydrated++;
      }
      if (rehydrated > 0) {
        log.info(`Rehydrated ${rehydrated} pending SMS from DB`);
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
  /**
   * wave-2026-06 — the caller writes the smsMessages row itself (via
   * logOutboundSms, with its variantKey). Skip persistOutboundShopSms so
   * sendSms does NOT write a SECOND row. The admin SMS counts were ~2x
   * inflated for every cron send (sendSms persisted + the cron logged).
   * logOutboundSms stays the single writer (it carries the variantKey the
   * cron cooldown queries filter on). Only affects the online success /
   * timeout paths; the offline queue (queueForLater) persists separately.
   */
  skipPersist?: boolean;
  /** Skip timing check — used internally for delayed queue processing */
  _forceImmediate?: boolean;
  /** Define the message type to apply correct TCPA rules */
  messageClass?: "customer_marketing" | "customer_followup" | "customer_confirmation" | "internal";
  /** Internal staff alerts bypass customer opt-out footers */
  isInternal?: boolean;
  /** Explicitly bypass customer opt-out footer */
  skipOptOutFooter?: boolean;
  /** forensic-audit MEDIUM · skip ONLY the 5-min in-memory cooldown (the daily
   *  cap still applies). Used for inbound auto-replies: a customer's second
   *  question within 5 min of the first reply must still be answered — the
   *  cooldown is anti-spam for OUTBOUND sends, not for 1:1 responses. */
  skipShortCooldown?: boolean;
  /**
   * Routing override.
   * - undefined (default · wave-181.60): shop-first — tries the F25e
   *   Capevace gateway, falls back to Twilio on failure. This is the
   *   safe default because Twilio has been dead since wave-103 and
   *   callers that forgot to specify `via` were silently failing into
   *   it (the wave-181.58 bug cluster).
   * - "shop" (explicit): same as default. Kept for clarity at call
   *   sites where the routing decision is intentional.
   * - "twilio": opt OUT of shop-first. Use ONLY for the rare case where
   *   you specifically want the Twilio path (test scripts, legacy
   *   Twilio-only webhooks). No production customer-facing path should
   *   pass this.
   *
   * The shop gateway requires SHOP_SMS_GATEWAY_* env vars + the SMS
   * Gateway app running on the F25e. Customer sees the text from
   * 216-862-0005.
   */
  via?: "twilio" | "shop";
  /**
   * wave-2026-06 (telemetry dedup) — A/B / tier key carried onto the
   * smsMessages row written by the OFFLINE queue (queueForLater). Callers
   * that pass skipPersist also tag their send so that, when a send is
   * QUEUED (outside-hours / gateway-offline), the single durable queued
   * row already carries the tier. The cron then skips its own
   * logOutboundSms for queued results (see the call sites) — without this
   * the queued send produced TWO rows: an untagged one from queueForLater
   * AND a tagged one from logOutboundSms (the "Untagged (pre-181.51)"
   * 2x-count bug). The queued row stays load-bearing for delivery
   * (rehydrate reads status='queued'); we just stamp its tier.
   */
  variantKey?: string;
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
  /**
   * wave-181.101 (#3) — true when the failure was a request timeout
   * (AbortSignal.timeout). A timeout is AMBIGUOUS: the Capevace relay may
   * already have accepted the message. Callers must NOT fall back to
   * Twilio on a timeout — that double-sends the customer. Definitive
   * failures (non-OK HTTP, DNS/connection error) leave this undefined.
   */
  timedOut?: boolean;
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

  // wave-181.101 (#3) — env-tunable timeout. The prior fixed 10s was tight
  // enough that a slow Capevace relay round-trip would abort and (pre-fix)
  // trigger a Twilio double-send. 15s default; operator can raise it via
  // SHOP_SMS_GATEWAY_TIMEOUT_MS without a redeploy.
  const timeoutMs = Number(process.env.SHOP_SMS_GATEWAY_TIMEOUT_MS) || 15_000;

  try {
    const res = await fetch(`${baseUrl}/message`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
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
    // wave-181.103 (#3 review fix) — read the error name directly instead
    // of gating on `instanceof Error`. AbortSignal.timeout() rejects with a
    // DOMException, and whether DOMException subclasses Error varies by Node
    // version — gating on instanceof would silently miss the timeout on a
    // runtime where it doesn't, and the send would wrongly fall back to
    // Twilio (double-send). Reading `.name` off the object is version-
    // independent. A timeout means the request may have landed, so
    // sendSms() must NOT fall back to Twilio.
    const errName =
      err && typeof err === "object" && "name" in err
        ? String((err as { name?: unknown }).name)
        : "";
    const timedOut = errName === "TimeoutError" || errName === "AbortError";
    log.error("Shop SMS gateway threw", { error: msg, timedOut });
    return { success: false, error: msg, timedOut };
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

/**
 * wave-181.101 (#2) — persist an outbound shop-gateway send to the durable
 * `smsMessages` table. Two reasons this is required:
 *
 *   1. /admin/sms reads `smsMessages` — without a row, shop sends were
 *      invisible in the conversation thread (only the in-memory addToThread
 *      Map had them, and that Map is wiped on every redeploy).
 *   2. The sms:delivered / sms:failed webhook (routes/webhooks/smsGateway.ts)
 *      updates status by `WHERE twilioSid = <gateway messageId>`. With no
 *      row to match, every shop send sat permanently at "sent" — the
 *      delivery receipts were silently dropped.
 *
 * `status` is "sent" for a confirmed gateway accept, "sending" for the
 * ambiguous timeout path (#3) where we never got a messageId back.
 *
 * Fire-and-forget by contract: a failed DB write must never fail an SMS
 * that already left the gateway. Errors are logged, not thrown.
 */
async function persistOutboundShopSms(
  to: string,
  body: string,
  status: "sent" | "sending",
  gatewayMessageId?: string,
  variantKey?: string | null,
): Promise<void> {
  try {
    const { getOrCreateConversation, addSmsMessage } = await import("./db");
    const conversation = await getOrCreateConversation(to);
    await addSmsMessage({
      conversationId: conversation.id,
      direction: "outbound",
      body,
      twilioSid: gatewayMessageId || undefined,
      status,
      // 2026-07-07 · opts.variantKey was honored on the offline-queue path
      // but dropped here on the online path, so every default-persist cron
      // send landed untagged and invisible to per-campaign attribution
      // (smsPerformance groups by variantKey).
      variantKey: variantKey ?? null,
    });
  } catch (err) {
    log.warn("Failed to persist outbound shop SMS to smsMessages", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const MAX_SMS_PER_PHONE_PER_DAY = 8;

// Per-phone short-term cooldown (5 min between messages, capped).
// Stays in-memory per-instance — the window is tight enough that
// restart loss isn't operationally meaningful, and avoiding a DB
// roundtrip on the cooldown check keeps the hot path lean. The
// per-pod split is also fine here: worst case under N pods is a
// 5-min cooldown effectively becoming 5/N min, which is still
// nowhere near the daily cap. The DAILY counter is the one that
// genuinely needs durability — see checkDailyLimit below.
const smsLastSentMap = new Map<string, number>();
const SMS_COOLDOWN_MS = 5 * 60 * 1000;

// Periodic cleanup to prevent unbounded growth of the in-memory cooldown map.
setInterval(() => {
  const now = Date.now();
  for (const [phone, ts] of smsLastSentMap) {
    if (now - ts > 3600_000) smsLastSentMap.delete(phone);
  }
  if (smsLastSentMap.size > 2000) smsLastSentMap.clear();
}, 60 * 60 * 1000); // Every hour

/**
 * Daily SMS rate-limit check + atomic increment.
 *
 * wave-181.66: counter moved from an in-memory Map (smsCountMap) to the
 * `sms_rate_limit` table (drizzle/0043_wave181_sms_rate_limit_durable.sql).
 * Sister bug to wave-181.59's OTP fix — the map worked for a single
 * long-running process but had two prod-realistic holes:
 *
 *   1. Process restart wiped the counter. Railway redeploys reset every
 *      customer's daily count to 0 — a customer who already received 8
 *      messages today could immediately receive 8 more after a deploy.
 *
 *   2. Railway runs N>1 instances — counts split across pods, so the
 *      effective cap was N× higher than intended.
 *
 * Implementation uses MySQL's atomic INSERT ... ON DUPLICATE KEY UPDATE
 * (same pattern as recordFailedAttempt in middleware/bruteForce.ts) plus
 * a follow-up SELECT to read the post-update count. One row per phone,
 * race-safe across concurrent sends from any pod.
 *
 * The short-term 5-min cooldown still uses smsLastSentMap (in-memory) —
 * its window is too tight for restart loss to matter, and skipping a DB
 * roundtrip on every cooldown check keeps the hot path fast.
 *
 * Fail-open on DB error: if the table is unreachable, allow the send and
 * log a warn. Same policy as middleware/bruteForce.ts — locking real
 * customers out during a DB outage is worse than the rare overcount.
 *
 * The atomic upsert ALWAYS increments (or resets to 1 when the 24h
 * window has rolled). wave-181.101 (#5): the increment is bounded by
 * LEAST(count + 1, cap + 1) so a blocked phone's counter cannot run away
 * unboundedly under contention or repeated blocked attempts — it pins at
 * cap+1, which still reads as "over the cap" and blocks. Cleanup cron
 * prunes stale rows after 25h.
 */
async function checkDailyLimit(phone: string, opts?: { skipShortCooldown?: boolean }): Promise<boolean> {
  const now = Date.now();

  // Short-term cooldown (in-memory) — skipped for inbound auto-replies, which
  // are 1:1 responses to the customer's own message (the daily cap still runs).
  const lastSent = smsLastSentMap.get(phone);
  if (!opts?.skipShortCooldown && lastSent && now - lastSent < SMS_COOLDOWN_MS) {
    log.warn("SMS cooldown active", {
      phone: phone.slice(-4),
      secondsAgo: Math.round((now - lastSent) / 1000),
    });
    return false;
  }

  try {
    const { getDb } = await import("./db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      // DB unavailable — fail-open, log, still record the cooldown so
      // we don't spam the same number multiple times per minute even
      // when the durable counter is offline.
      smsLastSentMap.set(phone, now);
      return true;
    }

    // wave-181.83 (db-optimizer audit fix) · MySQL LAST_INSERT_ID() trick
    // collapses the prior 2-query pattern (UPSERT + SELECT) into a single
    // atomic operation. Pre-fix · pod A increments to 8 · pod B increments
    // to 9 concurrently · pod A's follow-up SELECT could read 9 instead of
    // 8 → false-block on a phone that was legitimately under the cap.
    //
    // The trick · LAST_INSERT_ID(expr) stores `expr` as the session-level
    // last-insert-id AND returns it. The mysql2 driver exposes that as
    // `insertId` on the ResultSetHeader. So one query · one network
    // roundtrip · no race window between increment and read.
    const [result] = await db.execute(sql`
      INSERT INTO sms_rate_limit (phone, count_24h, window_started_at, last_sent_at, updated_at)
      VALUES (${phone}, LAST_INSERT_ID(1), NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        count_24h = LAST_INSERT_ID(IF(
          window_started_at < (NOW() - INTERVAL 24 HOUR),
          1,
          LEAST(count_24h + 1, ${MAX_SMS_PER_PHONE_PER_DAY + 1})
        )),
        window_started_at = IF(
          window_started_at < (NOW() - INTERVAL 24 HOUR),
          NOW(),
          window_started_at
        ),
        last_sent_at = NOW(),
        updated_at = NOW()
    `);
    const resultRaw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
      ? result[0]
      : result) as { insertId?: number };
    const newCount = resultRaw.insertId ?? 1;

    if (newCount > MAX_SMS_PER_PHONE_PER_DAY) {
      log.warn("SMS daily limit reached", {
        phone: phone.slice(-4),
        count: newCount,
        cap: MAX_SMS_PER_PHONE_PER_DAY,
      });
      return false;
    }

    smsLastSentMap.set(phone, now);
    return true;
  } catch (err) {
    log.warn("checkDailyLimit DB error — allowing send (fail-open)", {
      errorId: "SMS_DAILY_LIMIT_QUERY_ERROR",
      error: err instanceof Error ? err.message : String(err),
    });
    smsLastSentMap.set(phone, now);
    return true;
  }
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
// ─── Wave BH · 2026-05-29 · shop-gateway reachability gate ──────────
// Operator directive: "if the cloud goes on or off ... wait till the
// cloud comes back online if its not on." The automated bulk SMS drains
// (appointment scheduler · review queue · retention winback) call this
// BEFORE claiming any message. If the F25e is offline, the drain skips
// entirely → messages stay 'pending' → delivered exactly once when the
// gateway returns (the atomic pending->sent claim guarantees once).
//
// This replaces the prior gateway-down behavior (claim 'sent' → send
// fails → mark 'failed' = message LOST, never retried) with
// hold-and-deliver. As of the 2026-06 operator directive (F25e-only,
// Twilio off) sendSms ALSO gates on this: a configured-but-offline
// gateway queues the message instead of Twilio-falling-back, so both the
// per-message path and the bulk drains now hold-and-deliver.
//
// Same probe the health monitor uses (Capevace /device + F25e lastSeen
// within 30 min). Cached 60s (both states) so back-to-back drains don't
// hammer the cloud. Any probe failure / unconfigured → treated OFFLINE
// (skip) · never send into uncertainty.
const GATEWAY_REACHABLE_TTL_MS = 60_000;
let _gatewayReachableCache: { value: boolean; expiresAt: number } | null = null;

async function probeShopGatewayReachable(): Promise<boolean> {
  const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
  const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
  const baseUrl =
    process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";
  if (!username || !password) return false; // no creds → can't send → treat offline
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  try {
    const res = await fetch(`${baseUrl}/device`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false; // API problem → don't send into uncertainty
    const devices = (await res.json()) as Array<{ id: string; lastSeen?: string }>;
    if (!devices.length) return false; // no device registered → offline
    const targetId = process.env.SHOP_SMS_GATEWAY_DEVICE_ID;
    const dev = targetId
      ? devices.find((d) => d.id === targetId)
      : devices.reduce((freshest, d) => {
          const t = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
          const ft = freshest.lastSeen ? new Date(freshest.lastSeen).getTime() : 0;
          return t > ft ? d : freshest;
        });
    if (!dev) return false; // configured device not among registered → offline
    const lastSeenMs = dev.lastSeen ? new Date(dev.lastSeen).getTime() : 0;
    const ageMin = lastSeenMs ? (Date.now() - lastSeenMs) / 60_000 : 999;
    // Same offline window as the live badge + the alerting cron (one constant).
    return isGatewayOnline(ageMin);
  } catch {
    return false; // unreachable → offline
  }
}

/**
 * Gateway creds present? Distinguishes "F25e offline" from "not set up" —
 * we only queue-when-offline if the gateway is actually the configured
 * sender. An unconfigured (dev/test) env keeps the legacy send path so the
 * test suite isn't forced down the new queue branch.
 */
export function isShopGatewayConfigured(): boolean {
  return !!process.env.SHOP_SMS_GATEWAY_USERNAME && !!process.env.SHOP_SMS_GATEWAY_PASSWORD;
}

/**
 * Is the shop SMS gateway (F25e) reachable + checked-in right now?
 * Bulk SMS drains gate on this so they hold (not lose) messages while
 * the cloud is offline. 60s-cached. See the block comment above.
 */
export async function isShopGatewayReachable(): Promise<boolean> {
  const now = Date.now();
  if (_gatewayReachableCache && _gatewayReachableCache.expiresAt > now) {
    return _gatewayReachableCache.value;
  }
  const value = await probeShopGatewayReachable();
  _gatewayReachableCache = { value, expiresAt: now + GATEWAY_REACHABLE_TTL_MS };
  return value;
}

export async function sendSms(to: string, body: string, opts?: SendSmsOptions): Promise<SmsResult> {
  // Normalize phone first — both routes need it
  const normalizedEarly = normalizePhone(to);
  if (!normalizedEarly) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }

  const messageClass = opts?.messageClass || "customer_marketing"; // Default is marketing

  // TCPA/CTIA Compliance: automatically apply the opt-out footer where appropriate.
  const ownerPhone = process.env.OWNER_PHONE_NUMBER;
  const adminPhone = process.env.ADMIN_PHONE;
  const isStaffNumber = !!((ownerPhone && normalizedEarly.endsWith(ownerPhone.replace(/\D/g, "").slice(-10))) ||
                        (adminPhone && normalizedEarly.endsWith(adminPhone.replace(/\D/g, "").slice(-10))));
  const isInternal = messageClass === "internal" || opts?.isInternal || isStaffNumber;
  
  // Only internal or explicit overrides bypass the opt-out footer entirely.
  // We include STOP on confirmations + followups for compliance/safety.
  const bypassOptOutFooter = isInternal || opts?.skipOptOutFooter;

  if (!bypassOptOutFooter) {
    body = withOptOut(body);
  }

  // wave-181.60-followup (audit · 2026-05-18 PM) · TCPA opt-out check
  // and daily rate-limit MUST run BEFORE the gateway-routing branch.
  // Internal bypasses daily limits.
  if (!isInternal && !opts?._forceImmediate && !opts?.skipOptOutCheck) {
    if (!(await checkDailyLimit(normalizedEarly, { skipShortCooldown: opts?.skipShortCooldown }))) {
      return { success: false, error: "Daily SMS limit reached for this number" };
    }
  }
  
  if (!opts?.skipOptOutCheck) {
    try {
      const last10 = normalizedEarly.slice(-10);
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

  // wave-181.64 (bug-hunter audit) · TCPA-good-practice 8AM-8PM ET
  // sending window MUST also run BEFORE gateway routing.
  // Internal messages and customer_confirmations bypass quiet hours.
  // Marketing and followups are queued if outside hours.
  const bypassQuietHours = isInternal || messageClass === "customer_confirmation" || opts?._forceImmediate;
  
  if (!bypassQuietHours && !isWithinSendingHours()) {
    queueForLater(normalizedEarly, body, opts);
    return {
      success: true,
      queued: true,
      error: "Outside sending hours (8AM-8PM ET), queued for next window",
    };
  }

  // ─── Operator directive (2026-06) · F25e-only, queue-when-offline ───
  // F25e is the sole sender right now (Twilio intentionally not set up).
  // When it's offline, HOLD the message in the durable queue and deliver
  // it when the phone checks back in — never drop, never Twilio. The drain
  // (processDelayedQueue, gated on the same probe) sends it once the gateway
  // returns; getNextSendWindow() yields "now" inside 8AM-8PM, so it goes out
  // on the next 60s drain cycle after the F25e is back. _forceImmediate (the
  // drain itself) bypasses this so it can actually attempt the send. Only
  // fires when the gateway is configured — dev/test keeps the legacy path.
  if (
    opts?.via !== "twilio" &&
    !opts?._forceImmediate &&
    isShopGatewayConfigured() &&
    !(await isShopGatewayReachable())
  ) {
    queueForLater(normalizedEarly, body, opts);
    return {
      success: true,
      queued: true,
      error: "Shop gateway offline — queued for delivery when it's back online",
    };
  }

  // ─── Wave-181.60: shop gateway is now the DEFAULT route ───
  // Wave-103/106 made shop-routing opt-in (opts.via === "shop"). The
  // wave-181.58 audit found 5 customer-facing call sites that forgot
  // to pass `{ via: "shop" }` and were silently routing to dead Twilio
  // (booking confirmations, 24h/1h reminders, thank-you, review-request,
  // maintenance reminders). All of them WANTED the shop gateway — they
  // just missed an opt-in flag.
  //
  // Flip: default to shop-first unless the caller explicitly opts OUT
  // with via: "twilio". The Twilio fallback below still runs if the
  // shop gateway is offline, so capability is preserved. Kill switch
  // is checked AFTER this so an active kill switch still allows
  // shop-gateway sends to flow through the F25e.
  if (opts?.via !== "twilio") {
    const gw = await sendSmsViaShopGateway(normalizedEarly, body);
    if (gw.success) {
      smsStats.totalSent++;
      smsStats.lastSentAt = new Date().toISOString();
      updateDeliveryRate();
      addToThread(normalizedEarly, "outbound", body, gw.gatewayMessageId);
      // wave-181.101 (#2) — persist to durable smsMessages so the send
      // shows in /admin/sms and the delivery webhook can match it.
      // skipPersist: a cron caller logs its own row (logOutboundSms, with
      // variantKey) -> don't double-write (the 2x-count fix).
      if (!opts?.skipPersist) {
        persistOutboundShopSms(normalizedEarly, body, "sent", gw.gatewayMessageId, opts?.variantKey)
          .catch(() => undefined);
      }
      return { success: true, sid: gw.gatewayMessageId };
    }
    // wave-181.101 (#3) — a TIMEOUT is ambiguous: the Capevace relay may
    // have accepted and the F25e fired the text; we just didn't get the
    // response in time. Falling back to Twilio here would double-send the
    // customer. Stop here on timeout; only DEFINITIVE failures (non-OK
    // HTTP, DNS/connection error) drop through to the Twilio fallback.
    if (gw.timedOut) {
      log.warn(
        `Shop gateway timed out for ${normalizedEarly.slice(-4)} — NOT falling back (delivery uncertain, avoids double-send)`,
      );
      await alertShopGatewayFallback("timeout — delivery uncertain, not retried", normalizedEarly);
      addToThread(normalizedEarly, "outbound", body);
      if (!opts?.skipPersist) {
        persistOutboundShopSms(normalizedEarly, body, "sending", undefined, opts?.variantKey)
          .catch(() => undefined);
      }
      return { success: true };
    }
    // Definitive failure (non-OK HTTP / DNS / connection error). A non-OK
    // HTTP is AMBIGUOUS: the Capevace relay may have accepted + SENT the
    // text before erroring on the response, exactly like a timeout. So we
    // do NOT re-queue here -- re-queue -> drain -> DUPLICATE was the
    // 003afc8b regression that spammed customers with repeats. Alert + fall
    // through; Twilio is off so this returns a failure, which
    // sendConfirmationSms surfaces as degraded -> Nick reads the address
    // aloud. The OFFLINE pre-check above is the safe never-drop path -- it
    // queues BEFORE attempting a send, so it can never double-send.
    if (isShopGatewayConfigured()) {
      log.warn(`Shop gateway send failed (${gw.error}) for ${normalizedEarly.slice(-4)} -- not retried (ambiguous delivery, avoids double-send)`);
      await alertShopGatewayFallback(gw.error || "unknown", normalizedEarly);
    }
    // Drop through to Twilio below (off -> returns failure -> degraded).
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

  // wave-181.64 · drop the redundant second normalizePhone(to) — already
  // computed as `normalizedEarly` at line 708. Re-use the existing value
  // so future refactors that modify `to` between the two calls can't
  // create a divergence bug.
  const normalized = normalizedEarly;

  // Sending-hours check was hoisted to the top of sendSms() in wave-181.64
  // so the shop-gateway path also respects 8AM-8PM ET. Rate-limit + opt-out
  // checks were hoisted similarly in wave-181.60-followup. All three TCPA-
  // adjacent guards now run before any gateway routing decision.

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
export function bookingConfirmationSms(_name: string, _service: string, refCode?: string): string {
  const ref = refCode ? ` Ref: #${refCode}` : "";
  return `Got your request at Nick's Tire & Auto. We're walk-in and first come, first served — but we saw your message and we'll help you when you pull up. Open Mon-Sat 8-6, Sun 9-4.${ref} Questions? (216) 862-0005`;
}

/** Status update SMS */
export function statusUpdateSms(_name: string, stage: string, refCode?: string): string {
  const ref = refCode ? ` (Ref: #${refCode})` : "";

  const stageMessages: Record<string, string> = {
    received: `We've got your vehicle in the queue at Nick's Tire & Auto. We'll check it and reach out before doing any work. Questions? (216) 862-0005`,
    inspecting: `We're checking your vehicle now. Once we know what it needs, we'll explain it clearly and give you the price before doing anything`,
    "waiting-parts": `Quick update from Nick's Tire & Auto: we're waiting on parts. We'll let you know as soon as they're in and the job can move forward`,
    "in-progress": `Work is underway on your vehicle. We'll text or call when it's finished or if anything changes`,
    "quality-check": `The work is done. We're giving it a final check before pickup. We'll let you know as soon as it's ready`,
    ready: `Your vehicle is ready for pickup at Nick's Tire & Auto. Pull up during business hours. Questions? (216) 862-0005`,
  };

  const statusMsg = stageMessages[stage] || `Quick status update on your vehicle`;
  
  // Prevent double-appending shop info for fully self-contained status stages
  if (stage === "received" || stage === "ready") {
    return `${statusMsg}${ref}`;
  }
  return `${statusMsg}.${ref}\n\n${STORE_NAME} — ${STORE_PHONE}`;
}

/** 24-hour thank-you SMS */
export function thankYouSms(_name: string, _service: string): string {
  return `Hey, thanks again for coming by Nick's Tire & Auto. All work is backed by our warranty. If anything feels off or you have a question, text or call us here: (216) 862-0005`;
}

/** 7-day review request SMS */
export function reviewRequestSms(_name: string): string {
  return `Hey, hope everything's been good since your visit. If we earned it, a quick Google review helps other Cleveland drivers find a shop they can trust: nickstire.org/review`;
}

/** Callback confirmation SMS */
export function callbackConfirmationSms(_name: string): string {
  return `Got your callback request at Nick's Tire & Auto. We'll reach out during business hours (Mon-Sat 8-6, Sun 9-4). Need us sooner? Call or text (216) 862-0005.`;
}

/**
 * TCPA/CTIA: bulk promotional SMS must carry opt-out instructions. Append a
 * STOP footer unless the body already contains one. Idempotent — safe to call
 * even on a body that already ends with a STOP line. Mirrors the same helper
 * in routers/campaigns.ts (campaign sends); apply ONLY to bulk promo, never to
 * transactional/1:1 messages.
 */
export function withOptOut(body: string): string {
  return /\breply stop\b/i.test(body) ? body : `${body}\n\nReply STOP to opt out.`;
}

/** Maintenance reminder SMS (bulk promo · carries the TCPA opt-out footer) */
export function maintenanceReminderSms(_name: string, _service: string, _mileageNote?: string): string {
  return withOptOut(`Due for an oil change? $49 conventional, $80 full synthetic — walk in any day, no appointment. Nick's Tire & Auto, 17625 Euclid Ave. (216) 862-0005`);
}

/** Lead submission confirmation SMS */
export function leadConfirmationSms(_name: string): string {
  return `Hey, this is Nick's Tire & Auto on Euclid. We saw your request and wanted to help. What's going on with the car — tires, brakes, check engine, or something else?`;
}

/** Booking confirmation request SMS — asks customer to reply YES */
export function bookingConfirmationRequestSms(_name: string, _preferredTime?: string): string {
  return `Still planning to swing by Nick's Tire & Auto? Reply YES and we'll keep an eye out — or just walk in any day, first-come, first-served. (216) 862-0005`;
}

/** Appointment reminder — 24 hours before */
export function appointmentReminder24hSms(_name: string, _service: string, _vehicle?: string, _preferredTime?: string): string {
  return `Reminder from Nick's Tire & Auto: we're expecting you tomorrow. We're first come, first served, so earlier is usually better. Open Mon-Sat 8-6, Sun 9-4. Questions? (216) 862-0005`;
}

/** Appointment reminder — 1 hour before */
export function appointmentReminder1hSms(_name: string, _vehicle?: string): string {
  return `Just a heads up — we're expecting you soon at 17625 Euclid Ave. Pull up when you're ready. Questions? (216) 862-0005`;
}

// ─── EXPORTS ───────────────────────────────────────────

export { normalizePhone, STORE_PHONE, STORE_NAME };
