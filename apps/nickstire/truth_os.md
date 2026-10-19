# Nick's Tire & Auto Current Truth

This compatibility entrypoint exists because repository instructions historically referenced `truth_os.md`.

The active operating contract is:

- [`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md)
- [`docs/METRICS-CONTRACT.md`](docs/METRICS-CONTRACT.md)
- [`docs/ISSUE-REGISTRY.md`](docs/ISSUE-REGISTRY.md)
- [`docs/REVENUE-OPS-ROADMAP.md`](docs/REVENUE-OPS-ROADMAP.md)
- [`docs/operations/SMS-REVENUE-AGENT-OS.md`](docs/operations/SMS-REVENUE-AGENT-OS.md) — operator runbook for the SMS Revenue Agent OS (2026-07-29 arc: levers, gates, daily loop, symptom table)

## What is ARMED in production — read this, do not quote it

**Nine of the ten flags that produce an external side effect are ON.** Read at
2026-08-16T11:53Z from the live `MAINnicks-tire-auto` service, not from a doc and
not from `.env`:

| flag | live | side effect when ARMED |
|---|---|---|
| `FEATURE_DECLINED_RECOVERY` | `1` | SMS · "you declined this work" follow-ups (ROS-093) |
| `FEATURE_VOICE_RECOVERY` | `1` | VOICE · outbound recovery calls |
| `FEATURE_CONFIRMATION_CALLS` | `1` | VOICE · outbound confirmation calls |
| `FEATURE_FOLLOWUP_CADENCE` | `1` | SMS · multi-touch follow-up cadence |
| `ENABLE_CUSTOMER_CONFIRMATIONS` | `true` | SMS · booking confirmations, and since 2026-10-18 the one "Text me this quote" text from a /tires top-pick card (`quoteTexted` template, `tireQuote.text`): same flag, same pause key, customer_confirmation class, so it is not held for quiet hours |
| `REEL_PUBLISH_ENABLED` | `true` | PUBLISH · reels to Instagram, and since #2865 the same door gates reel VIDEO to the Facebook Page |
| `REEL_FB_CROSSPOST_ENABLED` | `true` *(set 2026-10-01 17:19Z, operator instruction)* | PUBLISH · the nightly reel cron also hands the reel to the Facebook Page as a video reel. Instagram stays the authority; FB failure only logs. Inert until #2865 is the running container. **An AI-generated reel stays off the Page** (2026-10-01 fix): Facebook's Reels API has no AI-disclosure field, so `publishToSocial` skips it and logs why; Instagram still gets it, without `is_ai_generated` since 2026-10-11 (operator removed the self-disclosure: `META_AI_SELF_DISCLOSURE=false` in `shared/reelDisclosure.ts`; Rule 1 real-evidence block unchanged). An ambiguous FB finish parks the job like a live one, and the reconcile pass hands an attempt that went to Facebook to the operator instead of releasing it. |
| `REEL_AUTOPOST_ENABLED` | `true` | PUBLISH · unattended posting |
| `REEL_COMMENT_RESPONDER_ENABLED` | `true` | PUBLISH · public replies to IG comments |
| `REEL_FILM_GRAIN` | `true` *(2026-09-09)* | RENDER · adds moving luma grain + vignette to every reel ASSEMBLED from now on. Not a send, but it changes what every future viewer sees, and it is the only flag here that alters pixels. Already-assembled reels keep the look they were rendered with. |

Four of these — the voice and cadence flags — had **never appeared in any
canonical doc** before 2026-08-16. They were not stale; they were absent. Nobody
reading this file would have known Nick was placing outbound calls.

**Runtime pauses for these lanes (C5.5, 2026-10-17).** Each env send lane also reads a
`feature_flags` row through `server/services/sendPause.ts` (5 s cache), so a lane can be
stopped from the admin Feature Flags panel without a redeploy. TRUE = paused. A lane checks at
its start gate, again (fresh) before each send in its loop, and in the delayed SMS queue drain. A new
send is skipped, not queued; a text already in the delayed queue is held there and goes out on
resume (`sendSwitchesStatus.heldQueued` counts them). No value is asserted here: read `instagramAdmin.sendSwitchesStatus`.

| pause key | holds | unreadable switch |
|---|---|---|
| `send_pause_voice_outbound` | every outbound AI voice call (`FEATURE_VOICE_RECOVERY`, `FEATURE_CONFIRMATION_CALLS`, `FEATURE_FOLLOWUP_CADENCE`, manual follow-up call) | HOLD (fail closed); the manual follow-up call SENDS (operator present) |
| `send_pause_customer_confirmations` | tire-order confirmation texts and emails, and the /tires quote-by-text (`ENABLE_CUSTOMER_CONFIRMATIONS`) | SEND (fail open, 1:1) |
| `send_pause_declined_recovery` | declined-estimate texts (`FEATURE_DECLINED_RECOVERY`), cron and run-now | HOLD (fail closed) |
| `send_pause_weather_sms` | weather texts (`WEATHER_SMS_SEND`) | HOLD (fail closed) |
| `send_pause_missed_call_recovery` | missed-caller texts (`MISSED_CALL_RECOVERY_SEND`) | HOLD (fail closed) |

Reel publish, autopost and the comment responder keep their own switches (`publishingKillSwitch`, `*_paused`).

**Regenerate, never retype:** `node scripts/probe-live-send-flags.mjs`. A flag
value written into a doc is a cache with no invalidation — on 2026-08-15 this
file asserted `FEATURE_DECLINED_RECOVERY=0` on the authority of
`docs/ISSUE-REGISTRY.md` while the service had it at `1` and the cron was sending.
`scripts/audit-feature-flag-state.ts` could not have caught it: it reads the
`feature_flags` DB table, and every flag above is an environment variable.

Two 2026-08-07 contracts worth knowing before you debug a quiet automation, both
detailed in `docs/CURRENT-TRUTH.md`:

- **Live IG publishing is gated by an independent judge, fail-CLOSED.** If the
  judge lane is unreachable, autoposting pauses loudly rather than publishing
  blind. Escape hatch: `IG_SHADOW_JUDGE=false`.
- **The AI receptionist prompt has a measurement loop behind it** (Call Ossuary →
  ghost replay → weekly optimizer). It only ever emits PROPOSALS — **Push Config
  is still the one serving gate**, and four prompt fixes reached the live line
  that way on 2026-08-07.
- **A weekly revenue digest now exists** (2026-08-07): Monday Telegram push of
  paid-invoice mirror revenue, WoW delta, repeat-revenue share and
  arrivals→invoice receipts — `server/cron/jobs/weeklyRevenueDigest.ts`,
  contract in `docs/CURRENT-TRUTH.md`. The weekly intelligence report
  previously never read `invoices` at all.
- **A weekly Search Console digest now exists** (2026-10-08): Monday Telegram push
  of the official 28-day GSC totals vs the prior 28 days, top queries/pages, and
  CTR opportunities + 7-day ranking moves from the `search_performance` mirror
  (which it labels empty/stale instead of rendering as "none") —
  `server/cron/jobs/weeklyGscDigest.ts`, `weekly-gsc-digest` in the hourly tier.
  GSC numbers previously reached the operator only by pull.
- **The ScanFinish wave landed (2026-08-13, #1552/#1553):** the reel lane's
  independent judge runs **shadow/log-only** (image-lane gate unchanged,
  fail-closed); reel brief feedback is REELS-first with a disclosed fallback;
  campaign-keyword comments get a no-DM public hand-off inside every existing
  responder gate; a read-only **SMS autonomy census** (declared ceiling vs live
  mode, registry-derived) sits under the Rollout Control Center; Today gained
  the **Arrival load** strip (walk-in planning signal — there is deliberately
  no calendar/slot model); and customer-touching "today" math moved off bare
  `CURDATE()` onto shop-time `getBusinessDateKey()`. Contracts + scope notes in
  `docs/CURRENT-TRUTH.md`; per-finding receipts in
  `docs/NICKSTIRE-SCAN-LEDGER.md`.
- **ScanFinish Run 2 landed same day (2026-08-13, #1558/#1561):** the reel
  lane now has a real **anti-repetition memory** (the autonomous daily brief
  regenerates on a topic that repeats the last 21 days of `reel_jobs`; the
  draft lane gets the same history as a soft `avoidTopics` steer); a
  **job-level free-lane fallback** closes Veo's zero-resilience gap (a
  terminal paid-provider verdict re-queues ONE forced `template_stock`
  attempt when `REEL_FALLBACK_TO_TEMPLATE_STOCK=true`, instead of publishing
  nothing); an **originality/QC checklist** runs shadow/log-only beside the
  judge (now incl. voiceover claim-safety and muted-first, one KV verdict per
  job); the **attention-microstructure swipe file** and a **multilingual dub
  worklist** render on the Learn admin page; and a curated **Local Discovery
  topic library** (Cleveland/Euclid, E-Check web-verified) feeds the topic
  miner — E-Check topics route through the government-evidence gate, never
  around it. `reel_jobs.payload` readers must use
  `shared/reelJobPayload.ts`'s `parseReelJobPayload()` (post-merge audit:
  ad-hoc inline payload types produced a structurally-dead field twice).
  Kling/LTX-2/TikTok Symphony: WATCH, deliberately not built. Contracts in
  `docs/CURRENT-TRUTH.md`; receipts + the audit-round-2 postmortem in
  `docs/NICKSTIRE-SCAN-LEDGER.md`.
- **An AEO proprietary-data price page exists** (2026-08-11):
  `/tire-prices-cleveland` publishes canon floors plus live per-size retail
  floors from the Gateway feed via public `gatewayTire.publicPriceRanges`
  (rounding parity with `publicSearch`, pinned). The daily
  `refreshGatewayPrices` cron now also persists the aggregated floors to
  `shop_settings.tirePriceFloors` so cold pods and prerender can serve them —
  retail only, wholesale never leaves the server. Live sections self-suppress
  when the feed is cold (canon floors render, never an empty table).

## 2026-10-19 - revenue_reconciliation_candidates retention: the count is live after deploy, the delete is OFF (#3163)

- **Why:** `revenue_reconciliation_candidates` is derived. The 2-hour reconciliation run re-inserts one row per call in its 21-day
  window, and both readers (`routers/revenueAttribution.ts`, `services/promptEvolution.ts`) keep only the newest row per `call_id`.
  A row with a newer sibling for the same call is invisible to every reader; nothing ever removed them.
- **Nightly count, LIVE once this deploys (counts only, no text column):** the `cleanup` job appends
  `recon candidates: rows N, calls M, superseded S, deleted D (flag off|on|unreadable)` to its `details`, so `cron_log` carries it.
  `unavailable` means the table or the read failed (UNKNOWN, never zero). Code: `server/services/revenueReconciliationRetention.ts`.
- **Delete path, BUILT + WIRED, default OFF** behind the `revenue_recon_retention` feature flag (seeded OFF). When ON it runs one
  single-table DELETE per call that has more than one row, bounded by `UNIX_TIMESTAMP(created_at) <` that call's newest time, so
  the newest row per call (and any row tied with it) is never selected. Per run: at most 200 calls and about 60 s; the time budget
  is checked between statements, so one slow DELETE can run past it and only the cleanup job's own outer timeout bounds that.
  The rest waits for the next night. It reads the flag row **fresh and fails closed**: a failed read deletes nothing and shows
  `(flag unreadable)`; it does not use the cached `isEnabled()`, which keeps its last value when a refresh fails.
- **Rollout gate (all three, in order):** the first nightly count is read and looks right; a fresh nightly TiDB backup exists
  (`tidbBackup.ts` copies this table weekly); the operator says go. Nobody turns the flag ON before that.
- **Evidence so far:** the retention SQL was run on TEMPORARY tables on TiDB by the manager on 2026-10-19: 31 of 31 checks passed.
  The real table, read-only at 2026-10-19 00:26Z: 352,083 rows, 3,626 distinct calls, 348,457 superseded, and 0 rows tied at a
  call's newest time (every call has exactly one row at its newest time).
- **What the figure means:** `superseded` is rows minus distinct calls, an upper bound on what one DELETE pass removes whenever
  rows tie at a call's newest time. Production has no such ties today, so there it equals the removable count.
- **Not yet observed:** a nightly `cron_log` row carrying the line; a real DELETE on the production table (none has run).

## 2026-10-18 - Tire finder by vehicle, Kafene first, order completion (#3148 live, #3152 merged)

- **/tires finds sizes by vehicle** (`fitment` router, `server/services/fitment/dkFitment.ts`): year > make > model > trim >
  factory sizes from D&K's own b2b quicksearch through the Gateway Tire login. No new vendor. LIVE: deploy `0b8cb5bae`,
  `fitment.status {available:true}`, 2018 Honda Civic LX -> 215/50R17, 215/55R16, 215/55R17, 235/40R18. When the Gateway login
  is down the tab hides and size search stays. Per-IP limits (20/min, 120/15 min), single flight, 30 s negative cache.
- **Top picks** above the results (lowest, best value, premium) with Call, Request, Apply with Kafene and More payment programs.
- **Payment Programs are five, Kafene first** (`shared/financing.ts`, `shared/business.ts`): Kafene, Acima, Snap, Koalafi,
  American First. Copy, SMS planner, voice classifiers, chat tools, GBP and ad copy all say five. `financing_clicks.provider`
  gains `kafene` by **migration 0147 (operator step, admin Run Migrations)**; until applied a Kafene click opens the application
  and the click row is dropped with a warn. The Vapi keyword list gained Kafene: **Push Latest Config** is an operator step.
- **Order completion (#3152, squash `8b189e8b7`; live when Railway deploys it):**
  - Admin one-tap supplier order at D&K (`gatewayOrder.prepare/submit/clearOurLines`, `services/gatewaySupplierOrder.ts`):
    cart from the order lines, PO `online order <order number>`, CAS claim so two taps place one order, unclear submits park as
    `uncertain:<uuid>`, doubled carts refused (`cart_mismatch`). **Behind `GATEWAY_ORDERING_ENABLED` (off) and `money.manage`.**
    A Kafene-leased order (never "paid") counts as paid for this once its lease is signed.
  - Kafene keyless bridge, ON at deploy: Apply with Kafene in the order modal calls `kafene.applyStarted` (order note, one
    Telegram to staff with the phone masked, once per order per day, 5 calls/IP/hour); admin lease panel shows "Application
    started on the website". **Migration 0148 (`kafene_leases`) is an operator step**; before it, the Telegram still goes and
    the panel says the records are not installed.
  - Kafene keyed path, DORMANT: checkout SDK, `start/attach/markSigned`, admin activate (after install) and cancel through the
    Partner API; every call answers `disabled` until `KAFENE_MERCHANT_ID`, `KAFENE_STORE_ID`, `KAFENE_API_KEY` exist. Kafene
    issues those to e-commerce stores only; the rep must enable the store. Kafene's own plugin ships the same key to the browser
    SDK and the Partner API (one key by their design).
  - Order-modal links carry what each provider accepts (`providerApplyUrl`): Koalafi `phone=` (verified prefill), American
    First `amount=` + `reference=`; Kafene, Snap, Acima unchanged.
- Research: `docs/research/2026-10-18-competitor-tire-finder-teardown.md` (9 chains, provider apply pages, Kafene portal).

## 2026-10-16 - Observability is proven by planted positives, not by env presence (branch nickstire/observability-proof, NOT yet merged)

- `GET /api/system/observability-status` (Bearer `ADMIN_API_KEY`) answers HEALTHY / DEGRADED / UNKNOWN per instrument (Sentry, Langfuse) from in-process counters (`server/lib/observabilityStatus.ts`); keys unset, zero acks or a proof older than 12 h read UNKNOWN, never HEALTHY. Counters reset on every deploy.
- `POST /api/system/observability-probe` (same gate) plants one Sentry message tagged `probe_id` + `commit` and one synthetic Langfuse generation, then reports `ok` only on the sink's own 2xx. Sentry's release is now the deployed commit; `/api/health` `checks.sentry` says `dsn_set` plus receipts, no longer `configured`.
- Langfuse tracing covers every server AI call site, including calls that throw (`server/langfuseTraceGate.test.ts`, `server/langfuseThrowTraced.test.ts`). A trace carries NO free text by default: model, prompt sha256, input/output character counts, tokens, latency and an error class; masked excerpts are opt-in per call and enabled only for the probe (the masker misses names like "Lopez, Maria 44101"). Keys were set on the nickstire service on 2026-10-17; not yet proven by a production probe.
- `customer_notifications.status` gains `skipped` (drizzle/0146); follow-up Cancel keeps failing in production until that ALTER is applied (Admin > Settings > Run Migrations).

## 2026-10-16 - Telegram alert diet: one sender per event, once per state, a class on every send, and honest counts

- **One sender per event.** The event bus `telegram` destination (`eventBus.ts`) is the only nickstire sender for a captured lead, callback, chat lead, booking and completed job. `lead.submit`, `callback.submit`, the chat lead capture and `autoCreateLeadFromBooking` no longer call `alertNewLead`; the bus writes the `lead_delivery_events` telegram row (sent only when the transport accepted, failed otherwise). The StateNour bridge (`/api/webhooks/nickstire`) still sends its own copy of lead and job-complete: that is the statenour lane's cut. `live_telegram_feed` (liveFeed destination) is a separate flag-gated path, not touched.
- **Once per state.** `revenue-pulse`, `promise-risk-check` and `stale-estimate-alert` claim a `cron_alerts_fired` row (`services/alertClaim.ts`, INSERT IGNORE, fail open) before they send: key = state (revenue band, fingerprint of the at-risk orders or the stale list), `fired_for` = the Cleveland shop day. Same state sends nothing, a changed state sends once, ET midnight resets. Not covered: `feedbackLoop.ts` "Revenue pacing" and `nickIntelligence.ts` proactive checks still repeat; they are classed digest only.
- **Per-SMS gateway alerts are gone** (`sms.ts` fallback helper with the false "falling back to Twilio" text, and the `sms:failed` webhook send). A transport failure on an immediate SMS (timeout, HTTP error, connection failure) sends ONE incident per ET day per error kind (`sms-gateway-transport:<ET date>:<kind>` claim, naming the count so far and the last error); a sustained outage is also alerted once per incident by `smsGatewayHealthMonitor` and the stuck-queue alert in `sms.ts`.
- **Classes.** `services/telegram.ts` takes an optional class: `incident | digest | approval | receipt | noise`. Unclassified = incident, so nothing nobody classified changes. About 57 sites in 36 files are classified (digests, receipts, three approvals incl. the AUTO-CONTENT article draft; the DVI customer decision is pinned as an incident; the live feed is a digest so `live_telegram_feed` stays its only gate); `server/telegramCallSiteClasses.test.ts` is the table. Flags on the admin flags page: `telegram_incident_muted`, `telegram_digest_muted`, `telegram_approval_muted` are PAUSE flags (default FALSE = sends; an unreadable flag table never silences an incident, same polarity as `sms_global_pause`); `telegram_receipt` is an ENABLE flag, OFF by default (receipts are held and counted in the daily summary line). `noise` is never sent. A held send returns true (a decision, not a failure) and is counted per class.
- **Honest counts.** Dead batching removed. A send dropped by the 20-per-second limit is counted (`rateLimited`; the limiter now counts at admission, it counted after the await so a same-tick burst never tripped it). The daily summary carries `Telegram: N sent, M dropped by rate limit, K failed, R receipts held (since last restart)` from `getTelegramStats`. The counters are per process: they reset on every deploy, so the line is "since last restart", not a day total. `notifyOwner` returns false when it only logged; the follow-up report goes through Telegram only when it did not deliver; vendor health also reads the chat id with `getChat`.

## 2026-10-16 - Reel quality fixes: real-footage cuts, one-plate captions, voice env, start frame only where the photo was taken

- Cuts (`reelAssembly.ts` `planSegmentTrim`): a non-last beat whose probed source covers `dur + 0.5` now runs real footage through the 0.5 s xfade instead of clone-freezing its last frame, and a source with 0.5 s more skips the clips' first-frame hold (`trim=0.5:...`). Short or unprobed sources keep the old trim and clone pad. Offsets and the total (beats + 3 s SAVE) do not move.
- Captions: each caption is one `drawbox` plate (black@0.6) behind its per-line text runs; the old one-box-per-line drawtext overlapped about 35 px on two-line captions. The beat anchor stays `h*0.55`: 0.68 would put every beat caption inside Instagram's bottom 35% (`captionSafeZone.test.ts`). Text runs stay one per line because drawtext drew the LF as a tofu box (#829).
- Voice env (`reelVoice.ts`): `REEL_VO_PROVIDER` (`google` or `elevenlabs`; unset keeps "Google key wins"; naming a provider whose key is missing fails the job loudly), `REEL_GOOGLE_VOICE` (default `en-US-Neural2-J`), `REEL_GOOGLE_SPEAKING_RATE` (0.97, accepted 0.25-2.0), `REEL_GOOGLE_PITCH` (-1.5, accepted -20 to 20); a value outside its range falls back to the default with one warning. A voice name containing `Chirp` keeps SSML and the rate and sends no pitch. No env set = the same request as before.
- `scripts/reel-voice-candidates.ts`: dry run prints four Google request bodies; `--execute` renders Neural2-J and Chirp3-HD Charon, Orus and Enceladus for one script into `data/generated/voice-candidates/` (a few cents; delete the folder after choosing). The brief critic gained rule 6: short sentences, a comma where a breath goes, no sentence over 14 words.
- Start frame (`shared/reelStartFrame.ts` `startImageForBeat`): with image conditioning on and a real shop photo as hero (`visualWorld.style` `real_shop_still`), only a beat whose visual names the storefront, bay door, lot or exterior starts from it; underbody, lift, macro and road beats render text-to-video. A generated hero frame still anchors every beat. Both pipeline lanes use it. The repair lane (`selectiveRepair.ts`) still hands the hero to every repaired beat.
- Live proof owed: the first render after deploy shows about 690 frames for a 5-beat 20 s reel, no frozen frames across each 0.5 s fade (assembly does not log the filter graph, so read the frames), one plate per caption, and the TTS request body naming the chosen voice. The unbranded-hardware and no-morph prompt lines for the generator pack are a client-lane patch, not in this change.

## 2026-10-16 - Reel comment responder gets gates, an audit trail and admin controls

- `runReelCommentResponder` (cron and the Meta comment webhook) now stops before any DB or Graph read unless `REEL_COMMENT_RESPONDER_ENABLED` is exactly `true` and the new inverted flag `reel_comment_responder_paused` is off. Before this the cron read ENABLED as truthy, the webhook as exactly `true`, and the service read only LIVE.
- A live run asks the autonomy publishing kill switch once; instagram blocked (or the switch unreadable) makes that run a dry run whose cron_log details start `kill switch: replies drafted, not posted`.
- Every reply attempt writes one `autonomy_audit_events` row, action `comment_reply`, decision POSTED, FAILED or DRY_RUN, with media, comment and reply ids, tone and our reply text. The customer's comment text is never stored.
- `instagramAdmin.commentResponderStatus` (contract v1) feeds the comment responder card on Admin -> Instagram -> Pipeline health: enabled, live, pause, last run, the last 20 replies and 7-day counts. A failed read is UNKNOWN or `available:false` and still carries the pause state.
- Live state 2026-10-16: ENABLED and LIVE both `true`, 0 replies since 2026-10-03. Live proof owed: one pause logs `Skip — paused by reel_comment_responder_paused` on the next pulse, and the first live reply after deploy shows as a POSTED row on the card.
## 2026-10-16 - External clips door: operator-rendered beats enter the pipeline before assembly

- `instagramAdmin.attachExternalClips` (admin mutation, contract v1, `server/services/externalClips.ts`) takes `{ jobId, clipUrls, source: "higgsfield-web", startFrame: "none" | "shop_still", model?, note? }` for a `needs_regen` or `queued` reel job (`startFrame` is the operator's attestation; only "none" lets rendered QA judge the reel on its lens world) and returns `{ ok: true, jobId, clipCount, rehostedUrls }` or `{ ok: false, refusal }`; refusals are never thrown. Built because the Unlimited models (Wan 3.0) exist only in the higgsfield.ai web app and API credits are gone until November 1.
- It refuses unless there is one https clip per GENERATED beat (local beats must already hold their clip), durable storage is configured, and every clip downloads under 60 MB in 60 s with an SSRF guard, starts with an `ftyp` box and probes at least 4 s. All clips are checked before any is re-hosted; then one compare-and-swap on id, status, payload and clipUrlsJson sets `assets_ready` (attempts 0, error null) and merges `payload.externalClips` (source, model, note, attachedBy, attachedAt, the vendor URLs). One `attach_external_clips` audit row per call, OK or REFUSED.
- Clips are re-hosted through `storagePut` under `reel-clips/higgsfield-external-...`; that `higgsfield-` path segment is what makes `shouldDiscloseAi` read them as AI under every `REEL_VIDEO_PROVIDER` pin (template_stock and self_hosted included), and the attach refuses if a re-hosted URL does not read as generative. The door does not approve or publish; it settles no generation reservation.
- Live proof owed: on the first real attach (job 2100001) the row shows `assets_ready` with the re-hosted URLs, the next reel-pipeline pulse moves it to `assembled` with renderedQa present, and the publish carries the AI label.

## 2026-10-16 - Image autopost lane gets admin controls

- New inverted flag `ig_autopost_paused` (TRUE = paused). `runIgAutopostCron` checks it after the slot gate and before the dedupe read and any generation or spend; the manual Run-a-slot-now door ignores it. Turning `legacy_autopost_live` OFF still only makes the lane a dry run that spends.
- `instagramAdmin.autopostLaneStatus` (contract v1) returns pause and live state, the last post, today's slots, the last 20 runs and 7-day counts. A failed read is UNKNOWN or `available:false`, never 0.
- The 'Image autopost' card on Admin -> Instagram -> Pipeline health shows that status and has Pause / Resume and Run a slot now. Run a slot now (`instagramAdmin.startAutopostRun`) starts a background run, one at a time, because a run outlasts the gateway timeout; its outcome appears in the history. `nickActions.fireIgAutopostNow` still waits for the run (HTTP route, Nour-OS bridge).
- Live proof owed: the card shows real rows in prod, one manual run starts and its row appears in the history, and one paused slot logs `Skip — paused by ig_autopost_paused` in cron_log.
## 2026-10-16 - the reel lane stops spending into an empty Higgsfield balance, and needs_review parks

Live state read 2026-10-16 02:50Z (read-only): the keepalive balance was 29.5 Higgsfield credits;
job 2100001 (the 18:00 ET cron reel) rendered 2 clips, failed with `not_enough_credits`, was
retried 3 times as UNKNOWN and is `needs_regen`; job 2070013 (rendered-QA gate `needs_review`) was
selected by the drain on 149 consecutive pulses, 2026-10-13 22:08Z to 2026-10-15 11:10Z, so
production skipped 10-14 (both slots) and 10-15 06:00 ET until the operator rejected it.

- `shared/providerErrors.ts`: `not_enough_credits` (and its spellings) classifies
  QUOTA_OR_CREDIT / PAUSE_PROVIDER, so the job goes terminal on attempt 1.
- `server/services/reelProviderFunds.ts` + `dailyReelPost.ts`: before building a brief, reserving
  or moving the rotation, the cron compares the keepalive balance with 6 beats (the most a brief may carry) x the clip model's
  measured price (seedance1_5 12, seedance_2_5 26). A shortfall holds the run, Telegram once per
  ET day. An unknown or stale balance, a non-Higgsfield provider or an unpriced model never holds.
- `dailyReelPost.ts`: `needs_review` is in `PARKED_QA_GATES` (not `RETRYABLE_QA_GATES`), so the
  drain skips it and moves on instead of re-selecting it every pulse.

## 2026-10-02 — Admin closure wave (#2885, #2891): queues close their loops, migrations 0127–0139 applied AND recorded

Merged as `d583840268129c2115d44e08c0c80f7b6240ca4c` (#2885, squash of 20 commits) and
`62fb22719e4156d8be9348e1d79c144640b1c033` (#2891). Corrections to the operator's audit, the full change list and
every receipt: `docs/operations/ADMIN-TRUTH-PASS-2026-10-02.md`.

**Runtime receipts.**
- #2885 deployed as Railway `5c5eec0d`: `server:ready` 15:49:15Z.
- #2891 deployed as Railway `dd095678`: `server:ready` 17:12:10Z, schema guard green, 26 column checks passed, no
  error lines. `/api/health` healthy on `62fb22719`.
- Migrations: operator one-tap on the d5838402 container (176 steps, none failed); `record-migrations.mjs` recorded
  0127–0130, 0132, 0133, 0136–0139 as exact schema matches; `reconcile-migrations --strict` exit 0, 0 UNRECORDED.

**What production does differently now** (all LIVE + UNPROVEN until the first cron_log receipt says otherwise):
- **SMS human-review drafts close.** `orchestration-status-reconcile` cancels a draft whose obligation closed or that
  the customer superseded, and expires drafts older than 7 days. Approving a draft closes its obligation. A stale
  draft cannot be sent verbatim, and a double tap cannot double-send. Never sends. First receipt to read:
  "drafts closed N" (the ~366 backlog should fall to ~7 days).
- **Missed calls close.** One live card per phone. A PAID invoice on a later shop day → `won` (via `recordOutcome`).
  A later callback / lead / booking / captured call, or a same-day paid invoice → `duplicate`, with a receipt. Only
  untouched `new` cards are auto-closed. First receipt: `opportunity-queue-refresh` "collapsed".
- **Missed-call recovery reaches tool-reaching callers** (follow-up PR): a call that reached a tool (`convertedToLead=1`)
  gets the recovery text only when a successful read proves it saved nothing (no lead, callback, callback request or
  walk-in arrival). A failed read skips the call. Operator decision 2026-10-02, reversing the 2026-09-23 skip.
- **Nick's call drafts are capture-aware.** No booking/callback draft for what a tool already captured; the
  extractor knows today's date. `scheduleCallback` links its callback to the call.
- **Operator truth surfaces:** Approvals shows what happened after a decision; Today hints "likely served" on stale
  callbacks; financing clicks show who and whether they were invoiced; Settings → Status and Lot cannot be green over
  an offline camera; GSC numbers name their source. Money leaving nickstire is converted or labelled.

**`feature_flags` TABLE switches, read live 2026-10-02 via `GET /api/admin/flags` (the env probe above cannot see
these):**
- `sms_review_requests` = **on**: the review-request cron created its first 8 invoice-sourced rows at 17:13Z
  (`cron_log`: "invoice rows created 8 of 8"); they send after the 24 h delay, through every existing gate.
- `contact_holdouts_enabled` + `contact_holdout_retention|winback|weather|review_requests|campaigns` = **ARMED
  2026-10-02 17:25:10Z** on operator instruction (server log "Feature flag toggled … ENABLED" ×6). 15% of eligible
  customers per lane now get a recorded no-contact control (`heldout`) instead of the text; a failed assignment read
  sends normally. `review_reminder_drafts` stays OFF (a separate experiment that adds review-queue drafts).
- `missed_call_recovery` = on and env `MISSED_CALL_RECOVERY_SEND="1"`: recovery texts were already live (6 sent at
  17:13Z).

**First outcome receipts (`cron_log`):** `orchestration-status-reconcile` at 16:04:17Z — **drafts closed 366**
(obligation closed 52 · superseded 7 · expired 307 · left open 0); later runs 0. `opportunity-queue-refresh` runs once
per shop day and had already run before the deploy, so its first "collapsed" receipt is the next shop day.

**Still open:**
`__drizzle_migrations_bak_20261002_record` can be dropped later; the ledger claim `admin-closure-wave-20261002`
expires 2026-10-16 without the cron receipts above.

## 2026-10-01 — Creative Intelligence OS (#2865): the visual critic can say UNKNOWN, ads read the SSOT, Facebook gets the video

Merged as `54a366629ba89867dcd5dbc916e37bee88f8e645` (squash of 8 commits; blueprint, evidence book, prompt pack and example
outputs in `docs/creative-intelligence-os/`). Runtime receipt: see `docs/CURRENT-TRUTH.md` §"Creative Intelligence OS".
Four live defects were found in Railway logs on 2026-10-01 and closed with no schema change; everything else is new
signal around capabilities already live.

- **An unscored AI image could publish.** `evalImage` skipped without `REPLICATE_API_KEY` and `combineScores` set
  `imagePass=true` on the skip — on the LIVE lane (12:17:20 `image-eval skipped` → 12:17:51 `Instagram image published`,
  every static slot 09-26 → 10-01). `igVisualQaGate`: generative pixels with no rendered verdict = UNKNOWN = **held**
  (Telegram `HELD BY VISUAL QA` + `ig_autopost_log` `visual-qa-unknown`); branded posters and operator-captured
  `real_shop` photos are exempt by construction. The critic falls to Gemini vision when Replicate is unkeyed; a reply
  with no SCORE line is UNKNOWN, not the old default 0.65 pass. Kill switch `IG_VISUAL_QA_GATE=false`.
- **Three dead image-provider hops per static post** (Higgsfield credits → OpenRouter 402 → HF FLUX 410 → Gemini).
  `imageProviderCircuit`: credits failures skip the provider 6 h, retired models 24 h, transient never. HF route deleted.
- **Paid-ad copy carried a warranty the shop does not honor** ("12-month / 12,000-mile", retired from the SSOT
  2026-07-21). `brandTruth.ts` compiles one fact object from `shared/business.ts` + invoice facts; the Meta Ads
  Architect router overrides every fact-bearing field server-side; `brandTruth.test.ts` is a drift canary over 10
  creative prompt sources (positive control on old main: 3 hits).
- **The Wed/Sat article cron generated a draft and never saved it** while telling Telegram to review it in Drafts.
  It now persists the draft (status `draft`; this path never publishes). Articles no longer get a word count or a
  "number anchor" instruction; service routes are resolved against the route registry.
- **Facebook was a text status.** A cross-posted reel reached the Page with no media. `publishToSocial` now runs the
  Reels Publishing 3-step for a video (behind `REEL_PUBLISH_ENABLED` + the claim check on an FB-native caption), the
  nightly cron sends `["instagram","facebook"]` when `REEL_FB_CROSSPOST_ENABLED="true"`, and FB post insights land in
  `ig_metric_snapshots` under the `fb:` prefix (IG readers filter it). FB live + IG refused parks the job
  `publish_ambiguous` rather than releasing the claim. **LIVE+UNPROVEN** until the first `Facebook reel cross-post
  published` log line (~04:00Z reel tick).
- **New signal, default-safe:** customer-language miner (PII scrubbed before extraction) + GSC rising queries feed the
  topic miner; real-asset-first picks a `real_shop` photo before generating; Creative Assistant cards on Today; $0 pixel
  checks + craft score on every rendered-QA verdict with ONE specialist lens behind `RENDERED_QA_SPECIALIST` (default
  off); 6 experiment presets (`hook_style_v1`, `duration_v1` wired end to end); curated internal links on service and
  blog pages; `creativeOs` router (organic→paid evidence, atomizer, pattern miner, trend intel — generation only).
- **Three defects the review found in the diff itself:** `analyzePhoto` failed closed on the SMS-MMS flag for internal
  callers (would have held every autonomous static post); experiment arm recorded under `reel_job_<id>` but generated
  under the brief id (~half of episodes mis-recorded); an all-ambiguous publish was written `failed` and retried.

## 2026-09-23 — the first production census, and what it moved

The census (#2576) read three months of calls and texts as customer episodes. What it found, and what
shipped the same day, is in `docs/CURRENT-TRUTH.md` ("Customer-corpus wave") and the research doc Part M.
The short version for anyone quoting production:

- **Transfers:** 946 attempts, a provider verdict on only 103. `transfer-update` is now recorded (#2581);
  a connect rate still needs the provider's status and stays a floor.
- **Promises:** 0 of 108 assistant promises were followed by a person. The untracked ones are gone from
  the scripts (#2559, #2580, #2579); the census counter was corrected for in-call texts and drop-off
  conditions, so re-run it before quoting the old number.
- **Texts:** 55 of 104 text episodes ended unanswered. They now sit on Today's action queue (#2582).
- **Opt-out:** "Stop by around 3?" used to unsubscribe the customer from everything. Fixed (#2587).
- **Pushed live 13:12Z:** receptionist and follow-up assistant, both logged `Updated`, no refusal.

## 2026-09-23 — twenty DB-error checks were reading the SQL, not the error

Shipped as #2574 (missing table, duplicate key) and #2589 (the rest). drizzle-orm
0.45 wraps every driver error in a `DrizzleQueryError` whose message is only
`Failed query: <sql>\nparams: <params>`; the code, errno and driver text sit on
`.cause`. Twenty call sites regexed that message or read only the top-level
`.code`. Until #2589 is live, all of the following were true in production:

- **Every "migration not applied yet, retry without the column" fallback was
  unreachable** (sms.ts x3, opportunityQueue x4, smsOps replay, recoveryLift x2):
  a real wrapped 1054 never matched.
- **A failed query whose params held `1054` did match.** On `sms_messages.id`
  1054 a timeout would have switched retry bounding off for the process.
- **emailCampaigns and dashboardSync called every failure "migration not
  applied"**: their regexes named a column/table their own SQL contains.
- **monteCarloForecast and weeklyRevenueDigest never reported BROKEN** on a
  schema bug; they read only the top-level `.code`.
- **shopdriver x3, followupCadence and the vapi webhook missed a wrapped
  duplicate**, so a lost race took the error path.

**Rule:** never text-match a database error. Ask `server/lib/dbErrors.ts`
(`isMissingTableError`, `isDuplicateKeyError`, `isUnknownColumnError`,
`isSchemaBugError`). A source scan in `server/lib/dbErrors.test.ts` fails if a
regex comes back at any of the twenty sites.

## 2026-09-16 — "we could not check the opt-out list" had been reading as "nobody opted out"

Shipped as #2361 (`34d53af5c`), #2363 (`e94ab8998`) and #2371 (`46e3194f4`);
all three merged, deployed and confirmed live by ancestry against
`/api/health`.

`server/sms.ts` records a verified harm from 2026-07-20: a consent list that
failed to load once contributed to 136 messages reaching 103 people. The SMS
path was fixed then. **The outbound VOICE path never got that fix.**
`cron/jobs/voiceRecovery.ts` and `cron/jobs/followupCadence.ts` each ran their
own narrower query — `customers.smsOptOut` only, ignoring `sms_preferences`,
the inbound STOP log and carrier blocks — inside `catch { /* fail-soft */ }`.
An unreachable database therefore produced an EMPTY opt-out set and the whole
batch got called. `confirmationCalls.ts` had no consent check at all.

Three things about how that was found are worth keeping.

1. **The second lane was a byte-for-byte copy of the first, and it only turned
   up because I swept the class AFTER shipping the fix for lane one.** Twelve
   lines above the fail-open, `followupCadence` already rethrows on an
   unreadable fired-touch set — an unreadable fired-touch set must not read as
   a clean run. The re-contact guard failed closed while the consent guard
   failed open, in the same function.
2. **A fourth lane existed that my own guard could not see.** I had written
   that a fourth lane "cannot be missed the way the second one was"; that was
   false. `routers/vapi.ts` `makeFollowUpCall` dials VAPI with a raw `fetch` to
   `https://api.vapi.ai/call`, so it was invisible both to a guard keyed on the
   helper name and to one scoped to `server/cron/jobs`. Sweeping the PROVIDER
   rather than the helper is what surfaced it.
3. **Only a mutation showed that two of my own guards were mention-blind.** A
   source assertion on `loadSuppressionIndex` stayed GREEN under a full revert
   of the fix, satisfied by a leftover comment that merely named the function.
   Both guards now match a call expression on comment-stripped source.

Operator decisions taken the same day: the shop is first-come first-served with
no held spots, so a confirmation call is outreach and is gated like the rest;
and the email lanes were authorized, so both now read the same index. The full
operating contract — including why `stale` is not "five minutes old" — is in
[`docs/CURRENT-TRUTH.md`](docs/CURRENT-TRUTH.md) under **Outbound consent**.

Fixed alongside, because it is the same defect shape one level up: three
staged-diff gates — including statenour's staged **secret scanner** — were
scanning ZERO files on every commit and rendering that as a pass. `git commit`
hands hooks an absolute `GIT_DIR` with no `GIT_WORK_TREE`; lefthook runs each
job with `root: apps/<app>`; git then treats the cwd as the work-tree root, so
every per-file pathspec and `--show-toplevel` answers the wrong root. A planted
AWS key and a planted banned claim both committed cleanly before the fix.
**Any canary for a gate that shells out to git must run twice — clean, and
under a VALID `GIT_DIR`** (the prior canary used a NONEXISTENT one, so git
failed loudly and the silent case was never covered).

## 2026-09-09 — the account was being judged on the wrong number, and the critic was grading a spec the generator never got

**SAVES ARE NOT A REELS RANKING INPUT.** Meta's own ranking documentation lists
nine predictions for Reels and saves is not among them; it belongs to the
*Explore* list. This account had been measured on 0.00 saves per post for a year.
That figure is real and it is a symptom, not a penalty.

**The number that does rank was already in the database, unread.**
`reels_skip_rate` is the percentage of viewers who leave inside three seconds,
and "watching less than three seconds" is a named Reels prediction. Migration
0108 has been collecting it since it shipped. Read for the first time
2026-09-09, one row per post, latest snapshot, reach > 0:

| measure | value |
|---|---|
| published posts carrying a skip rate | 41 |
| corpus mean skip | 66.4% |
| best / worst hook | 39.8% / 92.9% |
| Pearson r, skip rate vs reach | **−0.633** |

Two thirds of viewers leave before the fourth second, and reach follows. The
generator had been writing hook 105 blind to hooks 1 through 104; it now receives
that scoreboard. **Do not re-derive this from saves.** `server/services/hookPerformance.ts`
holds the read, and it returns an EMPTY prompt fragment when the history is
unreadable or the sample is under six, so an outage teaches nothing rather than
teaching from nothing.

**THE CRITIC WAS GRADING A SPEC THE GENERATOR NEVER RECEIVED.** `LENS_PALETTES`
gives each of the fourteen motion lenses its own world; the vision critic was
still told the world was graphite+gold, so it would have reported
`PALETTE_DRIFT` on every correctly-rendered non-noir reel. Fixing the critic
alone was not enough: `buildReelContinuityBlock` returns an approved visual
world's invariants EARLY, before it reaches its own palette line, and
`visualWorld.ts` hardcoded the retired string twice more. `REEL_AUTO_VISUAL_WORLD`
is `true` in production, so this was live, not theoretical.

**FOUR LANES WERE CHECKED, NOT ONE.** Roughly sixty scheduled jobs run here and
fifty-six were clean. Of the four that were not:

- `kpi-snapshot` had **never once succeeded** — 5 runs, 0 successes since it
  first fired 2026-09-03 — on a single identifier: it asked `review_replies` for
  `createdAt`, and that table spells it `created_at`. The table beside it in the
  same statement genuinely uses camelCase `sentAt`, so both spellings are correct
  in this schema on different tables. A column name inside a raw `sql` template
  is invisible to tsc, to Drizzle's typing and to every lint. **The first and only
  signal was a production cron failure.**
- `ig-autopost` timed out on 20 of 703 runs over seven days because it inherited
  `DEFAULT_JOB_TIMEOUT_MS` (4 min, sized for database-only jobs) while it
  generates an image and uploads it to Meta. Now 10 min, under its tier's own
  15-minute cadence.
- The other two were already repaired earlier the same week.

**THE PACK LANE HAD NO CALL TO ACTION AT ALL.** `buildBriefFromApprovedProductionPack`
never read `ask`, so every pack-derived reel rendered no end card. Four packs had
worked around it by burning the shop name, address and phone into their last
BEAT plus a spoken "stop by" — the one surface an ask must never occupy, because
`assembleReel` refuses it. **Those four could never have shipped**; they would
have failed at assembly, after their clips were paid for. Fixed at source.

**And every pack-derived reel wore one look.** `motionLens` and `archetype` were
hardcoded, so 26 of 27 queued reels carried the identical lens and only 5 of 14
lenses appeared in the whole 21-day window. Both now rotate deterministically on
the pack id — measured across the real 166 packs as all 14 lenses reached, spread
7 to 16 each. Determinism matters: randomness would make a retry look like a new
idea to the repetition ledger.

**THE POSTING LANE WAS ALREADY HEALTHY, and that was verified before anything
was changed.** It publishes one reel a day and had an unbroken 28-day schedule
through 2026-10-07 with a populated `publication_intended_at` on each. The two
nine-day dark stretches in the preceding month traced to defects fixed earlier
that week. **A queue of finished reels is not a stuck queue** — check the
scheduled dates before concluding inventory is idle.

**Cost per PUBLISHED reel**, all generation spend over the reels that actually
shipped, failures included because they were paid for too: **$4.09 lifetime,
$6.49 over the last 30 days.** The honest denominator is publishes, not
generated seconds.

**FILM GRAIN IS ARMED, at strength 8.** A generated clip is perfectly smooth and
real footage never is; that absence is much of what reads as AI-made. The figure
that had kept the feature off — 2.57x file size — was measured on a synthetic
smooth gradient, the worst possible case. **Re-measured on a real 8.2 MB reel
master it costs 1.18x**, and the curve turns hard just after 8 (9 → 2.19x,
10 → 3.34x, 12 → 6.40x). Twelve looks best and produced a 52.8 MB file, past a
phone upload limit. Chromatic aberration and highlight bloom were each measured
washing Nick yellow out by ~10% and were rejected on that evidence.

**Where to look now:** Instagram admin → gear → **Pipeline health**. It carries
the forward schedule with the first empty day called out, measured hook
performance, the queue, cost per published reel and lane health. All of it was
reachable before and none of it was on a screen; it was being answered with
ad-hoc SQL against production, one probe at a time.

Shipped `562681607`, `c8880ee0b`, `09abf1e23`, `77c4ab9d7`, each verified on
main by file content and confirmed serving via `/api/health`.

## 2026-08-21 — the silent stock fallback is dead in production, and the fix sat unmerged for a day

**Production was substituting stock footage for real AI video and publishing it, and the fix
existed but was never deployed.** During a Higgsfield outage the reel pipeline did not fail — it
fell back to `templateStockStudio` (local ffmpeg gradients) and published anyway. 11 reels were
produced that way, not the 7 previously believed: 4 never reached Instagram, so platform-side
review could not see them.

The Phase 2 fix (kill the fallback, add an unbypassable publish gate) was written, tested green,
and reported "done" — while living on an unmerged branch. `REEL_FALLBACK_TO_TEMPLATE_STOCK=true`
was still set in Railway and prod kept substituting. **It fired again on 2026-08-21 during the
remediation itself**, poisoning two beats of job 1740002: this session re-queued a job locally,
prod's pulse cron claimed the same row (it claims UNSCOPED), and finished it on the old code. The
remediation's own QC gate is what caught it. Merged as #1760, verified by file content on
`origin/main`, not by the merge command's exit code.

**What is true now.** `evaluateReelPublishGate` rejects any reel carrying a `template-stock` clip,
asserting on the storage path — unforgeable — rather than a settable flag, ahead of the
`RENDERED_QA_ENABLED` disable check. A terminal paid-provider failure routes to `needs_regen`:
non-publishable, surfaced, alerted. `REEL_FALLBACK_TO_TEMPLATE_STOCK` was deleted from the Railway
service on 2026-08-21 (inert by then — zero live readers).

**Five hand-copied status lists disagreed with each other.** Adding `needs_regen` to the canonical
predicate was not enough: `getReelJob`'s mapper defaulted it to `queued` (Studio polled forever,
never surfacing the failure), `discardReelJob`'s `CLOSEABLE` refused it with "already published"
(false — it never published), `adminRoutes` kept a second attention list, `qualityGate`'s
paid-repair circuit breaker counted only `status='failed'` so it went blind to the very outage it
exists to catch, and `reelReliability` counted `needs_regen` in the denominator but not the
numerator, deflating the displayed failure rate on both the dashboard card and the Telegram digest.

