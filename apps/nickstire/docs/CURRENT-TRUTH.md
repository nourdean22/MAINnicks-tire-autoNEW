# Nick's Tire & Auto — Current Truth

**Status:** active operating contract  
**Verified against:** `main` on 2026-08-07 (self-improvement arc, PRs #1382–#1421; prior line: 2026-07-29 SMS Revenue Agent OS arc, PRs #1190–#1201)  
**Owner:** Nick's Tire & Auto operator  
**Operator runbook for the SMS side:** [`operations/SMS-REVENUE-AGENT-OS.md`](operations/SMS-REVENUE-AGENT-OS.md)

Live code and production evidence override this document when they disagree. Update this file in the same change that alters a listed contract.

## Live application

- Application: `apps/nickstire`
- Public site and admin: `https://nickstire.org`
- Deployment: GitHub `main` to Railway
- Client: React 19 and Vite
- Server: Express 4 and tRPC 11
- Canonical operational database: TiDB Cloud / MySQL through Drizzle
- Package manager: pnpm workspace
- Master application gate: `pnpm run verify` from `apps/nickstire`

## Canonical business records

- Leads: `leads`
- Booking requests and job-stage records: `bookings`
- Customers: `customers`
- Repair revenue: `invoices`
- Shop work: `work_orders` and imported ShopDriver records
- AI receptionist calls: `vapi_call_logs`
- Callback requests: `callback_requests`
- Search detail: `search_performance`

A transcript classification, tool invocation, direction instruction, transfer attempt, estimated value, or modeled close rate is not a paid invoice.

## Weekly revenue digest (2026-08-07)

- `server/cron/jobs/weeklyRevenueDigest.ts` pushes a Monday Telegram digest: paid-invoice revenue for the trailing 7 days, week-over-week delta, parts/labor mix, repeat-revenue share (last-10-digit phone match against any earlier paid invoice), top services, and the count of `expected_arrivals` rows reconciled to invoices that week.
- It reads the ALG **mirror** (`invoices`, `paymentStatus='paid'` — the same filter as `getDailyRevenueTruth`) and never touches ShopDriver/ALG itself.
- Scheduling: hourly (2h) tier + `oncePerShopDay` claim (ROS-081 pattern), self-gated to shop-timezone Mondays. On query failure it sends nothing and logs why — a zeros digest produced by a thrown query would be a false report.

## GSC data flow

1. `server/pipelines/gsc-data.ts` authenticates with the Google service account.
2. A dimensional request stores query, page, date, device and country rows in `search_performance`.
3. Those rows support query, page, device, country and trend analysis.
4. A separate no-dimension Search Analytics request is the authoritative source for headline clicks, impressions, CTR and average position.
5. Dimensional rows may be incomplete because Search Analytics returns bounded top rows. Their sums must be labeled detailed-row totals, not official totals.
6. GSC jobs are automated through the pipeline scheduler when production credentials are configured.
7. The `device` dimension applies to web only. Google's Discover reporting rejects it, so the Discover request omits it and `search_performance` holds no `searchType='discover'` rows — nickstire.org has no Discover traffic (ROS-029). Do not treat an empty Discover slice as a pipeline failure.

## VAPI data flow

1. VAPI sends signed webhook events to `/api/webhooks/vapi`.
2. Tool calls invoke the internal voice-agent router.
3. End-of-call events create or reconcile `vapi_call_logs`.
4. The daily VAPI evaluator classifies operational outcomes and records quality evidence. It also extracts per-call signals (`metadata.callSignals`: objection type · competitor mentions · price-sensitivity, deterministic regex — 2026-07-22) that enrich the Missed Revenue Queue with the *why* behind a stalled call. Signals are observed evidence, not confirmed facts.
5. Leads, callbacks, bookings and invoices remain separate operational records.
6. Tool engagement is an observed call fact. It is not automatically a lead, booking, arrival or paid job.
7. Any classifier-derived outcome must carry a definition version and evidence level before it is used in executive reporting.

## Lead and booking creation

- Website lead forms write `leads`.
- Website booking flows write `bookings`.
- **Voice tools do not create leads for ordinary inquiries.** Per operator directive 2026-06-05, `tireInquiry` acknowledges the caller and returns **before** any insert; the call recording and `vapi_call_logs` row are treated as the record. Only `escalate` (callback, when closed) still persists an operational row from voice.
- **`checkTireStock` persists nothing at all** (2026-07-20). It previously wrote an urgency-5 rack-check lead, fired a Telegram and promised a callback that no code tracked to completion; it now hands the caller to a person.
- The `bookSlot` tool provides first-come-first-served walk-in guidance and does not persist an appointment.
- Measured 2026-07-20 against production: 494 `tireInquiry` dispatches over 90 days, **0** voice-attributed leads, `leads` table holding 2 rows total. That is the directive working as intended — not a defect. Do not "fix" it without re-confirming the directive.
- A booking is verified only when a booking row exists.
- An arrival is verified only from an operational arrival/check-in or repair-order signal.
- Paid conversion is verified only from a paid invoice linked by a defensible matching rule.

## Crawler HTML

- Normal visitors receive the React SPA.
- Recognized crawlers receive committed files from `apps/nickstire/prerendered/` through `server/prerender-middleware.ts`.
- Railway normally does not regenerate prerendered HTML during deploys.
- `.github/workflows/prerender-refresh.yml` performs the scheduled refresh.
- `pnpm run prerender:check` verifies route-tree presence.
- Semantic parity checks must verify identity, metadata, H1, canonical URL and structured data for key routes.

## Automated systems

- GSC dimensional ingestion and SEO analysis
- VAPI end-of-call ingestion and daily evaluation
- Scheduled prerender refresh
- Lead, callback and booking persistence
- ShopDriver invoice/customer synchronization where configured
- Selected internal alerts and recovery workflows
- Reel manufacturing: cron-pulsed clip generation (Higgsfield Seedance 1.5) and ffmpeg assembly with a blocking render-integrity gate (duration contract, video-stream length, frame count, sampled-frame motion proof) — operational contract in [`docs/operations/REEL-PIPELINE.md`](operations/REEL-PIPELINE.md); publish remains operator-gated

Automation success is valid only when the final system of record confirms the action.

### Instagram deferred publishing — operating contract (2026-07-24, IG quality waves)

- `scheduled_posts.inventoryId` (migration 0096, applied to prod and verified via information_schema) links every Studio-scheduled fire back to its inventory row. Consequences that hold by construction now: **reject cancels the pending fire first** and CONFLICTs if the cron already claimed it; `runScheduledPosts` writes the fire-time outcome (published / failed / ambiguous) back onto the inventory row, so "scheduled" can no longer be a forever-state; cancel/reschedule exist and discriminate fired-vs-stalled.
- `instagramStudio.schedule` claims `ready → scheduled` at-most-once BEFORE inserting the fire row; a double-tap gets a CONFLICT, not a duplicate post.
- A `media_publish` request that was **dispatched and got no answer** parks the item as `ambiguous` ("may be LIVE") everywhere — image/story/carousel/reel, both routers, and the cron — never as retryable `failed`. The operator resolves it from Publish (It IS live → published / It never posted → ready) after checking the real account.
- `instagramAdmin.schedulePost/listScheduled/cancelScheduled` were DELETED (zero callers + integrity holes); Studio's schedule → scheduled_posts → cron is the only deferred-publish path. adStudio writes its own unlinked scheduled_posts rows (no inventory linkage) — since #1055 its post routes through `publishToSocial` (kill-switches + cadence governor apply) and claim-safety/permanent-URL checks are enforced server-side at post AND schedule time.

### Every path to Meta goes through the emergency stop (2026-07-27)

- **The kill switch reaches the autonomous poster.** `runIgAutopost` posted directly to Meta, so the operator's global / publishing / per-platform switches did not stop the one publisher that runs with no human watching (measured: 116 lifetime `posted` rows). It now shares the same check via `killSwitchBlockedPlatforms`. **Automated callers fail CLOSED** when switch state is unreadable — an unattended cron must not treat "we could not check" as "publish" — while operator callers still proceed loud. `dailyReelPost` and `socialInventoryPublisher` opt in the same way.
- **The cadence governor counts all four doors**, including `ig_autopost_log`, which alone accounts for ~84% of lifetime publishing and was previously invisible to the cap. Each door is counted independently, so one unreadable source no longer zeroes the others. The autoposter now also ASSERTS the cadence itself — with a preflight before generation, so a capped day buys no LLM/image spend — and a cap hold is terminal for that slot.
- **Autonomy policy v8** (operator-authorized 2026-07-27): `maxFeedPostsPerDay` 20, `minimumFeedSpacingHours` 0. v7 was leftover `cc2-verify` "temp" state from 2026-07-18, never a business decision (ROS-067). At 20 the cap never binds on ordinary operation — the autoposter does 3/day and the busiest normal day across all doors is 5 — so it is a runaway brake, not a content dial. The busiest day on record is 32.
- **Not runtime-verified.** All of the above is asserted by code and pinned by tests; no cron tick or live publish has been observed since the change. Recorded as deferred scope on the `content-governor` capability rather than left implied.

### The independent judge gates live IG publishing (2026-08-07, operator flip)

- **The self-eval blind spot was measured before it was closed.** A 25-post
  retro-tournament found **5/25 (20%)** of historical posts passed self-eval
  `>= 0.7` while the independent tournament judge scored them `< 60` or hard-
  rejected — a unanimous "generic mechanic imagery any shop could run unchanged"
  signature. Captions scored fine; the image self-eval (`proLook`) rubric is all
  craft (lighting, sharpness, composition, artifact-freeness) and carries **no
  differentiation criterion**, so a technically flawless generic image cleared
  the gate every time (ROS-088).
- `server/services/igJudgeGate.ts` → `shadowJudgeGate()` now blocks the **LIVE**
  branch of `runIgAutopost` on the *exact* measured disagreement predicate
  (`rejected || total < 60`), so `content.shadowJudgeReadout` keeps measuring the
  gate's own behavior. The threshold equality is pinned by test — do not drift
  the gate and the readout apart.
- **Dryrun previews are unaffected** (that lane has a human). The judge verdict
  already existed inline *before* the publish decision — it ran in shadow from
  2026-08-05 — so the flip is decision logic over a verdict already paid for.
- **Fail-CLOSED** on judge error or a missing verdict, by the same "automated"
  reasoning as the kill switch above. Escape hatch: `IG_SHADOW_JUDGE=false`
  disables judge AND gate together (pre-flip, self-eval-only behavior). **A dead
  judge lane therefore pauses live IG posting loudly rather than publishing
  blind** — that is intended, and it is the first thing to check if autoposting
  goes quiet.
- A judge-blocked run logs `status='aborted'` with a `judge-blocked:` prefix,
  Telegram-notifies, and stays **retryable** — a later tick regenerates fresh
  content rather than resurrecting the rejected draft (a rejection is
  content-specific, not slot-specific). The live-mode judge call is **P0** in the
  Ollama scheduler; dryrun stays P1.

### The AI receptionist improves from its own failed calls (2026-08-06/07)

The voice prompt is no longer only hand-edited. A closed measurement loop reads
real failed calls and proposes bounded edits; **Push Config remains the one
serving gate** — nothing here ever writes the live assistant.

1. **The Call Ossuary** — `vapi_call_archives` (migration 0109) vaults full
   transcripts before VAPI's **14-day** retention purge. Without it every
   evaluation corpus older than two weeks is unrecoverable.
2. **Ghost replay** (`server/services/ghostReplay.ts`) replays **real vaulted
   caller turns verbatim** against any candidate prompt. The caller side is
   fixed and real, so only the receptionist's replies vary — a like-for-like
   comparison. Grading is deterministic (resolution-offered + banned-claim
   regexes) and cannot be sweet-talked by the prompt under test.
3. **The semantic resolution judge** (`server/services/resolutionJudge.ts`,
   2026-08-07) is a backstop *behind* the regex, never a softener. Regex first —
   a match is a resolution, no API call. Only a MISS escalates to a
   **different-model-family** judge, which answers the question a regex cannot:
   was a concrete next step even *possible* from what the caller said, and was it
   offered? A verdict of `unresolvable` (wrong number, or the caller gone before
   asking) **excludes that seed from the pass-rate denominator** and hides it
   from the optimizer — counting an unwinnable call as a prompt failure both
   understates the score and trains the optimizer on a hang-up (ROS-087). The
   judge can **never** overturn a price leak, a guarantee, or an empty turn;
   those stay deterministic and disqualifying. A dead judge lane leaves the regex
   verdict standing and marks the grade `judgeUnavailable` — it can never
   manufacture a pass.
4. **The weekly optimizer** (`promptEvolutionWeekly` cron) proposes bounded edits
   from a different model family, guards the compliance spine with
   `violatedInvariants`, and accepts a candidate **only on strict holdout
   improvement**. Output is a PROPOSAL (kv + Telegram — not files; Railway's
   filesystem is ephemeral). Seeds exclude verified conversions so the optimizer
   never trains on a mislabeled win.
5. **The cage match** (`scripts/cage-match.ts`) is the *discovery* instrument: an
   adversarial LLM caller red-teams the prompt offline, zero customer contact.

**Instrument rules learned the hard way — read before trusting either number:**

- **A tireless simulated caller flatters the prompt.** The cage adversary keeps
  talking for 16–17 turns and hands the receptionist recovery chances real
  callers never give; it scored a HOLD on the exact seed the frozen real caller
  failed. **Cage for discovery, ghost replay for verdicts.**
- **Both duel lanes are pinned by name, never ambient.** A probe that exercises a
  different lane than the measured work is a false-green generator: one gauntlet
  failed all 8 matches on a dead lane and still exited 0 printing "0 losses"
  (ROS-086). A run that completes zero units of work now exits non-zero.
- `AI_FORCE_OLLAMA=true` reroutes **every** request — explicit pins included —
  onto one model, which silently puts the same model on both sides of a duel. The
  instruments strip it in-process; prod config is untouched.
- `OLLAMA_API_KEY` is **not** in `apps/nickstire/.env`. Its home is
  `apps/statenour/.env` locally and Railway in prod; inject it per shell for
  local instrument runs.
- Aggregate pass rates are **not** an A/B — the seed pool rotates as new calls
  vault. Same-seed movement is the only controlled comparison, and deepseek stays
  ±1–2 seeds nondeterministic even at temperature 0.

**Four defect classes have been found by this loop and pushed live** (each
verified on its own failing seed before merge, and read-back verified on the
served prompt after each Push Config): name-ask transfers, the repeated-ballpark
stonewall, the invented parts policy + competitor referral, and the wrong-shop
caller. See ROS-085 and the ISSUE-REGISTRY rows for each.

### Outbound SMS delivery — operating contract

- Outbound routes **shop-first** through the Capevace/F25e gateway on the shop's own Verizon line. Twilio is configured but not the primary sender.
- A send blocked by quiet hours (8AM–8PM ET), an unreachable gateway, or the **global SMS pause** is **queued**, not failed. `sms_messages.status='queued'` is the durable record.
- **Rehydration is continuous** (2026-07-29): `rehydrateQueuedFromDb` runs at boot AND on the drain timer after each throttled stale-'sending' recovery pass (~5 min cadence), `LIMIT 100` per pass — a >100 backlog drains over successive passes without restarts. Rows younger than a 2-minute claim grace are left for their in-flight `queueForLater` stamp (double-load race). In-memory dedup is by **DB id, checked before the claim**.
- Rehydration atomically claims each row `queued → sending`. A crash-orphaned `sending` row is flipped back by `recoverStaleSendingRows` (>10 min → `queued`, >48h → `failed`) and now HAS a live consumer in the running process — the next timer rehydrate loads it.
- **Global SMS controls** (2026-07-29): `sms_global_pause` DB flag = the real kill switch for the F25e path (HOLD semantics — marketing+followups queue durably, confirmations+internal flow; drain holds while paused; unreadable state fails closed for marketing only). Shop-wide rolling-24h cap (`SMS_GLOBAL_DAILY_CAP`, default 200) counted from `sms_messages` refuses automated sends over cap. Human takeover is enforced at the `sendSms` chokepoint for automated classes (`humanInitiated: true` = operator-approved exemption). The old `SMS_KILL_SWITCH` env gates only the dead Twilio fallback and is display-only in practice.
- **SMS autonomy ladder** — `server/services/smsAutonomy.ts` declares level 0-4 per automation; `setRolloutMode` enforces each event type's declared ceiling. Ops surface: `smsOps.opsStatus` + the SMS Ops strip in the admin (pause lever, queue depth/age, caps, suppressions, ladder).
- **Bounded retry + dead-letter** (Autopilot Wave 1, 2026-07-29, migration **0104 — hand-apply required**): a definitive drain failure increments `send_attempts` and dead-letters at 5 (`failed`, `failure_reason='max_retries_exceeded: …'`); the 48h rule stamps `stale_sending_expired`. Pre-0104 the code degrades to the old time-bounded-only behavior. Replay: `smsOps.replayFailed` (atomic `failed→queued`, attempts reset, audit-logged, idempotent).
- **Silent-stall alert**: gateway healthy + in-hours + unpaused + due rows queued >5 min → Telegram (transition-aware, hourly re-alert). Rehydration now runs EVERY drain cycle (60s), recovery stays 5-min throttled.
- **Stale-lead truth** (Autopilot Wave 1): the 2-24h follow-up cron claims via `lastFollowUpAt IS NULL` and marks a lead `contacted` ONLY after a confirmed dispatch (`sent`/`queued`). A blocked/failed attempt leaves `status='new'` — the 24h `stale_lead` collector surfaces it. The cron also skips leads with a pending callback or inbound SMS within 48h (channel dedupe).
- **Autopilot Wave 6** (2026-07-29): `abandoned_form` collector (2h–14d partials w/ phone, subsequent-lead/booking excluded; `partial` evidence, value null, call-first) + string-keyed reconciler. **Takeover release**: `smsOps.releaseTakeover` writes `customer.sms_takeover_released` (fail-LOUD direct insert); `isConversationHumanHeld` is release-aware (most-recent signal wins — a manual reply after a release re-arms). Decision Inbox UI: snooze picker (2h/1d/2d/1wk), manual-match toggle on Won (un-closable-opportunity fix; recorded `manual`, never verified), owner chip.
- **Autopilot Wave 4 — identity verdicts** (2026-07-29): `services/identityResolution.ts` computes `resolved|ambiguous|unresolved|conflicted` per phone from existing tables (no link table — the prod dry-run measured 99.9% resolved / 0 ambiguous / 1 conflicted = operator's own test phone, so a stored graph is evidence-refused; see the audit doc §4). Enforced: `sendOpportunityDraft` refuses personalized sends on ambiguous/conflicted/unreadable; `draftOutreach` surfaces the verdict in risk reasons. Inbound-path refusal (`loadCustomerContext`) and estimate-collector rules unchanged and authoritative.
- **Autopilot Wave 2** (2026-07-29): two more collectors — `no_show_booking` (open booking requests whose preferred date passed; `inferred` by design — FCFS shop, a date is an intention) and `human_pending_sms` (conversations past the 30-min human SLA; `critical`/`verified` — the highest-signal row the queue holds). Morning brief now leads with an EXCEPTIONS block (waiting customers, blocked sends, held queue, delivery failures; failed reads render UNKNOWN). Migration **0105 — hand-apply** adds `sms_messages.sent_at` (drain-stamped) making queue→sent latency honestly measurable (`smsOps.latencyMetrics.queueToSent`). Bridge §8: `draft_opportunity_sms` / `send_opportunity_sms` — the ONE bounded statenour texting action (opportunity-row identity, shown-body approval contract, durable idempotency via `sms.bridge_send` audit rows, full chokepoint gates).
- Verified 2026-07-20: a tuple-shape misread of the claim result made that claim always evaluate to zero rows, so every restart moved up to 100 messages into `sending` and sent none. 136 messages to 103 people accumulated between 2026-06-02 and 2026-07-19. Fixed (#962/#965, `lib/db-affected.ts` `affectedRowCount`), backlog released, 132 delivered.
- Every non-send path in `sendSms` now logs a reason, and the drain logs hold/resume transitions (#970). Before that, a message that never reached a customer left no trace anywhere.

### Inbound SMS response — durability + human takeover (2026-07-21, NCSOS)

- Every inbound customer text now creates a durable **`sms_response_jobs`** row — the obligation to respond, deduped by a deterministic idempotency key so a provider redelivery maps to one job. The webhook still answers in-request for latency; the job row is the durable safety net. `server/services/smsResponseJobs.ts` (#986).
- A job leaves the queue only via a terminal status: `responded` (a reply was dispatched), `suppressed` (the AI deliberately did not auto-send — human owns it), `failed` (dispatch failed; the outbound layer owns delivery retry), or `dead` (retried and still threw). `startResponseJobProcessor` re-sweeps un-answered `pending` jobs on boot and every 45s and reclaims crashed `processing` jobs — so an inbound reply can no longer be silently lost to a restart.
- **Human takeover:** if an operator manually replied to a conversation within 60 minutes (signalled by the `customer.sms_manual_send` audit row), the orchestrator suppresses AI auto-send and downgrades to a draft the operator approves — the AI never texts over a live human. STOP/opt-out is handled earlier and is unaffected. `server/services/humanTakeover.ts` (#987).
- The SMS drafter now receives the customer identity, vehicle, open-estimate service, and last-VAPI-call gist that `loadCustomerContext` already loaded, so replies are personal, not cold (#988). The SMS persona prompt is a single shared SSOT constant (`nickSmsPersona.ts`) imported by both the live drafter and the fine-tune corpus exporter, so training data and serving cannot drift (#989).

## Contracts that are executable, not prose (2026-07-27)

Three governing contracts moved from markdown into typed modules that the code
actually reads. In each case the prose remains for humans; the module is what
runs, and a parity test fails the build if the two disagree.

- **Brand voice** — `shared/voice.ts` is the sole source of the kill list, the 7
  positive patterns, the surface rules and the CTA library. `docs/brand/VOICE.md`
  and `.claude/brand-voice-guidelines.md` no longer carry word lists; the
  brand-voice linter, both Instagram prompts and `voice-compliance.test.ts` all
  import the kernel. Before this the voice existed in seven disagreeing copies
  and "reliable" shipped to the live site (ROS-074). Adding a rule anywhere but
  the kernel fails `voiceKernelParity.test.ts`.
- **Metrics** — `shared/metricsContract.ts` carries the 27 canonical metrics from
  `docs/METRICS-CONTRACT.md` with their evidence levels and ROI-safety, plus the
  `MetricEnvelope` every executive metric response should travel in. It is a
  registry and validator only; no existing query or admin surface was rewired to
  it in this change (ROS-077). `Verified attributed revenue` is the single
  ROI-safe revenue concept, pinned by test.
- **Loop health** — `server/services/loopShapeContract.ts` declares, per loop,
  the output a healthy run produces. A run that succeeds while producing nothing
  is `dormant`; a run that succeeds without measuring its output is `unknown`,
  never healthy (ROS-078). Contracts and a pure classifier only — no observer is
  wired to it yet.

Answer-engine crawlers (`OAI-SearchBot`, `ChatGPT-User`, `PerplexityBot`,
`Claude-User`, `Google-Extended`, `meta-externalagent` and others) now receive
prerendered HTML. `GPTBot` was already present but is OpenAI's model-training
crawler, not the agent that answers a customer question (ROS-076).

## Manual or operator-gated systems

- Applying SEO copy changes to source
- Publishing generated content or GBP material
- Approving and publishing reels (Instagram → Publish → **Reels segment** since the 2026-07-24 reel-absorption wave — the legacy Queue is deleted; hash-sealed via approveDraft/publishPost with a two-tap exact-payload confirm; earlier live verification 2026-07-17 with IG posts 18018908711883906 and 17877918753617173)
- Approving and publishing Instagram Studio V2 drafts — server-owned quality gate (review/declined-work sources are picked from real records; the server still verifies them), deterministic HTML→JPEG render, drafts persisted server-side with versioned autosave from the moment of generation, and an explicit approve → schedule/publish step behind a two-tap payload confirm; nothing posts without operator action (`server/services/instagramStudio.ts`, `server/routers/instagramStudio.ts`)
- Pushing VAPI prompt/configuration changes
- Resolving weak invoice or customer matches
- Approving outbound campaigns
- Correcting historical classifications
- Production migrations and credential rotation

## Experimental or modeled systems

- Classifier-derived call outcomes
- Duration-based warm-transfer connection estimates
- Modeled receptionist pipeline value
- AI-generated recommendations and drafts
- Weak phone/time attribution without direct identifiers

These must remain visibly labeled as inferred or modeled.

## Retired or historical-only material

- Files under `docs/_archive/` are historical evidence, not current instructions.
- The archived `docs/_archive/root_reports/truth_os.md` is not the current operating contract.
- Old audit findings are not standing truth. Reverify them against current source, tests, generated output and production evidence.

## Not currently measurable with full confidence

- Universal transfer connection without a direct VAPI human-answer signal
- Arrival from a walk-in direction unless a later operational record is linked
- Paid revenue attributable to a call without a defensible invoice match
- Exhaustive GSC query/page totals from bounded dimensional API rows
- Revenue caused by a classifier outcome

## Authoritative operator surfaces

- Paid revenue: invoice-backed revenue views
- Leads and bookings: their respective operational tables and admin workflows
- Voice call activity: Voice Receptionist admin, with metric definitions from `METRICS-CONTRACT.md`
- Search performance: official GSC aggregate totals plus separately labeled detailed-row analysis
- System health: integration-specific timestamps and error states, not a single blended score
- Instagram content: the five-view IG admin (`?igview=` Today / Create / Publish / Community / Insights, 2026-07-24). **Publish is the only queue** — Board (lifecycle × computed health, incl. the Attention lane), List, and Reels segments; Planning, reel recovery, autonomy control and settings live behind the gear. Views, filters and inner tabs are URL-persisted and honor browser history (popstate). Admin-wide rule pinned by tests: a failed read renders as *unknown*, never as an empty/positive state (`adminTruth.test.ts`, `emptyIsNotUnknown.test.ts`); client dialog globals are lint-banned (the iOS PWA suppresses them)

## Production actions not performed by documentation changes

Documentation does not deploy, migrate data, reclassify history, contact customers, update VAPI, publish GBP content or modify external accounts.