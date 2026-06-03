# Truth OS — nickstire.org (living snapshot)

**Purpose:** Single place to record what must be **true in production** for this repo. Update when you ship behavior or infra changes.

## 🔵 Latest shipped — 2026-06-03 (admin overhaul + customer dedup + code-underneath fixes)

**Customer data — DEDUPED + dupe-proofed (LIVE on prod TiDB):**
- Customer count is **1,943** (was 1,964 — 21 same-name+same-vehicle duplicate rows merged 2026-06-03; row-level backups in `_bak_*_dedup_20260603`). Survivors retain both numbers (`phone` + `phone2`).
- Phone is now canonical **10-digit** for new + merged rows. `findOrCreateCustomer` (`server/services/customerLookup.ts`) normalizes BOTH sides to last-10 before insert → **a chat `+1216…` can no longer create a twin of an existing `216…` import row.**
- ⚠ TiDB **cannot** `ALTER`-add a STORED generated column, so the normalized-phone uniqueness is enforced **app-side** (the import guard) + the existing `uniq_customer_phone` key over now-uniform 10-digit values — there is **no** DB `phone_normalized` generated key.
- 18 orphan invoices (`customerId IS NULL`) were linked by phone; ~299 remaining unlinked invoices are anonymous walk-ins/estimates with no matching customer (left as-is). Full record: `docs/admin-surface-audit/customer-dedup-plan.md` (§ EXECUTION OUTCOME) + reproducible `scripts/dedup-*.ts` / `scripts/orphan-invoices-*.ts` / `scripts/recompute-customers.ts`.

**Crons:** `confirmation-calls` + `voice-recovery` now **fire on the daily tier** (`server/cron/scheduler.ts` TIER 4). They were previously registered only in `registerAllJobs()` (the HTTP-trigger registry, which boot never calls) and so never ran on a timer — `FEATURE_CONFIRMATION_CALLS` / `FEATURE_VOICE_RECOVERY` did nothing. Both self-gate on VAPI env + their flag (OFF by default) + at-most-once claims.

**Security:** `getTrackingInfo` (public job tracker, `server/services/customerMessaging.ts`) **fails closed**. It used to verify the caller's phone only when `customer_id` was numeric, so walk-in / AI-chat WOs (non-numeric `customer_id`) returned status/vehicle/service to anyone with the (low-entropy) order number — an IDOR/PII leak. Every path now requires a phone match (numeric-id lookup OR `customer_id`-as-phone). Guarded by `server/services/customerMessaging.test.ts`.

**Data-layer correctness (`docs/admin-surface-audit/code-underneath-audit-{data,logic}.md`):** enrich phone-join hardened to `RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)` (was a weak `RIGHT(phone,10)` → undercounted spend/visits); `lastRetentionTier` now resets on a return visit (was permanent D365 ineligibility); churnRisk/isVip scored for ALL customers (was top-200); 2 always-zero `customer_metrics` columns dropped from `customers.list`; win-back SMS no longer ship literal `{lastService}`/`{vehicleInfo}`; overnight leads no longer age out of speed-to-lead; `autoAdvanceWorkOrders` requires an on-row billing signal (`total>0 OR payment_status≠'unpaid'`) before `completed`→`invoiced` (the WO↔invoice link is type-incompatible + unpopulated — confirmed).

**Env (Railway service `MAINnicks-tire-auto`):** `STATENOUR_SYNC_URL` repointed from the stale `https://autonicks.com` → `https://statenour-web-production.up.railway.app` (fixes the `statenour-live-sync` cron 404). `STATENOUR_SYNC_KEY` + other secrets untouched.

**Admin UI surface:** all 31 admin pages audited + fixed across 9 waves (money-formatter centralized in `shared/format.ts`; square-`Panel` card uniformity; TCPA "Reply STOP" on retention/oil/voice bulk SMS; WalkIn oil presets re-anchored to advertised $49/$80; revenue KPI = paid-only over `DATE_SUB(CURDATE(),INTERVAL n DAY)`; ~40 defect fixes). Audit set: `docs/admin-surface-audit/*.md`.

**OPEN — operator-decisions, NOT shipped:** (1) `work_orders.customer_id` is a varchar string-space (`"WALK-IN"`/phone) that can't join `customers.id` (int) — reconciliation joins miss; a schema refactor. (2) `customers.segment` has 3 writers on 3 cadences — pick one owner. (3) "Total revenue" is paid-only on 3 surfaces vs all-invoices on 4 — pick the canonical definition. (4) GBP content generator fabrication (held). Detail in `docs/admin-surface-audit/SESSION-CHECKPOINT.md`.

