# Truth OS — nickstire.org (living snapshot)

**Purpose:** Single place to record what must be **true in production** for this repo. Update when you ship behavior or infra changes.

## 🟢 Latest shipped — 2026-06-18 (Ad Studio + IG reel/ad campaigns)

- **Ad Studio (#212 · `/admin/ad-studio` · nav: Megaphone)**: owner-gated tool that generates a boost-ready Instagram carousel **ad** end-to-end — pick an angle ($10-down / free-check / 4.9★ trust) → claim-safe LLM copy (`server/services/adStudio/adCopyGen.ts`) + **server-side puppeteer render** of a brand template (Nick's yellow on near-black, **no fake people**; real product object shots + a designed 4.9★ review card) → slides hosted via `storagePut` → **Post now** or **Schedule**. Reuses `metaSocial.postInstagramCarousel` + `scheduled_posts` for delivery. **Proof + CTA cards are templated from `BUSINESS` constants** — phone/address/reviews can never be hallucinated. Fonts (Anton + Barlow Condensed, OFL) + product shots are baked to base64 (`server/services/adStudio/adAssets.ts` via `gen-assets.mjs`) so the render survives esbuild bundling — **no runtime file IO or font fetch**. Gates: tsc 0 · `adStudio.test` 10/10 · build · brand-voice 0 · routes 0. **⚠ Watch item: the runtime puppeteer render on Railway is operator-smoke-tested in-browser (open the tool → Generate). Chromium is present at build (prerender); if its runtime libs are missing, `adStudio.generate` returns a clean error rather than crashing.**
- **Server-side image render is now load-bearing for ads**: puppeteer (the same engine prerender uses at build) renders 1080×1080 JPEG slides at runtime; hosting is `storagePut` (S3 when `S3_BUCKET`, else `nickstire.org/generated/`). The Meta **carousel** post path + the publish-later `scheduled_posts` queue are reachable from the admin (previously only per-reel/educational paths).
- **IG reel campaigns (operational)**: 12 hand-built tire reels hosted as `reel32`–`reel43` on the `nourdean22/nt-reels` HF dataset — reel #1 posted live, `reel33`–`reel43` queued in `scheduled_posts` (11 pending rows) to fire **6 PM ET nightly Jun 19→29** via the pulse-tier `scheduled-posts` cron. **Independent of the 9 AM `dailyReelPost` (reel5–30) → now 2 reels/day.** Plus 2 "Nonstop Nick" faceless reels (`reel44`/`reel45`) posted live. **HF reels 4–45 are used → next is `reel46`.** Posting requires the Railway arms `REEL_PUBLISH_ENABLED` + `META_IG_USER_ID` (both confirmed true in prod). Brand rule recorded: **no fake AI people in ads** — use the graphic-design pipeline.

## 🟢 Shipped — 2026-06-12 (Customer Total Spent Fix)

- **Customer Total Spent (dead totalRevenue fix)**: Resolved the bug where `customerMetrics.totalRevenue` was always 0 in the database (never populated) by redirecting reads in both `customersRouter.vipLookup` and `customerPsychoProfile` service to `customers.totalSpent` (the live spent value in cents).
- **Test Integrity**: Standardized the vitest error assertions in `triggerRefund.test.ts` to run stably without relying on rejects.toThrow string matching issues.

## 🟢 Shipped — 2026-06-12 (Tires Metadata Alignment & GSC Sitemap Submission)

- **Tires Metadata Alignment**: Modified `apps/nickstire/shared/services.ts` to align the tires page meta description with the SEO-tuned string inside `routes.ts` and `TireFinder.tsx` ("New & used tires in Cleveland & Euclid. Free installation package included in estimate. Walk in 7 days, payment programs available. Call (216) 862-0005.").
- **Zero Divergences**: Verified that the meta divergence check reports 0 divergences between route registry and SPA runtime sources.
- **HTML Prerender Regeneration**: Regenerated all 336 pre-rendered HTML files (`pnpm run regen`) to ensure they carry the aligned metadata in their static output.
- **GSC Sitemap Submission**: Successfully executed `pnpm tsx scripts/gsc-submit-sitemap.ts` to ping Google Search Console and request immediate re-crawling of `sitemap.xml`, `sitemap-services.xml`, `sitemap-locations.xml`, and `sitemap-images.xml`.

---

## 🟢 Shipped — 2026-06-10 late (Review Replies: claim-safety QA + draft editing — stacked on the #57 posted-confirmation loop)

Two stacked PRs complete the Growth → Review Replies operator loop. **#57 (MERGED, squash `722934c7`)** closed the state machine: `reviewReplies.markPosted` (approved → posted + `postedAt`, only reachable from approved, DB-only owner confirmation — nothing posts to Google), `stats.oldestApprovedAt` rot signal + the approved-backlog amber banner, and the two-tap "Mark posted (DB only)" button. **#58** (this delta, retargeted to main after the #57 merge) adds the QA layer:

- **Claim-safety QA** `shared/reviewReplyQa.ts` (same rule family as the GBP Q&A seeds / studio pattern banks): block tier (guarantees, warranty talk, `free` except "free check", self-ranking, wait-time numbers, prices) + warn tier (kill-words, bot phrases, same-day). `approve` refuses server-side on block findings; the Growth UI shows live findings on draft cards and disables Approve until the draft is edited clean.
- **Both AI draft prompts** (router `fetchNewReviews` + the review-monitor cron) embed `buildReplyPromptRules()` from the same module, so drafts come out clean in the first place.
- **`updateDraft` now reachable**: the Growth UI gained an in-DOM edit box (the mutation existed with no UI — the operator could only approve-verbatim or skip).
- **Queue order**: `reviewReplies.list` orders worst rating first, newest first within a rating — angry reviews surface on top.
- Tests: `server/review-reply-qa.test.ts` (detector blocks/allows incl. the cron fallback templates + a phone-number false-positive guard + prompt/detector lockstep) alongside #57's 7 router tests (`server/__tests__/review-replies.test.ts`). No migration (`status` is varchar(20); `postedAt` already existed). No external side effects added.

---

## 🟢 Shipped — 2026-06-10 (11-PR ship night: tire money path hardened + admin grew Tire Orders / Ops Hub / Growth + both social studios)

Eleven PRs squash-merged to main in one evening (#42, #44, #45, #46, #47, #48, #49, #50, #51 + #52, #53, #54, #55 line; final main `a231e449`). What must now be true in prod:

**Money path (tire checkout — Stripe LIVE):**
- Online tire checkout hardened (#42): durable webhook dedup (atomic conditional UPDATE), price-tamper guards, collision retry, Sheets sync revival, Telegram per order, cancel/refund-risk alerts. Pay Now stays ENABLED (operator decision).
- ONE admin cockpit for tire orders (#46): the Money→Tire Orders tab and the #41 command center are consolidated; protection banners (payments.health / refund / stale-session) live there. Old URLs redirect.
- Google Sheets "Tire Orders" tab exists with the 24 canonical headers (operator-verified live edit). **Watch item: first synced order row not yet observed.**
- Still NO `stripe.refunds` call anywhere — refunds remain manual by design, pending owner approval of `docs/refund-writeback-design.md`.

**Admin shell — three new top-level sections:**
- **Ops Hub** (#47): owner-action registry (danger-zone truth), reports corpus, PREVIEW-ONLY customer message templates (no send path exists — it throws by design).
- **Growth** (#50 systems + #53 wiring): 7 tabs — Local Growth (IG autoposter armed-state booleans + Google reviews/Place-ID health), Review Replies (copy-only drafts; Approve/Skip/Mark-posted are DB-status-only, **nothing posts to Google** — "Mark posted" is the owner's after-the-paste confirmation that sets `postedAt`, and the tab shows an approved-but-unposted backlog banner off real DB state), GBP Q&A (17 claim-safe seeds), Photo Queue (deterministic weekly 6), Entity/Brand (canonical NAP checklist), Competitors (2026-06 baseline, honest gap math), Social Studios.
- **Studios** (#51 IG carousel, #52+#54 faceless reel, #55 tile): `/admin/ig-studio` + `/admin/reel-studio` + topbar icon links. DRAFT-ONLY — generation/publish/insights kill-switches all OFF.
- Deep-link aliases: `?tab=gbp|local|localseo|social` → Growth; `?tab=reviews` still → Outreach (review REQUESTS, unchanged).

**Safety/correctness fixes that must hold:**
- `docs/MIGRATION_AUDIT.md` is REDACTED in HEAD (#49) — but the leaked Stripe secret / TiDB URL / vendor passwords **live in git history → rotation is still owner-urgent**.
- GSC env-aliasing fixed (#50): `GOOGLE_SEARCH_CONSOLE_KEY` "configured" marker now derives from the service-account creds, NOT the Maps key — deleting the Maps key no longer silently kills Search Console sync.
- Dead links fixed, CAN-SPAM footer address corrected to 17625 Euclid Ave (#49).
- Web used-tire pricing stays the approved **"$25 installed (select 12-inch) / most $40-80"**; quoting channels stay $60 (two-tier policy unchanged — see 2026-06-03 section).

**Operator watch items:** post-deploy phone smoke (Admin → Tire Orders / Ops Hub / Growth / both studios) · armed-state card should read DISARMED + dry-run ON · first Sheets order row · credential rotation (rank 0).

Ledger of every item + evidence: `docs/PROJECT-COMPLETION-LEDGER.md` (repo root). Ranked queue: `docs/NEXT-BEST-ACTIONS.md`.

---

## 🟢 Shipped — 2026-06-04 (VAPI receptionist live-bug fixes + SMS pre-launch hardening — receptionist + SMS TURNED ON)

Operator turned the AI receptionist + customer SMS back ON; F25e gateway back online (was ~22h offline). A live-call review caught real bugs the static audit + harness-secret theory both missed; all fixed + deployed; new prompt pushed to the live assistant.

**VAPI receptionist:**
- **Tool args-parse — THE live bug (`3e20e5a7`):** the webhook dispatcher did `JSON.parse(call.function.arguments)`, but VAPI sends `function.arguments` as an already-parsed OBJECT on some events → `JSON.parse("[object Object]")` throws → EVERY custom tool (tireInquiry/bookSlot/lookupCustomer/checkTireStock) failed → the AI gave up and forwarded the call (why the call log was a wall of "Assistant forwarded call"). Fixed in `server/routes/webhooks/vapi.ts`: accept object-OR-string args. Webhook signature was always fine (tools reached the dispatcher). Same root cause as the `vapi-harness` "tool dispatch FAILED" checks — NOT a secret drift.
- **Conversion attribution (`3e20e5a7`):** dispatcher now injects the real `event.call.id` into tool args so bookSlot/tireInquiry/escalate stamp `convertedToLead` on `vapi_call_logs` (the LLM never supplies callId → was silently dead).
- **Prompt human-ness (`0720a97d`, pushed live to 150fe622):** killed two robot tells from a real call — (1) re-greeting/re-announcing the shop after a caller's "hello?/you there?" → now a brief reassure, never a second intro; (2) stacked filler ("Give me a moment. Hold on…") → one line then act. Added to the kill-list + HOW YOU TALK in `ASSISTANT_SYSTEM_PROMPT`; no logic/tool/transfer change.
- **"Push Latest Config" was updating the WRONG assistant (`0c197739`):** the two VAPI assistants share the display name "Nick's Tire & Auto Receptionist" but are DIFFERENT — **`150fe622` = INBOUND receptionist (`VAPI_RECEPTIONIST_ASSISTANT_ID`, phone-bound, every live call); `afcad79e` = OUTBOUND follow-up (`VAPI_FOLLOWUP_ASSISTANT_ID`)**. The panel pushed `status.assistants[0]` = the follow-up, so the receptionist never received new config. Fixed: `vapi.updateAssistant` defaults `assistantId` to `VAPI_RECEPTIONIST_ASSISTANT_ID` server-side; the panel button stops passing the first-in-list id. **Do NOT delete `afcad79e` — it's the follow-up assistant, not a duplicate.**

**SMS — pre-launch hardening (`8a92375b`):**
- **TCPA: non-exact STOP now honored.** `smsResponseParser` + `smsBot` were exact-match only ("STOP please" / "Stop texting me" did NOT opt out); the shop F25e gateway has no carrier-level opt-out, so the app must catch variants → now leading-keyword match. CANCEL-as-cancel-appointment preserved in the parser.
- **Appointment reminders no longer silently dropped:** `sms-scheduler` passes `transactional: true` for confirmation/24h/1h/thank-you so they bypass the promo daily-cap + 5-min cooldown; `maintenance-reminder` stays capped (it's promo, keeps its STOP footer).
- **Campaigns:** per-batch gateway reachability re-check — if F25e dies mid-blast, remaining rows stay `pending` for `resumeStuckCampaigns` instead of phantom `sent`.

**Env confirmed (railway `MAINnicks-tire-auto`):** `VAPI_WEBHOOK_SECRET` SET · `VAPI_API_KEY` SET · `VAPI_RECEPTIONIST_ASSISTANT_ID=150fe622…` · `VAPI_FOLLOWUP_ASSISTANT_ID=afcad79e…`. Phone `+1 216 424 9249` inbound assistant = the receptionist (VAPI dashboard); phone-level **Fallback Destination is EMPTY** (optional hard-failure safety net — set to the shop line if wanted).

⚠ **Operator spot-check pending:** live test-call to confirm tools answer naturally + no re-greet + clean transfer.

---


## 🟢 Latest shipped — 2026-06-03 PM (front-facing site audit: truth + two-tier tire pricing, 8 commits)

**Tire pricing is TWO-TIER by surface (canonical current state):**
- **WEBSITE + its SEO/crawler layer** (hero, LocalBusiness + FAQPage schema, `client/public/ai.txt`, the `_core` LLM site-index): used tires **"from $25 installed"** — a deliberate decoy hook — carrying the fine print **"12-inch rims, subject to availability"** + the honest band **"most sizes $40-80"**. Centralized in `BUSINESS.usedTires` (`shared/business.ts`).
- **QUOTING CHANNELS** (phone VAPI, SMS, voice agent, web chatbot `gemini.ts`, IG autopost, the AI price-compliance validator): used tires **"$60 installed"** — the real average. High-intent callers (often sending tow trucks) get the honest price, not the decoy. `838c1968` reverted a brief $25 experiment back to $60.
- **NEW tires "from $89 installed"** everywhere (`BUSINESS.newTires`) + positioning "Any tire, any brand. Nick never says no" (no ™). **GBP** pricing ($60) held/untouched.
- VAPI live assistant `150fe622-…` re-deployed at $60 (PATCH 200, transfer `+16056916315` + 10 tools preserved).

**Truth fixes (were broadcast to Google + AI answer engines):**
- **Warranty:** false **"36-month/36,000-mile"** → canonical **12-month/12,000-mile** across `shared/services.ts`/`blog.ts`/`guides.ts`/`seo-pages.ts`, the chatbot (`gemini.ts`), GBP/IG generators, and `client/public/{ai.txt,business-data.json,services-schema.json}`. The legit 36-mo **battery** warranty (`server/routers/nick/utils.ts`) left intact.
- **Founding:** "Since 2005" (LandingPage) + "over 20 years"/"1,688 reviews" (WomensSafety) → real **2018 / 1,700+**.
- **Geo:** removed `scripts/patch-prerender-copy.mjs` rules that reverted the canonical Google-pinned coords (`41.5525118/-81.5571875`) back to wrong, + its straggler-check that flagged the CORRECT coords as stale.

**Brand-voice / SEO / chrome / visual:** "family-owned"→"family-run" (/about, /careers SEO + TrustStrip chip); NotificationBar self-"trust"→concrete; quality/premium/"inspection" kill-words cleared on touched lines; DiagnosticsPage gained the "| Nick's" title suffix; PriceEstimator breadcrumb leaf `/estimate`→`/pricing`; StatusTracker dead `rounded-2xl rounded-lg`; RoundupTile slug formula 404'd 4/7 competitors → explicit route map; **BookingPage** wrapped in `PageLayout` (CustomerPortal + LandingPage left chrome-less by design); DiagnosePage/SharePage/TrackJob/WomensSafety hardcoded hex/gray → design tokens (~145 classes, zero-shift); undefined `--nick-yellow-alpha` → `--color-nick-yellow`.

**Commits:** `66d5fda6` (site truth + $25/$89) · `c0e190e0` (brand-voice/SEO/links) · `15c47e10` (dead-links) · `aa6e69d0` (chrome+tokens) · `6df2ebda` (channels→$25, **SUPERSEDED**) · `838c1968` (channels→$60). Each: tsc 0 · brand-voice 0 · build green · landed attempt 1. ⚠ **Prerendered `prerendered/*.html` refreshes on the next CI regen** (Puppeteer broken on this Windows box; the live hydrated site is already correct). Detail: `docs/frontface-audit/{PLAN,CHANGELOG}.md`.

---

## 🔵 Latest shipped — 2026-06-03 (admin overhaul + customer dedup + code-underneath + architecture decisions + SMS voice sweep + VAPI receptionist slim-down)

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

**DECISIONS 1-3 RESOLVED (wave-182, `96ba44d9` — pure-code, reversible, no migration, no prod data-write):** (1) `work_orders.customer_id` polymorphic-join miss FIXED — both reconciliation joins (`customerMetricsRefresh` backlog + `dataPipelines` visit-date) now resolve each WO to its customer by numeric-id OR last-10-digit phone; chose phone-fallback over a new int column + prod backfill (YAGNI at 1,943 customers, zero drift). Bonus: the `dataPipelines` WO query had camelCase cols against the snake-case `work_orders` table -> threw every run -> visit dates never synced from WOs; corrected. QC-comeback false-positive (all anon walk-ins share one sentinel string) also killed. (2) `customers.segment` single-owner DONE — `enrichCustomerData` step 6 is authoritative w/ full-population coverage; the redundant 3x-registered `customerSegmentation` cron is a no-op (reversible). (3) "Total revenue" canonical = **PAID-only** — `customers.advancedStats` (5 queries) + statenour bridge feed (3) standardized to `paymentStatus='paid'`. **STILL OPEN:** (4) GBP content generator fabrication (held — say "unhold GBP"). **DEFERRED (flagged, need live-SMS verification):** app-layer SMS-resolution rewires (`dropOffFlow`/`workOrderService`/`declinedWorkRecovery`/`generateStatusMessage` skip phone-keyed walk-ins) · dead `customerMetrics.totalRevenue` (always 0, read by `vipLookup`). Detail in `docs/admin-surface-audit/SESSION-CHECKPOINT.md`.

**SMS messaging — voice + compliance + reliability (wave-182, `4238dbc0` + `55dd7bad`):** Every customer-facing SMS (~80: transactional, retention D7-D365, declined-recovery 15-variant, win-back 20, drip, cross-sell, drop-off lifecycle, no-show/expired/callback/VIP/referral, admin campaigns, after-hours, lead) was rewritten to a **business-voice contract: no per-customer interpolation** (no `{firstName}`/`{vehicle}`/`{service}`/`{money}` — args retained + `_`-prefixed so callers/tests are undisturbed), no planted negatives, kill-list-clean, all within `.claude/brand-voice-guidelines.md`. Brand-law rules now honored in copy: only the 3 price anchors ($60 tire / $49 oil / $80 synthetic), no "same-day" promise (rule #3), no "Nick personally" (rule #2); the Uber-ride claim (operator: not real) and the fake drip `{{referralCode}}` removed. **TCPA opt-out** now on ALL win-back (`personalizeWinbackBody`→`withOptOut`) + ALL drip (`dripProcessor`→`withOptOut`) — the gap is closed. **NickGPT SMS-drafter** (`nickgpt-client.ts`) + its corpus twin (`scripts/export-sms-corpus.ts`) now carry the 3 anchors + a no-other-repair-price rule, so the model can't text a wrong price. Landmines fixed: business name standardized to "Nick's Tire & Auto" (was truncated "Nick's Tire" in campaigns), `BUSINESS.usedTires` `$40`→`"$60 installed"`, tagline `"Cleveland's Trusted Shop"`→`"Cleveland's walk-in tire & auto shop"` ("trusted" is a kill-word). Only operator-confirmed offers kept ($25 referral, 10% VIP/win-back, 4.9★/1,700+, $10-down, $49/$80). Brand-voice CI lint = **0 violations**; 12 SMS tests realigned to the name-free contract.

**SMS reliability — phone-keyed walk-in skip RESOLVED** (the DEFERRED item from the decisions block above is DONE, `55dd7bad`): `server/lib/resolveWorkOrderCustomer.ts` (numeric-id → last-10-digit phone fallback, mirrors `getTrackingInfo`; 5-case unit test) now backs the drop-off / pickup / review-on-close / status-message send paths, so phone-keyed AI-chat / walk-in WOs stop silently missing texts (`dropOffFlow.getWorkOrderContext` used to **throw** for them). Additive — numeric-id WOs unchanged. `declinedWorkRecovery` confirmed (grep) to be estimate/phone-keyed and never touch `work_orders.customer_id`. **NOT a live bug (corrected):** the audit's "24h/7d double-send" — `runFollowUps` (bookings-based) is a **manual admin button only** (`admin.ts:1065` ← `FollowUpsSection`), not on any cron, and the automated path is sms-scheduler; both have at-most-once guards, so there is no automatic double-send.

**VAPI inbound receptionist — front-to-back slim-down, DEPLOYED LIVE (wave-182, `0c4fa0fe`):** `ASSISTANT_SYSTEM_PROMPT` (`server/services/vapi.ts`) compressed **~40k → 17.3k chars (56% leaner, ~4.7k tokens)**, **behavior-preserving** (in-place section compression). Cut: embedded `wave-X audit` rationale + stats, the Honda/Camry example dialogues, cross-section duplication (Repair Haiku / FCFS / pricing / transfer-gate stated once), verbose tool descriptions, the curiosity/FCFS phrase sub-banks. KEPT (zero behavior dropped): tire-first bias, full kill-list (the corporate-adjective enumeration compressed to a **lint-safe category** — the brand-voice CI lint flags those literal words on a rewrite, and the VOICE rule already covers it), all 6 hard rules + the 3-anchor pricing discipline + the VAPI liquid time-template `{{"now" | date …}}` verbatim, all 9 custom tools + `transferCall`, all 4 flows (3-beat repair close intact), every special case (tow play / rack-check / flat / FCFS / wrong-number / Spanish-Arabic / vehicle-at-shop), all 8 trust phrases + 8 urgency lines, SMS-degraded, name-echo, compliance, if-stuck, core. **DEPLOYED** via `railway run -s MAINnicks-tire-auto npx tsx scripts/vapi-update-assistant.ts` (VAPI_API_KEY injected) → PATCH 200 on assistant `150fe622-…`; dashboard transfer number `+16056916315` preserved (fetch-and-merge), 10 tools live, gpt-4o + Brian voice + greeting unchanged — **answering live calls now**. `FIRST_MESSAGE` + `VOICEMAIL_MESSAGE` + the 3 outbound prompts untouched. ⚠ Not yet live-call-tested (operator spot-check pending). Old→new behavior map: `docs/vapi-receptionist-simplification.md`. Reversible: `git revert` + re-push.

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
