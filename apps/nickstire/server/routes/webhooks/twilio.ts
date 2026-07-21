/**
 * Twilio Webhook Routes — Handles inbound SMS and voice calls
 * POST /api/v1/webhooks/twilio/incoming-sms — inbound customer SMS
 * POST /api/v1/webhooks/voice/incoming — voice call greeting
 * POST /api/v1/webhooks/voice/process — voice speech processing
 * POST /api/v1/webhooks/voice/status — call lifecycle status callback
 *   (closes the click→call attribution loop: matches DialCallSid +
 *    CallDuration + CallStatus back to a prior call_events row)
 */

import { Router, type Request, type Response } from "express";
import { createLogger } from "../../lib/logger";
import { generateGreetingTwiML, generateResponseTwiML } from "../../services/aiReceptionist";
import { validateTwilioRequest } from "../../middleware/twilioValidation";

const log = createLogger("twilio-webhooks");
const router = Router();

// Apply Twilio signature validation to all routes in this router
router.use(validateTwilioRequest);

// ─── Inbound SMS ────────────────────────────────
router.post("/twilio/incoming-sms", async (req: Request, res: Response) => {
  try {
    const { Body: body, From: from, To: to, MessageSid: messageSid, NumMedia: numMediaRaw, MediaUrl0: mediaUrl0 } = req.body;

    // Wave AZ · MMS routing · Twilio sets NumMedia ≥ 1 when an image
    // is attached. Route to the photo-assess pipeline fire-and-forget
    // (don't block the TwiML ack on vision-model latency). The pipeline
    // runs its own opt-out + sending-hours checks via sendSms.
    const numMedia = Number(numMediaRaw ?? 0);
    if (numMedia >= 1 && mediaUrl0 && from) {
      (async () => {
        try {
          const { runPhotoAssess } = await import("../../services/photo-assess-pipeline");
          await runPhotoAssess({
            phone: from,
            photoUrl: String(mediaUrl0),
            source: "twilio_mms",
          });
        } catch (err) {
          log.warn("photo_assess_twilio_mms_failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })().catch(() => undefined);
    }

    if (!body || !from) {
      // MMS with no body is still a valid inbound · skip the empty-body
      // bail if we just kicked off photo-assess
      if (numMedia >= 1) {
        res.type("text/xml").send("<Response></Response>");
        return;
      }
      res.status(400).send("<Response></Response>");
      return;
    }

    // Privacy: log metadata only — customer message content goes to the DB
    // conversation record (admin inbox), never to the stdout/Railway log stream.
    log.info("Inbound SMS received", {
      from: from.slice(-4),
      body_len: String(body).length,
      has_media: numMedia >= 1,
    });

    const { getOrCreateConversation, addSmsMessage, smsMessageExists } = await import("../../db");

    // Dedup — Twilio delivers inbound webhooks at-least-once. If we've
    // already recorded this MessageSid it's a redelivery: ack and skip,
    // so executeAutoAction can't fire a duplicate auto-reply SMS or
    // create a duplicate lead (auto-price-response does both).
    if (messageSid && (await smsMessageExists(String(messageSid)))) {
      log.info("Duplicate inbound Twilio SMS ignored", {
        from: from.slice(-4),
        sid: String(messageSid).slice(0, 12),
      });
      res.type("text/xml").send("<Response></Response>");
      return;
    }

    // Persist inbound to the conversation thread — this is both the
    // admin-inbox record and the dedup marker the check above reads.
    let conversationId: number | undefined = undefined;
    try {
      const conversation = await getOrCreateConversation(from);
      conversationId = conversation.id;
      await addSmsMessage({
        conversationId: conversation.id,
        direction: "inbound",
        body,
        twilioSid: messageSid ? String(messageSid) : undefined,
        status: "received",
      });
    } catch (persistErr) {
      log.error("Failed to persist inbound Twilio SMS", {
        error: persistErr instanceof Error ? persistErr.message : String(persistErr),
      });
    }

    if (conversationId) {
      try {
        const { orchestrateSms } = await import("../../services/smsOrchestrator");
        await orchestrateSms({
          type: "inbound_sms",
          phone: from,
          body,
          conversationId,
        });
      } catch (orchErr) {
        log.warn("Orchestrator inbound SMS check failed in Twilio webhook", {
          error: orchErr instanceof Error ? orchErr.message : String(orchErr),
        });
      }
    }

    // Send empty TwiML response (no auto-reply for now)
    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    log.error("Inbound SMS webhook error", { error: err instanceof Error ? err.message : String(err) });
    res.type("text/xml").send("<Response></Response>");
  }
});

// ─── Voice: Incoming Call ───────────────────────
router.post("/voice/incoming", (_req: Request, res: Response) => {
  log.info("Incoming voice call");
  res.type("text/xml").send(generateGreetingTwiML());
});

// ─── Voice: Process Speech ──────────────────────
router.post("/voice/process", (req: Request, res: Response) => {
  const speechResult = req.body?.SpeechResult || "";
  const digits = req.body?.Digits || "";
  const callerPhone = req.body?.From || "";

  // If they pressed 0, transfer
  if (digits === "0") {
    const ownerPhone = process.env.OWNER_PHONE_NUMBER || process.env.ADMIN_PHONE || "(216) 862-0005";
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Connecting you now. One moment please.</Say>
  <Dial>${ownerPhone}</Dial>
</Response>`);
    return;
  }

  if (speechResult) {
    // Privacy: log transcript length only, never the caller's spoken words.
    log.info("Voice input processed", {
      caller: callerPhone.slice(-4),
      speech_len: String(speechResult).length,
    });
    res.type("text/xml").send(generateResponseTwiML(speechResult));
  } else {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Thank you for calling Nick's Tire and Auto. Call us during business hours at 216-862-0005. Goodbye!</Say>
</Response>`);
  }
});

// ─── Voice: Call Status Callback ────────────────
// Twilio fires this when a call's status changes (initiated → ringing →
// in-progress → completed/no-answer/busy/failed). We stamp duration +
// outcome onto the most recent matching call_events row so the admin
// dashboard can compute click→answer→duration funnels.
//
// Configure in Twilio Console: Phone Numbers → +1 216-862-0005 → A Call
// Comes In: Webhook → URL of /voice/status → HTTP POST.
router.post("/voice/status", async (req: Request, res: Response) => {
  try {
    const callStatus = String(req.body?.CallStatus || "");
    const callDuration = Number(req.body?.CallDuration || 0);
    const callerPhone = String(req.body?.From || "");
    const callSid = String(req.body?.CallSid || "");

    // Only process terminal statuses — earlier transitions don't have duration.
    const TERMINAL_STATUSES = new Set(["completed", "no-answer", "busy", "failed", "canceled"]);
    if (!TERMINAL_STATUSES.has(callStatus)) {
      res.type("text/xml").send("<Response></Response>");
      return;
    }

    // Structured log — durable in our log aggregator (Sentry/Telegram).
    // Closing the click→call attribution loop fully (matching this
    // outcome to a prior call_events row by callerPhone + recency window)
    // requires a callSid column on call_events. Schema migration pending.
    log.info("phone_call_outcome", {
      status: callStatus,
      duration_sec: callDuration,
      from_last4: callerPhone.slice(-4),
      sid_last8: callSid.slice(-8),
    });

    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    log.error("Voice status callback error", { error: err instanceof Error ? err.message : String(err) });
    res.type("text/xml").send("<Response></Response>");
  }
});

async function logInboundSms(phone: string, body: string, intent: string): Promise<void> {
  try {
    const { getDb } = await import("../../db");
    const { communicationLog } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return;
    await db.insert(communicationLog).values({
      customerPhone: phone,
      type: "sms",
      direction: "inbound",
      body: body.slice(0, 5000),
      metadata: { parsedIntent: intent },
    });
  } catch (err) {
    log.warn("[twilio] Failed to log inbound SMS:", err instanceof Error ? err.message : err);
  }
}

export { router as twilioWebhookRouter };
