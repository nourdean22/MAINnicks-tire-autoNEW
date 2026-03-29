# Rate Limit Audit — Nick's Tire & Auto
Generated: 2026-03-29

## Current Rate Limiters

| Limiter | Window | Max Requests | Applied To |
|---------|--------|-------------|-----------|
| `apiLimiter` | 15 min | 100/IP | `/api/trpc` (all procedures) |
| `formLimiter` | 1 hour | 10/IP | `booking.create`, `lead.submit`, `callback.submit` |
| `aiLimiter` | 1 hour | 20/IP | `chat`, `public.diagnose`, `public.askMechanic`, `public.aiSearch`, `laborEstimate.generate` |

## Assessment vs Targets

| Route Type | Target | Actual | Status |
|-----------|--------|--------|--------|
| AI endpoints | 10-15/hr | 20/hr | ACCEPTABLE — tightened from 30 in commit `29634b0` |
| Form submissions | 5-10/hr | 10/hr | OK |
| SMS-triggering (booking.create) | 3-5/hr | 10/hr (form limiter) | ACCEPTABLE — booking also triggers Sheets write |
| Bridge endpoints | 30/min | No dedicated limiter | LOW RISK — auth-gated by X-Bridge-Key |
| Static/read-only | 60-100/min | 100/15min via apiLimiter | OK |

## Unprotected Routes

| Route | Rate Limited? | Risk |
|-------|-------------|------|
| `GET /api/health` | No | LOW — read-only, cheap |
| `GET /api/ping` | No | NONE — returns static response |
| `GET /api/ready` | No | LOW — single DB query |
| `GET /api/review-click/:token` | No | LOW — redirect + 1 DB write |
| Bridge endpoints | No dedicated | LOW — X-Bridge-Key auth required |
| `/sitemap.xml` | No | NONE — cached, read-only |
| `/robots.txt` | No | NONE — static text |

## Input Validation

- tRPC procedures use Zod schemas for input validation (enforced server-side)
- `booking.create`: validates name, phone, email (string), service, date, vehicle fields
- `lead.submit`: validates name, phone, email, message, source, urgencyScore
- `callback.submit`: validates name, phone, reason
- Max length limits handled by Zod `.max()` on string fields

## Recommendations

1. AI limiter could be tightened to 15/hr if OpenAI costs become a concern
2. Bridge endpoints don't need rate limiting — the shared secret already prevents abuse
3. Health endpoints are fine without limits — they're lightweight and useful for monitoring
