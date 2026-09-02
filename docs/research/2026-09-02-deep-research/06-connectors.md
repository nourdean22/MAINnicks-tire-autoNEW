# StateNour Connector/Integration Matrix
Snapshot: git archive of origin/main @ abdd99395 (prod deploy 2026-09-02 13:23Z)
Auditor stance: READ-ONLY. Evidence classes: A=verified code, H=inference, I=not verified, D=doc-dated live probe.

STANCE: read-only audit, no writes/installs/network beyond local grep. Corpus for absence claims: `apps/statenour/{lib,app,config,prisma}` via case-insensitive grep unless noted; positive control run alongside each absence claim (a known-present term found via the same command).

## 1. Google OAuth (google-data) end-to-end — `/api/oauth/google-data/*`

**Flow:** `start` (mints CSRF, session-gated) -> Google consent -> `callback` (timing-safe state check, exchanges code) -> `status` (health probe).

- `start`: session-gated via global middleware (see below); mints 32-byte CSPRNG `state=<csrf>:<accountKey>`, stored in HttpOnly/Secure(prod)/SameSite=Lax cookie `__oauth_state`, path-scoped to `/api/oauth/google-data`, 10min TTL. — class A: `app/api/oauth/google-data/start/route.ts:57-67`
- `callback`: validates `state` against cookie with `timingSafeEqual` (length-checked first to avoid throw-on-mismatch-length), cookie deleted before exchange (single-use). — class A: `app/api/oauth/google-data/callback/route.ts:63-81`
- Scopes requested (exact list): `openid, email, profile, gmail.readonly, gmail.compose, calendar.readonly, calendar, drive.readonly` — class A: `lib/services/google-oauth.ts:27-36`. Note: `gmail.compose` and full `calendar` (write) are broader than "ingestion" — this is drafting/write-capable, not read-only.
- **Route-policy check:** `/api/oauth` is NOT in `PUBLIC_PREFIXES`/`PUBLIC_EXACT` (`lib/security/route-policy.ts`) so it also inherits the global NextAuth session gate in `middleware.ts:87` (401 JSON for API paths without `req.auth.user.email`). `status`/`start` route files carry no additional per-route auth call beyond `start`'s explicit `requireSession(req)` — coverage is middleware-only for `status`/`callback`, which is fine as a second layer but means the route file alone would be unauthenticated if middleware policy ever changed.