**Instagram CAN delete reels — the blocker was a wrong conclusion.** `DELETE /<IG_MEDIA_ID>` is
documented, supports Reels, and needs `instagram_basic` + `instagram_manage_contents`. Both are
already granted on the live token (verified against prod, 35 scopes). This was called impossible
for a day because nothing in the repo called it — the same mistake AGENTS.md already records for
the Higgsfield REST API. Note `/me/permissions` is the WRONG probe for a page token (`/me` is the
Page, which has no permissions edge, and returns "(#100) nonexisting field" — reads exactly like a
missing capability); use `debug_token`. Phase 5 remains operator-gated: deletion is irreversible.

**Traps this arc paid for, all found by RUNNING things rather than reading them:**

- `storagePut`'s local fallback wrote `path.basename(key)`, so 11 archives sharing a filename
  silently overwrote each other — with a success log for every one. Fixing that by keeping the full
  key then removed the only containment `basename` had been providing by accident, opening a
  reachable path traversal (`carouselSlideRenderer` builds its key from an unvalidated `brief.id`).
  Containment now lives in `normalizeKey`, so every consumer inherits it.
- Rotation persistence was fire-and-forget. A short-lived script that exits right after the promise
  settles discards the CLI's rotated token, leaving `app_secret_kv` holding a spent one. **A health
  check killed the session twice this way.** All four call sites now await it — bounded at 15s, so
  a stalled DB write can never hang a paid generation that already succeeded.
