# Vendor Integration Audit — Nick's Tire & Auto

**Audited**: 2026-03-29
**Status**: 9 integrations mapped, 4 high-risk (env-var-only detection) identified and fixed

## Integration Matrix

| # | Vendor | Auth Method | Health Check | Risk | Status |
|---|--------|-------------|-------------|------|--------|
| 1 | **Database (TiDB)** | Connection string | `SELECT 1` query | Low | Real check |
| 2 | **Google Sheets CRM** | OAuth token (`GOOGLE_DRIVE_TOKEN`) | `isSheetConfigured()` env check only | Medium | Upgraded to real |
| 3 | **Gmail Notifications** | App password | Delivery log analysis | Low | Real check |
| 4 | **Gateway Tire B2B** | Cookie auth (`b2b.dktire.com/auth-signin`) | **ENV VAR ONLY** | **HIGH** | Fixed: real auth probe |
| 5 | **Twilio SMS** | API key (`TWILIO_ACCOUNT_SID` + `AUTH_TOKEN`) | **ENV VAR ONLY** | **HIGH** | Fixed: account verify |
| 6 | **Stripe Payments** | Secret key (`STRIPE_SECRET_KEY`) | **ENV VAR ONLY** | **HIGH** | Fixed: balance fetch |
| 7 | **Auto Labor Guide** | Cookie auth (`autolaborexperts.com/api/auth/login`) | **ENV VAR ONLY** | **HIGH** | Fixed: real auth probe |
| 8 | **Financing Providers** | Merchant portal links (no API) | Static "connected" | Low | No API to probe |
| 9 | **NOUR OS Bridge** | Local file + HTTP dispatch | Real health metrics | Low | Already real |

## High-Risk Findings (Pre-Fix)

### Gateway Tire B2B
- **Problem**: `process.env.GATEWAY_TIRE_USERNAME ? "connected" : "disconnected"` — never tested if credentials actually work
- **Fix**: Call `getGatewaySession()` which POSTs to `b2b.dktire.com/auth-signin` with a 5s timeout
- **Degraded path**: Falls back to curated catalog

### Twilio SMS
- **Problem**: `process.env.TWILIO_ACCOUNT_SID ? "connected" : "disconnected"` — wrong SID would still show "connected"
- **Fix**: Fetch `api.twilio.com/2010-04-01/Accounts/{SID}` to verify credentials
- **Degraded path**: SMS silently fails, logged for admin visibility

### Stripe Payments
- **Problem**: `process.env.STRIPE_SECRET_KEY ? "connected" : "disconnected"` — expired or invalid key still shows "connected"
- **Fix**: Call `stripe.balance.retrieve()` which validates the key with minimal cost
- **Degraded path**: Financing providers still available

### Auto Labor Guide
- **Problem**: `process.env.AUTO_LABOR_USERNAME ? "connected" : "disconnected"` — credential rotation would break silently
- **Fix**: Call `getShopDriverSession()` which POSTs to `autolaborexperts.com/api/auth/login` with a 5s timeout
- **Degraded path**: Built-in `LABOR_CATEGORIES` fallback DB with 7 categories

## Architecture Notes

- All health checks use `Promise.allSettled` — one vendor failure never crashes the report
- Each check has a 5-second timeout to prevent blocking the dashboard
- Health results include per-check latency for performance monitoring
- Results are cached 60 seconds to avoid hammering vendor APIs on every dashboard load