---

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

## Migrations applied (recent · for reference)

- **`0040_wave181_otp_attempts_durable.sql`** — APPLIED 2026-05-18. Creates `otp_attempts` table backing the durable OTP brute-force counter (server/middleware/bruteForce.ts).
- **`0041_wave181_sms_sending_status.sql`** — APPLIED 2026-05-18. Appends `"sending"` to `sms_messages.status` enum for the rehydrate state machine.
- **`0042_wave181_declined_recovery_attempted_at.sql`** — APPLIED 2026-05-18. Adds `follow_up_{7,30}d_attempted_at` to `alg_estimates` for at-most-once declined-recovery sends.
- **`0043_wave181_sms_rate_limit_durable.sql`** — APPLIED 2026-05-19. Creates `sms_rate_limit` table backing the durable 8/24h per-phone counter (server/sms.ts checkDailyLimit · single-atomic via LAST_INSERT_ID after wave-181.83).
- **`0044_wave181_cron_alerts_fired.sql`** — APPLIED 2026-05-19. Creates `cron_alerts_fired` table for durable Telegram-alert dedup (vapiLatencySync.ts).
- **`0045_wave181_drip_enrollments_unique.sql`** — APPLIED 2026-05-19. Adds `uq_drip_active` UNIQUE INDEX on `drip_enrollments` (customerPhone, campaignId, status) · closes the gap-lock deadlock in persistDripEnrollment.
- **`0047_wave181_cron_tier_skip_state.sql`** — APPLIED 2026-05-19. Creates `cron_tier_skip_state` table backing the durable scheduler tier-skip counter (server/cron/scheduler.ts · was in-memory Map · pre-fix lost state on every pod restart).
- **`0048_wave181_confirmation_calls.sql`** — APPLIED 2026-05-19. Creates `confirmation_calls` table for AgentPhone confirmation-bot per-attempt tracking.
- **`0049_wave181_voice_recovery.sql`** — APPLIED 2026-05-19. Adds `voice_recovery_attempted_at` / `voice_recovery_call_id` / `voice_recovery_outcome` columns to `alg_estimates` for voice-recovery escalation tracking.

## Migrations pending awareness (continued)

- **`0046_wave181_sms_conv_phone_normalized.sql`** — DEFERRED 2026-05-19. Expression index on `sms_conversations` to kill the function-on-left-side WHERE full scan in smsInstrumentation.ts. Blocked by TiDB's expression-index function safety list. Requires `SET GLOBAL tidb_allow_function_in_expression_index = 'RIGHT,REPLACE';` (SUPER privilege via TiDB Cloud console). Apply with: `pnpm exec tsx apps/nickstire/scripts/apply-wave-181-83-phone-normalized.ts` once the config flag is set. Current cost is bounded at <100 inbound SMS/day · self-decays via wave-181.61 at-write normalization.

## SMS routing (post wave-103, updated wave-181.60)

- **Default path:** Shop SMS Gateway = Capevace `me.capcom.smsgateway` v1.60.0 running on the F25e (Samsung S25 FE) at `216-862-0005` (Verizon line). Wave-181.60 made this the DEFAULT — any `sendSms(phone, body)` call with no explicit `via` routes through the shop gateway first. Forgetting `{ via: "shop" }` no longer silently routes to dead Twilio (the wave-181.58 bug class).
- **Fallback path:** Twilio (`+1 216-769-9977`). Only fires when shop gateway returns failure (with Telegram alert), or when caller explicitly opts out via `{ via: "twilio" }` (rare — test scripts, legacy Twilio-only webhooks).
- **Inbound webhook:** `POST /api/webhooks/sms-gateway` — HMAC-SHA256 over `rawBody + X-Timestamp` header value, ±5min replay window. Verified via `SHOP_SMS_GATEWAY_WEBHOOK_SECRET`.
- **Health monitor:** Cron `sms-gateway-health` (pulse tier, 15min) pings Capevace `/device`, Telegram alert if F25e last-seen > 30min.
- **Kill switch:** `SMS_KILL_SWITCH=true` only blocks the Twilio fallback. Shop gateway sends keep working when the switch is on. With wave-181.60's default flip, the kill switch is effectively cosmetic for customer-facing traffic — shop path is reached before the kill switch check.
- **Manager-on-duty alerts:** `eventBus` destination `manager-on-duty-sms` texts the VAPI transferCall destination (current on-duty manager) on every booking_created / lead_captured / callback_requested / emergency_request event. Self-loop guard skips if the on-duty number == 216-862-0005.
- **Operator runbook:** `docs/SHOP_SMS_GATEWAY_SETUP.md` and `docs/OPERATOR_RUNBOOK_WAVE_181_60.md` (migration apply procedure).

