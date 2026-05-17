# Security · statenour-os

v11.0 · threat model + controls. Single-operator app — Nour only —
assumptions below reflect that.

---

## Threat model

**What we defend against:**
1. Random internet attackers hitting public endpoints.
2. Credential leak through git history or hot-loaded env files.
3. Nick acting beyond sanctioned scope (autonomous actions mis-firing).
4. Cross-origin request forgery into authenticated endpoints.
5. XSS from untrusted content (journal, chat, Drive ingest).

**What we explicitly do NOT defend against:**
1. Multi-tenant isolation — this is single-user by design.
2. Physical access to Nour's devices (the local agent has .ring_token).
3. Adversarial Nick inputs from Nour himself (trust boundary = Nour).

---

## Auth model

**NextAuth v5-beta.30 with Google OAuth provider + single allowlist email.**

```
middleware.ts
    │
    ├── public prefixes bypass:
    │     /api/auth, /api/webhooks, /api/telegram, /api/images,
    │     /api/cron, /api/sync, /api/health, /auth, /_next, /favicon
    │
    ├── other API paths → 401 if no valid session
    │
    └── other pages → redirect /auth/sign-in with ?callbackUrl
```

**auth.ts** enforces the allowlist:
```ts
async signIn({ user }) {
  return email === allowedEmail;
}
```

Session strategy: JWT (stateless, ~30d default). No session table.

**Dev bypass:** `LOCAL_DEV_BYPASS_AUTH=1` skips auth entirely. **NEVER
set in production.** Never include in `.env.example`'s default values.

### Session rotation

On secret rotation (`AUTH_SECRET`), every existing JWT is invalidated.
Nour will need to sign in again. Annual rotation recommended.

---

## Public endpoints (no auth)

These bypass `middleware.ts` and must carry their own auth:

| Endpoint | Own auth |
|---|---|
| `/api/health` | none (public health probe) |
| `/api/system/health` | none (uptime monitor target) |
| `/api/auth/*` | NextAuth internal |
| `/api/cron/*` | `CRON_SECRET` via `Authorization: Bearer` |
| `/api/sync/*` | `STATENOUR_SYNC_KEY` via header |
| `/api/telegram` | Telegram webhook secret header + chat_id check |
| `/api/webhooks/*` | provider-specific (Stripe signature, etc.) |
| `/api/images/*` | public, cached (no PII — generated images only) |

**Rule:** before moving a route into the public prefix list, confirm
that route has its own auth check. Never rely on obscurity.

---

## Secrets

### Where they live
- `.env.local` — dev machine only, **gitignored**.
- Vercel project env → production + preview.
- `local-agent/.env` — Windows machine, **gitignored**.

### What's in the wild vs what must rotate

**Low-risk** (rotate only on compromise):
- `VENICE_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`
  — spend is bounded by the provider's own limits.

**Medium-risk** (rotate quarterly):
- `RESEND_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TWILIO_AUTH_TOKEN`,
  `STRIPE_SECRET_KEY` — can cost money or send mis-targeted messages.

**High-risk** (rotate on any suspected leak + quarterly):
- `AUTH_SECRET` — JWT forgery possible if leaked.
- `AUTH_GOOGLE_CLIENT_SECRET` — impersonation possible.
- `CRON_SECRET` — cron manipulation.
- `STATENOUR_SYNC_KEY` — bridge impersonation.
- `DATABASE_URL` — full DB access.

### Rotation procedure

