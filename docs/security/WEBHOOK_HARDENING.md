# Webhook Hardening — Nick's Tire & Auto
Generated: 2026-03-29

## Twilio SMS Webhook (`POST /api/sms-webhook`)

**Status: HARDENED** (commit `29634b0`)

- X-Twilio-Signature header validated using `twilio.validateRequest()`
- Missing signature → 403 reject with console.warn
- Invalid signature → 403 reject with console.warn
- Signature validation error → 500

**Body parsing:** Uses `express.urlencoded({ extended: false })` — correct for Twilio form-encoded payloads.

## Facebook Messenger Webhook

### GET `/api/messenger-webhook` (verification)
- Validates `hub.verify_token` against `FB_VERIFY_TOKEN` env var
- Invalid token → 403

### POST `/api/messenger-webhook` (incoming messages)
**Status: HARDENED** (commit `29634b0`)

- Uses `express.raw({ type: "application/json" })` to get raw body buffer for HMAC
- X-Hub-Signature-256 validated with HMAC-SHA256 using `FB_APP_SECRET`
- Uses `crypto.timingSafeEqual()` to prevent timing attacks
- Missing signature (when secret is configured) → 403
- Invalid signature → 403
- If `FB_APP_SECRET` not set → HMAC verification skipped (soft degradation with console.warn at startup)

## Review Click Redirect (`GET /api/review-click/:token`)

**Status: SAFE — No open redirect**

- Redirect target is hardcoded `GOOGLE_REVIEW_URL` from `@shared/const`
- No user-controlled redirect parameter
- Token is used only for DB tracking (click recorded), not for URL resolution
- Token length validated (≤64 chars)

## Global Body Size Limits

**Status: HARDENED** (commit `29634b0`)

- `express.json({ limit: "500kb" })` — reduced from dangerous 50mb
- `express.urlencoded({ limit: "500kb", extended: true })`
- `booking.uploadPhoto` handles its own limits separately

## Error Information Leakage

- tRPC error formatter strips stack traces in production
- Webhook error handlers return minimal info (empty `<Response>` or generic 500)
- No internal paths, DB URLs, or stack traces in public error responses