- The keepalive credit regex `(\d+)\s*credits` cannot cross a decimal: it read **62** credits
  against a real balance of **2388.62**, matching the fragment after the point.
- `push-higgsfield-creds`'s staleness guard compared a mysql2-skewed `updated_at` (~4h ahead of
  real Eastern) against a file mtime, so it refused a genuinely fresher login as "NEWER".
- Env pins set in a script's top-level body are **inert** against any module-level `const`: ESM
  hoists imports above them. A "raised clip timeout" never once took effect; the concurrency drop
  (3 → 1) was doing all the work. Per-beat time climbs 140s → 342s under 3-way contention on one
  Higgsfield account.
- A squash-merge leaves the old branch showing every commit as "ahead". Comparing **tree content**
  (`git diff main HEAD`) rather than ancestry revealed that branch was −7,338 lines behind on
  sibling-session work; a follow-up PR from it would have reverted all of it.

## 2026-08-16 - the reel lane's independent judge is readable, and its own gate doc was stale

**The reel lane has had an independent judge since 2026-08-13 and could not consult it.** NT-001
wired `judgeSingleConcept` into `dailyReelPost.ts` - one LLM call per about-to-publish reel, deduped
by a KV marker - and wrote the verdict to `shop_settings` as `reel_shadow_judge_<jobId>`. Nothing
ever read it: two references in the whole repo, both in the writing file, and the only read is
`if (!alreadyJudged)`, a boolean. The judgment was bought and discarded.

