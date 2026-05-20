/**
 * Wave-103 — SMS Gateway webhook (Samsung F25e shop phone).
 *
 * The SMS Gateway by Capevace cloud relay (https://sms-gate.app) calls
 * POST /api/webhooks/sms-gateway whenever the shop's phone receives or
 * delivers a message. We use it for two things:
 *
 *  1. **Inbound customer texts** (event = "sms:received") — the customer
 *     texted 216-862-0005 directly. We record it in the conversation
 *     thread + log it in communication_log so the admin SMS dashboard
 *     shows the real conversation.
 *
 *  2. **Delivery receipts** (event = "sms:delivered" / "sms:failed") —
 *     update delivery stats so the admin can see what got through.
 *
 * Signature validation: SMS Gateway signs each request with HMAC-SHA256
 * using the per-webhook signing key. Header `X-Signature` carries
 * `sha256=<hex>`. We compare with `SHOP_SMS_GATEWAY_WEBHOOK_SECRET`.
 *
 * Docs: https://docs.sms-gate.app/integration/webhooks/
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { createLogger } from "../../lib/logger";
import { recordInboundShopSms } from "../../sms";

const log = createLogger("sms-gateway-webhook");
const router = Router();

interface SmsGatewayEvent {
  deviceId?: string;
  event?: string;
  id?: string;
  webhookId?: string;
  payload?: {
    messageId?: string;
    phoneNumber?: string;
    message?: string;
    receivedAt?: string;
    sentAt?: string;
    deliveredAt?: string;
    failedAt?: string;
    reason?: string;
  };
}

/**
 * Verify HMAC-SHA256 signature on a Capevace SMS Gateway webhook.
 *
 * Per docs.sms-gate.app/features/webhooks/, Capevace signs the
 * concatenation of the raw request body and the X-Timestamp header
 * value: `HMAC-SHA256(secret, rawBody + timestamp)`. The result is
 * sent as a hex string in the X-Signature header.
 *
 * Replay protection: the timestamp must be within ±5 minutes of now.
 */
const TIMESTAMP_WINDOW_SECONDS = 300; // ±5 min

function verifySignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !timestampHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/, "").trim();
  if (!provided) return false;

  // Replay-protection: timestamp must be within ±5min of server time
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > TIMESTAMP_WINDOW_SECONDS) return false;

  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const message = bodyStr + timestampHeader;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  // Constant-time compare
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(computed, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function logToCommunicationLog(phone: string, body: string, direction: "inbound" | "outbound", metadata: Record<string, unknown>): Promise<void> {
  try {
    const { getDb } = await import("../../db");
    const { communicationLog } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    await db.insert(communicationLog).values({
      customerPhone: phone,
      type: "sms",
      direction,
      body: body.slice(0, 5000),
      metadata,
    });
  } catch (err) {
    log.warn("Failed to log to communication_log", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

router.post("/sms-gateway", async (req: Request, res: Response) => {
  // ─── Signature validation ────────────────────────
  const secret = process.env.SHOP_SMS_GATEWAY_WEBHOOK_SECRET;
  if (secret) {
    // Capevace signs HMAC-SHA256(secret, rawBody + timestamp) where
    // timestamp comes from X-Timestamp header. We use req.rawBody
    // (stashed by the express.json verify callback in _core/index.ts)
    // — NOT JSON.stringify(req.body), which would reformat the bytes.
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const sig = req.header("X-Signature") || req.header("x-signature");
    const ts = req.header("X-Timestamp") || req.header("x-timestamp");
    if (!rawBody || !verifySignature(rawBody, sig, ts, secret)) {
      log.warn("SMS gateway webhook rejected — bad signature", {
        sig: (sig || "").slice(0, 20),
        ts: ts || "(missing)",
        hasRawBody: !!rawBody,
      });
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    // wave-141b — in production, refuse unsigned requests outright
    // instead of silently accepting them. An attacker who discovers
    // this endpoint without the secret could otherwise inject fake
    // inbound SMS events (including opt-outs that flag legit
    // customers). Dev/test environments still allow unsigned so
    // local Capevace simulators work.
    log.error("SHOP_SMS_GATEWAY_WEBHOOK_SECRET not set in production — rejecting webhook");
    res.status(500).json({ error: "webhook_misconfigured" });
    return;
  } else {
    log.warn("SHOP_SMS_GATEWAY_WEBHOOK_SECRET not set — accepting unsigned request (non-production)");
  }

  const event = req.body as SmsGatewayEvent;
  const eventType = event.event || "";
  const payload = event.payload || {};
  const phone = payload.phoneNumber || "";
  const messageId = payload.messageId || event.id || "";

  log.info("sms_gateway_event", {
    event: eventType,
    phone: phone.slice(-4),
    messageId: messageId.slice(0, 12),
  });

  try {
    if (eventType === "sms:received") {
      // ─── Inbound customer text → 216-862-0005 ────────
      const body = payload.message || "";
      if (!phone || !body) {
        res.status(400).json({ error: "missing_phone_or_message" });
        return;
      }
      const { normalized } = recordInboundShopSms(phone, body, messageId);
      if (normalized) {
        // Persist the inbound text to smsMessages so it surfaces in
        // /admin/sms and bumps the conversation unread badge.
        // recordInboundShopSms() above writes only an in-memory Map
        // (wiped on every redeploy); addSmsMessage() is the durable row
        // the admin SMS UI actually reads. Awaited — a failed DB write
        // returns 500 so Capevace retries instead of dropping the lead.
        try {
          const { getOrCreateConversation, addSmsMessage } = await import("../../db");
          const conversation = await getOrCreateConversation(normalized);
          await addSmsMessage({
            conversationId: conversation.id,
            direction: "inbound",
            body,
            twilioSid: messageId || undefined,
            status: "received",
          });
        } catch (err) {
          log.error("Failed to persist inbound shop SMS to smsMessages", {
            error: err instanceof Error ? err.message : String(err),
          });
          res.status(500).json({ error: "persist_failed" });
          return;
        }
        // Fire-and-forget DB log
        logToCommunicationLog(normalized, body, "inbound", {
          source: "shop_gateway",
          messageId,
          deviceId: event.deviceId,
          receivedAt: payload.receivedAt,
        }).catch(() => undefined);
        // wave-181.51 — attribute this reply to the most recent outbound
        // SMS within 7d. Helper is fully fail-open (try/catch + log-only)
        // so an unapplied migration cannot break the webhook.
        (async () => {
          const { recordSmsReply } = await import("../../services/smsInstrumentation");
          await recordSmsReply(normalized, body);
        })().catch(() => undefined);
        // wave-181.101 — process inbound intent the same way the Twilio
        // webhook does (routes/webhooks/twilio.ts). CRITICAL TCPA fix:
        // before this, the F25e gateway — now the PRIMARY inbound number
        // (216-862-0005) — silently ignored STOP/UNSUBSCRIBE. A customer
        // who texted STOP kept receiving messages because nothing set
        // customers.smsOptOut. parseSmsResponse + executeAutoAction set
        // the flag and push it into the live opt-out cache via
        // markPhoneOptedOut, so the very next send is blocked. Fire-and-
        // forget — intent handling must never block or fail the 200 ack.
        (async () => {
          const { parseSmsResponse, executeAutoAction } = await import(
            "../../services/smsResponseParser"
          );
          const parsed = parseSmsResponse(body);
          if (parsed.autoAction && !parsed.requiresHuman) {
            await executeAutoAction(parsed, normalized);
          }
        })().catch((err) => {
          log.warn("Inbound shop SMS intent processing failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
      res.status(200).json({ received: true });
      return;
    }

    if (eventType === "sms:delivered" || eventType === "sms:sent") {
      // ─── Delivery receipt — record the success ────────
      log.info("Shop SMS delivered", {
        messageId: messageId.slice(0, 12),
        phone: phone.slice(-4),
      });
      // Wave-109: propagate delivery state into the conversation thread
      // so the admin SMS dashboard shows "delivered" instead of "sent".
      // Match by twilioSid which we already store as the gateway message
      // ID for shop sends (col is named after legacy Twilio path).
      if (messageId) {
        (async () => {
          try {
            const { getDb } = await import("../../db");
            const { smsMessages } = await import("../../../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (!db) return;
            const newStatus = eventType === "sms:delivered" ? "delivered" : "sent";
            await db.update(smsMessages)
              .set({ status: newStatus })
              .where(eq(smsMessages.twilioSid, messageId));
          } catch (err) {
            log.warn("Failed to update smsMessages status on delivery", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
      }
      res.status(200).json({ received: true });
      return;
    }

    if (eventType === "sms:failed") {
      // ─── Delivery failed — log + Telegram alert ─────
      const reason = payload.reason || "unknown";
      log.warn("Shop SMS failed", {
        messageId: messageId.slice(0, 12),
        phone: phone.slice(-4),
        reason,
      });
      // Wave-109: mark the conversation message as failed in DB
      if (messageId) {
        (async () => {
          try {
            const { getDb } = await import("../../db");
            const { smsMessages } = await import("../../../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (!db) return;
            await db.update(smsMessages)
              .set({ status: "failed" })
              .where(eq(smsMessages.twilioSid, messageId));
          } catch {
            // Don't break the webhook
          }
        })();
      }
      // Fire-and-forget Telegram alert
      (async () => {
        try {
          const { sendTelegram } = await import("../../services/telegram");
          await sendTelegram(
            `❌ Shop SMS failed to ${phone.slice(-4)}\nReason: ${reason}\nMessageId: ${messageId.slice(0, 16)}`
          );
        } catch {
          // Don't break the webhook
        }
      })();
      res.status(200).json({ received: true });
      return;
    }

    // Unknown event — ack so Capevace doesn't retry forever
    log.info("Unhandled sms-gateway event type", { event: eventType });
    res.status(200).json({ received: true, ignored: true });
  } catch (err) {
    log.error("sms_gateway webhook error", {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(200).json({ received: true, error: "internal" });
  }
});

export { router as smsGatewayWebhookRouter };
