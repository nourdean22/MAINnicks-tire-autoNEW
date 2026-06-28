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

  // wave-122 (HIGH S7) — was: skip validation if NODE_ENV !== production
  // OR if no auth token. That meant any reachable staging or test
  // environment could be hit with forged Twilio webhooks (bookings
  // auto-confirmed, estimates auto-approved, etc.) by anyone who knew
  // the URL. Now: skip ONLY when authToken is genuinely missing (dev
  // boxes without Twilio config). If token is configured, validate
  // ALWAYS regardless of environment. Log the bypass so it shows in
  // boot logs.
  if (!authToken) {
    if (process.env.NODE_ENV === "production") {
      log.error("[validateTwilioRequest] TWILIO_AUTH_TOKEN not set in production — webhook validation rejected (fail-closed).");
      res.status(403).type("text/xml").send("<Response></Response>");
      return;
    }
    log.warn("[validateTwilioRequest] TWILIO_AUTH_TOKEN not set — webhook validation BYPASSED. Configure the token in any reachable environment.");
    return next();
  }

  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!signature) {
    log.warn("Twilio webhook missing signature", { path: req.path, ip: req.ip });
    res.status(403).type("text/xml").send("<Response></Response>");
    return;
  }

  // wave-122b (MEDIUM S2) — was trusting `x-forwarded-proto` and
  // `Host` headers from the request to compute the HMAC validation
  // URL. A request with a manipulated Host header could force the
  // HMAC computation against the wrong URL and bypass or mismatch
  // validation. Now: prefer environment-pinned domain
  // (RAILWAY_PUBLIC_DOMAIN or NICKSTIRE_PUBLIC_URL), fall back to
  // request headers only if neither env var is set (dev convenience).
  const envDomain = process.env.NICKSTIRE_PUBLIC_URL
    ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
  let url: string;
  if (envDomain) {
    url = `${envDomain.replace(/\/+$/, "")}${req.originalUrl}`;
  } else {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol;
    const host = req.headers.host || "";
    url = `${protocol}://${host}${req.originalUrl}`;
    log.warn("[twilioValidation] no env-pinned domain — falling back to request headers (dev OK, prod set NICKSTIRE_PUBLIC_URL)");
  }

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

  // Replay protection: reject requests older than 5 minutes
  // Twilio includes a timestamp in the request body as DateCreated or DateSent
  const twilioTimestamp = req.body?.DateCreated || req.body?.DateSent;
  if (twilioTimestamp) {
    const msgTime = new Date(twilioTimestamp).getTime();
    const now = Date.now();
    const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
    if (isNaN(msgTime) || Math.abs(now - msgTime) > MAX_AGE_MS) {
      log.warn("Twilio webhook replay rejected (stale timestamp)", { path: req.path, age: now - msgTime });
      res.status(403).type("text/xml").send("<Response></Response>");
      return;
    }
  }

  next();
}