Full procedure: [`docs/RUNBOOK.md`](RUNBOOK.md#auth--secret-rotation).

### Git history audit

```bash
# Any file that SHOULDN'T have been committed but was?
git log --all --full-history --source -- .env
git log --all --full-history --source -- local-agent/.env
git log --all --full-history --source -- local-agent/.ring_token
```

All three return empty on 2026-04-21 audit. `.gitignore` now covers
all three paths (v11.0).

---

## CSP + headers

Configured in `next.config.ts`. Applied to every response.

```
default-src  'self'
script-src   'self' 'unsafe-inline' 'unsafe-eval'
             https://vercel.live https://va.vercel-scripts.com
style-src    'self' 'unsafe-inline'
img-src      'self' data: blob: https:
font-src     'self' data:
connect-src  'self' https://vercel.live
             https://vitals.vercel-insights.com
             https://*.openai.com https://*.anthropic.com
             https://api.venice.ai wss:
frame-ancestors 'none'
base-uri        'self'
form-action     'self'
```

- `frame-ancestors 'none'` — clickjacking protection.
- `X-Frame-Options: DENY` — belt & suspenders.
- `X-Content-Type-Options: nosniff` — MIME confusion protection.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` — default off.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — HSTS.
- `Cache-Control: no-store, no-cache, must-revalidate` on every `/api/*`.

**Why `unsafe-inline` + `unsafe-eval`?** Vercel Analytics + Next.js
hydration scripts require inline blobs. Removing them breaks analytics
+ client hydration. Tradeoff: personal OS, one user, acceptable.

---

## Rate limiting

`lib/rate-limit.ts` provides a sliding-window limiter backed by Redis
when available, falling back to an in-memory Map. Currently applied
to:
- `/api/ai/chat/prefetch` — per-session rate limit (prevents typing-
  driven fan-out from blowing the AI budget).
- `/api/ai/chat/lane-check/feedback` — prevent feedback spam.

**Not yet applied (W13.5 target):**
- `/api/ai/chat` main stream
- `/api/webhooks/*`
- `/api/telegram`

Telegram + webhooks have own idempotency via signature verification,
but aggressive rate limiting is still missing.

---

## Autonomous action scope

Nick can write, but only through declared tools. See `lib/ai/tools.ts`
(W6 split incoming). Every tool call:
1. Goes through `executeActions()` in `lib/ai/nick-agent.ts`.
2. Logs to `AutonomousAction` (audit trail, `/system/actions`).
3. Is bounded by `lib/ai/budget.ts` cost limits.

**Approval model:**
- `approval: "auto"` — executes immediately. Used for read-only tools + low-risk writes (create task, write brain memory).
- `approval: "pending"` — requires Nour to approve. Used for destructive writes, external sends, payments. **UI for approvals comes in W11.**
- `approval: "approved"` / `"rejected"` — terminal states.

**Blast-radius limits:** no tool can execute shell commands, rm
anything, or mutate deployment config. The tool set is whitelist-only.

---

## Bridge to nickstire

Cross-ring sync via `/api/sync/*` endpoints:
- Inbound (nickstire → statenour): every 4h cron-worker push.
- Outbound (statenour → nickstire): Nick tools that query business
  state (customer lookup, revenue pace).

Auth: `STATENOUR_SYNC_KEY` in `Authorization: Bearer` header.

**Trust boundary:** statenour trusts nickstire as authoritative for
business data. Nickstire trusts statenour for personal context.
Neither side exposes the other's data publicly.

---

## Content sanitization

User-generated content flows through:
- **Chat input** → streamed back through `output-sanitizer.ts` + rendered
  via `streamdown` (markdown) with strict allow-list.
- **Journal entry** → plain text, stored raw, rendered with escape.
- **Drive ingest** → parsed, HTML stripped, text only.
- **Gmail ingest** → parsed, HTML stripped, text only.

Nick output is also sanitized — no raw HTML injection path from Nick's
responses to the UI.

---

## Logging

- **PII filtering:** no — everything that's logged is Nour's. No 3rd
  parties. Phone numbers / emails may appear in logs; acceptable.
- **Secret filtering:** `lib/utils/logger.ts` redacts known-secret
  patterns (Bearer tokens, API-key-shaped strings) from error context
  before writing to `ErrorLog`.
- **Retention:** see [`DATA-MODEL.md`](DATA-MODEL.md#retention-policy).

---

## Dependency security

- `pnpm audit --audit-level=high` runs in `pre-push-check.sh` (once).
- No automated Dependabot yet (W13 todo).
- `patches/` contains `ai@6.0.162.patch` — upstream bug workaround.
  Re-evaluate when upgrading `ai` SDK.

---

## Known gaps (tracked in UPGRADE-PLAN.md)

1. **NextAuth v5 still on beta.30.** Upgrade target: W1.1 scheduled.
2. **Three Google OAuth env naming schemes coexist** (`AUTH_GOOGLE_*`
   primary, `GOOGLE_OAUTH_*` + `GOOGLE_*` as fallbacks in
   `lib/services/google-oauth.ts`). Consolidation pending.
3. **Rate limit coverage is thin.** `/api/ai/chat` + webhooks +
   Telegram should have active limits.
4. **Pending-action approval UI missing.** Currently
   `approval: "pending"` rows sit in `AutonomousAction` with no UI to
   resolve them — Nick's autonomous path can't exercise sensitive
   tools. Scheduled for W11.
5. **CronJobLog token leakage risk.** Cron errors may include full
   URL fragments with secrets in path params. Audit scheduled for W13.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
