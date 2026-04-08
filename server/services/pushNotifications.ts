/**
 * PWA Push Notifications Service
 *
 * Sends web push notifications to subscribed browsers.
 * Uses VAPID keys for authentication. Lazy-loads web-push to save memory.
 *
 * Env vars needed:
 * - VAPID_PUBLIC_KEY: Public VAPID key (share with client)
 * - VAPID_PRIVATE_KEY: Private VAPID key (server only)
 * - VAPID_EMAIL: Contact email for VAPID (mailto:email)
 *
 * Generate keys: npx web-push generate-vapid-keys
 */

import { createLogger } from "../lib/logger";

const log = createLogger("push");

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  actions?: Array<{ action: string; title: string }>;
}

interface PushSubscriptionData {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send a push notification to a specific subscription.
 * Lazy-loads web-push to avoid startup memory cost.
 */
export async function sendPush(
  subscription: PushSubscriptionData,
  payload: PushPayload
): Promise<{ success: boolean; error?: string }> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL || "mailto:nourdean22@gmail.com";

  if (!publicKey || !privateKey) {
    return { success: false, error: "VAPID keys not configured" };
  }

  try {
    const webpush = await import("web-push");
    webpush.setVapidDetails(email, publicKey, privateKey);

    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );

    return { success: true };
  } catch (err: unknown) {
    const message = (err as Error).message || "Push send failed";
    // 410 Gone = subscription expired, should be removed from DB
    if (message.includes("410") || message.includes("expired")) {
      log.info("Subscription expired, should remove:", { endpoint: subscription.endpoint.slice(-20) });
      return { success: false, error: "subscription_expired" };
    }
    log.warn("Push notification failed:", { error: message });
    return { success: false, error: message };
  }
}

/**
 * Send push to all admin subscribers (for internal alerts like new bookings, safety, etc.)
 */
export async function pushToAdmins(payload: PushPayload): Promise<number> {
  try {
    const { getDb } = await import("../db");
    const { pushSubscriptions } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return 0;

    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.isAdmin, true));
    let sent = 0;

    for (const sub of subs) {
      const result = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload
      );
      if (result.success) sent++;
      if (result.error === "subscription_expired") {
        // Clean up expired subscription
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
    }

    return sent;
  } catch (err: unknown) {
    log.warn("pushToAdmins failed:", { error: (err as Error).message });
    return 0;
  }
}

/**
 * Send push to a specific customer by ID.
 */
export async function pushToCustomer(customerId: string, payload: PushPayload): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const { pushSubscriptions } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return false;

    const subs = await db.select().from(pushSubscriptions)
      .where(eq(pushSubscriptions.customerId, customerId));

    for (const sub of subs) {
      const result = await sendPush(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        payload
      );
      if (result.error === "subscription_expired") {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
      if (result.success) return true;
    }

    return false;
  } catch (err: unknown) {
    log.warn("pushToCustomer failed:", { error: (err as Error).message });
    return false;
  }
}
