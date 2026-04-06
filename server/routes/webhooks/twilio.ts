/**
 * Twilio Webhook Routes — Handles inbound SMS and voice calls
 * POST /api/v1/webhooks/twilio/incoming-sms — inbound customer SMS
 * POST /api/v1/webhooks/voice/incoming — voice call greeting
 * POST /api/v1/webhooks/voice/process — voice speech processing
 */

import { Router, type Request, type Response } from "express";
import { createLogger } from "../../lib/logger";
import { parseSmsResponse, executeAutoAction } from "../../services/smsResponseParser";
import { generateGreetingTwiML, generateResponseTwiML } from "../../services/aiReceptionist";
import { validateTwilioRequest } from "../../middleware/twilioValidation";

const log = createLogger("twilio-webhooks");
const router = Router();

// Apply Twilio signature validation to all routes in this router
router.use(validateTwilioRequest);

// ─── Inbound SMS ────────────────────────────────
router.post("/api/v1/webhooks/twilio/incoming-sms", async (req: Request, res: Response) => {
  try {
    const { Body: body, From: from, To: to } = req.body;

    if (!body || !from) {
      res.status(400).send("<Response></Response>");
      return;
    }

    log.info("Inbound SMS received", { from: from.slice(-4), body: body.slice(0, 100) });

    // Parse intent
    const parsed = parseSmsResponse(body);

    // Execute auto-action if high confidence
    if (parsed.autoAction && !parsed.requiresHuman) {
      await executeAutoAction(parsed, from);
    }

    // Log communication (fire-and-forget)
    logInboundSms(from, body, parsed.intent).catch(() => {});

    // Send empty TwiML response (no auto-reply for now)
    res.type("text/xml").send("<Response></Response>");
  } catch (err) {
    log.error("Inbound SMS webhook error", { error: err instanceof Error ? err.message : String(err) });
    res.type("text/xml").send("<Response></Response>");
  }
});

// ─── Voice: Incoming Call ───────────────────────
router.post("/api/v1/webhooks/voice/incoming", (_req: Request, res: Response) => {
  log.info("Incoming voice call");
  res.type("text/xml").send(generateGreetingTwiML());
});

// ─── Voice: Process Speech ──────────────────────
router.post("/api/v1/webhooks/voice/process", (req: Request, res: Response) => {
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
    log.info("Voice input processed", { caller: callerPhone.slice(-4), speech: speechResult.slice(0, 100) });
    res.type("text/xml").send(generateResponseTwiML(speechResult));
  } else {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Thank you for calling Nick's Tire and Auto. Call us during business hours at 216-862-0005. Goodbye!</Say>
</Response>`);
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
    console.warn("[twilio] Failed to log inbound SMS:", err instanceof Error ? err.message : err);
  }
}

export { router as twilioWebhookRouter };