**Why the image lane could flip its gate and this one could not.** `igAutopost` persists verdicts to
`ig_autopost_log`, a queryable log table, and ships a reader (`scripts/ig-dual-judge-readout.ts`).
That is how the measured 5/25 blind-spot readout existed to justify the 2026-08-07 flip. The reel
lane put the same measurement in the settings KV and shipped no reader - same signal, wrong
substrate. Now readable via `server/services/reelShadowReadout.ts` (pure) plus
`scripts/reel-shadow-judge-readout.ts` (read-only; the operator runs it, since the only
`DATABASE_URL` here is production). No migration: the KV key is `LIKE`-scannable.

**Three ways a naive reader would have been worse than none**, each pinned by a behavioural test:

1. `shadowJudgeGate` fails CLOSED - correct for an unattended publisher, wrong for a shadow readout,
   where the reel lane fails OPEN on purpose. Reusing it directly scores every Ollama timeout as a
   quality blind spot and inflates the statistic a gate flip would rest on. Unusable verdicts get a
   third bucket and are counted on neither side.
2. The corpus is CONDITIONED: the judge runs only after `evaluateReelPublishGate` already allowed
   the reel, so every row cleared rendered-QA. That is a blind-spot rate, never a quality base rate,
   and the readout states it above the numbers.
