/**
 * SMS Bot Router
 * Automated conversation state machine for booking requests via SMS
 * States: IDLE → AWAITING_NAME → AWAITING_VEHICLE → AWAITING_PROBLEM → COMPLETE
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { sanitizePhone, sanitizeText, sanitizeName } from "../sanitize";
import { sendSms } from "../sms";

const CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes
const RATE_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 }; // 20 msgs/hour

interface ConversationState {
  phone: string;
  state: "IDLE" | "AWAITING_NAME" | "AWAITING_VEHICLE" | "AWAITING_PROBLEM" | "COMPLETE";
  customerName?: string;
  vehicleInfo?: string;
  problemDescription?: string;
  messageCount: number;
  lastMessageAt: number;
  createdAt: number;
}

const optOutSet = new Set<string>();
const conversationMap = new Map<string, ConversationState>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getOrCreateConversation(phone: string): ConversationState {
  if (!conversationMap.has(phone)) {
    conversationMap.set(phone, {
      phone,
      state: "IDLE",
      messageCount: 0,
      lastMessageAt: Date.now(),
      createdAt: Date.now(),
    });
  }
  const conv = conversationMap.get(phone)!;
  conv.lastMessageAt = Date.now();
  return conv;
}

function cleanupExpiredConversations() {
  const now = Date.now();
  for (const [phone, conv] of Array.from(conversationMap.entries())) {
    if (now - conv.lastMessageAt > CONVERSATION_TTL) {
      conversationMap.delete(phone);
    }
  }
  // Also clean expired rate limit entries
  for (const [phone, limit] of Array.from(rateLimitMap.entries())) {
    if (now > limit.resetAt) {
      rateLimitMap.delete(phone);
    }
  }
}

function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(phone);

  if (!limit) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return true;
  }

  if (now > limit.resetAt) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return true;
  }

  if (limit.count >= RATE_LIMIT.max) {
    return false;
  }

  limit.count++;
  return true;
}

/** Persist opt-out/opt-in to the customers table */
async function persistOptOut(phone: string, optOut: boolean) {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return;
    const { customers } = await import("../../drizzle/schema");
    const { like } = await import("drizzle-orm");
    await d.update(customers)
      .set({ smsOptOut: optOut ? 1 : 0 })
      .where(like(customers.phone, `%${phone}`));
  } catch (err) {
    console.error("[SMS Bot] DB opt-out update failed:", err);
  }
}

/** Load DB opt-outs into the in-memory set on startup */
export async function loadOptOutsFromDb() {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return;
    const { customers } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const optedOut = await d.select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    for (const c of optedOut) {
      if (c.phone) {
        optOutSet.add(c.phone.replace(/\D/g, "").slice(-10));
      }
    }
    console.log(`[SMS Bot] Loaded ${optedOut.length} opt-outs from DB`);
  } catch (err) {
    console.error("[SMS Bot] Failed to load opt-outs:", err);
  }
}

export async function handleIncomingSMS(from: string, body: string): Promise<string> {
  cleanupExpiredConversations();

  const phone = sanitizePhone(from).replace(/\D/g, "").slice(-10);
  const message = sanitizeText(body).trim().toUpperCase();

  // Check opt-out (in-memory cache, backed by DB)
  if (optOutSet.has(phone)) {
    // Handle UNSTOP to re-enable
    if (message === "UNSTOP" || message === "START") {
      optOutSet.delete(phone);
      // Persist to DB
      persistOptOut(phone, false).catch(err => console.error("[SMS Bot] Failed to persist opt-in:", err));
      return "Welcome back! You've been re-subscribed to messages from Nick's Tire & Auto.";
    }
    return "";
  }

  // Handle STOP keyword
  if (message === "STOP" || message === "HALT") {
    optOutSet.add(phone);
    // Persist to DB
    persistOptOut(phone, true).catch(err => console.error("[SMS Bot] Failed to persist opt-out:", err));
    return "You've been opted out. Text UNSTOP to re-enable.";
  }

  // Handle HELP keyword
  if (message === "HELP") {
    return "Nick's Tire & Auto, Cleveland OH. Hours: M-Sat 8AM-6PM, Sun 9AM-4PM. Call (216) 862-0005.";
  }

  // Rate limit check
  if (!checkRateLimit(phone)) {
    return "You've sent too many messages. Please call us at (216) 862-0005.";
  }

  const conv = getOrCreateConversation(phone);
  conv.messageCount++;

  // Check for booking keywords to start flow
  if (conv.state === "IDLE") {
    if (message.includes("BOOK") || message.includes("APPOINTMENT") || message.includes("SCHEDULE")) {
      conv.state = "AWAITING_NAME";
      return "Great! I'll help you book an appointment. What's your name?";
    }
    return "";
  }

  // Collect name
  if (conv.state === "AWAITING_NAME") {
    conv.customerName = sanitizeName(message);
    if (!conv.customerName) {
      return "Please provide a valid name.";
    }
    conv.state = "AWAITING_VEHICLE";
    return `Thanks ${conv.customerName}! What vehicle do you have? (e.g., 2020 Honda Civic)`;
  }

  // Collect vehicle
  if (conv.state === "AWAITING_VEHICLE") {
    conv.vehicleInfo = sanitizeText(message).slice(0, 200);
    if (conv.vehicleInfo.length < 3) {
      return "Please provide more details about your vehicle.";
    }
    conv.state = "AWAITING_PROBLEM";
    return "What's the issue or service you need? (e.g., brake repair, tire rotation)";
  }

  // Collect problem/service
  if (conv.state === "AWAITING_PROBLEM") {
    conv.problemDescription = sanitizeText(message).slice(0, 500);
    if (conv.problemDescription.length < 3) {
      return "Please describe the issue or service needed.";
    }
    conv.state = "COMPLETE";

    // Save booking to DB (async, don't block response)
    saveBooking(phone, conv).catch(err => {
      console.error("[SMS Bot] Failed to save booking:", err);
    });

    return "Thanks! We've received your booking request. We'll call you shortly to confirm. Call us at (216) 862-0005 for urgent issues.";
  }

  return "";
}

