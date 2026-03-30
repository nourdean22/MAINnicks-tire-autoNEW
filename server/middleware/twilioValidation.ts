/**
 * Twilio Webhook Validation Middleware
 * Verifies that incoming requests actually originated from Twilio
 * using the X-Twilio-Signature header + HMAC-SHA1 validation.
 *
 * Without this, anyone can forge webhook requests to trigger SMS actions.
 *
 * WARNING: This middleware must NEVER be mounted globally with app.use(twilioWebhookRouter).
 * It must ONLY be applied to the specific webhook router (server/routes/webhooks/twilio.ts).
 *
 * A March 2026 incident caused a full site outage because this was mounted globally,
 * applying Twilio signature validation to ALL requests including the homepage.
 * Non-Twilio requests returned 403 + XML <Response/>, making the entire site inaccessible.
 */

import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { createLogger } from "../lib/logger";

const log = createLogger("twilio-auth");

/**
 * Validates the X-Twilio-Signature header.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioRequest(req: Request, res: Response, next: NextFunction): void {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Skip validation in development or if no auth token configured
  if (!authToken || process.env.NODE_ENV !== "production") {
    return next();
  }

  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) {
    log.warn("Twilio webhook missing signature", { path: req.path, ip: req.ip });
    res.status(403).type("text/xml").send("<Response></Response>");
    return;
  }

  // Build the validation URL (Twilio uses the full URL including protocol)
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers.host || "";
  const url = `${protocol}://${host}${req.originalUrl}`;

  // Sort POST parameters and append to URL
  let data = url;
  if (req.body && typeof req.body === "object") {
    const sortedKeys = Object.keys(req.body).sort();
    for (const key of sortedKeys) {
      data += key + req.body[key];
    }
  }

  // Compute HMAC-SHA1
  const expectedSignature = createHmac("sha1", authToken)
    .update(data)
    .digest("base64");

  // Timing-safe comparison
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    log.warn("Twilio webhook signature mismatch", { path: req.path, ip: req.ip });
    res.status(403).type("text/xml").send("<Response></Response>");
    return;
  }

  next();
}
