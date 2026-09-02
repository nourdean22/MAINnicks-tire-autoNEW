# Nick's Tire Admin — automation, outreach, security and data: verified findings

**2026-09-01 · Artifact 2 of the audit.** Builds outward from
[`ADMIN-WIRING-AUDIT-2026-09-01.md`](./ADMIN-WIRING-AUDIT-2026-09-01.md) (artifact 1: route
inventory + first wiring findings F-1…F-5). Same evidence discipline: every claim names a file
and line at `origin/main` **`5c1195e6f`**; everything is VERIFIED CURRENT CODE unless marked
otherwise; **no runtime, no live UI, no DB rows were read.** The working tree is still gutted
(artifact 1 §0) — every read below came from the git object database.

Findings continue artifact 1's numbering. Corrections continue its ledger.

---

## 0. Correction ledger, continued

Artifact 1 logged four corrections on ~12 candidates. This artifact's detectors produced six
more. **Two of them were the exact false-positive shape the sibling StateNour audit shipped
today**, which is the reason this ledger exists.

| # | Claim I nearly shipped | What refuted it | Class |
|---|---|---|---|
| 5 | `crossSellOutreach` is an orphaned cron job (referenced by no registry, route, or router) | `scheduler.ts:1541` — *"RETIRED 2026-08-04 · cross-sell-outreach (ROS-033, operator decision)"*. Detector fired correctly; "defect" reading was wrong. | interpretation |
| 6 | `campaigns.send` claims `status: "sent"` before sending and never releases it (same shape as F-1) | `campaigns.ts:509-515` — the failure branch **does** set `status: "failed"`. Only the `queued` case leaves "sent". | scope |
| 7 | 29 cron jobs are double-scheduled (in both `registerAllJobs()` and a scheduler tier) | `cron/index.ts:65-66` — `startAllJobs()` throws; `registerJob` only fills a Map for the HTTP-trigger path. One live scheduler. | false positive |
| 8 | **RBAC is barely enforced** — `hasAdminPermission` has 3 call sites across 703 procedures | `_core/trpc.ts:228-229` — the shared `adminProcedure` middleware resolves a permission for **every** call via `permissionForAdminProcedure(path, type)`. The low decorator count is by design. `adminPermissionCoverage.test.ts` proves the repo already measured and closed "49 of 85 routers fell to admin.view". | **the sibling's false P0, avoided** |
| 9 | The Twilio webhook has no signature check | `routes/webhooks/twilio.ts:17` — `router.use(validateTwilioRequest)`; the check lives in `middleware/twilioValidation.ts` and fails **closed** in production when the token is unset (`:37-40`). My grep was scoped to one file. | false positive |
| 10 | Only ~8 operator actions are audited | `services/auditTrail.ts` `logAdminAction` has **29** call sites; with `operatorActionLog` (4) and `adminSecurity.recordAction` (4) that is ~37 across three ledgers. Coverage is far better than my first read; fragmentation stands. | magnitude |

**Running total: 10 corrections on ~30 candidate findings. Every finding below survived a
falsification pass, and the two detectors introduced here each carry a positive control.**

---

## 1. The "sent" problem is systemic, and the codebase already contains the fix

Artifact 1's F-1 (RUN FOLLOW-UPS burns bookings and toasts green) is not an isolated bug. It is
one instance of a pattern that appears across the outreach layer in **three sub-shapes**, and —
this is the important part — the codebase already implements the *correct* pattern in two
places, which makes every other site a measurable deviation rather than a design debate.

### 1.1 The standard the codebase already meets, in two places

**Meta/Instagram publish** (`services/metaSocial.ts`) is the gold standard in this repo:
`pollContainerReady` (`:317-360`) waits for Meta's container to report `FINISHED` or `ERROR`
before `media_publish`; the publish itself has a distinct **`ambiguous: true`** outcome
(`:537`, *"media_publish sent but no response — the reel may be LIVE"*); and
`publishReconciler.reconcileAttempt` (`:67-77`) reads the account back and returns
`cannot_check` as a first-class state, explicitly *"not knowing is a legitimate outcome and
must not look like 'not published'."* Three-valued truth, read-back verification, and honest
uncertainty.

**Unpaid-invoice recovery** (`cron/jobs/unpaidInvoiceRecovery.ts:286-303`) is the SMS-side
standard: it stamps `paymentReminder7dAttemptedAt` as the at-most-once claim, then stamps
`paymentReminder7dSentAt` **only** on `res.success`. Attempted and sent are different columns.
A failed send leaves a visible, queryable "attempted, not sent" state.

Everything below is measured against those two.

### 1.2 What `sendSms` actually returns — the fact every caller must know

`server/sms.ts` returns `{ success: true, queued: true }` — **not** `success: false` — in two
common situations:

| Situation | Where | How common |
|---|---|---|
| Outside 8 AM–8 PM ET, non-exempt class | `sms.ts:1889` (`bypassQuietHours`) and the `queueForLater` branch that follows | **Every after-hours automated send.** Most cron tiers run around the clock. |
| `sms_global_pause` is ON | `sms.ts:1914-1940` — "HOLD, not drop" | Whenever the shop-wide stop is thrown |

The message goes to a durable queue (`queueForLater`, `sms.ts:337-378`, persisted as an
`sms_messages` row with `status: "queued"`). That queue can **terminate a message as
`failed`**: `MAX_SEND_ATTEMPTS = 5` (`sms.ts:512`) flips `sending → failed` (`:534-535`), and
the stale-orphan sweep marks `stale_sending_expired` (`:590`). So `success: true, queued: true`
means *"accepted for later; may still fail"* — and a caller that writes "sent" on `success`
alone has written a receipt for an event that has not happened and might never happen.