### FINDING (class A, HIGH severity) — OAuth tokens stored in plaintext and leaked via a management API
- Refresh token + access token + expiry + email are stored **unencrypted** in `Integration.config` (Json column) — `lib/services/google-oauth.ts:236-264` (`exchangeCodeForToken`) and `:377-393` (refresh path). No encrypt/decrypt call anywhere in this file or its callers (grepped `encrypt` across `lib/services` and `lib/crypto*` — see §11 SSRF/crypto scan below).
- `GET /api/integrations` (`app/api/integrations/route.ts:16-21`) is `auth:"owner"` gated but calls `paginate(prisma.integration, pagination, { orderBy: { name: "asc" } })` with **no `select`** — `lib/db/query-helpers.ts:33-37` passes `queryArgs` straight into `findMany`, so every column including `config` is serialized to the HTTP response. For any `google_oauth*` row this ships the live refresh token + access token to the browser on every list-load.
- Contrast: `lib/services/system-pages.ts:166-168` (the `/system` dashboard's integration panel) DOES scope with `select: { name, status, lastSyncAt, enabled }` — proving the team knows how to redact, but did it in one reader and not the other. No consumer of the raw `GET /api/integrations` route was found in `components/` or `app/` (grepped for the literal path) — it may be dead/admin-only-via-curl today, which lowers but does not remove the exposure (still owner-auth-bypassable via any owner-session XSS, and the token sits in plaintext in Prisma Studio / any DB export / `ApiRequestLog` if response bodies are ever logged — see §10).
- `POST /api/integrations/[name]/test` (`app/api/integrations/[name]/test/route.ts`) does NOT leak config in its response — good.

### Google OAuth token refresh / revocation
- 401/`invalid_grant` handling: on refresh failure, row is marked `status:"failed"`, `consecutiveFailures` incremented — `lib/services/google-oauth.ts:356-366`. A heuristic even estimates "exactly 7 days" token life as a signal the GCP OAuth consent screen is stuck in Testing mode (`:347-354`) — class A, notable operational self-diagnosis.
- **No upstream revoke call on disconnect** — grepped for a `revoke` call to `oauth2.googleapis.com/revoke`; none found in `lib/services/google-oauth.ts` or elsewhere (see §11). There is no "disconnect" route at all — only re-grant (`/start`) overwrites the stored token; the old token is never explicitly revoked at Google, only orphaned in the DB (overwritten) or Google-side revoked manually by the operator via myaccount.google.com.
- Multi-account: `google_oauth` (legacy/primary) + `google_oauth_<key>` rows, iterated by `listConfiguredAccounts()` — `lib/services/google-oauth.ts:70-100`.

## 2. Webhook signature verification — quoted, per provider

All webhook routes live under `/api/webhooks/*`, `/api/telegram/*`, `/api/inngest` — all in `PUBLIC_PREFIXES` (`lib/security/route-policy.ts:20-35`), i.e. exempt from the NextAuth session gate by design, each running its OWN auth. Shared constant-time helper `safeEqual()` / local clones of it are used everywhere (`lib/auth-guard.ts:31-39`).

| Provider | Mechanism | Fail-closed when secret unset? | Constant-time? | Evidence |
|---|---|---|---|---|
| **Stripe** | Custom HMAC-SHA256 re-implementation of Stripe's `t=...,v1=...` scheme (`createHmac("sha256", secret).update(`${t}.${payload}`)`), NOT the official `stripe` SDK | YES — 503 "Webhook not configured" if `STRIPE_WEBHOOK_SECRET` unset (explicitly fixed per in-code note, "forensic-audit MEDIUM") | YES — `timingSafeEqual`, length-checked first | `app/api/webhooks/stripe/route.ts:16-41,54-68` |
| **Make.com** | Static shared secret, header `x-make-secret` OR `authorization: Bearer <secret>` (NOT an HMAC of the body — a bearer-style compare) | YES — 503 if `MAKE_WEBHOOK_SECRET` unset | YES — `timingSafeEqual`, self-compare on length mismatch to avoid short-circuit timing leak | `app/api/webhooks/make/route.ts:23-49` |
| **nickstire bridge** | `requireSyncAuth()` — `x-sync-key` header or `Bearer` compared to `STATENOUR_SYNC_KEY` | YES — `requireSyncAuth` throws 401 if `SYNC_KEY` falsy (`lib/auth-guard.ts:56-62`) | YES | `app/api/webhooks/nickstire/route.ts:77-85`, `lib/auth-guard.ts:55-62` |
| **inbound-crm** | `x-sync-key` header (legacy `?secret=` query still accepted, logged as deprecated) vs `STATENOUR_SYNC_KEY \|\| BRIDGE_API_KEY` | YES — 503 if neither env set | YES (`safeEqual`) | `app/api/webhooks/inbound-crm/route.ts:18-42` |
| **Telegram** | `X-Telegram-Bot-Api-Secret-Token` header vs `TELEGRAM_WEBHOOK_SECRET`, plus a second-layer numeric `from.id === TELEGRAM_OWNER_ID` check on callback/message handling | YES — 503 `ENV_MISSING` if secret unset (moved out of module-load specifically to avoid a build-time throw — v8.21→v8.33 history in comments) | YES (`safeSecretEqual`, local clone of the same pattern) | `app/api/telegram/webhook/route.ts:56-119` |
| **Inngest** | Delegated entirely to the `inngest/next` `serve()` SDK using `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` — **NONE FOUND in-repo**, no custom verification code to quote | SDK-dependent; GET is wrapped to return a clear 503 "not configured" instead of the SDK's raw 500 when keys are absent (`isInngestFullyConfigured()`) — POST/PUT go straight to the SDK handler with no repo-side fallback check | N/A (library) | `app/api/inngest/route.ts:35-70`, `lib/inngest/client.ts` |

Env var names used by these guards that are **absent from `lib/env.ts` ENV_SPEC`** (the documented "single source of truth"): `MAKE_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_ID`, `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` (these two ARE present, runtime tier). `MAKE_WEBHOOK_SECRET` and `TELEGRAM_WEBHOOK_SECRET`/`TELEGRAM_OWNER_ID` are class A confirmed absent from `ENV_SPEC` array (`lib/env.ts:44-136`, grepped) — a `pnpm check:env` pass gives no visibility into whether these auth-critical secrets are configured; only the route's own runtime 503 reveals it.

## 3. SSRF defense — `assertPublicUrl()` coverage

Defined `lib/utils/url-safety.ts:106-172` — resolves DNS, rejects private/loopback/link-local IPv4+IPv6, CGNAT, a hostname deny-list (`localhost`, `metadata.google.internal`, `metadata.goog`, `instance-data`) and deny-suffixes (`.internal`, `.local`, `.localdomain`, `.vercel.internal`); rejects non-http(s) schemes. Callers must manually walk redirects (`redirect:"manual"`, re-check each `Location`) — the function itself does not follow redirects.

**Covered (class A, calls `assertPublicUrl` before fetching):**
- `lib/ai/tools/system.ts:313-337` — generic document-URL ingestion tool (`ingestDocumentFromUrl`), 5-hop manual redirect walk re-checked at every hop, closes the CVSS-8.6 finding referenced in the file header.
- `lib/ai/tools/system.ts:1225-1234` — `scrapeWebPage` tool, gates the URL immediately before calling Firecrawl's `scrapeUrl()`.
- `app/api/telegram/webhook/route.ts` — also imports/calls it (third caller, for a Telegram-triggered fetch path).

**NOT covered (class A, verified absent) — same `scrapeUrl()` sink, no gate at the call site:**
- `lib/ai/deep-research.ts:297` — scrapes up to 3 citation URLs harvested from live Tavily/Perplexity search results. This is the most realistic exposure of the four: citation URLs come from external search results (semi-adversarial), reachable indirectly from a user chat query, and nothing stops a resolved-private-IP citation from being scraped.
- `lib/intelligence/ingest.ts:196` — scrapes `source.url` from `ResearchSource`-type DB rows.
- `lib/intelligence/change-detection.ts:90` — scrapes `WATCHED_PAGES` (operator-curated static list by default).
- `lib/intelligence/connectors/competitor-watch.ts:42` — scrapes 2 hardcoded competitor URLs (`WATCH_TARGETS`, not attacker-reachable).
- Note `lib/integrations/firecrawl.ts` itself (the shared `scrapeUrl()` implementation, `:56-97`) has **no internal SSRF gate at all** — every guarantee comes from callers remembering to gate first; 2 of 5 call sites do, 3 do not. Since Firecrawl performs the actual HTTP fetch on Firecrawl's own cloud infrastructure (not this server), the blast radius of the ungated paths is "probe Firecrawl's network / fetch attacker-chosen URLs under this app's Firecrawl quota," not classic same-host SSRF — still worth gating for defense-in-depth and quota-abuse reasons.

**Different risk class, not SSRF-gated by design:** `lib/integrations/stagehand.ts:362` (`page.goto(opts.url, ...)`) drives a remote Browserbase cloud browser — no `assertPublicUrl` call, but navigation happens on Browserbase's infrastructure, not this app's network, so the classic private-IP-fetch threat model doesn't directly apply. The tool catalog already tags all `browser_*`/`browseAndDo` tools `riskClass: "high"` (`lib/ai/tools/catalog.ts:311-316`), suggesting the team is aware and is treating it as a different (agentic side-effect) risk category rather than SSRF.

## 4. Langfuse + Sentry (LIVE per #2073/#2074) — detail

### Langfuse
- **Destination confirmed, class D**: `docs/integrations/langfuse-observability.md:53,57-59,69` (dated 2026-09-02, same day as the snapshot) — "**Selected: Cloud Hobby, US region**" — `LANGFUSE_BASE_URL=https://us.cloud.langfuse.com`. Code default if unset is the generic `https://cloud.langfuse.com` SDK default (`lib/observability/langfuse.ts:255`), but the operator-set value on Railway is documented as the US regional endpoint, not self-hosted.
- **Doc's own live-probe target is commit `3e387b5`** (Railway deployment `bc0a81be-491d-4d88-99de-87a0ffa3d23a`) — the snapshot HEAD is `abdd99395`, a different (likely later, same-day) commit. Treat the wiring/config as LIVE (unchanged files) but note the probe was not re-run at the exact snapshot SHA.
- **Precise LIVE claim, self-qualified by the doc**: boot-init succeeded and an authenticated Langfuse API check succeeded, but returned **zero traces at check time** — "a trace landing receipt still requires triggering a non-private model call and reading it back" (`docs/integrations/langfuse-observability.md:79-83`). So: config+pipeline = class D LIVE; an actual trace-with-content confirmed in Langfuse = **NOT yet verified even in the doc** — classify that specific claim PARTIAL, not LIVE.
- **Data egress — prompt + completion content, by design**: 22 AI SDK call sites route through `langfuseTelemetry()` (enumerated in the doc, incl. `nick-chat`, `telegram-ask`, `daily-executive-brief`, `intelligence-brief`, `weekly-review`) and export gen_ai spans (prompt+completion) to Langfuse Cloud for every turn EXCEPT `privateMode` turns, gated by `isLangfuseTelemetryEnabled(privateMode)` (`lib/observability/langfuse.ts:88-90`). This is a genuine, intentional data-egress path for conversational content (which can include operator email/journal excerpts pulled into chat context) to a third-party US-region SaaS — mitigated only by (a) the private-mode opt-out per turn and (b) a narrow regex mask.
- **Masking, class A, real but narrow**: `maskLangfuseData()` (`lib/observability/langfuse.ts:179-182`) redacts only `sk-*`/`pk-*` prefixed keys and `Bearer <token>` strings from exported span data — `const SECRET_RE = /\b(?:sk|pk)-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g`. It does NOT scrub free-form PII (names, emails, phone numbers, journal content) — by the doc's own framing this is "belt-and-braces on top of the private-mode gate," i.e. content-shape privacy is delegated entirely to the private-mode flag being set correctly by every call site that handles sensitive content — not independently verified in this audit (would require checking `privateMode` at all 22 sites, e.g. inbound-crm/journal paths — NOT VERIFIED, out of time budget).
- Retention: Langfuse Cloud Hobby tier — 30-day retention, 50k units/mo free (doc line 53).

### Sentry
- `sendDefaultPii: false`, `tracesSampleRate: 0` in all three init files (`sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`) — no distributed tracing exported, no default PII (IP, user) attached.
- DSN resolution hardened against placeholder values (`lib/observability/sentry.ts:1-16`) — rejects `<...>`, `YOUR`, `CHANGE_ME`, `REPLACE_ME`, `example.com`, requires a URL with a username (the Sentry DSN public key) and a project-id path.
- **No `beforeSend`/`beforeBreadcrumb` scrub hook in any of the 3 config files** — grepped, none present. Default SDK breadcrumb integrations (console/http/fetch capture) are not explicitly disabled, so a `console.error`/`console.warn` call or an outgoing fetch URL containing a token in a query string would ride along as a breadcrumb on the next captured exception — the only backstop is `sendDefaultPii:false` (which governs IP/user auto-attach, not breadcrumb content) and whatever discipline call sites use when logging (see §10 credential-in-logs).
- **Doc's own caveat**: "Both DSN variables are configured on Railway. This proves configuration and deployment, not that an event has been emitted; no synthetic Sentry event was created as part of this rollout" (`docs/integrations/langfuse-observability.md:97-99`) — class D for "configured", explicitly NOT verified for "captures a real event."
- `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` are **absent from `lib/env.ts` ENV_SPEC`** — `pnpm check:env` gives no visibility into Sentry configuration state.

## 5. Device fleet ("Home reports 20 devices offline") — identified, DEAD not retired

- **Fleet composition**: `SmartDevice` Prisma model (`prisma/schema.prisma:1323-1346`), platforms `TUYA` (8 seeded — shop plugs/switches), `V380` (3 seeded — shop cameras), plus `RING`, `EUFY`, `GOOGLE_HOME`, `MANUAL` as valid enum-string values. Control/ingest is an **external Windows Python agent** at `local-agent/` (not a Next.js route) — `agent.py`, `tuya_agent.py`, `ring_agent.py`, `eufy_agent.py`, `v380_agent.py`, `health_server.py` — which pushes state to statenour over `/api/devices` (own `x-sync-key` auth, exempt from the session gate — `lib/security/route-policy.ts:53`).
- **Root cause, class A (in-code) + class D (dated postmortem)**: `app/api/devices/retire-stale/route.ts:8` — "Backstory: Apr 14 — local-agent died. 20/21 devices went offline. They've been showing as red rows on /system/devices ever since." Corroborated in `docs/RECONCILIATION.md:727` ("20 of 22 devices OFFLINE since April") and `docs/RECONCILIATION.md:2537` ("M2 ... Real device control runs through an EXTERNAL Python `local-agent/` that DIED Apr 14 ... cameras have NO pixel pipeline (`snapshotUrl` always null; V380s P2P/no-RTSP). Operator chose SKIP (needs their hardware). Wire-vs-delete = open.").
- **Status: DEAD, NOT retired.** No decision to decommission the feature — `AutomationRule`/`SmartDevice`/`DeviceCommand` remain live schema, used by 15+ files per the RECONCILIATION note, and a cleanup tool exists (`POST /api/devices/retire-stale`, owner-auth, deletes stale rows — `app/api/devices/retire-stale/route.ts:24-63`) but per the task's live observation ("20 devices offline" still showing) it has evidently not been run, or the agent produces new stale rows faster than cleanup. This is a hardware-dependent fix the operator explicitly deferred ("chose SKIP").
- **Alert-noise sub-finding, fixed**: `docs/RECONCILIATION.md#1899` — the automation-engine executor used to be level-triggered, so the stale-offline fact re-fired ~24 alert messages/day about a 4-month-old condition; fixed to edge-triggering (fires once per state change) in the same wave — the underlying offline fact is still true, only the alert spam was resolved.
- **Camera pipeline**: V380 cameras have no pixel/video pipeline into the app (`snapshotUrl` always null; V380 protocol is P2P, not RTSP) — camera-bridge (mentioned in root AGENTS.md as a vendored, non-workspace component) is out of `apps/statenour/` and not present in this snapshot.
- Classification: **DEAD** (device online/offline signal), **RETIRED-BUT-PRESENT** would be wrong — nothing was formally retired, it silently rotted.

## 6. Credentials/tokens in logs — two parallel systems, only one redacts

- **`lib/logger.ts` (structured `log.info/warn/error`)**: has `redactSensitive()` (`lib/logger.ts:29-50`) — a KEY-NAME allowlist-of-badness (`SENSITIVE_KEYS`: password, token, secret, key, authorization, cookie, x-sync-key, bearer, api_key, apikey, phone, email, ssn, creditcard, fullname, address, dob, etc. — `lib/logger.ts:20-27`) applied recursively (depth-capped at 3, deeper objects collapse to `"[REDACTED_SUBTREE]"`). This only catches secrets stored under a matching KEY NAME — a secret embedded inside a free-text string value (e.g. an upstream error message that happens to echo back a token) passes through untouched.
- **`lib/utils/error-log.ts` `logError()` (writes `ErrorLog.context`, a raw Postgres `Json` column, `prisma/schema.prisma:2246-2257`) has NO redaction call at all** — `context: extra ? ({ source, ...extra }) : ({ source })` (`lib/utils/error-log.ts:33`) persists the caller's `extra` object verbatim, unfiltered. `message` is truncated to 500 chars, `stack` to 4000, but neither is scrubbed for secret-shaped substrings. 107 call sites repo-wide (grepped). Spot-checked call sites are currently disciplined (pass labels/ids like `{ fn: "archiveGoal.undoToken" }`, `{ tokenRow: row.id }`, never a raw token — `lib/services/undo-token.ts:147`, `lib/services/google-oauth.ts:231` deliberately logs a synthetic error instead of the real `SyntaxError` specifically to avoid leaking JWT payload fragments) — so no active leak was found in this pass, but the finding is structural: **there is no backstop** comparable to `redactSensitive()` on this path; safety depends entirely on every future caller remembering not to pass secrets, not on the framework.
- **`ApiRequestLog`** (`prisma/schema.prisma:1448-1463`) stores only `method, path, statusCode, durationMs, requestId, userAgent(≤200c), error(≤500c)` — confirmed **no request/response body field exists in the model or the two writer call sites** (`lib/utils/http.ts:243-246,306-309`) — this table cannot leak webhook/API payload secrets by construction.
- **Langfuse breadcrumb-equivalent**: `maskLangfuseData()` (§4 above) is content-pattern-based (regex for `sk-`/`pk-`/`Bearer `), the opposite strategy from `lib/logger.ts`'s key-name approach — the two redaction layers in this codebase use inconsistent strategies and neither covers the other's blind spot (a secret in a free-text value logged via `logger.ts`; a secret under an unexpected key name exported to Langfuse would still be masked only if it happens to match the sk-/pk-/Bearer shape).
- **Sentry breadcrumbs**: no `beforeBreadcrumb` scrub configured (§4) — same class of gap as `logError`.
- No console.log/error call was found printing a raw secret VALUE in the sampled files (`google-oauth.ts`, webhook routes, `provider.ts`) — all consistently log `.message.slice(0,200)` or structured reason codes, not raw response bodies from token endpoints.

## 7. Integration model — writers and readers (complete enumeration)

`Integration` (`prisma/schema.prisma:1423-1446`): `id, name(unique), type, enabled, status, lastSyncAt, nextSyncAt, config(Json), healthCheckUrl, errorCount, consecutiveFailures, metadata(Json), createdAt, updatedAt`. No token-specific columns — all provider state (including the Google OAuth plaintext tokens, §1) is shoehorned into the generic `config`/`metadata` Json blobs. Every `prisma.integration.*` call site in the app (grepped exhaustively, class A):

| Call | File:line | Op |
|---|---|---|
| `upsert` | `lib/services/google-oauth.ts:247` | Write Google OAuth token on grant |
| `findUnique` | `lib/services/google-oauth.ts:429` | Read for `probeGoogleOauthConfigured` |
| `findUnique` | `lib/services/google-oauth.ts:515` | Read for `getGoogleOauthStatus` |
| `update` (2x) | `lib/services/google-oauth.ts:356,378` | Mark failed / healthy on refresh attempt |
| `findMany` (select-scoped) | `lib/services/system-pages.ts:166-168` | `/system` dashboard panel — name/status/lastSyncAt/enabled only, safe |
| `create` | `app/api/integrations/route.ts:28` | `POST /api/integrations` — owner-auth, manual row registration |
| `findMany` (no select — **leaks `config`**) | `app/api/integrations/route.ts:18` | `GET /api/integrations` — see §1 finding |
| `findUnique` + `update` | `app/api/integrations/[name]/test/route.ts:125,159` | `POST .../test` — connection probe, does not leak config in response |

No other reader/writer exists (no cron, no other route, no other lib file touches `prisma.integration`). This means every non-Google integration (Telegram, Stripe, Resend, etc.) that has an `Integration` row (if any exist beyond what `seed.ts` creates) is **status/health metadata only** — actual credentials for those live purely in process env vars, never in this table. Google OAuth is the only integration whose live secret material transits this table.

## 8. Env var inventory — `scripts/check-env.ts` / `lib/env.ts` ENV_SPEC (the documented "single source of truth"), grouped by provider

`scripts/check-env.ts` validates exactly the `ENV_SPEC` array in `lib/env.ts:44-136` (44 entries). Tiers: **required** (boot fails), **runtime** (feature degrades silently), **platform** (auto-set, never hand-configured).

| Provider/area | Vars (tier) | Silent no-op when unset? |
|---|---|---|
| Neon Postgres | `DATABASE_URL` (required), `DIRECT_URL` (required) | No — boot fails (`lib/env.ts:47-48`) |
| NextAuth / Google sign-in | `AUTH_SECRET`, `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET`, `AUTH_ALLOWED_EMAIL` (all required-in-prod, `when: prod`) | In prod: no — `middleware.ts:69-84` fail-closed 500 "SYSTEM LOCKED". In dev: yes, falls back to mock operator (`lib/auth-guard.ts:75-77`) |
| Cron / bridge auth | `CRON_SECRET`, `STATENOUR_SYNC_KEY` (required-in-prod) | No — `requireCronAuth`/`requireSyncAuth` 401 fail-closed regardless of env-spec tier (`lib/auth-guard.ts:47-62`) |
| AI providers (>=1 required, group-validated) | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`(alias `GOOGLE_GENERATIVE_AI_API_KEY`), `XAI_API_KEY` (all runtime) | Yes per-key; but `assertEnvOrDie` fails boot if the WHOLE group + `OLLAMA_API_KEY` is empty (`lib/env.ts:143-146` — note `OLLAMA_API_KEY` is checked in `atLeastOneAiProvider` logic but has **no ENV_SPEC entry of its own**, class A gap) |
| Resend | `RESEND_API_KEY` (runtime) | Yes — `lib/services/email.ts:6-7` conditionally constructs the client, silent no-op otherwise |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (runtime, both listed) — **`TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_OWNER_ID` are used by the webhook route but ABSENT from ENV_SPEC** (class A gap) | Bot token/chat id: yes, silent degrade. Webhook secret: NO — route fails closed 503 (`app/api/telegram/webhook/route.ts:97-104`) but `pnpm check:env` can't see it |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (runtime) | Yes, silent degrade |
| nickstire bridge | `BRIDGE_API_KEY` (runtime) | Yes for reads; inbound-crm falls back to `STATENOUR_SYNC_KEY` if unset |
| Redis | `REDIS_URL` (runtime) | Yes — `getRedis()` returns `null`, falls back to in-memory L1 (`lib/utils/redis.ts:26-29`) |
| Web push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (runtime) | Yes, silent degrade (not independently verified this session) |
| Google Places / GBP reviews | `GOOGLE_PLACES_API_KEY`, `GOOGLE_PLACE_ID` (both runtime — comment at `lib/env.ts:78-86` documents the exact prior incident: the review-ingest cron hard-failed 64x on prod because `GOOGLE_PLACE_ID` was missing from the spec) | Now both spec'd; still silent-degrade tier (not required) by design so a missing review feed never blocks boot |
| Weather | `OPENWEATHER_API_KEY` (runtime) | Yes |
| Contact enrichment | `APOLLO_API_KEY` (runtime) | Yes |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (runtime) | Payments route degrades; **webhook fails CLOSED (503) if secret unset**, does not "silently no-op" (`app/api/webhooks/stripe/route.ts:59-68`) |
| Public origin | `NEXT_PUBLIC_APP_URL` (runtime) | Falls back to `NEXT_PUBLIC_SITE_URL` then hardcoded `https://bdnick.info` (`lib/env.ts:189-191`) |
| Provider pin / dev bypass | `AI_PROVIDER`, `LOCAL_DEV_BYPASS_AUTH` (runtime) | n/a — operational flags |
| Braintrust (dead) | `BRAINTRUST_API_KEY`, `BRAINTRUST_PROJECT_NAME` (runtime) — **spec'd but explicitly annotated "UNUSED by the app since 2026-08-25 ... zero callers ever"** (`lib/env.ts:107-108`) | n/a — dead code path kept only for manual eval-dataset scripts |
| Inngest | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (runtime) | Yes — GET wrapped to a clear 503 "not configured"; POST/PUT go straight to the SDK (§2) |
| Misc ops | `APP_BASE_URL`, `BUILD_TIME`, `DAILY_AI_BUDGET_CENTS`, `DEBUG_SQL`, `NARRATOR_LLM_SYNTHESIS`, `NICK_PRIME_PROMPT`, `OPERATOR_EMAIL`, `GEMINI_MODEL`, `ALLOW_PROD_WRITES`, `CONFIRM_PROD`, `POLICY_GATE_HARD`, `POLICY_GATE_SOFT`, `PRE_PUSH_SKIP` (all runtime) | Yes, all silent-degrade / operational toggles |
| Platform (never hand-set) | `NODE_ENV`, `VERCEL`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA` | n/a — note these are Vercel-native names on a Railway-deployed app; `getDeployMeta()` (per root AGENTS.md) is documented elsewhere as Railway-first, so these platform entries may themselves be vestigial from a pre-Railway era (NOT independently verified this session) |

### Vars used in code but ABSENT from `ENV_SPEC` (class A, silent gaps in "the" env spec) — non-exhaustive, found opportunistically
`OLLAMA_API_KEY`, `OLLAMA_BASE_URL`, `OPENROUTER_API_KEY`, `FIRECRAWL_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `PERPLEXITY_API_KEY` (used per catalog only, not directly confirmed this pass), `GITHUB_TOKEN`, `E2B_API_KEY`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `VAPI_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT`, `LANGFUSE_RELEASE`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `OBSIDIAN_VAULT_PATH`, `OBSIDIAN_REST_URL`, `OBSIDIAN_REST_TOKEN`, `ICLOUD_SHORTCUTS_PATH`, `CLICKUP_API_KEY`, `FIREFLIES_API_KEY`, `HEALTH_INGEST_TOKEN`, `MAKE_WEBHOOK_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_ID`. Positive control: the grep methodology correctly found 44/44 ENV_SPEC entries when searched directly and correctly returned zero hits for genuinely absent names (e.g. `LIVEKIT_*`, see next section) — so these absences are real, not a grep miss. `pnpm check:env` / the `/system` env-health card therefore has a materially incomplete view of what the running app actually depends on.

## 9. Master connector matrix

Owner legend: SN = StateNour-owned config/data; EXT = external SaaS is source of truth; NK = nickstire-owned. Class: A=verified code, D=doc-dated probe, H=inference, I=not verified.

**Google (google-data: Gmail/Cal/Drive).** Owner EXT. Direction: read + draft(compose) + act(calendar write). Auth: OAuth2, scopes in section 1. Token storage: plaintext in Integration.config Json, leaked via unscoped GET /api/integrations (section 1, HIGH). Refresh/revoke: auto-refresh, invalid_grant leads to status:failed; no upstream revoke call anywhere in the repo (grepped). Sync: cron-pull (ingest-gmail/ingest-calendar), no webhook. Egress: email/Drive/Calendar content flows into Nick's chat context, then into whichever AI provider is live plus Langfuse for non-private turns. Failure mode: getGoogleOauthStatus() distinguishes missing/expired/stale/healthy plus a probeFailed flag (DB-unreachable is not the same as unconfigured) — genuinely good UNKNOWN-vs-unhealthy modeling. Class A.

**Google sign-in (next-auth).** Owner SN. Direction: act (site login). Auth: OAuth2 with a single AUTH_ALLOWED_EMAIL allowlist. Storage: session JWT via AUTH_SECRET, no DB Account table (no Prisma adapter in use). Failure mode: fail-closed 500 "SYSTEM LOCKED" if creds are missing in production (middleware.ts:76-84). Class A.

**GitHub.** Owner EXT. Direction: act (issues/PRs). Auth: GITHUB_TOKEN Bearer, not stored (env only), manual rotation, on-demand via AI tool call. Failure mode: throws a clear error if unset (lib/integrations/github.ts:19). Class A.

**Telegram bot.** Owner SN. Direction: read + act. Auth: bot token (TELEGRAM_BOT_TOKEN) outbound; inbound webhook secret-token + owner-id check (section 2). Not stored beyond env. Sync: webhook push inbound, REST push outbound. Egress: chat content to Telegram (expected — operator's own bot). Failure mode: fail-closed 503 if the webhook secret is unset (section 2). Class A.

**Stripe.** Owner EXT. Direction: read(webhook) + act(future charges via key). Auth: webhook HMAC (section 2); STRIPE_SECRET_KEY Bearer for API calls, not stored, standard Stripe key rotation. Sync: webhook, real-time. Egress: customer email/name/payment metadata land in Order.metadata as a raw customerDetails object (app/api/webhooks/stripe/route.ts:165-169). Failure mode: fail-closed 503 if the webhook secret is unset (section 2). Class A.

**Make.com.** Owner EXT. Direction: read (inbound webhook). Auth: shared secret header, constant-time compare (section 2), not stored, manual rotation. Sync: webhook push. Egress: scenario payload lands in ExecutionInsight.detail as raw JSON, truncated to 2000 chars, stored indefinitely — no TTL found. Failure mode: fail-closed 503 (section 2). Class A.

**nickstire bridge.** Owner: nickstire owns its own data, StateNour is a peer not an owner. Direction: read + act, bidirectional over x-sync-key. Auth: shared secret STATENOUR_SYNC_KEY / BRIDGE_API_KEY, constant-time (section 2), manual rotation. Sync: webhook (/api/webhooks/nickstire) plus polling (/api/sync/*). Egress: lead/customer data crosses between the two apps by design (contract in docs/NICKSTIRE-QUERY-CONTRACT.md, not read this pass). Failure mode: Wave-58 fixed a real alert-blackhole bug where a silent `.catch(()=>{})` swallowed Telegram delivery failures — now loud (section 2 comments). Class A.

**inbound-crm webhook.** Owner SN. Direction: read (act via AI extraction). Auth: x-sync-key header, legacy ?secret= query deprecated, constant-time (section 2). Sync: webhook push. Egress: raw inbound email/SMS body text is passed to tracedAiChat, i.e. to an AI provider and, if not private-mode, to Langfuse. Failure mode: fail-closed 503 (section 2). Class A.

**Apple Health (HAE + Shortcuts).** Owner SN. Direction: read, device-initiated. Auth: bearer HEALTH_INGEST_TOKEN, timing-safe, fail-closed 503 if unset (lib/security/health-ingest-auth.ts). Storage: raw samples land in health_samples/BodyTracking tables (not schema-audited this pass). Sync: push from iOS Health Auto Export / Shortcuts, deduplicated via a content-hash batchId. Egress: health biometrics stored in Neon; the on-device export origin means no third-party health-data processor sits in the loop, which is a positive. Failure mode: 8MB body cap, 413 on oversize (.../hae/route.ts:31-33). Class A.

**Resend (email).** Owner EXT. Direction: act (send). Auth: RESEND_API_KEY Bearer, not stored, manual rotation, on-demand. Egress: email bodies/recipient addresses to Resend — expected, transactional. Failure mode: silent no-op, the client is only constructed if the key is present (lib/services/email.ts:6-7). Class A.

**web-push (VAPID).** Owner SN. Direction: act (push notify). Auth: VAPID keypair (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY). Storage: push subscriptions presumably live in a DB table, not schema-audited this pass — NOT VERIFIED. Egress: notification text goes through the browser's push relay (Google/Apple/Mozilla), which is inherent to the Web Push protocol. Class I (storage detail not verified).

**LiveKit.** NOT FOUND — zero references anywhere in apps/statenour (lib/, app/, config/, prisma/ grepped case-insensitively; positive control: the identical methodology found 12+ VAPI hits in the same directories). The task brief lists LiveKit as a known integration; either it lives in a sibling app outside this snapshot, or the brief is stale for this app. Class A (absence).

**VAPI.** Owner EXT (nickstire-adjacent). Direction: read (analytics only). Auth: VAPI_API_KEY Bearer, server-side only (app/api/system/vapi-calls/route.ts:13), not stored, manual rotation. Sync: pull on dashboard load. Egress: call metadata (duration/status/endedReason) displayed on /system/vapi-calls; no transcript/PII content confirmed handled this pass. Status: the webhook receiver /api/vapi was deleted 2026-08-09 (route-policy.ts:51) — live voice call handling moved to nickstire's own webhook — but the read-only analytics proxy (buildVapiCallStats) is still present and code-live. Classification is mixed: RETIRED-BUT-PRESENT for the webhook, WIRED-RUNTIME-UNVERIFIED for the analytics proxy. Class A.

**Obsidian vault engine.** Owner SN, local-only. Direction: act (write notes). Auth: local REST API token OBSIDIAN_REST_TOKEN (defaults empty), OBSIDIAN_REST_URL defaults to http://127.0.0.1:27124. Storage: n/a, local file writes via fs. Sync: one-way export script (scripts/export-brain-to-obsidian.ts). Egress: none off-machine — OBSIDIAN_VAULT_PATH defaults to a hardcoded operator-local Windows path (lib/obsidian/engine-config.ts:25) and the REST URL is loopback-only. Failure mode / note: this runs only on the operator's own PC, not the Railway deployment — a local CLI tool living in lib/, not a live bdnick.info server capability. Class A.

**Research: Tavily.** Owner EXT. Direction: read. Auth: TAVILY_API_KEY Bearer, not stored, manual rotation, on-demand. Egress: query text to Tavily. Note: documented as the sole reliable web-search source per docs/CURRENT-TRUTH.md:118. Class A.

**Research: Perplexica.** Owner: internal Railway-private service (*.railway.internal). Direction: read. Auth: none visible — internal network trust, no auth header seen in lib/integrations/perplexica.ts (not exhaustively confirmed absent, only skimmed). Egress: query text stays inside Railway's private network. Note — conflicting dated claims, both 2026-08-16: docs/CURRENT-TRUTH.md:119-120 says "perplexica returns ZERO completed searches (400 invalid_request_error)"; lib/integrations/searxng.ts:11-17's code comment says "Measured on the live services, 2026-08-16" with working SearXNG timings (2.4-6.1s) — though that specifically measures SearXNG, not Perplexica's synthesis pass, so the two claims are not strictly contradictory on close read, but are flagged for operator reconciliation. Class D (conflicting).

**Research: SearXNG.** Owner: internal Railway-private service. Direction: read. Auth: none visible, private network. Egress: same as Perplexica. Note: docs/CURRENT-TRUTH.md:118-119 — "ZERO healthy responses (116 CAPTCHA across duckduckgo/wikipedia/startpage/brave/google-cse)", dated 2026-08-16. Class D.

**Firecrawl.** Owner EXT. Direction: read (scrape). Auth: FIRECRAWL_API_KEY Bearer via the SDK, not stored, manual rotation, on-demand. Egress: target-page content goes to Firecrawl's cloud, which performs the actual fetch. Failure mode / gap: SSRF gate present at only 2 of 5 call sites (section 3). Class A.

**Exa / Perplexity / Grok (xAI).** Owner EXT. Direction: read. Auth: EXA_API_KEY / PERPLEXITY_API_KEY (referenced via the tool catalog, not directly grepped this pass) / XAI_API_KEY Bearer, standard pattern, throws on a missing key. Egress: query text to each vendor. Class A.

**NotebookLM ingest.** NOT independently verified this pass — found only as references inside tool-catalog/reasoning files, never traced to a dedicated integration file. Class I.

**E2B (sandbox exec).** Owner EXT. Direction: act (code execution). Auth: E2B_API_KEY (lib/integrations/e2b.ts:65-66), not stored, manual rotation, on-demand. Egress: arbitrary code/data the AI chooses to run — a different risk class (RCE-in-sandbox, not SSRF); not exhaustively audited this pass. Failure mode: throws a clear error if unset. Class A.

**Browserbase / Stagehand.** Owner EXT. Direction: act (headless browser control). Auth: BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID, not stored, manual rotation, on-demand, tagged riskClass:"high" in the tool catalog (lib/ai/tools/catalog.ts:311-316). Egress: whatever the agent navigates to or extracts, on Browserbase's cloud browser. Gap: no assertPublicUrl gate on .goto() (section 3) — a different threat model than same-host SSRF, since the fetch happens on Browserbase's infrastructure. Class A.

**last30days.** Owner SN, local skill. Direction: read. Auth: n/a — local Python scripts reading the operator's own machine's browser cookies (chrome_cookies.py, cookie_extract.py). Egress: stays local by construction, not a server-side bdnick.info capability. Class A.

**MoneyPrinterTurbo.** Vendored, non-workspace per root AGENTS.md. Direction: act (video generation). Not audited this pass beyond confirming it is a large vendored Python tool under lib/ai/moneyprinter/ containing third-party font/song assets — not integration code per se. Class I.

**RunnerNode / device fleet (Tuya / V380 / Ring / Eufy).** Owner SN, hardware-dependent. Direction: read + act. Auth: x-sync-key on /api/devices (route-policy.ts:53). Storage: device state in SmartDevice/DeviceEvent. Sync: external Windows Python agent pushes state. Egress: device telemetry only. Status: DEAD since 2026-04-14 (section 5) — 20-22 devices stuck OFFLINE; the alert-noise bug is fixed but the underlying offline condition was deliberately deferred by the operator (hardware-dependent, "chose SKIP"). Class A.

**Cameras (V380).** Owner SN, hardware-dependent. Direction: read (metadata only). Auth: same as the device fleet. Storage: snapshotUrl is always null. Note: no pixel/video pipeline exists at all — confirmed class A via docs/RECONCILIATION.md:2537. Same DEAD status as the device fleet. Class A/D.

**Ollama Cloud.** Owner EXT. Direction: read (LLM inference). Auth: OLLAMA_API_KEY, base URL defaults to https://ollama.com — i.e. Ollama Cloud, not self-hosted (config/ai-providers.ts:43,56-57). Egress: all chat/tool prompt+completion content — it is first in the provider order for every task type, at the "zero_incremental" cost tier. Failure mode: provider-chain fallback to openrouter, then gemini, openai, anthropic (config/ai-providers.ts:158-169). Class A.

**OpenRouter.** Owner EXT. Direction: read. Auth: OPENROUTER_API_KEY Bearer, also used for an embeddings fallback (lib/ai/provider.ts:1570-1577). Egress: same content class as Ollama. Second in the provider order. Class A.

**OpenAI / Anthropic / Gemini.** Owner EXT. Direction: read. Auth: standard Bearer/API-key per SDK, not stored, manual rotation. Egress: same content class. Note: Gemini has every safety filter set to BLOCK_NONE by a deliberate owner-authority decision (lib/ai/provider.ts:250-260) — content moderation is fully disabled for this provider, a compliance-relevant fact worth the operator's awareness. Class A.

**Braintrust.** Owner EXT. Auth: BRAINTRUST_API_KEY, spec'd as runtime tier. Status: DEAD — the env spec's own description says "UNUSED by the app since 2026-08-25 (braintrust-wrap deleted, zero callers ever)" (lib/env.ts:107). Class A, self-documented dead.

**Langfuse.** Owner EXT, Cloud Hobby tier, US region. Direction: read (telemetry). Auth: Basic auth via LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY to https://us.cloud.langfuse.com. Sync: per-AI-call OTel span export across 22 call sites. Egress: prompt+completion content, masked only for sk-/pk-/Bearer shapes (section 4, full detail there). Classification: LIVE for configuration, PARTIAL for trace-landing, which is unconfirmed even by the integration's own doc. Class D.

**Sentry.** Owner EXT. Direction: read (error telemetry). Auth: DSN-based. Note: sendDefaultPii:false, no beforeSend scrub (section 4). Classification: LIVE for configuration, UNVERIFIED for actual event capture — the doc's own words. Class D.

**OpenTelemetry (NDJSON export).** Owner SN. Direction: read (export). Mechanism: n/a, driven by the local `pnpm export:traces` script, manual/on-demand. Egress: content-FREE by design — two independent privacy layers: an explicit Prisma select that never reads content columns out of the DB, plus a runtime enforceAllowlist() that throws (rather than silently dropping) on an unexpected key (lib/observability/otel-export.ts:14-24). This is a positive control that contrasts favorably with Langfuse's content-bearing export. Class A.

**Redis (ioredis).** Owner EXT, Upstash-compatible. Direction: read/write (cache). Auth: REDIS_URL connection string (may embed credentials; not a separate auth step). Storage: cached values only (L2 cache). Failure mode: fails silently to null / falls back to in-memory L1, never throws (lib/utils/redis.ts:6-9,26-29). Class A.

**Neon Postgres.** Owner EXT, managed. Direction: read/write (primary datastore). Auth: DATABASE_URL / DIRECT_URL connection strings. Storage: everything — this is the primary datastore. Failure mode: required tier, boot fails without it. Class A.

## 10. Rate limits / quotas / reliability layer

No per-connector rate-limit tracker exists for the external SaaS integrations (Stripe, Telegram, Resend, Make, Tavily, Firecrawl, etc.) — none carry a local request-budget or circuit breaker keyed to that specific vendor. Two general-purpose layers cover this instead:

- **`lib/tools/guardian.ts` `withGuardian()`** — a generic wrapper (timeout + exponential-backoff retry + 9-category failure classification + telemetry) applied at individual call sites (Firecrawl's `scrapeUrl`, several research tools) — reliability infrastructure, not a quota/budget system; it does not prevent hitting a vendor's own rate limit, it just retries and classifies the failure when one is hit.
- **`lib/db/safe-prisma.ts` `isQuotaExhausted()`/`markQuotaExhausted()`** — a Neon DB compute-quota circuit breaker (referenced throughout `lib/utils/http.ts`, e.g. `:238,265,300`) — this is about Neon's own compute quota, not a third-party API quota; when tripped, the app returns 503 with `dbQuotaExhausted:true` and skips telemetry writes to avoid compounding the outage.
- **`lib/services/cost-slo.ts` + `DAILY_AI_BUDGET_CENTS`** — the only true spend-budget gate in the codebase, and it applies to AI provider cost specifically (computes today's burn from `AiGeneration`, forecasts 24h linear extrapolation, trips a threshold at forecast > budget × 1.2) — not to Stripe/Telegram/etc.
- **`lib/ai/tool-quota.ts`** — a per-turn AI *tool-call* budget (the `NICK_TOOL_BUDGET` referenced in `docs/CURRENT-TRUTH.md:129`, caps tool exposure at 24), unrelated to external-vendor API rate limits.

Net: cost/quota discipline exists for the two things that could runaway-bill (Neon compute, AI provider spend); every other connector trusts the vendor's own 429 handling with only generic retry, not a local budget.

## 11. Classification summary

- **LIVE (class D, doc-dated 2026-09-02, matches snapshot date):** Langfuse (config + pipeline only — trace-landing PARTIAL), Sentry (config only — event-capture UNVERIFIED), Neon, the 5 AI providers (ollama/openrouter/gemini/openai/anthropic — chat is the app's core loop), Redis (best-effort), nickstire bridge, Telegram, Stripe/Make/inbound-crm webhooks, Apple Health inlets, Google OAuth (data ingestion) per its own health-state machine.
- **WIRED-RUNTIME-UNVERIFIED:** VAPI analytics proxy (`/api/system/vapi-calls`), web-push (VAPID keys spec'd, subscription storage not schema-verified), GitHub, Resend, E2B, Browserbase/Stagehand, Exa/Perplexity/Grok, Firecrawl (code path solid, no live-probe doc found this pass), Inngest (SDK-delegated, `isInngestFullyConfigured()` gate exists but no dated live-run receipt found this session).
- **PARTIAL:** Perplexica/SearXNG (conflicting same-day 2026-08-16 claims — see §9), Google OAuth token-leak surface (feature works, but the `GET /api/integrations` exposure is a live latent defect, not a "down" state).
- **DEAD (not retired, silently rotted):** RunnerNode/SmartDevice fleet + V380 cameras (since 2026-04-14), Braintrust (since 2026-08-25, self-documented in `lib/env.ts:107`).
- **RETIRED-BUT-PRESENT:** VAPI webhook receiver (`/api/vapi`, code deleted 2026-08-09 per `route-policy.ts:51` comment — route itself confirmed absent from `app/api/` this pass is consistent with that claim, not independently re-verified by directory listing this session).
- **NOT FOUND (absence, positive-controlled):** LiveKit — zero references anywhere in `apps/statenour`.
- **NOT VERIFIED this session (I):** NotebookLM ingest (no dedicated integration file located), MoneyPrinterTurbo (vendored, not audited beyond confirming its presence), web-push subscription storage/encryption, Perplexity/Exa's exact spec presence (inferred from catalog references, not directly opened), whether `privateMode` is correctly set on every content-sensitive AI call site feeding Langfuse (would require tracing all 22 sites — out of budget), OpenTelemetry export's actual `pnpm export:traces` run history, Braintrust's eval-dataset scripts' current usage cadence.