3. A judge that throws writes NOTHING, so its failures never appear as errored rows - the corpus
   just shrinks, and a small corpus with no blocks reads as an all-clear. `coverage` reports
   eligible posted reels carrying no verdict at all.

**And the fix for (3) needed its own fix.** A P1 review caught `coverage` counting EVERY
historically posted `reel_jobs` row, so pre-rollout reels and reels published by the operator route
or `contentManufacturing` were reported as judge failures - fabricating the gap coverage exists to
expose, which is the same lie in the opposite direction. Eligible now = `briefId` matching
`autopost-<YYYY-MM-DD>` (the only jobs `dailyReelPost` selects, and the judge sits inside that
function) with that date on/after the 2026-08-13 rollout, and the readout PRINTS what it excluded so
the filter is not silent either. `source` is not the signal: `contentManufacturing` also enqueues
`source: "cron"` while publishing elsewhere. The date is read from the briefId because it is
immutable - `updatedAt` is `onUpdateNow` and `createdAt` is enqueue time, not publish time.

The readout also reports judge-vs-QC agreement: if the free deterministic checklist already flags
what the LLM judge flags, the lane can gate at zero LLM cost.

**A doc asserting a value is a cache with no invalidation - this file's sibling proved it again.**
`docs/IG-ADMIN-PLAN-GATE-2026-08-05.md` called wiring `runConceptTournament` "the single
highest-leverage change", on the premise that the daily lane self-scores. True on 2026-08-05, stale
from 2026-08-13, and the 2026-08-16 addendum repeated it without re-reading the service. Corrected
in place: pre-generation concept selection (5 calls, still open, still an operator spend decision) is
a different stage from the post-render verdict (already paid for, now readable). Run the readout
before spending on the tournament - the image lane set the precedent that this call is made on a
number.