async function saveBooking(phone: string, conv: ConversationState) {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) {
      console.error("[SMS Bot] Database not available");
      return;
    }
    const { bookings } = await import("../../drizzle/schema");

    const now = new Date();
    const normalizedPhone = phone.replace(/\D/g, "");
    const e164Phone = `+1${normalizedPhone.slice(-10)}`;

    // Create booking
    await db.insert(bookings).values({
      name: conv.customerName || "SMS Bot Customer",
      phone: e164Phone,
      service: conv.problemDescription?.split(" ")[0] || "general-repair",
      vehicle: conv.vehicleInfo || "",
      message: `SMS Bot: ${conv.problemDescription}`,
      status: "new",
      stage: "received",
    });

    // Sync to sheets (async, fire-and-forget)
    try {
      const { syncLeadToSheet } = await import("../sheets-sync");
      await syncLeadToSheet({
        name: conv.customerName || "SMS Bot Customer",
        phone: e164Phone,
        vehicle: conv.vehicleInfo || undefined,
        problem: conv.problemDescription || undefined,
        source: "sms",
        urgencyScore: 3,
        urgencyReason: "SMS Bot inquiry",
        recommendedService: "general-repair",
      });
    } catch (err) {
      console.error("[SMS Bot] Sheets sync failed:", err);
    }

    // Notify owner via SMS
    try {
      const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || "2168620005";
      const notifMsg = `New SMS booking from ${conv.customerName}: ${conv.vehicleInfo} - ${conv.problemDescription}`;
      await sendSms(OWNER_PHONE, notifMsg);
    } catch (err) {
      console.error("[SMS Bot] Owner notification failed:", err);
    }
  } catch (err) {
    console.error("[SMS Bot] Booking save failed:", err);
  }
}

export const smsBotRouter = router({
  /** Get conversation state (admin) */
  getConversation: adminProcedure
    .input(z.object({ phone: z.string() }))
    .query(({ input }) => {
      const phone = input.phone.replace(/\D/g, "").slice(-10);
      const conv = conversationMap.get(phone);
      return conv || null;
    }),

  /** List all active conversations (admin) */
  listConversations: adminProcedure.query(() => {
    cleanupExpiredConversations();
    return Array.from(conversationMap.values());
  }),

  /** Reset a conversation (admin) */
  reset: adminProcedure
    .input(z.object({ phone: z.string() }))
    .mutation(({ input }) => {
      const phone = input.phone.replace(/\D/g, "").slice(-10);
      conversationMap.delete(phone);
      return { success: true };
    }),

  /** Add phone to opt-out list (admin) */
  addOptOut: adminProcedure
    .input(z.object({ phone: z.string() }))
    .mutation(({ input }) => {
      const phone = input.phone.replace(/\D/g, "").slice(-10);
      optOutSet.add(phone);
      return { success: true };
    }),

  /** Remove phone from opt-out list (admin) */
  removeOptOut: adminProcedure
    .input(z.object({ phone: z.string() }))
    .mutation(({ input }) => {
      const phone = input.phone.replace(/\D/g, "").slice(-10);
      optOutSet.delete(phone);
      return { success: true };
    }),

  /** Get opt-out count (admin) */
  optOutCount: adminProcedure.query(() => {
    return { count: optOutSet.size };
  }),
});
