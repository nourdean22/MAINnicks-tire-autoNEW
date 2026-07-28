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
import { STORE_PHONE } from "@shared/const";
// Type-only: erased at compile time, so it cannot create an import cycle with the
// service this module otherwise reaches through dynamic import.
import type { ObligationHandle } from "../../services/smsResponseJobs";

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
    // Wave AZ · Capevace exposes MMS attachments in the payload when
    // the receiving device captures multimedia. Field shape varies by
    // gateway version · we tolerate both `attachments` (array of URLs)
    // and `mediaUrl` (single URL).
    attachments?: string[];
    mediaUrl?: string;
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

      // Loop guard ("reading itself"): drop any sms:received whose sender
      // is the shop's OWN number. The Capevace relay can echo an outbound
      // back as inbound (or a self-test does), which would run our own text
      // through executeAutoAction -> auto-reply -> another send -> loop.
      // (eventBus has the same guard for the manager number.)
      if (phone.replace(/\D/g, "").slice(-10) === STORE_PHONE.replace(/\D/g, "").slice(-10)) {
        log.warn("Inbound shop SMS from our OWN number -- dropping (loop guard)", { phone: phone.slice(-4) });
        res.status(200).json({ received: true, selfIgnored: true });
        return;
      }

      // Wave AZ · MMS detection · if Capevace included an attachment
      // (image), fire the photo-assess pipeline in parallel with the
      // normal text-handling path. The pipeline runs its own opt-out +
      // sending-hours checks via sendSms.
      const mmsUrl = (payload.attachments && payload.attachments[0]) || payload.mediaUrl;
      if (mmsUrl && phone) {
        (async () => {
          try {
            const { runPhotoAssess } = await import("../../services/photo-assess-pipeline");
            await runPhotoAssess({
              phone,
              photoUrl: mmsUrl,
              source: "shop_gateway_mms",
            });
          } catch (err) {
            log.warn("photo_assess_shop_mms_failed", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })().catch(() => undefined);
      }

      if (!phone || !body) {
        // MMS with no body is still valid · if we just kicked off
        // photo-assess, return success rather than 400
        if (mmsUrl && phone) {
          res.status(200).json({ received: true, mms: true });
          return;
        }
        res.status(400).json({ error: "missing_phone_or_message" });
        return;
      }
      const { normalized } = recordInboundShopSms(phone, body, messageId);
      if (normalized) {
        // Rank-3 dedup flag — set inside the try (needs the conversation id),
        // read by the executeAutoAction IIFE below to skip a duplicate
        // auto-reply/lead on a redelivered inbound (the row is recorded either way).
        let compositeRedelivery = false;
        // Persist the inbound text to smsMessages so it surfaces in
        // /admin/sms and bumps the conversation unread badge.
        // recordInboundShopSms() above writes only an in-memory Map
        // (wiped on every redeploy); addSmsMessage() is the durable row
        // the admin SMS UI actually reads. Awaited — a failed DB write
        // returns 500 so Capevace retries instead of dropping the lead.
        let conversationId: number | undefined = undefined;
        try {
          const { getOrCreateConversation, addSmsMessage, smsMessageExists, recentInboundExists } = await import("../../db");
          // Dedup — the Capevace cloud relay delivers webhooks
          // at-least-once, so the same sms:received can arrive more than
          // once. If a durable row for this gateway message id already
          // exists this is a redelivery: ack 200 and skip, so the
          // executeAutoAction call below can't fire a duplicate auto-reply
          // SMS or create a duplicate lead (auto-price-response does both).
          if (messageId && (await smsMessageExists(messageId))) {
            // ROS-058 · this drop is keyed on the MESSAGE row, but the row that
            // can go missing is the OBLIGATION row. If the first delivery died
            // between addSmsMessage and the job INSERT (deploy restart, DB
            // blip), nothing was ever obligated to answer this customer — and
            // dropping here suppresses the only redelivery that could have
            // created it. So consult the obligation before discarding.
            //
            // Healing cannot double-answer: the idempotency key is
            // deterministic (INSERT IGNORE collapses to the one row) and
            // claimJobById only claims pending/stale jobs, so a message that
            // really was answered is a no-op. `null` means undeterminable —
            // never read that as "no obligation", or a DB hiccup would
            // re-answer every redelivery.
            const { responseObligationExistsForProviderMsg, handleInboundResponse } =
              await import("../../services/smsResponseJobs");
            const hasObligation = await responseObligationExistsForProviderMsg(messageId);
            if (hasObligation === false) {
              log.error(
                "Inbound redelivery is healing a MISSING response obligation — a prior delivery persisted the message but never recorded the duty to answer it",
                {
                  messageId: messageId.slice(0, 12),
                  phone: phone.slice(-4),
                  errorId: "SMS_OBLIGATION_HEALED",
                },
              );
              const { getOrCreateConversation } = await import("../../db");
              const { ensureResponseObligation, answerResponseObligation } =
                await import("../../services/smsResponseJobs");
              const conv = await getOrCreateConversation(normalized);
              const healInput = {
                conversationId: conv.id,
                phone: normalized,
                providerMsgId: messageId,
                body,
              };
              // AWAIT the obligation write, exactly as the first-delivery path
              // does. Fire-and-forgetting it here would rebuild the very hole
              // this branch exists to repair: if the heal is lost to a restart
              // the message row still exists, so the NEXT redelivery lands back
              // in this same dedupe and finds no obligation again. A 500 hands
              // the retry to Capevace instead.
              let healed: ObligationHandle;
              try {
                healed = await ensureResponseObligation(healInput);
              } catch (err) {
                log.error("Obligation healing failed — asking Capevace to redeliver", {
                  error: err instanceof Error ? err.message : String(err),
                  errorId: "SMS_OBLIGATION_HEAL_FAILED",
                });
                res.status(500).json({ error: "heal_failed" });
                return;
              }
              // Answering stays off the ack path; the durable row is the guarantee.
              void answerResponseObligation(healed, healInput).catch((err) => {
                log.warn("Healed obligation could not be answered in-request", {
                  error: err instanceof Error ? err.message : String(err),
                });
              });
              res.status(200).json({ received: true, duplicate: true, healed: true });
              return;
            }
            log.info("Duplicate inbound shop SMS ignored", {
              messageId: messageId.slice(0, 12),
              phone: phone.slice(-4),
            });
            res.status(200).json({ received: true, duplicate: true });
            return;
          }
          const conversation = await getOrCreateConversation(normalized);
          conversationId = conversation.id;
          // Rank-3: a prior identical inbound (<5min) means this is a redelivery
          // (new messageId) or an impatient repeat. Checked BEFORE addSmsMessage
          // so it sees only PRIOR rows, not the one we're about to add.
          compositeRedelivery = await recentInboundExists(conversation.id, body);
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
        // Recovery 2.0 · passive stated-concern capture. If this reply
        // answers a declined-recovery text (last outbound within 7d
        // carries a declined_* variantKey), classify the customer's own
        // words and stamp alg_estimates.stated_concern (source
        // sms_reply). OBSERVER ONLY: no reply logic, no sends; operator
        // capture is never overwritten (stated_concern IS NULL guard);
        // fail-open like every parallel block in this path. The reply
        // engine below is untouched.
        (async () => {
          const { captureStatedConcernFromReply } = await import("../../services/recoveryReplyCapture");
          await captureStatedConcernFromReply(normalized, body);
        })().catch(() => undefined);
        // Service-recovery loop (receive side) · complaint language →
        // review_recovery opportunity in the owner Decision Inbox.
        // OBSERVER ONLY (pure intent classifier, no-state context); the
        // reply engine + review-request engine are untouched, and review
        // asks are never conditioned on this. Fail-open.
        (async () => {
          const { captureComplaintOpportunity } = await import("../../services/opportunityQueue");
          await captureComplaintOpportunity(normalized, body);
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
        // ─── Durable obligation, BEFORE the ack (ROS-058) ───────────────────
        // Awaited on purpose. This write used to ride the fire-and-forget block
        // below — i.e. it ran AFTER res.status(200) — so a restart between the
        // message INSERT above and the job INSERT left a persisted customer text
        // that nothing was obligated to answer, and the message-keyed dedupe
        // above then ate the redelivery that could have healed it. Returning 5xx
        // hands the retry back to Capevace, whose at-least-once redelivery is
        // idempotent against the deterministic key.
        let obligation: ObligationHandle = { jobId: null, durable: false, created: false };
        if (!compositeRedelivery) {
          try {
            const { ensureResponseObligation } = await import("../../services/smsResponseJobs");
            obligation = await ensureResponseObligation({
              conversationId: conversationId!,
              phone: normalized,
              providerMsgId: messageId || null,
              body,
            });
          } catch (err) {
            log.error("Failed to record the inbound response obligation — asking Capevace to redeliver", {
              error: err instanceof Error ? err.message : String(err),
              phone: phone.slice(-4),
              errorId: "SMS_OBLIGATION_WRITE_FAILED",
            });
            res.status(500).json({ error: "obligation_failed" });
            return;
          }
        }
        // Answering stays OFF the ack path: the durable row is what guarantees a
        // reply, so this call only supplies latency.
        (async () => {
          if (compositeRedelivery) {
            log.info("Skipping orchestrator — composite redelivery (prior identical inbound <5min)", {
              phone: phone.slice(-4),
            });
            return;
          }
          const { answerResponseObligation } = await import("../../services/smsResponseJobs");
          await answerResponseObligation(obligation, {
            conversationId: conversationId!,
            phone: normalized,
            providerMsgId: messageId || null,
            body,
          });
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
            const { smsMessages, smsOrchestrations, leadDeliveryEvents } = await import("../../../drizzle/schema");
            const { eq, like } = await import("drizzle-orm");
            const db = await getDb();
            if (!db) return;
            const newStatus = eventType === "sms:delivered" ? "delivered" : "sent";
            await db.update(smsMessages)
              .set({ status: newStatus })
              .where(eq(smsMessages.twilioSid, messageId));

            await db.update(smsOrchestrations)
              .set({ status: newStatus })
              .where(like(smsOrchestrations.sendResultJson, `%"sid":"${messageId}"%`));

            // Lead-delivery ledger: match the sms row by providerRef (= the
            // gateway message id captured on send in lead.ts) so the per-lead
            // delivery chronology advances sent -> delivered.
            await db.update(leadDeliveryEvents)
              .set({ status: newStatus })
              .where(eq(leadDeliveryEvents.providerRef, messageId));
          } catch (err) {
            log.warn("Failed to update status on delivery", {
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
            const { smsMessages, smsOrchestrations, leadDeliveryEvents } = await import("../../../drizzle/schema");
            const { eq, like } = await import("drizzle-orm");
            const db = await getDb();
            if (!db) return;
            await db.update(smsMessages)
              .set({ status: "failed" })
              .where(eq(smsMessages.twilioSid, messageId));

            await db.update(smsOrchestrations)
              .set({ status: "failed", failureReason: reason })
              .where(like(smsOrchestrations.sendResultJson, `%"sid":"${messageId}"%`));

            await db.update(leadDeliveryEvents)
              .set({ status: "failed", detail: reason })
              .where(eq(leadDeliveryEvents.providerRef, messageId));
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
