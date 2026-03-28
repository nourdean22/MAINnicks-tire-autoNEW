/**
 * Webhook Manager — Reliable delivery with exponential backoff
 * Wraps external API calls (Google Sheets, Meta CAPI, email)
 * with retry logic. Failed deliveries stored in webhookDeliveries table.
 */

import { createLogger } from "./logger";
import { randomUUID } from "crypto";

const log = createLogger("webhook");

// Retry delays: 30s, 2min, 10min, 1hr, 6hr
const RETRY_DELAYS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

interface WebhookDelivery {
  id: string;
  name: string;
  url: string;
  method: string;
  payload: unknown;
  attemptCount: number;
  maxAttempts: number;
  status: "pending" | "delivered" | "retrying" | "failed";
  lastError?: string;
}

const pendingRetries = new Map<string, WebhookDelivery>();

/**
 * Send a webhook with automatic retry on failure.
 * Returns immediately — retries happen in the background.
 */
export async function sendWebhook(
  name: string,
  url: string,
  payload: unknown,
  options?: { method?: string; headers?: Record<string, string>; maxAttempts?: number }
): Promise<{ success: boolean; deliveryId: string; error?: string }> {
  const deliveryId = randomUUID();
  const method = options?.method || "POST";
  const maxAttempts = options?.maxAttempts || 5;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: method !== "GET" ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      log.info(`Webhook delivered: ${name}`, { deliveryId, status: response.status });
      return { success: true, deliveryId };
    }

    // Non-2xx — queue for retry
    const errBody = await response.text().catch(() => "");
    log.warn(`Webhook failed: ${name}`, { deliveryId, status: response.status, body: errBody.slice(0, 200) });

    scheduleRetry({
      id: deliveryId,
      name,
      url,
      method,
      payload,
      attemptCount: 1,
      maxAttempts,
      status: "retrying",
      lastError: `HTTP ${response.status}: ${errBody.slice(0, 100)}`,
    });

    return { success: false, deliveryId, error: `HTTP ${response.status}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`Webhook error: ${name}`, { deliveryId, error });

    scheduleRetry({
      id: deliveryId,
      name,
      url,
      method,
      payload,
      attemptCount: 1,
      maxAttempts,
      status: "retrying",
      lastError: error,
    });

    return { success: false, deliveryId, error };
  }
}

function scheduleRetry(delivery: WebhookDelivery): void {
  if (delivery.attemptCount >= delivery.maxAttempts) {
    delivery.status = "failed";
    log.error(`Webhook permanently failed: ${delivery.name}`, {
      id: delivery.id,
      attempts: delivery.attemptCount,
      lastError: delivery.lastError,
    });
    // Store in DB for admin review (fire-and-forget)
    storeFailedDelivery(delivery).catch(err => console.error("[Webhook] Failed to store failed delivery:", err));
    return;
  }

  const delay = RETRY_DELAYS[Math.min(delivery.attemptCount - 1, RETRY_DELAYS.length - 1)];
  pendingRetries.set(delivery.id, delivery);

  log.info(`Webhook retry scheduled: ${delivery.name}`, {
    id: delivery.id,
    attempt: delivery.attemptCount + 1,
    delayMs: delay,
  });

  setTimeout(async () => {
    pendingRetries.delete(delivery.id);
    delivery.attemptCount++;

    try {
      const response = await fetch(delivery.url, {
        method: delivery.method,
        headers: { "Content-Type": "application/json" },
        body: delivery.method !== "GET" ? JSON.stringify(delivery.payload) : undefined,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        delivery.status = "delivered";
        log.info(`Webhook retry succeeded: ${delivery.name}`, { id: delivery.id, attempt: delivery.attemptCount });
      } else {
        delivery.lastError = `HTTP ${response.status}`;
        scheduleRetry(delivery);
      }
    } catch (err) {
      delivery.lastError = err instanceof Error ? err.message : String(err);
      scheduleRetry(delivery);
    }
  }, delay);
}

async function storeFailedDelivery(delivery: WebhookDelivery): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { webhookDeliveries } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    await db.insert(webhookDeliveries).values({
      id: delivery.id,
      webhookName: delivery.name,
      url: delivery.url,
      method: delivery.method,
      payload: delivery.payload,
      errorMessage: delivery.lastError,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      status: "failed",
    });
  } catch {
    // Don't let storage failure break anything
  }
}

/** Get stats on pending retries */
export function getWebhookStats(): { pending: number; retrying: number } {
  return {
    pending: pendingRetries.size,
    retrying: Array.from(pendingRetries.values()).filter(d => d.status === "retrying").length,
  };
}