## 2026-08-16 — Create is grounded in records, and the admin stopped guessing

Full architecture: [docs/IG-EVIDENCE-ARCHITECTURE.md](docs/IG-EVIDENCE-ARCHITECTURE.md). Read that
before touching IG source selection, the quality gate, or any admin read state.

**The declined-work picker was reading a column nothing writes.** It filtered
`work_order_items.declined = true`; the only writers insert with the false default or set it FALSE on
recovery, and no migration updates it — so the query was `WHERE false` and the list was permanently
empty. The canonical lane is `alg_estimates` (unmatched), which is what `nour-os-query.ts` and
`customer_metrics` already used. The picker now agrees with the rest of the system.

**The decline on that lane is INFERRED, not recorded.** `alg_estimates` has no `declined` column —
it is derived from `matched_invoice_id IS NULL` through a ±10%/30-day matcher, so a failed match is
indistinguishable from a refusal. Facts now carry `basis: recorded | inferred | operator`, and
`inferred` can never reach "sufficient" alone. Do not reword the assertion text to say a customer
declined anything.

**The quality gate measured string length.** `source_grounding` was `detail?.trim() ? 8 : 6` — one
character earned 8/10 and silenced its own warning — and `buildEvalArgs` never passed the resolved
evidence, so the evaluator could not inspect what it scored. Now scored from structured facts, which
ride on the draft's `source` so they survive the round trip (a plain `z.object` strips unknown keys;
without that every re-score re-graded a grounded draft as ungrounded).

