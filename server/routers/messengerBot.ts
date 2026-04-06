/**
 * Messenger Bot Router (Feature 9)
 * Handles Facebook Messenger conversations with customers.
 * Conversation state: name -> vehicle -> problem -> booking creation.
 * Uses same SMS bot pattern with in-memory 30-min TTL.
 */
import { router, adminProcedure } from "../_core/trpc";
import { sanitizeText, sanitizePhone, sanitizeName } from "../sanitize";
import { TRPCError } from "@trpc/server";
import { leads } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const STORE_PHONE = "(216) 862-0005";

// Conversation state: keyed by senderId (PSID)
interface ConversationState {
  timestamp: number;
  stage: "initial" | "name" | "vehicle" | "problem" | "confirm";
  name?: string;
  phone?: string;
  vehicle?: string;
  problem?: string;
}

const conversationMap = new Map<string, ConversationState>();
const CONVERSATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CONVERSATIONS = 500;

function getConversation(senderId: string): ConversationState {
  const existing = conversationMap.get(senderId);

  // Periodic cleanup: evict expired conversations + enforce cap
  if (conversationMap.size > MAX_CONVERSATIONS / 2) {
    const now = Date.now();
    for (const [key, conv] of conversationMap) {
      if (now - conv.timestamp > CONVERSATION_TTL_MS) conversationMap.delete(key);
    }
    // Hard cap
    if (conversationMap.size > MAX_CONVERSATIONS) conversationMap.clear();
  }

  // Check TTL
  if (existing && Date.now() - existing.timestamp > CONVERSATION_TTL_MS) {
    conversationMap.delete(senderId);
    return {
      timestamp: Date.now(),
      stage: "initial",
    };
  }

  if (existing) {
    return existing;
  }

  const fresh: ConversationState = {
    timestamp: Date.now(),
    stage: "initial",
  };

  conversationMap.set(senderId, fresh);
  return fresh;
}

function updateConversation(
  senderId: string,
  updates: Partial<ConversationState>
): ConversationState {
  const conv = getConversation(senderId);
  const updated: ConversationState = {
    ...conv,
    ...updates,
    timestamp: Date.now(),
  };
  conversationMap.set(senderId, updated);
  return updated;
}

// Trigger keywords for initiating bot conversation
const TRIGGER_KEYWORDS = [
  "booking",
  "appointment",
  "schedule",
  "service",
  "repair",
  "estimate",
  "quote",
  "help",
];

function shouldTriggerBot(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return TRIGGER_KEYWORDS.some((kw) => lower.includes(kw));
}

async function saveLeadToDb(
  name: string,
  phone: string,
  vehicle: string | undefined,
  problem: string | undefined
): Promise<number | null> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return null;

    const result = await d.insert(leads).values({
      name,
      phone,
      vehicle: vehicle || null,
      problem: problem || null,
      source: "chat",
      urgencyScore: 3,
      urgencyReason: "Facebook Messenger inquiry",
      status: "new",
    }).$returningId();

    const leadId = result[0]?.id ?? null;

    // Dispatch to event bus — make Messenger leads visible to entire system
    if (leadId) {
      import("../services/eventBus").then(({ emit }) =>
        emit.leadCaptured({
          id: leadId,
          name,
          phone,
          source: "chat",
          urgencyScore: 3,
        })
      ).catch(() => {});
    }

    return leadId;
  } catch (err) {
    console.error("[MessengerBot] Lead save failed:", err);
    return null;
  }
}

export async function sendMessengerReply(
  recipientId: string,
  text: string
): Promise<boolean> {
  try {
    const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.FB_PAGE_ACCESS_TOKEN;
    if (!token) {
      console.warn("[Messenger] META_PAGE_ACCESS_TOKEN not configured");
      return false;
    }

    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
      }
    );

    return response.ok;
  } catch (err) {
    console.error("[Messenger] Send failed:", err);
    return false;
  }
}

export async function handleMessengerMessage(
  senderId: string,
  text: string
): Promise<void> {
  try {
    const conv = getConversation(senderId);
    const sanitized = sanitizeText(text).toLowerCase().trim();

    if (!sanitized) return;

    // Initial trigger
    if (
      conv.stage === "initial" &&
      !shouldTriggerBot(sanitized)
    ) {
      await sendMessengerReply(
        senderId,
        `Hi! Need help scheduling a service? Just say "booking" or "appointment" to get started. Or call us at ${STORE_PHONE}!`
      );
      return;
    }

    if (conv.stage === "initial" || conv.stage === "name") {
      // Expect customer name
      const name = sanitizeName(text);
      if (!name) {
        await sendMessengerReply(
          senderId,
          "Could you tell me your name so I can help you better?"
        );
        return;
      }

      updateConversation(senderId, {
        stage: "vehicle",
        name,
        phone: undefined,
      });

      await sendMessengerReply(
        senderId,
        `Thanks, ${name}! What year, make, and model is your vehicle?`
      );
      return;
    }

    if (conv.stage === "vehicle") {
      // Expect vehicle info
      const vehicle = sanitizeText(text);
      if (!vehicle || vehicle.length < 3) {
        await sendMessengerReply(
          senderId,
          "Could you tell me the year, make, and model? (e.g., 2018 Honda Civic)"
        );
        return;
      }

      updateConversation(senderId, {
        stage: "problem",
        vehicle,
      });

      await sendMessengerReply(
        senderId,
        "What service or repair do you need? (Be as specific as possible)"
      );
      return;
    }

    if (conv.stage === "problem") {
      // Expect problem/service description
      const problem = sanitizeText(text);
      if (!problem || problem.length < 3) {
        await sendMessengerReply(
          senderId,
          "Could you describe the service or repair you need?"
        );
        return;
      }

      updateConversation(senderId, {
        stage: "confirm",
        problem,
      });

      const summary = `${conv.name} - ${conv.vehicle} - ${problem}`;
      await sendMessengerReply(
        senderId,
        `Got it! Here's what I have:\n${conv.name}\n${conv.vehicle}\n${problem}\n\nWould you like us to contact you to schedule? Reply with your phone number (e.g., 216-555-1234)`
      );
      return;
    }

    if (conv.stage === "confirm") {
      // Expect phone number
      const phone = sanitizePhone(text);
      if (!phone || phone.replace(/\D/g, "").length < 10) {
        await sendMessengerReply(
          senderId,
          "Could you provide your phone number? (e.g., 216-555-1234)"
        );
        return;
      }

      // Save as lead
      await saveLeadToDb(conv.name || "", phone, conv.vehicle, conv.problem);

      // Reset conversation
      conversationMap.delete(senderId);

      await sendMessengerReply(
        senderId,
        `Perfect! We've got your info and will call you at ${phone} soon. Thanks for choosing Nick's Tire & Auto!`
      );
      return;
    }
  } catch (err) {
    console.error("[MessengerBot] Handler error:", err);
    await sendMessengerReply(
      senderId,
      `Something went wrong. Please call us at ${STORE_PHONE}. Thanks!`
    );
  }
}

export const messengerBotRouter = router({
  // Admin endpoint to view active conversations
  listConversations: adminProcedure.query(async () => {
    const convs = Array.from(conversationMap.entries())
      .filter(([_, c]) => Date.now() - c.timestamp < CONVERSATION_TTL_MS)
      .map(([id, c]) => ({
        senderId: id,
        stage: c.stage,
        name: c.name,
        vehicle: c.vehicle,
        createdAt: new Date(c.timestamp),
      }));

    return convs;
  }),
});
