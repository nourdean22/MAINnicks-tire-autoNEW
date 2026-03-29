# Route Risk Matrix — Nick's Tire & Auto
Generated: 2026-03-29

## HIGH RISK — Public + Expensive or Unverified

| Route | Access | Rate Limited | Side Effects | Input Validated | Abuse Cost | Break Cost | Action |
|-------|--------|-------------|-------------|----------------|------------|------------|--------|
| `POST /api/sms-webhook` | Public | General only | SMS reply, DB write | Minimal | Medium (Twilio credits) | High (SMS bot) | Add Twilio sig verify |
| `POST /api/messenger-webhook` | Public | None | DB write, reply | Minimal | Low | Medium | Add FB HMAC verify |
| `chat.message` | Public | 30/hr AI limiter | OpenAI tokens | Minimal | High ($$$) | Medium | Tighten to 20/hr |
| `public.diagnose` | Public | 30/hr AI limiter | OpenAI tokens | Minimal | High | Low | Tighten to 20/hr |
| `public.askMechanic` | Public | 30/hr AI limiter | OpenAI tokens | Minimal | High | Low | Tighten to 20/hr |
| `public.aiSearch` | Public | 30/hr AI limiter | OpenAI tokens | Minimal | High | Low | Tighten to 20/hr |
| `laborEstimate.generate` | Public | 30/hr AI limiter | OpenAI tokens | Minimal | High | Low | Tighten to 20/hr |
| `booking.create` | Public | 10/hr form limiter | Sheets, SMS, DB | Partial | Medium | Very High | Add server validation |
| `lead.submit` | Public | 10/hr form limiter | Sheets, DB | Partial | Medium | Very High | Add server validation |
| `callback.submit` | Public | 10/hr form limiter | DB | Partial | Low | High | Add server validation |

## MEDIUM RISK

| Route | Access | Issue | Action |
|-------|--------|-------|--------|
| `GET /api/review-click/:token` | Public | Token not scoped — any string accepted | Acceptable: redirect is hardcoded to GBP URL, no open redirect |
| `booking.uploadPhoto` | Public | File upload with no auth | Low risk: no direct storage path exposed |
| `booking.statusByPhone` | Public | Phone number enumeration possible | Acceptable: low-value data |
| `GET /api/oauth/callback` | Public | No state param CSRF check | Low risk: login is owner-only |
| `/api/messenger-webhook` POST | Public | No HMAC verification | Add FB app secret HMAC check |

## LOW RISK — Admin Procedures
All admin procedures correctly use `adminProcedure` which enforces `role=admin` server-side.
Auth is checked in middleware, not just client-side routing. ✓

## BODY SIZE ISSUE
`express.json({ limit: "50mb" })` — WAY too large. Maximum realistic payload is ~100kb.
A 50MB JSON body can memory-bomb the server. **Fix: reduce to 500kb.**

## OPEN REDIRECT CHECK
`/api/review-click/:token` — redirects to hardcoded `GOOGLE_REVIEW_URL` constant from `shared/const.ts`.
No user-controlled redirect target. **No open redirect vulnerability.** ✓