## Outbound voice (wave-181.84 + 181.85 · AgentPhone)

- **Confirmation Bot** · daily cron `confirmation-calls` fires AgentPhone outbound calls to confirm next-day appointments. Hosted-LLM mode · brand-voice system prompt (60-90s target · voicemail handling · single confirm/reschedule round-trip).
- **Voice Recovery** · daily cron `voice-recovery` fires AgentPhone outbound calls to declined estimates that received D7 + D30 SMS but didn't convert. Hosted-LLM mode · "no pressure · we're here when you need us" closer if customer declines.
- **Webhook:** `POST /api/webhooks/agentphone` · HMAC-SHA256 via `AGENTPHONE_WEBHOOK_SECRET` · production refuses unsigned. Dispatches by callId lookup across confirmation_calls AND alg_estimates voice_recovery columns.
- **Gates** (3 env vars · 2 feature flags · operator-controlled):
  - `AGENTPHONE_API_KEY` (Railway env) · shared by both crons
  - `AGENTPHONE_WEBHOOK_SECRET` (Railway env) · shared
  - `AGENTPHONE_CONFIRMATION_AGENT_ID` (Railway env) · per-purpose agent
  - `AGENTPHONE_RECOVERY_AGENT_ID` (Railway env) · can be the same value
  - `FEATURE_CONFIRMATION_CALLS=1` (Railway env) · enables confirmation cron
  - `FEATURE_VOICE_RECOVERY=1` (Railway env) · enables recovery cron
- **Operator runbook:** `docs/OPERATOR_AGENTPHONE_SETUP.md`.

## ⚡ HF / AI stack (2026-05-26 activation)

### LIVE on prod (both services have env vars set)

| Service | Where | What it does | Env var gate |
|---|---|---|---|
| **HF prompt-injection screen** | nickstire `classifiers.ts` | Blocks jailbreak attempts via deberta-v3-base before intent routing | `HF_API_KEY` |
| **HF zero-shot intent classifier** | nickstire `classifiers.ts` | 11-label intent routing for inbound SMS (appointment/tire/brake/etc.) | `HF_API_KEY` |
| **Transformers.js Spanish detect** | nickstire `ChatWidget.tsx` | Browser-side language detect → `¿Español?` toast on first Spanish message | none (bundled) |
| **BGE rerank** | statenour `lib/brain/rerank.ts` | Cross-encoder reranker replaces Cohere · parallel single-pair HF Inference calls | `BGE_RERANK=true` + `HF_API_KEY` |
| **HF Inference embeddings** | statenour `lib/ai/hf-embeddings.ts` | `intfloat/multilingual-e5-large` as chain position #4 in `getEmbedding()` | `HF_API_KEY` |

### Scaffolded / coded — needs operator action to go live

| Service | File | Blocker |
|---|---|---|
| **NickGPT SMS drafter** | `server/services/nickgpt-client.ts` | DB feature-flag `nickgpt_drafter_enabled`=false · needs Modal account ($50, ~6h fine-tune) |
| **XTTS-v2 voice clone** | `server/services/voice-clone.ts` | Needs `REPLICATE_API_KEY` + 10-15s voice sample recording |
| **Photo-damage MMS assess** | `server/services/photo-assess-pipeline.ts` / `vision-analyzer.ts` | Needs `REPLICATE_API_KEY` · Qwen2-VL-72B backend |
| **Replicate FLUX image gen** | `apps/statenour/lib/ai/replicate-flux.ts` | Needs `REPLICATE_API_KEY` + `REPLICATE_FLUX=true` env var on statenour |
| **Bulk Whisper re-transcribe** | `scripts/bulk-whisper.ts` | Needs Modal account (~$14, ~12h batch job) |

### Operator activation queue (what to do next)

