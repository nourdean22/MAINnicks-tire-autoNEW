# Truth OS — nickstire.org (living snapshot)

**Purpose:** Single place to record what must be **true in production** for this repo. Update when you ship behavior or infra changes.

## Canonical business facts (code)

- **Address:** `17625 Euclid Ave, Cleveland, OH 44112` — source: `shared/business.ts` (`BUSINESS.address`).
- **Phone:** `(216) 862-0005` — source: `shared/business.ts`.
- **Public site:** `SITE_URL` env, default `https://nickstire.org`.
- **Review marketing line:** `BUSINESS.reviews` (`rating`, `count`, `countDisplay`) — canonical marketing floor. Live totals and admin overrides are merged in code (see below).

## Google review count (single rule)

**Display count = max(marketing floor, live Google, admin override).**

- **Marketing floor:** `BUSINESS.reviews.count` in `shared/business.ts` (and `countDisplay` for static trust copy).
- **Live Google:** Places `user_ratings_total` when the Maps API returns a positive value (`server/google-reviews.ts`).
- **Admin:** `shop_settings` keys `reviewCount` / `reviewRating` when set.

Implementation: `resolveReviewDisplay()` in `shared/business.ts`; `getGoogleReviews()` applies it on both API-success and DB fallback paths so the public site and admin health panel never show a total below the floor when GBP lags, and can show a higher number when Google or admin is ahead.

## Deploy

- **nickstire.org:** Railway (not Vercel for this app).
- **Build:** `pnpm run build`; full static SEO path: `pnpm run build:prerender`.

### Production: migration `0026` + Railway redeploy

1. **Apply SQL** `drizzle/0026_work_order_items_decline_recovery.sql` to production MySQL/TiDB (Railway database). Use your normal migration path (`drizzle-kit migrate`, or run the SQL file in the host’s SQL console). Required before declined-line `decline_outreach_*` / `decline_recovered_at` fields are trustworthy.
2. **Redeploy** the Railway nickstire service from the commit that contains the matching application code, then smoke-test booking/admin and declined-work flows.
3. **Optional check:** cron `statenourSync` should POST `200` to `STATENOUR_SYNC_URL` `/api/sync/business` (see `server/cron/jobs/statenourSync.ts`).

## Migrations pending awareness

- **`0026_work_order_items_decline_recovery.sql`** — adds `decline_outreach_*` and `decline_recovered_at` on `work_order_items` for declined-work recovery tracking. Apply to prod DB before relying on outreach/recovered fields.
- **`0040_wave181_otp_attempts_durable.sql`** (wave-181.60) — creates `otp_attempts` table backing the durable OTP brute-force counter in `server/middleware/bruteForce.ts`. Until applied, brute-force protection fails open (logged, doesn't block).
  - Apply: `pnpm exec tsx scripts/apply-wave-181-59-otp-attempts.ts`
- **`0041_wave181_sms_sending_status.sql`** (wave-181.60) — appends `"sending"` to `sms_messages.status` enum. Until applied, the rehydrate path's atomic queued→sending claim fails and false-positive "sent" stamps on restart return.
  - Apply: `pnpm exec tsx scripts/apply-wave-181-59-sms-sending.ts`
- **`0042_wave181_declined_recovery_attempted_at.sql`** (wave-181.60) — adds `follow_up_{7,30}d_attempted_at` to `alg_estimates` for at-most-once declined-recovery sends. Until applied, the at-most-once claim degrades to the prior double-send-on-restart behavior.
  - Apply: `pnpm exec tsx scripts/apply-wave-181-59-declined-recovery-attempted.ts`

## SMS routing (post wave-103, updated wave-181.60)

- **Default path:** Shop SMS Gateway = Capevace `me.capcom.smsgateway` v1.60.0 running on the F25e (Samsung S25 FE) at `216-862-0005` (Verizon line). Wave-181.60 made this the DEFAULT — any `sendSms(phone, body)` call with no explicit `via` routes through the shop gateway first. Forgetting `{ via: "shop" }` no longer silently routes to dead Twilio (the wave-181.58 bug class).
- **Fallback path:** Twilio (`+1 216-769-9977`). Only fires when shop gateway returns failure (with Telegram alert), or when caller explicitly opts out via `{ via: "twilio" }` (rare — test scripts, legacy Twilio-only webhooks).
- **Inbound webhook:** `POST /api/webhooks/sms-gateway` — HMAC-SHA256 over `rawBody + X-Timestamp` header value, ±5min replay window. Verified via `SHOP_SMS_GATEWAY_WEBHOOK_SECRET`.
- **Health monitor:** Cron `sms-gateway-health` (pulse tier, 15min) pings Capevace `/device`, Telegram alert if F25e last-seen > 30min.
- **Kill switch:** `SMS_KILL_SWITCH=true` only blocks the Twilio fallback. Shop gateway sends keep working when the switch is on. With wave-181.60's default flip, the kill switch is effectively cosmetic for customer-facing traffic — shop path is reached before the kill switch check.
- **Manager-on-duty alerts:** `eventBus` destination `manager-on-duty-sms` texts the VAPI transferCall destination (current on-duty manager) on every booking_created / lead_captured / callback_requested / emergency_request event. Self-loop guard skips if the on-duty number == 216-862-0005.
- **Operator runbook:** `docs/SHOP_SMS_GATEWAY_SETUP.md` and `docs/OPERATOR_RUNBOOK_WAVE_181_60.md` (migration apply procedure).

## Invariants (do not break)

- **ShopDriver / ALG** integration is load-bearing for shop operations — do not remove without explicit owner decision.
- **Feature flags:** risky features should default off at the code path until explicitly enabled in DB.
- **Shop SMS Gateway is load-bearing.** ~80% of customer-facing transactional SMS routes through the F25e. Don't change the `sendSms` default-route logic (`opts?.via !== "twilio"`) without confirming Twilio is healthy + opt-in compliance.
- **Webhook signature scheme** for the SMS Gateway is HMAC-SHA256 over `body + X-Timestamp`. Don't change this without updating the Capevace app's signing key OR re-signing scheme on both sides.
- **OTP brute-force counter is DB-backed (wave-181.60).** Don't revert to an in-memory Map — counters need to survive Railway restarts and aggregate across pods.
- **Declined-recovery is at-most-once (wave-181.60).** The `followUp{N}dAttemptedAt` claim must be stamped BEFORE `sendSms`, not after. Reversing the order reintroduces double-send-on-restart.