**Four surfaces claimed "empty" for reads that never happened** (Community feed and clusters,
Automation Lift, Database Hygiene — the last showing a green "Database is perfectly clean!" without
examining a row). react-query pauses when offline, leaving `isError` AND `isLoading` false with
`data` undefined. `client/src/lib/queryState.ts` encodes the guard.

**Storage health was inverted.** CloudFront being ABSENT is what enables permanent proxied URLs, so
`!!CLOUDFRONT_DOMAIN` reported "Ephemeral Only" exactly when they worked. Three states now, and the
`REEL_ALLOW_EPHEMERAL_STORAGE` branch is reported as a warning rather than a blocker.

**AI content no longer publishes itself.** Generated articles were written `status: "published"`,
overriding the column default, so every one went live on the blog and into the sitemap while the
admin showed an approve control that could never apply. Now draft; notifications start inactive; and
`getDynamicArticleBySlug` filters to published so the gate is not bypassable by URL.

**No navigation was renamed.** The Compose/Queue/Inbox proposal REVERSES commit 388c0a1ff and
`CURRENT-TRUTH.md`'s "Publish is the only queue"; Reel-as-a-format was rejected because the input
contracts are disjoint (reel has no objective control at all; static has no per-beat, VO, or paid
Visual World fields). What was actually wrong was three context-free doors on Today.

**Method note worth keeping.** Two adversarial audits of this same work refuted 17 of its claims and
found 3 criticals, including two pre-existing tests broken by a rename — missed because only
`server/*.test.ts` was being run while `client/src` (56 files, 1,019 tests) sat unrun. Run BOTH roots
before quoting a test count.

## 2026-08-12 — the approval queue is live, and it is the one door

