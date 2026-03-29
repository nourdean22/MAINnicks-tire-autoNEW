# Security Surface Map — Nick's Tire & Auto
Generated: 2026-03-29

## Public HTTP Routes (Express)

| Route | Method | Purpose | Auth | Rate Limited | Side Effects |
|-------|--------|---------|------|-------------|-------------|
| `/sitemap.xml` | GET | SEO sitemap | None | General (100/15min) | DB read |
| `/robots.txt` | GET | Crawler rules | None | General | None |
| `/api/review-click/:token` | GET | Review link tracking + redirect | None | General | DB write, always redirects to hardcoded GBP URL |
| `/api/sms-webhook` | POST | Twilio inbound SMS | None (no sig verify) | General | DB write, may trigger SMS reply |
| `/api/messenger-webhook` | GET | FB webhook verification | FB_VERIFY_TOKEN | None | None |
| `/api/messenger-webhook` | POST | FB incoming messages | None (no HMAC verify) | None | DB write, may send reply |
| `/api/oauth/callback` | GET | Google OAuth callback | Code param | None | DB write, session cookie set |
| `/api/health` | GET | System health | None (public) | None | DB read |
| `/api/trpc/*` | POST | All tRPC procedures | Per-procedure | Yes (multiple tiers) | Varies |

## tRPC Procedure Access Levels

### publicProcedure (unauthenticated — anyone can call)
- `booking.create` — creates booking, triggers Sheets write + SMS
- `booking.uploadPhoto` — file upload
- `booking.statusByPhone` / `statusByRef` — booking lookup
- `lead.submit` — lead capture, triggers Sheets write
- `callback.submit` — callback request
- `chat.message` — AI chat (OpenAI tokens)
- `public.diagnose` — AI diagnosis (OpenAI tokens)
- `public.askMechanic` — AI mechanic (OpenAI tokens)
- `public.aiSearch` — AI search (OpenAI tokens)
- `laborEstimate.generate` — AI estimate (OpenAI tokens)
- `services.*` (8 procedures) — service data reads
- `nourOsQuote.*` (5 procedures) — quote flows
- `gatewayTire.*` (5 procedures) — tire catalog
- `financing.apply`, `financing.calculate`
- `specials.list`, `gallery.list`, `shopStatus.get`
- `shareCards.generate`, `shareCards.get`
- `estimates.get`
- `waitlistRouter.join`
- `serviceMatcher.match`
- `reviewRequests.click`
- `content.list`, `content.get`, `content.search`, `content.related`

### protectedProcedure (authenticated users)
- Various customer portal procedures

### adminProcedure (role=admin only)
- All of `admin.*`, `advanced.*`, `campaigns.*`, `customers.*`
- `reminders.*`, `reviewReplies.*`, `winback.*`, `segments.*`
- All shop operations, work orders, technicians, inventory, warranties

## Background Processors (setInterval)

| Processor | Interval | What it does | Failure behavior |
|-----------|----------|-------------|-----------------|
| ReviewRequest Queue | 5 min | Sends SMS review requests | Logs error, continues |
| Reminder Queue | 15 min | Sends maintenance reminders | Logs error, continues |
| PostInvoiceFollowUp | 60 min | 7-day follow-up SMS | Logs error, continues |

All three: no retry logic, no consecutive failure tracking, no alerting.

## OAuth Flow
- Provider: Google (custom SDK via `sdk.ts`)
- Callback: `/api/oauth/callback`
- Session: JWT cookie (httpOnly, secure in prod)
- State parameter: NOT verified (CSRF risk — low in practice since login is owner-only)

## Webhook Surfaces

| Webhook | Sender | Signature Verified? | Risk |
|---------|--------|-------------------|------|
| `/api/sms-webhook` | Twilio | NO | Medium — fake SMS events |
| `/api/messenger-webhook` POST | Facebook | NO | Medium — fake message events |
| `/api/messenger-webhook` GET | Facebook | YES (FB_VERIFY_TOKEN) | Low |