### 1.3 Detector: callers that check `.success` but not `.queued` — with controls

42 non-test `await sendSms(` call sites (`server/**`). For each, a 25-line window was scanned
for `.success` and `queued`.

- **Positive control (detector recognises good callers):** `crossSellOutreach.ts:357`,
  `declinedWorkRecovery.ts:577`, `retentionSequences.ts:293`, `smsOrchestrator.ts:729/1552`,
  `opportunityDraft.ts:251`, `weatherIntelligence.ts:139` all check `queued`. ✅
- **Negative control (detector flags the known-bad site):** `follow-ups.ts:77` (F-1). ✅
- **Known limitation:** a `queued` mention in a nearby comment counts as "checked", and a
  caller that returns the result to a parent that checks it shows as unchecked. Every site in
  the table below that carries a severity was **hand-read**; the rest are triage.

#### Sub-shape (i) — claim first, never release *(F-1 family)*

| Site | Claim written before/without send | Released on failure? | Consequence |
|---|---|---|---|
| `follow-ups.ts:55, 84` | `bookings.followUp24hSent = 1`; `processed++` | **No** | F-1 — see artifact 1 |
| `services/workOrderAutomation.ts:277-291` | `UPDATE estimates SET followUpSent = 1`; `sent++` — **even when the feature flag skips the send entirely** (`:277`, `:290`) | **No** — the only writer of `followUpSent` is this line; nothing resets it | **F-6, below** |
| `services/workOrderAutomation.ts:388-432` + `dripProcessor.ts:151-163` | drip enrollment persisted at `currentStep = 1` **before** step 1 is sent; step-1 send result discarded (`:432`) | No — advancement is purely `nextStepAt <= NOW()` (`dripProcessor.ts:201`) | a customer whose step-1 text failed **receives step 2 on schedule**, as if step 1 had arrived |

#### Sub-shape (ii) — `success` written as "sent" while the message is queued

Hand-verified, highest stakes first:

| Site | What is stamped on `success` | Reality when `queued: true` |
|---|---|---|
| `routers/smsConversations.ts:105-114` — **operator's manual reply** | `addSmsMessage({ status: "sent" })` | see **F-7** |
| `routers/campaigns.ts:494-507` | row is already `status: "sent"` from the claim; `batchSent++`, `totalSent++` | campaign "sent" count = accepted-for-later, not delivered |
| `cron/jobs/unpaidInvoiceRecovery.ts:297-302` | `paymentReminder7dSentAt = now()` | the one site with an Attempted/Sent split still stamps *Sent* on a queued message |
| `follow-ups.ts:77-80` | `markNotificationSent` | notification row says sent; message is in the queue |
| Triage only (not hand-read): `crudAutomation.ts:594`, `warrantyAlerts.ts:107`, `postInvoiceFollowUp.ts:148`, `advanced/invoices.ts:1020`, `advanced/portal.ts:97`, `customers.ts:674/761`, `reminders.ts:100`, `reviewRequests.ts:209`, `winback.ts:755`, `customerMessageTemplates.ts:216`, `winbackProcessor.ts:127`, `workOrderAutomation.ts:347` | | |

#### Sub-shape (iii) — result discarded, then a claim or a "sent" log

`dropOffFlow.ts:124/158/190` (`await sendSms(...)` then `log.info("… sent")` regardless — log
only, no persistent claim, lowest severity); `workOrderAutomation.ts:278-290` (F-6);
`dripProcessor.ts:279` (step N send, result unassigned, enrollment already advanced).

---

### 🔴 F-6 · `estimate-followup` cron: F-1's unattended twin

> **Correction #18 (2026-09-02):** this twin never sent a text and never could -- its table does not exist in production (see F-17, correction #18). The counter/claim fixes shipped for it in PR #2063 were theater on a dead job; the job is retired in the follow-up PR and `alg_estimates` recovery is the one estimate follow-up path.

`services/workOrderAutomation.ts:246-296` (`processEstimateFollowUp`), registered in the
**daily** tier at `cron/scheduler.ts:2188-2192`.

1. Selects estimates 2–3 days old with no work order, a phone, and `followUpSent = 0` —
   **`LIMIT 10`** (`:254-263`).
2. If flag `sms_retention_sequences` is on, sends a text; **the send result is discarded**
   (`:277-289`).
3. **Unconditionally** `UPDATE estimates SET followUpSent = 1` and `sent++` (`:290-291`) —
   flag off, send failed, or send queued, all the same.
4. Returns `{ recordsProcessed: sent }` → `cron_log` as a *completed* run that "sent" N.

Two defects, independent of each other:

- **Silent burn.** With the flag off, every daily run permanently consumes up to 10 estimates
  and reports them as followed up. Unlike F-1 there is no button and no operator watching.
- **Silent starvation.** The window is a sliding 24-hour band. On any day with more than 10
  eligible estimates, the 11th ages out of the band tomorrow and is **never** selected again.
  There is no second sweep and no reset — `followUpSent` has exactly one writer (`:290`).

**NOT VERIFIED:** production value of `sms_retention_sequences`; whether `estimates.followUpSent`
exists in production at all — see F-12 (it is absent from `schema.ts` and every migration).