`admin_proposals` (migration 0111) + the attributed activity ledger on `audit_log` (0110) shipped
in #1541; both migrations are applied to prod and read-back verified. **Every new AI- or one-tap-
originated write lands there as a DRAFT and executes only through a compare-and-set approval
chain** — a rejected row cannot reach execution structurally, and executors create internal records
only (callbacks, bookings at status `new`), never a customer send. Nick's call-end extraction feeds
it draft-only. That flag (`vapi_action_proposals`) shipped OFF and was **turned ON 2026-08-16** at
the operator's instruction, read-back verified against live Railway env — so drafts accumulate from
now on. Hand-review the first ~10 against their recordings before trusting the queue. Contract detail in `docs/CURRENT-TRUTH.md`.

## 2026-08-08 — five defects that every internal signal reported as healthy

A wave of publish-path corrections (#1430 #1432 #1438 #1439 #1440 #1442). They
share one shape worth knowing before you trust a green dashboard: **each status
was accurate and the conclusion it invited was wrong.** Registry: ROS-089…094.

- **Model pins were discarded in prod, so the publish gate judged its own
  family.** `AI_FORCE_OLLAMA=true` with `OLLAMA_MODEL` unset made
  `resolveEffectiveModel` return `deepseek-v4-pro` for EVERY lane — including
  the judge and the generator it grades. Native pins now survive the flag;
  `CONCEPT_JUDGE_MODEL` pins both judges off the generator's family.
  **Invisible locally**, where the flag is unset and pins work (ROS-089).
- **Every IG post was over the hashtag cap.** The limit has been 5 since
  Dec 2025; the autopost prompt asked for 6-10 and the parse layer clamped at
  12. Prod receipt: 60 of the last 60 posted rows over cap (ROS-090).
- **No reel ever reached the profile grid.** Instagram defaults
  `share_to_feed` to false on REELS containers, so reels landed in the Reels tab
  only. Not editable after creation — the 76 already published stay off-grid.
  They were never unseen (they out-comment feed posts); they were unseen ON THE
  PROFILE (ROS-091).
- **The free-lane fallback was armed and unreachable.**
  `REEL_FALLBACK_TO_TEMPLATE_STOCK=true` was already live and reels still went
  dark, because a revoked provider session HANGS rather than returning 401 and
  never reaches `PAUSE_PROVIDER`. The predicate now consults the keepalive's own
  verdict, and a degrade reaches Telegram the same day (ROS-092).
- **The content engine had never read what customers refuse.** 345 declined
  estimates with service descriptions are now a ranked topic feed
  (`declinedWorkTopics` + `creativeFingerprint`). Counts and dollars rank and
  explain; they never enter the brief (ROS-094).

**OPEN, and it IS still sending — corrected 2026-08-16 against live prod.** This paragraph has
now been wrong in both directions. It read "is live-sending SMS" until 2026-08-15, was rewritten to
"NOT still sending" on the strength of `docs/ISSUE-REGISTRY.md` (ROS-093, "operator set
`FEATURE_DECLINED_RECOVERY=0` on Railway, read-back verified"), and that rewrite was false. Reading
the live service env on 2026-08-16 returns `FEATURE_DECLINED_RECOVERY=1`; the guard at
`server/services/declinedWorkRecovery.ts:239` is `=== "1"`, so the send path is armed. `cron_log`
agrees — `Sent 0/3d + 4/7d` on 08-13, `1/14d` on 08-14, `1/14d` on 08-15, i.e. **6 customer texts in
three days**, and 31 follow-up stamps on `alg_estimates` in the last 30. Either the flag was flipped
back after 08-08 or the read-back was never done. **Do not restate this flag from a doc — read the
service env.**

The judgement is still open, but the exposure is live, not historical. The matcher was never
unscheduled, it was BROKEN: it compared phone strings across two tables storing different formats,
so it ran on every sync and matched nothing. After the repair the match rate went 5 → 20 of 439, and
**15 of the rows sitting in the "declined" list were customers who had already paid**. The 30-day
matcher window then left a second blind band, closed in #1592 (`DECLINED_RECOVERY_WINDOW_DAYS = 60`,
matching what sends actually target). As of 2026-08-16 the live eligible set is **49 unmatched
estimates inside 60 days, 27 of them (55%) in the 31-60 day band the matcher could not reach until
#1592 merged** — so the list this loop has been texting was demonstrably wrong until that PR, and
should re-verify itself as syncs run. The operator's call on 2026-08-16 was to leave it running
rather than pause: volume is low and the band is now closed in code. Full receipts in
`docs/ISSUE-REGISTRY.md` (ROS-093), which carries the superseded `=0` claim.

**Superseded 2026-09-27:** the 2026-08-08 `template_stock` pin and revoked-session
statement below are historical, not current production truth. PR #2717 moved the
Higgsfield CLI/runtime to 1.1.26 and production keepalives recovered. A durable
credential row written before a fresh Railway process restart was subsequently
used by that fresh process to complete another `session refreshed` keepalive,
which proves cross-process recovery rather than a one-dyno false green. Live Reel
canary 1950002 then generated five Higgsfield clips and failed closed later at
render QA on a CTA mismatch; it was not published. Full refresh-token revocation
still requires an operator browser login. Verify the live provider predicate
instead of copying an old pin from prose.

## 2026-08-10 — the capability ledger can now say "we do not currently know"

`docs/operations/capability-ledger.json` is the record of what is actually done, and
CI enforces it (the completion-authority steps of the agent-policy job, `.github/workflows/agent-policy.yml`). It gained an expiry
axis it had always had code for and never used: `verificationExpiresAt` was
implemented, TESTED, and set by **0 of 48 capabilities** — the test built its own
synthetic record, so it stayed green while nothing real ever reached the path.
42 of 48 capabilities were last verified in July and the ledger had no way to say so
(ROS-099, #1493).

What changed, in one line: **stale is now a distinct state from invalid.** A claim you
cannot support is a lie and always fails. A claim you supported a month ago is a doubt
— it is reported, and it only FAILS the build where something other than your own
hands can act on it (`exposure` production or limited_autonomy). Two honest responses
to a stale claim, both fine: re-prove it and reset the date, or lower the claim with
`scripts/regress-capability.mjs`. Pretending is the only wrong answer.

Horizons are deliberately UNEVEN, set from what can kill a claim with no commit at
all — 21 days for anything resting on a third-party credential, session or quota;
90 days for our own schema; 180 for a deterministic render. `REALITY-LEDGER.md` shows
each date in a `Verify by` column; whether something is currently PAST it is printed
by `node apps/nickstire/scripts/check-capability-ledger.mjs`, never by the file
(CI diffs that file, so it must not change on a clock tick).

**CLOSED 2026-08-11, corrected here 2026-08-15 — `reel-pipeline-assembly` was
re-verified and now expires 2026-09-10.** This paragraph previously read "expires
2026-08-16" and warned that the completion-authority steps of the agent-policy job would go red on that date;
that deadline had already been retired and the warning was left standing. It is
still the only `exposure: production` capability, so it is still the only one whose
staleness can fail a build — just not this week. `node
apps/nickstire/scripts/check-capability-ledger.mjs` prints the live answer and is
the thing to believe; this file is a cache of it.
Four other capabilities (`format-directors`, `evidence-resolution`,
`drive-creative-vault`, `higgsfield-keepalive`) are past their dates (2026-08-07)
and are reported without failing anything — that is the intended behaviour, not a
backlog. Re-verifying the reel capability still means a real prod IG render, which
is an operator-authorized publish and never an agent's call; to lower a claim
instead: `node apps/nickstire/scripts/regress-capability.mjs <id> P2 "<reason>"
"freshness gate"`.

**Coverage note (2026-08-15):** only 12 of 48 capabilities carry a
`verificationExpiresAt` at all. The freshness axis is real but it is not yet a
property of the ledger — 36 claims cannot go stale because nothing dates them.
That is a gap, not a guarantee.

**Lead time (2026-10-15):** the first load-bearing expiry (`shopstate-lot-band`,
01:07Z) turned every open PR red at once, with no sign before it. The script now
prints one `note:` line per `production` / `limited_autonomy` entry within 14 days
of its `verificationExpiresAt`: id, days left, re-prove-or-lower. Under GitHub
Actions the same text is a `::warning` annotation on the run. It never changes the
exit code, and `scripts/preflight.sh` shows the lines from a passing ledger step.
Pinned by `server/ledgerExpiryWarning.test.ts`.

The older file under `docs/_archive/root_reports/truth_os.md` is historical evidence only. Do not treat archived audit claims as current without re-verification.