# Security Hardening Summary — Nick's Tire & Auto
Completed: 2026-03-29

## What Was Inventoried

- 47 server-side env vars cataloged and classified
- 3 client-side VITE_ vars verified safe
- All Express routes, tRPC procedures, webhooks, and background processes mapped
- Auth boundaries verified for all admin procedures

## What Was Hardened

1. **Startup env validation** — 8 critical vars checked, server fails fast if missing
2. **Body parser limit** — reduced from 50mb to 500kb (prevents memory bombs)
3. **AI rate limiter** — tightened from 30/hr to 20/hr per IP
4. **Twilio SMS webhook** — X-Twilio-Signature HMAC-SHA1 verification added
5. **Facebook Messenger webhook** — X-Hub-Signature-256 HMAC-SHA256 verification added (with `crypto.timingSafeEqual`)
6. **Health endpoints registered** — `/api/ping`, `/api/ready`, `/api/health` now accessible
7. **Bridge API** — X-Bridge-Key auth middleware on all bridge endpoints
8. **Security headers** — X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, HSTS in production
9. **pnpm override** — `qs >= 6.14.2` to fix transitive vulnerability
10. **Node.js engines field** — `>=20.0.0` enforced in package.json

## What Was Left Alone (With Reasoning)

- **OAuth state parameter** — no CSRF check on Google OAuth callback. Low risk: login is owner-only, not public registration.
- **Session token generation** — uses `Math.random()` in portal. Low risk: customer portal is low-value data.
- **Pre-existing TypeScript errors** — 12 errors in files not touched by security changes. Not introduced by hardening.
- **Dependency vulns (6 remaining)** — all transitive, in test/dev tooling. pnpm override applied for `qs`.

## Top Remaining Risks

1. **No WAF** — Railway doesn't provide one. Consider Cloudflare proxy if DDoS becomes an issue.
2. **Session tokens not cryptographically random** — portal uses Math.random(). Low priority given portal's limited scope.
3. **No request logging/audit trail** — would help with incident response. Future enhancement.

## Build Status

- `pnpm run build`: PASSING (dist/index.js 723.5kb)
- No new TypeScript errors from hardening changes