**Fix shape (from the codebase's own standard):** split into `followUpAttemptedAt` /
`followUpSentAt` per `unpaidInvoiceRecovery.ts`; count only on `success && !queued`; select on
`followUpAttemptedAt IS NULL` with an age floor instead of a 24-hour band.

---

### 🟠 F-7 · The operator's own reply to a customer is gated as *marketing*

`routers/smsConversations.ts:105` sends the operator's manual reply as
`sendSms(normalized, cleanMessage, { via: "shop", humanInitiated: true })` — **no
`messageClass`**. `sms.ts:1689`: `const messageClass = opts?.messageClass || "customer_marketing"`.

`humanInitiated` does **not** reclassify: its only effect is to lift the internal-destination
refusal (`sms.ts:1716-1736`). So a human answering a customer's question inherits the strictest
gate set in the system:

| Gate | Applies to the operator's reply? | Source |
|---|---|---|
| 8 AM–8 PM quiet hours → queued to next window | **Yes** — `bypassQuietHours` is `isInternal || customer_confirmation || _forceImmediate`; none is set | `sms.ts` window check |
| Opt-out index check | Yes (`customer_marketing && !skipOptOutCheck`) | `sms.ts:1862` |
| Unreadable `sms_global_pause` → **fail CLOSED** | Yes — while the same block reserves fail-**OPEN** for *"a customer's own question must not go unanswered because of a DB blip"* (`sms.ts:1919-1923`) | `sms.ts:1924-1927` |

**Observable consequence:** at 8:15 PM the operator types a reply and sees it as "sent"
(`smsConversations.ts:113`); the customer receives it at 8:00 AM. The highest-daily-use action
in the admin misreports its own outcome for roughly half of every day.

This is a gate with the wrong subject: the subject is "marketing"; the message is a human
reply. Whether a human reply to an inbound question should honour STOP/quiet-hours is a
**question for counsel, not for this audit** — but the classification should be a deliberate
choice, not a default fallthrough.

---

### 🟠 F-8 · Every operator reply writes two rows into the thread

Two independent persistence paths, both live, neither aware of the other:

1. `sms.ts:2028-2030` — on gateway success, `sendSms` itself calls
   `persistOutboundShopSms(..., "sent", gatewayMessageId)` **unless `opts.skipPersist`**.
   After hours, `queueForLater` (`:374-378`) persists a `"queued"` row instead.
2. `smsConversations.ts:108-114` — the router then calls `addSmsMessage({ status: "sent" })`
   into the same conversation (`getOrCreateConversation`, keyed by last-10-digit phone, `:96`).

The operator router passes **no `skipPersist`**. `getConversationMessages` (`db.ts:1509-1514`)
is a plain select by `conversationId` with no dedupe; the client renders the list as-is.

History makes the cause exact: `addSmsMessage` in the router predates the monorepo
(`859cffb7c`, 2026-05-17); `persistOutboundShopSms` arrived 2026-05-20 (`4c5c92aad`);
`skipPersist` arrived 2026-06-01 (`69a86a1dd`, *"kill the cron double-count"*) and was applied to
cron callers — **never to the operator path**. No test asserts a single row.

**Consequences:** the thread shows each operator reply twice (one row carrying the gateway
id, one without); after hours, one row says *queued* and its twin says *sent*; every count over
`sms_messages` outbound rows is inflated for operator replies. **Live-UI manifestation NOT
VERIFIED** — I could not render the thread. The mechanism is verified at every link.

---

## 2. The automation layer, as it actually is

### 2.1 Shape

| Fact | Value | Source |
|---|---|---|
| Live scheduler | **one** — `startTieredScheduler()` in `cron/scheduler.ts` | `cron/index.ts:65-66` (`startAllJobs()` throws) |
| Tiers and cadence | heartbeat 5 m · pulse 15 m · **"hourly" = 2 h** · daily 24 h · briefings 12 h | `scheduler.ts:527-528, 697-698, 1152-1153, 1712-1713, 2506-2507` |
| Named tier entries | 122 (many handlers inline) | `scheduler.ts` `name:` fields |
| Legacy HTTP-trigger registry | 35 names in `registerAllJobs()`; not a scheduler | `cron/index.ts:306` |
| Job files | 52 (41 non-test) | `server/cron/jobs/**` |
| Cross-dyno lock | yes (`acquireCronLock`, `held-by-other` / `fallback` states) | `cron/index.ts:96-159` |
| Run receipt | `cron_log` row per run: status, `records_processed`, `details` | `cron/index.ts:204-223` |
| **`cron_log` retention** | **7 days** | `cron/jobs/cleanup.ts:42-50` |

The tier named `hourly` fires every two hours (`scheduler.ts:1153`). Minor, but it is exactly
the name-versus-subject mismatch this audit exists to catch.

### 2.2 🟡 F-9 · ~35 cron catch-blocks still convert a crash into a "completed" run

`cron/index.ts:290` logs `status: "completed"` whenever the handler returns instead of throwing.
A handler whose `catch` returns `{ recordsProcessed: 0, details: "Failed: …" }` is therefore
recorded as a **successful run that produced nothing**, with `error_message` NULL (`:223`).

The repo knows this. `cron/jobs/cron-rethrow.test.ts:1-18` documents the wave-181.3/.15/.16
fixes (rethrow instead of swallow) for `warrantyAlerts`, `vapiLatencySync`,
`resumeStuckCampaigns`, canaries them, and states plainly: *"that pattern still exists in ~30
other cron jobs in this repo."* My scan of `cron/jobs/**` finds the surviving swallow-and-return
sites in: `chatFaqPipeline:189`, `confirmationCalls:106`, `crossSellOutreach:420` (retired),
`crudAutomation:33,115,176,231,345,378,451,478,546,630`, `cronSkipWatchdog:183`,
`dailyReport:76`, `dashboardSync:134`, `followupCadence:114,136`,
`intelligenceAutopilot:309,352`, `inventoryDemandForecast:83`, `monteCarloForecast:124,127`,
`psychoProfileRefresh:42`, `reviewMonitor:147`, `seoForensic:100`, `smsGatewayHealthMonitor:59`,
`socialInventoryPublisher:177`, `statenourSync:457`, `voiceRecovery:103`,
`weeklyRevenueDigest:413,416,423`.

**Why this is 🟡 and not 🔴 — the compensating control, verified:** `cron/observer.ts:264-277`
counts consecutive zero-output runs, excluding only runs whose `details` match the three skip
regexes in `services/loopShapeContract.ts:263-271` (`^skip`, `— skipped$`, `flag … disabled`).
`"Failed: …"` matches none of them, so a swallowed crash **does** accumulate toward a dormancy
alert. But: the alert is delayed by the streak threshold, it is labelled "producing nothing"
rather than "crashing", its `Latest error:` line reads *"no error message logged"*
(`observer.ts:382`), and the evidence window is the **7-day** `cron_log` retention. Degraded
signal, not absent signal. The fix is the one the repo already chose: rethrow.

### 2.3 🟡 F-10 · `CRON-INVENTORY.md` has drifted by ~37 jobs

`docs/operations/CRON-INVENTORY.md` opens with *"If you add a new job, update this doc in the
same commit."* Diffing its 87 job rows against the 128 names in code:

- **In code, not in the doc (42, of which 5 are tier names):** agentic-auditor, alg-evening-probe,
  campaign-resume, closed-loop-measure, confirmation-calls, content-experiment-resolve,
  content-reserve-replenish, cron-skip-watchdog, daily-reel-post, followup-cadence,
  higgsfield-session-keepalive, ig-autopost, inventory-demand-forecast, monte-carlo-forecast,
  overdue-reply-alert, prediction-outcomes-resolve, prompt-evolution-weekly,
  proposal-orphan-sweep, psycho-profile-refresh, reel-comment-responder, reel-pipeline,
  retention-{7,14,90,180,365}day, scheduled-posts, seo-forensic, service-affinity-compute,
  sms-learning-digest, social-inventory-publisher, statenour-sync, unpaid-invoice-recovery,
  vapi-call-eval, vapi-harness, vapi-latency-sync, voice-recovery, weekly-revenue-digest.
- **In the doc, not in code (2):** `auto-labor-guide-sync` (gone), `cross-sell-outreach`
  (retired 2026-08-04, still listed live).

Coverage ≈ 69%. See §6 for why this matters beyond tidiness.

### ✅ N-2 · `crossSellOutreach` — retired, not orphaned (do not re-flag)

Unreferenced by any registry, route or router — **by operator decision**, `scheduler.ts:1541`,
ISSUE-REGISTRY ROS-033. The file, its flag, and the predictions data are deliberately retained
(the predictions table has live readers). Three documents still describe it as live:
`REVENUE-AUTOMATION-STATE.md:22` (*"flag ON in prod [VERIFIED-runtime] … AUDITED: CLEAN"*),
`CRON-INVENTORY.md:129`, `eval-rubrics/slos.md:96`; and `crossSellDeadQuery.test.ts:5` opens with
*"cross-sell-outreach is registered hourly"*. All four are stale.

---

## 3. What "Approvals" actually gates — and what it does not

The registry entry for the Approvals section says *"every AI- or one-tap-originated action
lands here as a draft and executes only on human approval"* (`registry.tsx`, `approvals`).
Against the code:

| Fact | Source |
|---|---|
| Registered proposal executors: **`create_callback`, `create_booking_request`** | `services/proposals.ts:117, 134` |
| Plus `publish` — created **only** when an automated publish is *blocked* or the source is `fallback_unreachable` (an exception path, not the default gate) | `services/socialPublish.ts:132, 151` |
| Zero references to proposals in: `smsOrchestrator`, `igAutopost`, `dailyReelPost`, `socialPublish` default path, `winbackProcessor`, `dripProcessor`, `staleLeadFollowup`, `missedCallRecovery` | grep, `server/services`, `server/cron/jobs` |
| Zero references in the 11 operator-driven send/publish routers (`campaigns`, `smsConversations`, `opportunityQueue`, `winback`, `reviewRequests`, `reminders`, `customers`, `gbp`, `instagramAdmin`, `instagramStudio`, `content`) | grep, `server/routers` |

The **real** AI-SMS gate is `services/smsAutonomy.ts`: `AutonomyLevel 0-4`,
`RolloutMode off | shadow | draft_only | live_send | legacy_passthrough`, a per-lane
`SMS_AUTOMATION_REGISTRY` with an `evidenceRequirement` per lane (e.g. *"confidence ≥0.85;
safety/complaint/legal intents force human"*, `:103`), surfaced in the admin by
`AutonomyCensusPanel`. Instagram/reel lanes are gated by env flags (`REEL_AUTOPOST_ENABLED`,
`REEL_PUBLISH_ENABLED`, `IG_AUTOPOST_DRYRUN`, flag `legacy_autopost_live`).

So there are **three parallel autonomy systems** — proposals (3 action types), the SMS rollout
registry, and IG env flags — and the section labelled "Approvals" governs the smallest. The
asymmetry is stark: an AI-drafted single callback waits for a human; an operator's one click on
`campaigns.send` texts a whole segment with no draft state. That is defensible (operator intent
is consent), but the sidebar label promises universality it does not have. **Runtime rollout
modes NOT VERIFIED** — agent memory records most external-side-effect flags as armed; read the
service, not the memory.

---

## 4. Security — narrow, verified, and with the sibling's mistake avoided

### 4.1 What is right, and should be left alone

- **RBAC is enforced on every `adminProcedure`** by `requireFreshMfaAndPermission`
  (`_core/trpc.ts:228-229`) via a path→permission resolver (`shared/adminPermissions.ts:42-`).
  `adminPermissionCoverage.test.ts` asserts no mutation resolves to `admin.view`. The resolver is
  thoughtful about reads: `customers.*`, `lead.*` require `.manage` for queries too;
  `export.*` requires `settings.manage` after a self-documented 10,000-customer CSV exposure
  (`adminPermissions.ts:69-73`); `sms*` requires `marketing.manage` (`:146-155`), so
  **no viewer/tech/accountant can read customer SMS threads**; `vapi.*` requires
  `callbacks.manage` (`:158`).
- **Every inbound webhook verifies its caller:** Twilio (`validateTwilioRequest`, fail-closed in
  prod), Meta (`X-Hub-Signature-256` over raw body, `meta.ts:57-61`), Messenger (verify token +
  signature, `_core/index.ts:1088-1104`), VAPI (`x-vapi-secret` constant-time; rejects in prod
  when unset, `vapi.ts:39-47`), Stripe (`constructEvent`, `_core/index.ts:891`; half-configured
  state logs *"Real payment events are being DROPPED"*), Snap (HMAC; rejects when secret unset,
  `statenour-bridge-routes.ts:731-741`), shop SMS gateway (`X-Signature` hex, `smsGateway.ts:64`).
- **Customer identity is strong:** `customers.phone` UNIQUE plus a generated, normalised
  `phone10` UNIQUE (`schema.ts`, `uniq_customer_phone10`), so format variants cannot create
  duplicates.
- **Default role for a new admin is `viewer`** (`adminSecurity.ts:88`); roles are set explicitly
  by `setRole` behind `security.manage` (`adminSecurity.ts:110`).

### 🟠 F-11 · Authorization fails **open, as owner**, when the security row is unreadable

`_core/trpc.ts:218-222`: `const effective = security ?? MFA_NOT_REQUIRED_STATE;` with the
self-logged message *"falling back to pre-RBAC behaviour (owner). Roles are NOT being enforced
for this request."* `MFA_NOT_REQUIRED_STATE.adminRole` is **`"owner"`** (`adminSecurity.ts:37`).

A transient DB read failure therefore promotes any admin session — `viewer` included — to owner
for that request. Contrast the SMS pause flag, which the same codebase fails **closed** for
marketing sends because *"could not check" is not "send"* (`sms.ts:1919-1923`). Authorization
deserves the stricter of the two. Blast radius depends on how many non-owner admins exist —
**NOT VERIFIED**.

### 🟠 F-12 · A `tech` can issue a Stripe refund

`gatewayTire.refundOrder` (`routers/gatewayTire.ts:1607`) is plain `adminProcedure` with no
inline role check. The resolver maps every `gatewaytire.*` path to **`workorders.manage`**
(`adminPermissions.ts:162-165`), which `tech` holds (`adminPermissions.ts:24`). Money actions
elsewhere resolve to `money.manage` (`invoices.*`, `payments.*`, `:79-80`). The refund inherited
its permission from the router it happens to live in. The refund *is* audited
(`invoice.refunded` / `invoice.refund_failed` via `auditTrail`), which bounds but does not
prevent. Whether any `tech`-role user exists is **NOT VERIFIED**.

### 🟡 F-13 · Front desk cannot text customers through the admin

The same resolver sends every `sms*` path to `marketing.manage` (`adminPermissions.ts:146-155`),
which only `owner` and `manager` hold. `front_desk` — the role whose job is answering customers —
can neither read `smsConversations.messages` nor call `smsConversations.send`. If the front desk
is meant to use the SMS inbox, the permission model contradicts the role model.

### 🟡 F-14 · Two bridges, two flat keys; one can run jobs

| Bridge | Routes | Auth | Notable |
|---|---|---|---|
| `_core/bridge-routes.ts` (Custom GPT) | 19 | single `X-Bridge-Key`, `timingSafeEqual` (`:115-130`) | `run-job` executes an **allowlisted** background job (`:1079`, STRIDE-D allowlist) — one leaked key runs jobs |
| `_core/statenour-bridge-routes.ts` | 7 GET | single `X-Statenour-Sync-Key`, `timingSafeEqual` (`:85-91`) | read-only |

Agent memory records StateNour's side moving to per-client scoped tokens on 2026-08-27; the
nickstire Custom-GPT bridge is still one flat key with a write capability.

### 🟡 F-15 · No customer-deletion path exists

No `deleteCustomer`, purge, anonymise or export-then-erase procedure exists for a customer
record (`routers/**`, `services/**`); only `deleteCustomerVehicle`. `dbCleanupPrune`
(`admin/dashboard/dbCleanup.ts:33-35`) prunes `leads | bookings | callbacks` only. Anonymisation
exists solely for the public FOMO ticker (`public.ts:181`). Whether a deletion capability is
*required* is a question for counsel; that none exists is a capability fact.

### 4.2 Audit ledgers — three of them

| Ledger | Call sites | Vocabulary (from literals) |
|---|---|---|
| `services/auditTrail.ts` `logAdminAction` | 29 | `lead.created`, `generate_quote`, `schedule_followup`, `schedule_callback`, `proposal.created`, `invoice.refunded`, `invoice.refund_failed`, `customer.sms_sent`, `customer.sms_manual_send`, `mark_failed`, `none` |
| `services/operatorActionLog.ts` | 4 | `discard`, `queue_truth_reconcile` |
| `adminSecurity.recordAction` (client-reported) | 4 | free-text |

~37 audited call sites across ~700 procedures, in three tables with three schemas. Coverage of
the consequential actions (refund, manual SMS, lead creation, proposals) is real; there is no
single spine an investigator could read top-to-bottom, and tire-order status changes (§5.2) are
in none of them.

---

## 5. Data model and data quality — verified

### 🟠 F-16 · `vehicles` is dead; `work_orders.vehicle_id` points at it

| Entity | PK | Reads | Writes | Verdict |
|---|---|---|---|---|
| `customer_vehicles` (`schema.ts:313`) | int | 3 | 3 | **live** |
| `vehicles` (`schema.ts:2094`) | `varchar(36)`, FK→customers, `vin`, `license_plate` | **0** | **0** | **dead table** |
| `work_orders.vehicle_id` (`schema.ts:2125`) | `varchar(36)` — shaped to match `vehicles.id`, not `customer_vehicles.id` | | | **dangling by design** |

Plus free-text `vehicle` / `vehicleInfo` varchar columns on ~12 tables (`schema.ts:36, 100, 173,
391, 485, 748, 919, 1289, 1341, 1419, 1550, 1926, 1955`). There is no canonical Vehicle: the
table with VIN and plate columns is never written; the table that is written has no FK from
work orders; and the operational truth lives in strings. Any "vehicle history" feature is
currently impossible to build honestly.

### 🟠 F-17 · Schema drift — columns the ORM does not know, relied on by crons

> **Correction #18 (2026-09-02, found while applying 0114 to production):** the `estimates` half of this finding was wrong in kind, not degree. Production has NO `estimates` table -- it never existed in any migration or in `drizzle/schema.ts` (only `alg_estimates` and `estimates_log` do). `processEstimateFollowUp` queried a phantom; the job had failed on every run since it was written, and its subject was already covered by `declinedWorkRecovery` on `alg_estimates`. Retired in the follow-up PR; 0114 now adds only `customers.lastEmailCampaignAt`. A raw-SQL table-existence canary (`server/__tests__/rawSqlTablesExist.test.ts`) now catches this class.

Detector: every raw-SQL `UPDATE <table> SET <column>` in `server/**` (6 found across
`estimates|bookings|customers|invoices|leads|work_orders|tire_orders`) checked against the
table's block in `schema.ts`. **Positive control:** `bookings.followUp24hSent` — present. ✅

| Column | Written by | In `schema.ts`? | In any migration? | Runtime DDL? |
|---|---|---|---|---|
| `estimates.followUpSent` | `workOrderAutomation.ts:290` (F-6), read `:261` | **no** | **no** | **no** |
| `customers.lastEmailCampaignAt` | raw SQL | **no** | **no** | **no** |

Either these columns were hand-applied outside the repo (AGENTS.md says migrations are
hand-applied, so this is plausible), or they do not exist and `estimate-followup` has been
failing quietly under F-9 every day. **Which one is true is NOT VERIFIED and is the first thing
to check.** Related: `routers/nick/intelligence.ts:484, 537-539, 755-756` run
`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN` from a tRPC procedure — a
migrations-from-a-router path (gated to `settings.manage`) that is the likely origin of drift.

### 🟠 F-18 · `nexus_audit_jobs`: an SMS-audit queue with a writer and no worker

`services/smsOrchestrator.ts:1692-1712` inserts a `status: "pending"`, `jobType: "sms_audit"`
row (with priority, payload, sample reason) whenever `nexusAuditSampler.shouldAuditMessage`
selects an outgoing AI SMS for audit. **Nothing reads the table** — not a cron, not a router,
not a bridge route, not `apps/worker`, not `apps/statenour` (grep, whole repo). A quality-control
sampling system decides which AI-written customer texts to audit, enqueues them, and no audit
ever runs. Every row is pending forever, and the table has no retention (§5.3).

### 🟡 F-19 · Tire-order status has no provenance, and "ordered" is a human claim

`tireOrders.status` enum includes `"ordered" // Tires ordered from Gateway Tire`
(`schema.ts:1541+`). **No code anywhere submits an order to a supplier** — no Gateway Tire order
API, no purchase order; `supplierOrderRef` is free text; `shopDriverMirror.ts:1677` *reads*
ShopDriver purchase orders (read-only by rule). The generic update mutation
(`gatewayTire.ts:1247-1263`) writes `status` directly with **no actor, no per-transition
timestamp, no history table**. `gateway-order-status-poll` (`scheduler.ts:969`) polls the local
table for staleness, not the supplier. So "ordered" means "someone with admin access set this,
at some point" — which is fine as a domain fact, but the admin renders it as a system state.

### 5.3 Retention: 27 of 146 tables have any deleter

`cleanup.ts` and scattered `DELETE`s cover 27 tables. Among the 119 that grow forever:
`sms_messages`, `customer_notifications` (including F-1's permanently-pending rows),
`nexus_audit_jobs` (F-18), `vapi_call_logs`, `sms_orchestrations`, `customer_status_messages`,
`lead_delivery_events`, `admin_proposals`, `alg_probe_log`, `analytics_snapshots`. On a
storage-priced cloud DB this is a cost curve; for F-1/F-6 it means the pending/burned rows are
also permanent.

### ✅ N-3 · `otp_codes` — a dead table with a live janitor

Never inserted, never read; the only touch is `cleanup.ts:34` deleting expired rows every 6 h.
Legacy of a pre-TOTP MFA design. Harmless; recorded so the miniature is not re-discovered.

---

## 6. The repo's own claims registries are decaying — measured

This audit was commissioned partly because prior audits produced confident filler. That is
measurable here, and the numbers are worth more than the anecdotes:

| Registry | Claim | Against `5c1195e6f` | Rate |
|---|---|---|---|
| `docs/audits/NICKSTIRE-ADMIN-CLEANUP-AUDIT.md` (2026-06-09, "55 fully wired") | 22 distinct `router.X.Y` evidence citations | **4 no longer resolve** (`loyalty.rules`, `vapi.settings`, `voiceAgent.callLogs`, `voiceAgent.transcripts`); 1 graded "fully wired" was reading a never-written table (F-4) | ~18–23 % in 12 weeks |
| `docs/operations/CRON-INVENTORY.md` ("update in the same commit") | 87 job rows | 37 jobs missing, 2 stale | ~69 % coverage |
| `client/src/lib/opsRegistry.ts` (9 claims, "every entry is a CLAIM") | `customer-confirmations: preview_only — "no send path, no cron, no provider call"` (lastVerified 2026-06-10) | **`sendCustomerMessage` sends** (`customerMessageTemplates.ts:216-217`, `messageClass: "customer_confirmation"`, idempotent by `variantKey`, audited), called from `gatewayTire.ts:858, 1284-1289`. Whether it fires in prod depends on a feature flag (`:160-176`) — and `truth_os.md:25` (rank-4 evidence) records `ENABLE_CUSTOMER_CONFIRMATIONS = true` for booking confirmations — but either way the stated *reason* is false. | 1 of 9 checked, wrong |
| `docs/REVENUE-AUTOMATION-STATE.md:22` | cross-sell `[VERIFIED] … ON in prod … AUDITED: CLEAN` | retired 2026-08-04 (N-2) | stale |
| `cron/index.ts` header (self-reported) | *"Uses setInterval"* | the file itself now says *"Both were false … The header outlived its mechanism"* | fixed in-place, worth quoting |

The pattern: a hand-maintained claim with no test is a cache with no invalidation. The one
registry in this repo that *cannot* drift is `ADMIN_REGISTRY` — because
`adminRegistryTruth.test.ts` fails when it lies. Every other registry above needs the same
canary or should stop claiming.

---

## 7. Things the brief named that do not exist in this product

The brief's candidate lists are anchors; per its own instruction, an absent anchor is a finding.
Checked by `git grep` across `client/src` + `server` (non-test):

| Brief named | In repo | Note |
|---|---|---|
| "cron/**Inngest**/queue" | **no Inngest** — not a dependency; the two hits are mentions of StateNour's | brief error |
| VIN decoding / NHTSA **vPIC** | **0 files** | no VIN decoding exists; `vin` columns sit on a dead table (F-16) |
| iCalendar / **RRULE** / `.ics` | 0 | scheduling is plain rows |
| e-signatures / authorization capture | 0 (`customerSignature|signedAt|esign`) | "approved" estimates carry no signature artefact |
| barcode / QR scanning | 0 | |
| passkeys / WebAuthn | 0 | MFA is TOTP (`AdminMfaGate`) |
| Workbox / `navigator.serviceWorker` in `client/src` | 0 | SW is hand-written `public/sw.js` (140 lines) |
| Next.js server actions, nested admin routes, modals-as-routes | N/A — Vite + Express + tRPC; one route (artifact 1 §1) | taxonomy mismatch |
| "cost-detail / margin" as a live metric | agent memory: ALG cost detail dead since 2026-04; post-April margins are fabrication | NOT re-verified here |

None of these absences is automatically a gap — several (RRULE, barcode, passkeys) may be
correct to leave out. They are listed so the later benchmark artifact cannot quietly assume them.

---

## 8. PWA / offline — the answer is "none, on purpose"

`client/public/manifest.json`: `display: standalone`, `scope: /`. `public/sw.js`
(`nicks-v3-network-first-shell`): **skips `/api/` entirely** (`:62`), network-first for
navigations (`:96`), cache-first for static assets (`:71`). The header records why: *"2026-08-01,
measured in prod: the admin rendered a BLANK PAGE. The SW served a…"* stale shell. The admin
therefore has **no offline capability**: with no network, nothing loads. For a shop with wifi
that may be the right trade; it should be stated as a decision rather than discovered. Admin JS
is code-split from the public site (`vite.config.ts:67-89`; a 1.7 MB single admin chunk was
fixed May 2026), and CWV telemetry lands at `/api/cwv` (`routes/analyticsRoutes.ts:141`).

---

## 9. Metrics — what already has a contract

`docs/METRICS-CONTRACT.md` is substantial and should be the starting point, not re-derived: it
defines voice/demand metrics with unit, source, inclusion/exclusion, dedupe key, freshness and
an **evidence tier** (observed / inferred / verified / modeled); rates with named denominators
(*"never use all calls as the denominator"*); revenue concepts split into verified-attributed /
modeled-pipeline / potential / **unmatched paid** / estimated-recovery; and GSC aggregates.

Not covered there (from its headings): ARO, car count, technician productivity / labour
utilisation, appointment show rate, inventory turns, comeback/warranty rate, and gross margin —
the last of which agent memory says cannot be computed honestly after 2026-04 because the ALG
cost feed died. §1 adds a new caveat to any "messages sent" metric: outbound counts over
`sms_messages` are inflated by F-8, and "sent" stamps across the outreach tables are claims.

---

## 10. Actions, ranked by (certainty × harm) ÷ effort

1. **Read three flags and one column in production, read-only:** `sms_review_requests` (F-1),
   `sms_retention_sequences` (F-6), the confirmations flag (`customerMessageTemplates.ts:160-176`),
   and `SHOW COLUMNS FROM estimates LIKE 'followUpSent'` (F-17). These four reads decide whether
   F-1/F-6 are consuming customers today and whether `estimate-followup` has ever worked.
2. **Measure F-1's and F-6's blast radius, read-only** (column names verified against
   `schema.ts`):
   ```sql
   -- bookings burned by the 24h follow-up with no text ever marked sent
   SELECT COUNT(*) FROM bookings b
   WHERE b.followUp24hSent = 1
     AND NOT EXISTS (SELECT 1 FROM customer_notifications n
                     WHERE n.bookingId = b.id AND n.notificationType = 'follow_up' AND n.status = 'sent');
   -- same for the 7-day review request
   SELECT COUNT(*) FROM bookings b
   WHERE b.followUp7dSent = 1
     AND NOT EXISTS (SELECT 1 FROM customer_notifications n
                     WHERE n.bookingId = b.id AND n.notificationType = 'review_request' AND n.status = 'sent');
   -- pending follow-up rows that can never drain (booking already claimed)
   SELECT COUNT(*) FROM customer_notifications n JOIN bookings b ON b.id = n.bookingId
   WHERE n.status = 'pending' AND n.notificationType IN ('follow_up','review_request')
     AND (b.followUp24hSent = 1 OR b.followUp7dSent = 1);
   -- F-6 (only if the column exists): estimates burned without a text.
   -- sms_messages carries NO phone column; the phone is on sms_conversations (schema.ts,
   -- smsMessages block: conversationId/direction/twilioSid/status only).
   SELECT COUNT(*) FROM estimates e WHERE e.followUpSent = 1
     AND NOT EXISTS (SELECT 1 FROM sms_messages m
                     JOIN sms_conversations c ON c.id = m.conversationId
                     WHERE m.direction = 'outbound' AND m.status IN ('sent','delivered')
                       AND RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]',''),10) = RIGHT(REGEXP_REPLACE(e.customerPhone,'[^0-9]',''),10)
                       AND m.createdAt >= e.createdAt);
   ```
   (Column names above were verified against `drizzle/schema.ts` at `5c1195e6f`; the
   `estimates.followUpSent` column itself is the F-17 drift case and may not exist.)
3. **F-6 + F-1 fix, one shape, three sites** (`follow-ups.ts`, `workOrderAutomation.ts:277-291`,
   drip enrollment): count only on `success && !queued`; split attempted/sent per
   `unpaidInvoiceRecovery.ts`; replace `LIMIT 10` on a sliding band with `attemptedAt IS NULL`.
4. **F-7: give the operator's reply an explicit class.** One line at `smsConversations.ts:105`
   (`messageClass: "customer_confirmation"` bypasses quiet hours today) — after counsel confirms
   that a human reply to an inbound question may bypass STOP/quiet-hours. Until then the default
   should at least be a *chosen* default.
5. **F-8: pass `skipPersist: true` from the operator router** (or drop `addSmsMessage` there) and
   add the missing single-row test. Then re-baseline any outbound-count metric.
6. **F-11: fail closed.** `security ?? MFA_NOT_REQUIRED_STATE` → throw `UNAUTHORIZED` on
   unreadable state, mirroring the pause flag's own doctrine.
7. **F-12: pin `gatewaytire.refundorder` to `money.manage`** in the resolver (one line, plus a
   canary in `adminPermissionCoverage.test.ts`). Then decide F-13 deliberately.
8. **F-18: either build the nexus audit worker or stop enqueuing.** A sampler that never audits
   is worse than none — it produces the feeling of QA.
9. **F-16: pick one vehicle table.** `customer_vehicles` is live; drop `vehicles` and retype
   `work_orders.vehicle_id` — after a row count on `vehicles` (expected 0; NOT VERIFIED).
10. **§6: put canaries on the claims registries or delete them.** `CRON-INVENTORY.md` can be
    generated from `getJobCadences()`; `opsRegistry` entries should cite a test.

---

## 11. Not investigated — stated, not hidden

| Area | Status | What it would take |
|---|---|---|
| Live UI of anything | NOT VERIFIED | a rendered session; the sandboxed preview hits the Google OAuth wall (agent memory) — use real Chrome |
| Runtime flag values, row counts, cron_log contents | NOT VERIFIED | read-only prod queries (§10.1–2) |
| Per-site hand review of the 12 "triage only" callers in §1.3(ii) | partial | ~1 h of reading |
| The 65 LLM call sites (`invokeLLM` chokepoint at `_core/llm.ts:421`; `contentManufacturing.ts` has 7) | **sized, not audited** | artifact 3 — prompt, retrieval, tool access, abstention per site |
| Meta/IG publish integrity beyond the reconciler | not audited | it is the codebase's best-practice reference (§1.1), so lowest priority |
| Bridge route-by-route (19 + 7) | not audited | read each handler's write scope |
| Remaining 8 inner-tab zeros from artifact 1's mechanical pass | closed for Instagram (10 views: today create publish community insights planning patterns actions control settings), Leads (kanban/list), Overview (7 composed panels); **Memberships, Voice, Intelligence, CallTracking, TrafficFunnel not hand-read** | one read each |
| Benchmarking, OSS landscape, visual system, IA redesign | **deliberately absent** | artifact 3+, kept separate from verified fact by design |

---

## 12. Carried into artifact 3

1. The four production reads in §10.1 — everything about F-1/F-6 severity hinges on them.
2. Whether a `tech`-role user exists (F-12) and how many non-owner admins there are (F-11).
3. The 12 triage-only `sendSms` callers.
4. The AI layer: 65 call sites, one chokepoint, three autonomy systems (§3) — the brief's
   "AI as operational agent" section, done honestly, is the natural next artifact.
5. The benchmark and OSS sections — now that the real shape is known (one route, a query-string
   registry, three vehicle identities, a three-ledger audit, no offline, no supplier API), the
   competitor list can be used for what the brief intended: checking what was *missed*, not
   confirming what was *named*.
