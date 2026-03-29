# Environment Variable Audit — Nick's Tire & Auto
Generated: 2026-03-29

## Summary
- **47 server-side env vars** in use across the codebase
- **3 client-side VITE_ vars** (non-sensitive — all safe to expose)
- **8 vars required at startup** (server crashes with clear error if missing)
- **Gitignore verified** — all .env* files excluded ✓
- **No secrets in logs** — grep confirmed ✓

---

## VITE_ Client-Side Variables (Exposed to Browser)

| Variable | Value Type | Risk |
|----------|-----------|------|
| `VITE_FRONTEND_FORGE_API_KEY` | API key for frontend forge service | Low — service has its own auth |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Google OAuth public client ID | None — by design, public |
| `VITE_SITE_URL` | Site URL string | None — not sensitive |

**Status: ACCEPTABLE** — None of these contain secrets that would enable unauthorized access.

---

## Server-Side Variables (process.env.*)

### CRITICAL — Server fails to start without these (startup validation enforced)

| Variable | Purpose | Where Used |
|----------|---------|-----------|
| `DATABASE_URL` | TiDB/MySQL connection string | Drizzle ORM, all DB operations |
| `JWT_SECRET` | Signs session JWTs | `server/_core/context.ts` |
| `OPENAI_API_KEY` | AI chat/diagnosis/search | All AI routers |
| `GOOGLE_OAUTH_CLIENT_ID` | Admin login flow | `server/_core/oauth.ts` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Admin login flow | `server/_core/oauth.ts` |
| `TWILIO_ACCOUNT_SID` | SMS sending | reviewRequests, reminders, booking |
| `TWILIO_AUTH_TOKEN` | Twilio API auth | SMS routers |
| `TWILIO_PHONE_NUMBER` | Send-from number | SMS routers |

### HIGH — Features fail silently without these

| Variable | Purpose | Failure Mode |
|----------|---------|-------------|
| `FB_PAGE_ACCESS_TOKEN` | Send Messenger replies | Bot goes silent |
| `FB_VERIFY_TOKEN` | Verify Messenger webhook | Webhook verification fails |
| `GOOGLE_SHEETS_CRM_ID` | Write bookings/leads to CRM | CRM writes fail silently |
| `GOOGLE_MAPS_API_KEY` | Maps embed, address validation | Maps broken |
| `GOOGLE_PLACES_API_KEY` | Places autocomplete | Autocomplete broken |
| `RESEND_API_KEY` | Email notifications | Emails not sent |
| `STRIPE_SECRET_KEY` | Payment processing | Payments fail |

### MEDIUM — Integrations or analytics only

| Variable | Purpose |
|----------|---------|
| `ADMIN_API_KEY` | Internal admin API auth |
| `AUTO_LABOR_USERNAME` / `AUTO_LABOR_PASSWORD` | Labor estimate data source |
| `AWS_REGION` | S3/CloudFront (if used) |
| `CEO_EMAIL` | Notification recipient |
| `CLOUDFRONT_DOMAIN` | CDN domain |
| `GA` | Google Analytics ID |
| `GATEWAY_TIRE_USERNAME` / `GATEWAY_TIRE_PASSWORD` | Tire catalog API |
| `GOOGLE_DRIVE_TOKEN` | Drive integration |
| `GOOGLE_WORKSPACE_CLI_TOKEN` | Workspace integration |
| `LLM_MODEL` | Override default AI model |
| `LOG_LEVEL` | Server logging verbosity |
| `META_CAPI_ACCESS_TOKEN` | Meta Conversions API |
| `META_PIXEL_ID` | Facebook Pixel |
| `NOTIFICATION_WEBHOOK_URL` | Internal notifications |
| `NOUR_OS_API_URL` / `NOUR_OS_EVENTS_PATH` | NOUR OS integration |
| `OLLAMA_BASE_URL` / `OPENAI_BASE_URL` | LLM endpoint overrides |
| `OWNER_OPEN_ID` / `OWNER_PHONE` / `OWNER_PHONE_NUMBER` | Owner contact |
| `REDIS_URL` | Session/cache store |
| `SHOP_EMAIL` | Shop contact |
| `STATENOUR_SYNC_KEY` / `STATENOUR_SYNC_URL` | NOUR OS sync |
| `TUNNEL_URL` | Dev tunnel URL |
| `YOUTUBE_API_KEY` | YouTube embed/API |

### LOW — Runtime config only

| Variable | Purpose |
|----------|---------|
| `NODE_ENV` | development / production |
| `PORT` | Server port (default 3000) |

---

## .gitignore Check ✓

```
.env
.env.*
.env.local
.env.*.local
```
All confirmed in `.gitignore`. No env files tracked in git.

---

## Action Items

| Priority | Action | Status |
|----------|--------|--------|
| HIGH | Add Twilio signature verification to `/api/sms-webhook` | Pending (Phase 4) |
| HIGH | Add FB HMAC verification to `/api/messenger-webhook` POST | Pending (Phase 4) |
| MEDIUM | Add `GOOGLE_SHEETS_CRM_ID` to startup validation | Consider adding |
| LOW | Document which vars are optional vs. feature-degrading | This doc |