1. Sign up Replicate → set `REPLICATE_API_KEY` on Railway (unlocks voice clone + photo assess + FLUX)
2. Record 10-15s voice sample (Nour's voice) → base64 → `VOICE_SAMPLE_URL` env on Railway
3. Sign up Modal → run NickGPT LoRA fine-tune per `docs/runbooks/nickgpt-finetune.md`
4. After fine-tune: `ollama pull nickgpt` on the inference host → flip `nickgpt_drafter_enabled` flag
5. Wire `lint-pii.mjs` into `.husky/pre-commit` (Wave U scaffolded this, hook not yet wired)

### New env vars (post 2026-05-26)

| Var | Service | Notes |
|---|---|---|
| `HF_API_KEY` | nickstire + statenour | Fine-grained token "nour-os-ports-2026-05-26" · currently set on both Railway services |
| `BGE_RERANK` | statenour | Set to `"true"` · activates BGE reranker in `contextual-recall.ts` |
| `REPLICATE_API_KEY` | nickstire + statenour | NOT YET SET · required for photo-assess + voice-clone + FLUX |
| `REPLICATE_FLUX` | statenour | Set to `"true"` alongside `REPLICATE_API_KEY` to activate FLUX |

## Invariants (do not break)

- **ShopDriver / ALG** integration is load-bearing for shop operations — do not remove without explicit owner decision.
- **Feature flags:** risky features should default off at the code path until explicitly enabled in DB.
- **Shop SMS Gateway is load-bearing.** ~80% of customer-facing transactional SMS routes through the F25e. Don't change the `sendSms` default-route logic (`opts?.via !== "twilio"`) without confirming Twilio is healthy + opt-in compliance.
- **Webhook signature scheme** for the SMS Gateway is HMAC-SHA256 over `body + X-Timestamp`. Don't change this without updating the Capevace app's signing key OR re-signing scheme on both sides.
- **OTP brute-force counter is DB-backed (wave-181.60).** Don't revert to an in-memory Map — counters need to survive Railway restarts and aggregate across pods.
- **Declined-recovery is at-most-once (wave-181.60).** The `followUp{N}dAttemptedAt` claim must be stamped BEFORE `sendSms`, not after. Reversing the order reintroduces double-send-on-restart.
- **SMS rate-limit is single-atomic (wave-181.83).** checkDailyLimit uses the LAST_INSERT_ID() pattern · don't revert to the 2-query SELECT-after-UPDATE form (race between increment + read).
- **Scheduler tier-skip counter is DB-backed (wave-181.83).** Don't revert to the in-memory Map · alert needs to survive restarts under chronic overrun.
- **Recovery cron uses personalized message + scored ranking (wave-181.82).** Customer vehicle + repeat-customer + service category drive a 2× engagement lift. Don't revert to generic-template-only.
- **AgentPhone API key NEVER goes to any URL other than api.agentphone.to.** Skill rule.
- **AgentPhone crons are env-gated · safe to ship code without operator flipping flags.** When operator's ready, 5 env vars unlock everything (see Operator runbook above).
- **HF classifiers are fail-open.** `classifiers.ts` catches all `fetch` errors and returns `allowed:true` / falls through to default intent. This is intentional — a classifier outage must not block inbound SMS processing.
- **BGE rerank has a 50% failure threshold.** `bge-rerank.ts` returns the original unranked results if more than half the pairs fail. Do not tighten this threshold — HF Inference cold-boot takes 20-40s and single-pair calls may time out during warmup.
- **HF embeddings are chain position #4 in statenour `getEmbedding()`.** Order: OpenAI → Venice → Cohere → HF → local fallback. Don't move HF above Cohere — Cohere is the latency-optimized default; HF is cost-fallback.
- **`@nour/utils` dist/ is committed.** `packages/utils/dist/` is in git because Railway's Node ESM runtime needs pre-built `.js` files with explicit extensions. The `.gitignore` at `packages/utils/` has a negation for `!dist/`. Do NOT add `dist/` to a root `.gitignore` or the ESM fix breaks.
- **`@statenour/lenses` must be in statenour Dockerfile.** Dockerfile deps stage needs `packages/lenses/package.json` + build stage needs source COPY + `pnpm run build` step. Missing this breaks statenour deploys (Module not found: `@statenour/lenses`).
- **Transformers.js Spanish detect is fire-and-forget.** The `void (async () => { ... })()` pattern in `ChatWidget.tsx::handleSend` means classifier errors are swallowed silently. This is intentional — a Transformers.js failure must not prevent message send. Don't convert to `await`.
