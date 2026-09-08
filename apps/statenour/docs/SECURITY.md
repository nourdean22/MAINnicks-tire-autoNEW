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
proxy.ts (was middleware.ts)
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

These bypass the session gate and must carry their own auth. **The list
below is a summary; the source of truth is `PUBLIC_PREFIXES` +
`PUBLIC_EXACT` in [`lib/security/route-policy.ts`](../lib/security/route-policy.ts),**
which carries a stated invariant per entry and is pinned by
`tests/security/route-policy.test.ts` + `middleware-boundary.test.ts`.

| Endpoint | Own auth (verified live 2026-09-07) |
|---|---|
| `/api/health` | **owner session** — was public until 2026-07-21 (it leaked the whole health payload); anonymous → 401 |
| `/api/system/health` | owner session (`{ auth: "owner" }`); anonymous → 401 |
| `/api/system/heartbeat` | none — `{ status, db_latency_ms }` only; Railway healthcheck + uptime monitors |
| `/api/version` | none — commit SHA / branch / configured-booleans only, no values |
| `/api/auth/*` | NextAuth internal |
| `/api/cron/*` | `CRON_SECRET` via `Authorization: Bearer` |
| `/api/sync/*`, `/api/devices/*`, `/api/nour-os/*` | `STATENOUR_SYNC_KEY` via `x-sync-key` (the nour-os `GET` is an unauthenticated query CATALOG, by design) |
| `/api/brain/*` | each handler runs `requireSession` or an extension bearer token — anonymous → 401 |
| `/api/telegram` | Telegram webhook secret header + chat_id check |
| `/api/webhooks/*` | provider-specific: Stripe signature (all `v1=` candidates, replay window), `x-make-secret`, `x-sync-key` |
| `/api/inngest` | Inngest signing key |
| `/api/actions/*`, `/api/mcp` | bridge bearer token; `/api/actions/openapi` is public (it advertises tool names + schemas to the Custom GPT importer — an accepted disclosure, revisit if the GPT is retired) |
| `/api/images/[id]` | **capability URL** (2026-09-07, D13) — `?exp=&sig=` HMAC (`lib/images/signed-url.ts`, secret `IMAGE_URL_SECRET` → `AUTH_SECRET`). Default `IMAGES_REQUIRE_SIGNATURE` unset: raw ids still serve (chat markdown, /content publish, Meta fetches) and a present-but-invalid signature is refused. Set the flag to `1` to refuse raw ids; every server-side minter goes through `imagePath()` and signs (7-day TTL). Flipping the flag is an operator Railway env edit. |
| `/api/short/<code>` | none — public redirector; logs a hashed-IP click |

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

**The CSP lives in exactly one place: `lib/security/csp.ts`, emitted by
`proxy.ts` (the Next 16 name for `middleware.ts`, renamed 2026-09-08; Node runtime) with a per-request nonce.** Static headers live in
`next.config.ts` `headers()`. Two CSP sources would make the browser
enforce their intersection and break the nonce model, so never add one to
`next.config.ts`. What production actually sends (read back 2026-09-07):

```
default-src  'self'
script-src   'self' 'nonce-<per-request>' 'strict-dynamic'
style-src    'self' 'unsafe-inline'
img-src      'self' data: blob: https:
font-src     'self' data:
connect-src  'self' https://*.openai.com https://*.anthropic.com
             https://api.vapi.ai https://ollama.com https://*.ollama.com
             http://localhost:11434 wss:
object-src      'none'
frame-ancestors 'none'
base-uri        'self'
form-action     'self'
```

- `script-src` is nonce + `'strict-dynamic'` in production — no
  `unsafe-inline`, no `unsafe-eval` (dev keeps both for HMR). Every page is
  `force-dynamic` so the nonce is fresh per render; a statically prerendered
  page would ship without one and render blank.
- `style-src 'unsafe-inline'` stays: Tailwind / styled-jsx inject `<style>`,
  and style injection is not a script-execution vector.
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` — clickjacking.
- `X-Content-Type-Options: nosniff` · `Referrer-Policy:
  strict-origin-when-cross-origin` · `X-XSS-Protection: 0` (legacy filter
  disabled on purpose).
- `Permissions-Policy: camera=(), microphone=(self), geolocation=()` —
  `microphone=(self)` is required by Talk-to-Nick voice mode.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (no
  `preload` — adding it is a one-way door for the whole domain).
- `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex` on every
  response (2026-09-07) plus `Disallow: /` in robots.txt — a private app is
  never indexable; auth is the access control, these only keep the sign-in
  URL out of indexes.
- `Cache-Control: no-store, no-cache, must-revalidate` on every `/api/*`.

**Verify, don't read:** `curl -sI https://bdnick.info/ | grep -i -E
'content-security|robots|strict-transport'`. The Vercel-era policy this
section used to describe (`unsafe-inline`, `unsafe-eval`, vercel.live,
Venice) has not been served since the 2026-06-21 hardening; this doc said
otherwise until 2026-09-07.

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

**Measured 2026-08-23.** Reproduce with
`grep -n audit-advisories .github/workflows/test.yml`.

The gate is **CI, not pre-push**, and it is `scripts/audit-advisories.mjs`, not `pnpm audit`.
Two steps in the `node` job of [`.github/workflows/test.yml`](../../../.github/workflows/test.yml):

| Step | Command | Blocking? |
|---|---|---|
| Dependency audit (high+) | `node scripts/audit-advisories.mjs --audit-level=high --advisory` | no — `continue-on-error: true` |
| Dependency audit (critical) | `node scripts/audit-advisories.mjs --audit-level=critical` | **yes**, and exits 2 if the scanner itself cannot run |

That second step's exit-2-on-broken-scanner is the important part: a scan that passes silently
when it is broken is indistinguishable from a clean scan. It is there because this gate already
rotted that way once (#760).

`dependency-review.yml` does **not** back this up and cannot — it needs a public repo or
GitHub Advanced Security, and is `continue-on-error`, so it reports a decorative green while
doing nothing. The CI job above is this repo's **only** dependency gate.

> **CORRECTED 2026-08-23 — the previous line was FALSE in three ways.** It read:
> *"`pnpm audit --audit-level=high` runs in `pre-push-check.sh` (once)."* There is no
> `pre-push-check.sh` anywhere in this repo; `pnpm audit` was removed because npm retired the
> endpoint it POSTs to and it returned 410 on 100% of PRs; and nothing dependency-related runs
> at push time — `lefthook.yml` `pre-push` runs exactly one command, `pnpm run build:affected`.
> Left on the record rather than silently swapped, because the sentence's damage was that it
> closed the question: a reader checking "are deps gated?" got a confident yes naming a file
> that does not exist.

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
4. **Pending-action approval UI — SHIPPED 2026-09-08 (#2195).** `/system/actions` lists the
   autonomous-action queue with a press-and-hold Approve and an expiry rule; the sink policy
   (#2198) parks external side effects from a turn that carries fetched content there as
   `require_owner` rows. The gap this item recorded is closed.
5. **CronJobLog token leakage risk.** Cron errors may include full
   URL fragments with secrets in path params. Audit scheduled for W13.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
