# Nick's Tire Admin — repository archaeology, the loops (helps / reports / fails to close), the StateNour boundary contract, and the money that renders as $0

**2026-09-01 · Artifact 4 of the audit.** Folds in the parts of the earlier brief that were
sharper than the one I executed against. Same ref (`origin/main` @ `5c1195e6f`), same limits
(no runtime, no live UI, no DB rows), same rule: a claim carries a file and line or says NOT
VERIFIED. Companion artifacts:
[1 wiring](./ADMIN-WIRING-AUDIT-2026-09-01.md) ·
[2 automation/security/data](./ADMIN-AUTOMATION-SECURITY-DATA-AUDIT-2026-09-01.md) ·
[3 AI/IA/thesis](./ADMIN-OPERATING-SYSTEM-THESIS-2026-09-01.md).

Items from the earlier brief that **do not apply to this product** are said so in one line and
not padded (§8 scheduling, §9 reviews, part of §2.7 inventory).

---

## 0. Corrections logged while doing this (continuing the ledger at #12)

| # | Claim I nearly shipped | What refuted it |
|---|---|---|
| 12 | "All five named StateNour routes (`/market`, `/photo-improver`, `/content`, `/links`, `/business`) no longer exist" | I had grepped `apps/statenour/src/app`; the Next.js app lives at `apps/statenour/app/(mastery)/`. All five exist as `page.tsx` (§4). |
| 13 | "`voiceAgent.ts:236` writes `source: "voice"` into `bookings`, whose enum has no such value — TiDB STRICT silently drops every voice booking" | The write targets `expected_arrivals` (`voiceAgent.ts:228-237`), whose enum includes `'voice'` (`drizzle/0094_expected_arrivals.sql:20`). No loss. The stale thing is the `bookSlot` docblock (`:183-184`), which still describes a bookings write tagged `"voice-agent"` that nothing performs. |
| 14 | Artifact 3 §6: "technician productivity — **no technician assignment model** — do not define" | `technicians` (6 Drizzle writers / 9 readers), `job_assignments` (5 / 6), and `work_orders.assignedTech / assignedTechId / assignedBay` all exist. `bays` is never inserted (§1.4), so the *bay* model is dead-on-arrival — but "does not exist" was wrong. **Corrected again (#17, 2026-09-02):** this row first said the columns are "never written"; `assignedTech`/`assignedBay` ARE written by the Work Orders quick-input (`WorkOrdersSection.tsx` → `workOrders.updateFields`) and `assignedTechId` by `dispatch.assign` (`services/dispatch.ts:209`). Technician assignment is live; only bays are not. Artifact 3 is corrected in place. |

Running total: **14 corrections on ~45 candidate findings.** Base rates stay as stated in
artifact 3 §12.

---

### Corrections #16–#17 (2026-09-02, hostile self-review of PR #2063)

- **#16 — the revenue push receiver.** §3.1 and §7 M-1 named `POST /api/sync/nour-os` → `case "financial"` → `financialSnapshot.upsert` as the receiver. The job posts to **`/api/sync/business`** (`statenourSync.ts:400`); that route builds CEO context from the payload and stores it in an `AuditEvent`; the Command Surface reads it through `app/api/command/data/route.ts:172-176` with `revenue.todayEstimate ?? … ?? 0`. The nour-os financial case is a separate personal-agent channel. Consequence: the nickstire-side `available:false` fix is necessary but not sufficient — the StateNour consumer must honour it (cross-app follow-up; StateNour already has a reader that tracks `hasToday`, `lib/nickstire/revenue.ts:48-82`, which the consumer does not use).
- **#17 — "never written" was wrong for two of three columns.** `work_orders.assignedTech`/`assignedBay` are written by the Work Orders quick-input and `assignedTechId` by `dispatch.assign`. Only `bays` has no insert. Technician assignment and the Team Performance panel are live; artifact 3 §6's "do not define technician productivity" rested on this row and is withdrawn.

## 1. Repository archaeology — why the current system looks like this

### 1.1 History starts on 2026-05-17; everything older is invisible

`git log` for any nickstire path begins at `859cffb7c` / `03f8e36bf` (2026-05-17, *"CP2 ·
monorepo skeleton · move nickstire into apps/nickstire/"*, 1,294 files). The original
repository's history was not imported. Consequence for the orphan tables in artifacts 1–2:
`vehicles`, `payments`, `kpi_snapshots`, `otp_codes`, `customer_status_messages`,
`customer_vehicles` and `work_orders.vehicle_id varchar(36)` are all born in that one commit.
**They were already dead when this repo began.** Their intent is unrecoverable here; only two
orphans have a traceable birth (below).

### 1.2 No file ever moved between the two apps

`git log --diff-filter=R -M50%` across `apps/statenour` ↔ `apps/nickstire` shows **zero
cross-app renames**. Every "migration out of StateNour" was a re-implementation, not a move.
That matters for §4: there is nothing to "finish moving"; there are two independently written
surfaces per concept, and the StateNour side describes itself as a projection
(`app/(mastery)/market/page.tsx:6`, *"Two former pages, both nickstire-bridge projections,
collapsed into one"*).

### 1.3 The half-finished subsystems, with their commit trail

| Subsystem | Born | What happened | Today |
|---|---|---|---|
| **Nexus SMS audit** (F-18) | `9d0da014c` 2026-07-09 *"SignalForge Nexus Production Wiring for NickGPT QA"* — added **both** `nexusAuditSampler.ts` and a consumer, `nexusAuditor.ts`; `06976cb50` same day *"finalize nexus auditor integration"* | The auditor was **never registered in any cron** (`git log -S nexusAuditor -- server/cron`: nothing). On 2026-08-04, `5bbfaf2b7` (#1329, *"the machine knew — eleven places the screen threw the answer away"*) deleted `nexusAuditor.ts` (204 lines) with twelve other services, with this body text: *"This repo has a documented last-mile problem: work gets built, tested and never wired, and the unfinished thing is indistinguishable…"* | The **producer was left running**: `smsOrchestrator.ts:1692-1712` still enqueues, `nexus_audit_jobs` still grows, nothing reads it. A half-purge. **Recommendation sharpens:** delete the sampler, the enqueue and the table; the operator already decided the auditor was not real. |
| **Manual testimonials** (F-5) | `8a7cdde24` 2026-06-22 *"social-studio: DB-backed memory layer and review grounding"* | Shipped with two readers and a `CREATE TABLE IF NOT EXISTS`; the entry surface was never built | reader with no writer since birth |
| **Bay / technician dispatch** | pre-history (CP2) | `bays` table (`schema.ts:2880`); `services/dispatch.ts` claims/releases bays (`:189, :269` — **update only**); no `INSERT` into `bays` anywhere, no seed, no migration seed; `work_orders.assignedBay / assignedTech / assignedTechId` (`schema.ts:2129-2131`) — `assignedTech`/`assignedBay` written by the Work Orders quick-input (free text), `assignedTechId` by `dispatch.assign`; this row first said "never written" (correction #17) | still mounted: Money → *Shop Status* renders `DispatchSection` (`RevenueSection.tsx:102`) showing `freeBays = load?.bays.filter(...).length \|\| 0` (`DispatchSection.tsx:112`) — i.e. **0 bays, 0 techs, forever**, on the Money page. `docs/CURRENT-TRUTH.md` says *"there is no calendar/slot/bay model anywhere, on purpose."* The document is right about the business; the code kept the model. This is the earlier brief's "old assumptions still contaminate the architecture," in one tab. |
| **`bookSlot` → expected arrivals** | wave 0094 | the VAPI tool was re-pointed from `bookings` to `expected_arrivals` | its docblock (`voiceAgent.ts:183-184`) still promises `source: "voice-agent"` on bookings — a value no enum accepts and no code writes |
| **Rollback pages** | — | `HomeLegacy.tsx` (*"kept as rollback"*, `Home.tsx:10`), `TireFinderLegacy.tsx` | unrouted (`App.tsx`: no route); dead by design |
| **Old SMS engine** | — | `RolloutMode "legacy_passthrough"` — *"same privilege as live_send, different engine"*, capped at level 3 (`smsAutonomy.ts:60-78`) | a second live-send engine kept reachable by policy |

### 1.4 The instruments the repo built to see its own rot — and their limits

- `config/knip-orphan-baseline.json` holds **1,007** accepted orphan symbols; CI fails only on
  *new* orphans (#2026/#2027). The baseline is the size of "built, never wired" that the repo
  has agreed to live with. (Denominator — total exports — was not measured; treat 1,007 as a
  count, not a rate.)
- `DEAD-PROCEDURE-HARVEST-2026-08-30.md`: 77 of 703 procedures served in 13 h.
- `cron-rethrow.test.ts`, `adminRegistryTruth.test.ts`, `adminPermissionCoverage.test.ts`,
  six honesty canaries (artifact 2 §5.3 and §7 below): each converts one past defect into a
  gate. None of them covers a *table* with a writer and no reader, which is why F-16/F-18
  survived.

**Do not preserve any of §1.3 for sunk cost.** The repo's own #1329 already established the
precedent and the wording.

---

## 2. The business loops — where the admin *helps*, where it *reports*, where it *fails to close*

For each loop: the record that proves closure, and the verdict at each stage. "Helps" = the
admin changes what the operator does next; "reports" = shows a number/list only; "fails" = the
loop has a step with no record, no consumer, or a receipt written from intent.

### 2.1 Lead → contact → arrival → work order → invoice → paid

| Stage | Helps | Reports | Fails to close | Evidence |
|---|---|---|---|---|
| Lead captured (popup/chat/callback/booking/sms/diagnose) | Today queue + Sales Pipeline kanban; SSE toast; at-most-once creation | — | — | `leads.source` enum (`schema.ts`, 10 values, widened by migrations 0006/0026/0082); `Admin.tsx` SSE handlers |
| Contacted | `markContacted` (bridge + UI) writes a receipt | — | — | `bridge-routes.ts:585`; `leads/MarkContactedButton.tsx` |
| Arrival | **Arrival Load** strip: expected arrivals (voice/SMS-captured) + tomorrow's preferred-date bookings | — | arrival itself is inferred: *"Arrival from a walk-in direction… not measurable unless a later operational record is linked"* | CURRENT-TRUTH "Authoritative surfaces"; `expected_arrivals` (`0094`) |
| Work order | create/advance; auto-advance to invoiced; auto-close stale | — | `vehicle_id` dangles (F-16); assigned tech/bay never written (§1.3) | `workOrderAutomation.ts`; `schema.ts:2125-2131` |
| Invoice / paid | Stripe checkout + webhook marks paid; ShopDriver mirror for POS invoices; `invoice-cross-reconciliation` daily | — | `invoices.paymentStatus` unreliable for POS rows (agent memory 2026-08-28) | `_core/index.ts:856-1019`; `scheduler.ts` *invoice-cross-reconciliation* |
| **Verdict** | **helps** through paid | | one inferred step (arrival), one dangling FK | |

### 2.2 Estimate → follow-up → conversion (declined-work recovery)

| Stage | Verdict | Evidence |
|---|---|---|
| Estimate created | helps (AI estimator, phone quote, manual) | `estimates.source` enum |
| Declined-work recovery (SMS sequence) | **helps**, honestly — checks `queued`, fail-closed cooldown, honest copy | `declinedWorkRecovery.ts:577`; agent memory "AUDITED 2026-07-28: CLEAN" |
| Generic estimate follow-up (2–3 days) | **fails** — burns up to 10/day whether or not a text goes out, on a column no migration created | F-6 / F-17 |
| Recovered → invoice | reports (`declinedLedgerHonesty.test.ts` guards the ledger) | `money/DeclinedEstimatesSection.tsx` renders `unknown ? "—"` (§7 positive control) |
| **Verdict** | **helps, with one broken lane (F-6) running beside the good one** | |

### 2.3 Inbound SMS → reply → outcome

Helps at every stage that exists (artifact 3 §1.3: deterministic router → plan → draft →
`planViolations` → human gates → rollout modes). **Fails to close** at two points: the
QA audit that never runs (F-18), and the operator's own reply misreporting itself after 8 PM
(F-7) while writing two rows (F-8). *Reports* only: `SmsPerformanceSection` reply-rate and A/B
tiles (`aac62eb42`, 2026-05-18).

### 2.4 Inbound call → record → outcome

**Helps and closes.** The busiest procedure surface (12 of 77 served, harvest). VAPI end-of-call
ingestion, tool receipts (`bookSlot`/`scheduleDropoff` → `expected_arrivals`), and
`agenticAuditor` explicitly hunts *"missing_arrival_record · scheduleDropoff/bookSlot fired but
no…"* (`agenticAuditor.ts:22`) — the loop verifies its own phantoms. Metric contracts exist
(`METRICS-CONTRACT.md`). Fails only where the contract says it cannot measure (transfer
connection without a human-answer signal).

### 2.5 Review request → review → reply

| Stage | Verdict | Evidence |
|---|---|---|
| Request (7-day) | helps — unconditional solicitation, at-most-once, `sms_review_requests` flag | `postInvoiceFollowUp.ts:54-73`; `reviewRequests.ts:284-333` |
| Detect new review | **reports, partially** — `reviewMonitor` uses the Places API (≤ 5 "most relevant" reviews, `reviewMonitor.ts:16-66`); the GBP pipeline exists but its API quota was 0 on 2026-07-29 (agent memory; NOT re-verified) | |
| Reply | helps — drafts for negatives, QA'd (`review-reply-qa`), operator-gated publish | `crudAutomation.ts:390-451` |
| Learn | reports — sentiment breakdown feeds intelligence | `engines/growth.ts:84-87` |
| **Verdict** | **helps on both ends; the middle (complete detection) depends on a quota Google has not granted** | see §9 for the policy check |

### 2.6 Ad / content → lead source → attribution → appointment → revenue → CAC / ROAS / retention *(earlier brief's loop)*

| Stage | Verdict | Evidence |
|---|---|---|
| Content published (IG/GBP/site) | helps — the largest subsystem in the admin | artifact 3 §3 |
| Lead source captured | helps, but **voice is not a `leads.source` value** — call-originated demand is attributed through `vapi_call_logs.leadId` instead (by contract) | enum list; `METRICS-CONTRACT.md` "Leads created" |
| UTM / click | reports — `lib/utm.ts`, GA4, `customer_events` | `client/src/lib/utm.ts`, `ga4.ts` |
| Lead → invoice attribution | helps — a real reconciliation subsystem: `leadRevenueSummary`, `callInvoiceReview`, `reconciliationRuns`, `reviewQueue`, `reconcile`, `resolve`, `journey`, `legacyBackfill` | `routers/revenueAttribution.ts` |
| **Operator ruling on weak matches** | **fails to close** — `revenueAttribution.resolve` exists (`:207` → `resolveAttributionDecision`, the only writer of `revenue_attribution_decisions`, `revenueReconciliation.ts:210`) and **no surface calls it**: not the admin client, not either bridge, not StateNour. `reviewQueue` likewise has no consumer. CURRENT-TRUTH lists *"Resolving weak invoice or customer matches"* as a manual operator system; the machinery has no door. (Only `leadRevenueSummary` and `callInvoiceReview` are rendered.) | grep, all four trees |
| **Ad spend → CAC / ROAS** | **fails to close, by absence** — no ad-spend ingestion exists. `engines/marketing.ts:42`: `const costPerLead = 0; // No ad spend data in DB — placeholder`. `metaAdsArchitect.ts` reads no Meta Insights (`act_`/`insights`: 0 hits). | see §7 for what that placeholder renders as |
| Retention | reports — segments, LTV engines, retention sequences send (with the queued caveat) | `retentionSequences.ts`; `customerSegmentation` |
| **Verdict** | **the loop is built up to the human step and stops there; CAC/ROAS cannot be computed and one panel pretends otherwise** | |

### 2.7 Inventory procurement → receiving → availability → allocation → sale → replenishment *(earlier brief's loop)*

**This loop does not exist, and should not be assumed.** Evidence: an `inventory` table exists
(`schema.ts`) with **0 Drizzle readers/writers** and 2 raw-SQL touches, one of which is the
low-stock cron that carries its own *"No inventory table"* fallback (`crudAutomation.ts:266-267`);
no `INSERT` into it anywhere. `inventoryDemandForecast` forecasts from *unresolved
`alg_estimates`* ("estimates that never resolved"), not stock. `gateway-price-refresh` maintains
a wholesale **price** cache (`scheduler.ts:2194-2200`). Nine hits for receiving/on-hand/reorder
vocabulary, all in the dead low-stock check. Tires are ordered per job by a human (F-19).
**Verdict: no procurement, receiving, allocation or replenishment step exists; the only real
signals are price and unmet demand.** Recommending an inventory system here would be the
category error the audit exists to prevent — unless the operator says the shop stocks tires.

### 2.8 Tire order → confirm → ordered → in transit → delivered → scheduled → installed

Helps (customer confirmations via `sendCustomerMessage`, idempotent, audited — `customerMessageTemplates.ts:216-217`; `gateway-order-status-poll` flags stale rows). Reports (9-status filter). **Fails** at provenance: status changes carry no actor/time/history, and "ordered" is a human claim (F-19).

### 2.9 Membership (Nonstop Nick)

**Helps and closes.** Stripe `checkout.session.completed` + `customer.subscription.{created,updated,deleted}` → `update(memberships)` (`_core/index.ts:995-1019`). Two admin procedures, 9 KB of UI — a customer attribute wearing a section (artifact 3 §3 verdict stands).

### 2.10 Instagram content → publish → engagement → learn

**Helps and closes**, with the best mechanisms in the codebase: read-back reconciliation,
`ambiguous` publish state, cadence governor, kill switches that reach the autoposter,
REELS-first performance feedback into briefs, anti-repetition memory (all in CURRENT-TRUTH's
"Automated systems"). Fails only at the human gate the label promises (artifact 3 §1.2).

---

## 3. The Owner Escalation contract — what crosses today, and what should

### 3.1 What actually crosses the boundary now (verified)

| Direction | Mechanism | What | Where it lands in StateNour |
|---|---|---|---|
| nickstire → StateNour, every 15 min | `statenour-live-sync` (`scheduler.ts:997`) → `POST {STATENOUR_SYNC_URL}/api/sync/business` (`statenourSync.ts:400`; this row first said `nour-os` — correction #16) | revenue today/yesterday/week/month, jobs, avg ticket, `pacing: on_track \| behind` (`:182-184`), pipeline, projections, bridge health | `app/api/sync/business/route.ts:62-80` → `buildCeoContextFromNickSyncPayload` → stored verbatim in an `AuditEvent` payload; read back by `app/api/command/data/route.ts:172-176` as `revenue.todayEstimate ?? … ?? 0` (the `nour-os` `case "financial"` → `financialSnapshot.upsert` this row first named is a different, personal-agent channel — correction #16); `case "brain_dump"` → `brainDump.create`; `case "decisions"` → `masteryDecision.create`; `case "patterns"`; `case "open_loop"` → **`createTask` into the Inbox mission** (`:175-204`) |
| nickstire → StateNour | `memory-sync-to-statenour` (`scheduler.ts:1262`) → `syncMemoriesToStatenour` (`nickMemory.ts:468-476`) | up to 10 memories as free text `"[type] content"` | `brainMemory.upsert` (`route.ts:48`) |
| StateNour → nickstire, pull | `pull-from-statenour-brain` fetches `/api/sync/nour-os` | brain data into nick intelligence | — |
| StateNour → nickstire, live read | `app/api/nickstire/query/route.ts` (owner session, server-only `STATENOUR_SYNC_KEY`) → nickstire `routes/nour-os-query.ts` | revenue ranges, **leads with `name, phone`** (`nour-os-query.ts:320, 348`), bookings with `name, phone, vehicle` (`:365`), callbacks | rendered, not stored (read-through) — the right pattern |
| Custom GPT → nickstire | `bridge-routes.ts` (19 routes, flat key) | reads incl. `customer-lookup` PII; writes incl. `sms-campaign` (F-20) | — |

Two of these already violate the contract the earlier brief asks for:

- **A shadow financial ledger.** Revenue figures computed with `Number(month.rev \|\| 0)`
  (`statenourSync.ts:175-179`), falling back on a query failure to an intelligence cache and
  then to `?? 0` (`:190-194`), are stored verbatim in an `AuditEvent` payload on the other side (`/api/sync/business`, not the `nour-os` financial case first named here — correction #16) and read back by the Command Surface's `command/data` route with `?? 0`. The
  v2 payload has no "revenue unknown" marker (its keys are listed at `:68-90`; the only health
  fields are bridge-transport counters). StateNour therefore holds a persisted, second copy of
  shop revenue that can read **$0 and "behind"** when the truth was "could not read." See §7.
- **Free-text memories with unknown PII content** land in `brainMemory` — agent memory records
  a daily per-customer preferences recompute upserting into that table (2026-08-30, #2032).
  Whether customer names/phones are inside the text is **NOT VERIFIED** and is not knowable
  from schema alone.

The read-through proxy is the model to keep: StateNour panels ask nickstire live, under the
owner's session, and store nothing.

### 3.2 The object (recommendation — no such type exists today; `open_loop` is the carrier)

StateNour's receiver already turns an `open_loop` event into a **Task in the Inbox mission**
(`route.ts:175-204`: title, description, priority, `source`, `domain`). That is the right
shape — an obligation, not a record. The escalation object is that event with the missing
fields made mandatory:

| Field | Meaning | Source in nickstire |
|---|---|---|
| `trigger` | the rule that fired (e.g. `refund_over_threshold`, `campaign_over_50`, `review_negative_unanswered_48h`, `weak_attribution_match`) | the emitting job/procedure name |
| `source` | `nickstire` + the entity: `{type: "invoice", id}` / `{type: "proposal", id}` / `{type: "attribution_decision", id}` | primary key, **never the row** |
| `summary` | one sentence, no PII beyond what the decision needs | composed at emit time |
| `decision_requested` | the exact choice: `approve \| reject \| defer`, or a named option set | — |
| `consequence` | what happens on each choice, and what happens on **no** choice by the deadline | — |
| `deadline` | absolute time, shop TZ | — |
| `evidence_links` | deep links back: `/admin?tab=<section>&…` (the registry's ids/aliases are stable — `resolveSection`, `COMPOUND_REDIRECTS`) | registry |
| `authorization_needed` | the tier from `autonomous-action-tiers.md` and the role that may decide | §6 |
| `resolution` | written by StateNour on decision: choice + actor + time | — |
| `write_back` | the nickstire mutation that consumes the resolution (`proposals.approveAndExecute`, `revenueAttribution.resolve`, …) — **the decision is not done until the write-back receipt exists** | existing procedures |
| `audit` | both sides log the same `escalation_id` | `auditTrail.logAdminAction` (29 sites) on the nickstire side |

**Rules that follow from the object:**

1. **Operational records stay in nickstire.** StateNour stores the obligation and links. The
   `financialSnapshot` upsert and any per-customer memory content should be retired in favour
   of the read-through proxy, or reduced to *decisions about* money rather than money.
2. **An escalation without a `write_back` target is a notification, not an escalation.** Today's
   `notifyOwner` (`_core/notification.ts:56-67`) is email to `CEO_EMAIL` — logged and skipped
   when unset, and `truth_os.md` does not record that variable as set (NOT VERIFIED) — and
   `sendTelegram` is the channel that demonstrably works (weekly digest). Neither carries a
   decision or a write-back. `runFollowUps` "reports" to `notifyOwner` (`follow-ups.ts:159`).
3. **UNKNOWN crosses as UNKNOWN.** The payload gets a per-slice `available: boolean` (the
   admin's own `slices` shape, `adminBundle.ts`) before StateNour is allowed to persist any of
   it.
4. **The first three escalations to wire are the three human steps that have no door today:**
   the attribution ruling (§2.6), the blocked-publish proposal (`socialPublish.ts:132,151` —
   the only publish path that *does* create a proposal), and F-20's live campaign.

---

## 4. The named migration candidates — verified, not copied

All five exist under `apps/statenour/app/(mastery)/` (correction #12). Per §1.2, none was ever
*moved*; each was written on the StateNour side. Verdicts on the workflow, not the UI:

| StateNour route | Size / self-description | nickstire has | Verdict |
|---|---|---|---|
| `/market` | 37 lines — *"Two former pages, both nickstire-bridge projections, collapsed into one"* | `intelligence/MarketIntelligence.tsx`, `competitorMonitor` (3 files) | **Delete the StateNour shell.** It projects nickstire data nickstire already renders. Nothing to move. |
| `/content` | 53 lines — *"Four former pages merged into one tabbed surface (redirects, not deletes…"* | `ContentSection` + `contentAdmin` + `contentManufacturing` (the "Website & Local" section) | **Delete the shell**; keep any StateNour-personal content tooling that is not shop content (NOT INVESTIGATED which tabs are which). |
| `/business` | 28 lines | `businessFacts` / `business-data.json` (2 files); nav link already dropped by #2048 | **Delete.** The shop portion is in nickstire; the nav to it is already gone. |
| `/photo-improver` | 397 lines, own data — *"Tire branded variant. Closes the loop between 'phone photo' and…"* | `photo-assess-pipeline` / `imageConditioning` (customer **damage-photo triage**, MMS-driven) | **Different job, not a duplicate.** StateNour's is an operator tool that improves a phone photo for publishing; nickstire's triages a customer's photo. If the shop's social pipeline needs photo improvement, rebuild it inside the reel/carousel lane (`carouselSlideRenderer`, `sharp` installed) — do not copy a Next.js page into a Vite app. |
| `/links` | 323 lines, no nickstire references | `shareCards` (public-token vehicle health summaries), `lib/utm.ts`, GA4 | **NOT INVESTIGATED — verify its job first.** No evidence it is shop link-tracking; likely personal. Rebuild only if a campaign → creative → publish → response chain needs short links with click receipts, and then as a nickstire table, not a StateNour page. |

**Rebuild rule (opinion):** the chain *campaign → creative → publish → response/lead →
appointment → sale → gross profit* is already ~70 % present in nickstire (IG lane through
`revenueAttribution`); the missing links are §2.6's human ruling door and ad spend. Gross
profit stays out until the cost feed is alive again (agent memory: ALG cost detail dead since
2026-04).

---

## 5. Integration classification — one taxonomy, every external system

`docs/integrations/INTEGRATION_REGISTRY.md` (14 rows) supplies purpose / secrets / flag / owner
/ fallback / risk. It lacks the one column that resolves reconciliation arguments. Added here
from code evidence:

| System | Class | Contract evidence | Note |
|---|---|---|---|
| **ShopDriver / ALG** (POS) | **SOURCE OF TRUTH** for POS invoices & customers; nickstire holds a **MIRROR** | `shopdriver.ts:581-700` syncs by `invoiceNumber`, updates existing rows; `invoices.source = "shopdriver"` (`schema.ts`, enum `shopdriver \| manual \| stripe`); read-only by rule (agent memory) | The `invoices` table is **partitioned by `source`**: `shopdriver` rows are a mirror, `manual`/`stripe` rows (tire orders, memberships, Snap) are canonical here. `invoice-cross-reconciliation` runs daily. Never treat the mirror as writable. |
| **Stripe** | SOURCE OF TRUTH for payment events; DELIVERY CHANNEL for checkout | `constructEvent` webhook; `payments.ts` | membership status follows Stripe (§2.9) |
| **Snap Finance** | SOURCE OF TRUTH for its own applications; writes `invoices` (`snapFinanceSync.ts:59`) | HMAC webhook | second external invoice writer — reconcile by `source` |
| **Shop SMS gateway** (`sms-gate.app`, F25e) | DELIVERY CHANNEL, with delivery receipts | `smsGateway.ts:423-478` | one physical phone = business-continuity fact |
| **Twilio** | DELIVERY CHANNEL (fallback, code says dead) | `sms.ts` fallback branch | registry row says "bulk/marketing campaigns"; `campaigns.ts:500` sends `via: "shop"` — **row stale** |
| **VAPI** | SOURCE OF TRUTH for call facts; DERIVED INPUT for leads/arrivals | `vapi_call_logs` UNIQUE `vapiCallId`; `expected_arrivals.source='voice'` | metric contract exists |
| **Meta Graph (IG/FB)** | DELIVERY CHANNEL for publish; SOURCE OF TRUTH for post/engagement facts (read back) | `publishReconciler`, `ig_metric_snapshots` | the read-back is what makes it trustworthy |
| **Meta webhooks** | DERIVED INPUT (comment events) | signed | |
| **Meta CAPI** | DELIVERY CHANNEL (attribution events out) | `meta-capi.ts` | |
| **Google OAuth** | SECURITY/IDENTITY | | |
| **Google Places** | OPTIONAL ENRICHMENT (≤ 5 reviews sample) | `reviewMonitor.ts` | not a review source of truth |
| **GBP** | SOURCE OF TRUTH for profile/reviews **when quota > 0**; today OPTIONAL | quota 0 (memory) | |
| **GSC** | SOURCE OF TRUTH for search facts | `METRICS-CONTRACT.md` GSC section | |
| **GA4** | DERIVED INPUT (post-click) | `analytics.ts` | UPSTREAMS: partial-incumbent |
| **Gateway Tire B2B** | DERIVED INPUT (wholesale price cache) | `gateway-price-refresh` | **not** an order channel (F-19) |
| **Higgsfield / Veo / Ollama / Gemini / OpenAI / Anthropic / ElevenLabs / XTTS / Replicate** | DERIVED INPUT (generation) | `_core/llm.ts`, reel services | no per-call ledger (F-21) |
| **S3 / catbox fallback** | DELIVERY CHANNEL (media hosting) | `STORAGE_CATBOX_FALLBACK_ENABLED` | a public-paste fallback for media is a policy question, NOT INVESTIGATED |
| **Resend** | DELIVERY CHANNEL (email) | | |
| **Telegram** | DELIVERY CHANNEL (owner alerts) | `sendTelegram` | the working owner channel |
| **StateNour** | MIRROR today (`financialSnapshot`, `brainMemory`) — **should be** obligation-only (§3) | `route.ts:48, 122` | |
| **Custom GPT bridge** | agent client, flat key | `bridge-routes.ts` | F-20 |
| **Sentry / Redis / web-push** | infrastructure | env census | |

The registry's own update rule ("same PR") applies; add the column there rather than here.

---

## 6. Agent side-effect classes — the earlier brief's eight vs the repo's five tiers

The repo already has a taxonomy: `docs/eval-rubrics/autonomous-action-tiers.md` — Tier 0
(never auto-execute), Tier 1 (auto with pre-action audit), Tier 2 (auto + post notification),
and up. It is **more concrete** than the brief's eight classes because it names actions, not
categories: Tier 0 lists *"Sending email or SMS campaigns to >50 recipients in one batch"*,
*"Issuing refunds"*, *"Schema migrations to prod"*, *"Deleting customer records"*, *"Voice-agent
commitments to a specific time slot without simultaneous `bookSlot` tool fire"*.

Tested against reality:

| Brief class | Repo tier | Instance | Verdict |
|---|---|---|---|
| READ | (unlisted) | bridge GETs incl. `customer-lookup` PII | fine; PII reads under one flat key deserve a tier line |
| SUGGEST / DRAFT | Tier 1–2 | proposals; `draft_only` rollout mode | matches |
| MUTATE INTERNAL | Tier 1 | `mark-contacted`, `quick-note`, expected arrivals | matches |
| COMMUNICATE EXTERNALLY | Tier 1 (single) / **Tier 0 (>50)** | `sms-campaign` bridge route, `limit` max **500**, no human (F-20) | **violates Tier 0 as written** |
| FINANCIAL / COMMERCIAL | Tier 0 | `refundOrder` by `tech` (F-12) | tier says human-in-loop; does not say *which* human — add the role |
| SECURITY / IDENTITY | Tier 0 | `setRole` behind `security.manage` | matches |
| DESTRUCTIVE / BULK | Tier 0 | `dbCleanupPrune` (candidate-validated), `handleRunMigrations` (settings.manage) | matches; the AI bridge cannot reach either ✅ |

**Recommendation (opinion):** keep the repo's tiers as the authority, add the brief's eight
classes as an orthogonal `side_effect` label on each tier line (it makes the F-20 mismatch
mechanical), add the deciding **role** to every Tier-0 line, and add `nexusAuditJobs`'s fate
to the "never wired" list so the taxonomy matches the code.

---

## 7. "UNKNOWN is not $0" — the money that renders as zero

Positive controls first — the codebase knows this rule and enforces it in places:
`adminSignal`'s `counted | unknown | not_measured`; `DeclinedEstimatesSection.tsx:84`
`const unknown = isError` consumed at `:248-255` (`value={unknown ? "—" : total}`) — the fix for
a documented `?? 0 → "$0 RECOVERABLE"` incident (`:77`); six honesty canaries
(`honestQueryStates`, `emptyIsNotUnknown`, `declinedLedgerHonesty`, `marginCoverageGuard`,
`adminBundleTruth`, `hqHonesty`); and `admin-stats.ts:556-600`'s own comment naming its two
swallowing catches and the additive `slices` fix. The remaining violations:

| # | Where | What renders | Why it is UNKNOWN not $0 | Consumer |
|---|---|---|---|---|
| **M-1 🔴** | `cron/jobs/statenourSync.ts:175-179, 190-194` | `todayEstimate / weekRevenue / monthRevenue` from `Number(x.rev \|\| 0)`, then on failure from an intelligence cache `?? 0`; `pacing = month ≥ target ? "on_track" : "behind"` (`:184`) | a failed read becomes **$0 and "behind"**, with no unknown marker in the v2 payload | stored by StateNour (`/api/sync/business` → `AuditEvent`, correction #16) and read by the Command Surface's `command/data` route with `?? 0`. **PR #2063 fixed the nickstire side** (`available:false`, no numbers, `pacing: "unknown"`); **the StateNour consumer still falls through to 0** (`app/api/command/data/route.ts:172-176`, `lib/state/nour-state.tsx:278`) and must be fixed there — cross-app follow-up, out of this PR's scope — the one place the brief said being wrong costs real decisions |
| **M-2 🟠** | `services/engines/marketing.ts:42-44` | `costPerLead = 0 // No ad spend data in DB — placeholder`; `roi` is the **string** `"43% conversion"` or `"N/A"` | cost is unknown, emitted as 0 | `intelligence/MarketIntelligence.tsx:22` sorts by `b.roi - a.roi` (string arithmetic → `NaN`, sort is undefined) and renders `` `${topChannel.roi}x ROI` `` → literally **"43% conversionx ROI"** on Intelligence HQ. Two defects in one tile; live render NOT VERIFIED, string arithmetic is deterministic |
| **M-3 🟡** | `money/DispatchSection.tsx:111-127` | `clockedIn`, `freeBays`, `totalBays`, `inProgress` all `\|\| 0` | the underlying model is dead-on-arrival (§1.3) — every value is *structurally* 0, and a failed read is indistinguishable | Money → Shop Status |
| **M-4 🟡** | `routes/nour-os-query.ts:282, 299` | `COALESCE(SUM(totalAmount), 0)` | a legitimate zero when no rows; but the route has no way to express "could not read" either — a thrown error is the only signal. **Held (PR #2063):** a failure returns 500 and a true zero returns 200 — the proxy CAN tell them apart, so no change | StateNour proxy panels |
| M-5 (not read) | `cron/jobs/dailyReport.ts:73` `Revenue: $${revenue}` | — | **NOT INVESTIGATED** — the computation was not traced | owner SMS |

**Contract to add (one sentence, in `METRICS-CONTRACT.md`):** a money value that could not be
read is transmitted and rendered as *unknown*, never as 0, and any payload that crosses a
system boundary carries `available: boolean` per slice — the shape `adminBundle.ts` already
uses inside the admin.

---

## 8. Scheduling — solvers do not apply here

The earlier brief asks to compare heuristics against OR-Tools/Timefold. **Reject both, with
evidence:** there is no constraint to solve. CURRENT-TRUTH: *"a deliberately slot-less FCFS
shop… there is no calendar/slot/bay model anywhere, on purpose."* `booking.ts` has zero
capacity/slot/bay logic (grep: 0 hits); `bookSlot` is a VAPI tool name that now records an
expected arrival (§1.3); the only bay model is dead (§1.3). The right artefact — the Arrival
Load strip — already exists. Reopen only if the business adopts appointments, and then start
with a heuristic on real arrival data, never a solver.

---

## 9. Reviews — no gating found; checked against Google's own policy

**Primary source** (fetched 2026-09-01, [Maps user-contributed content policy — Rating
manipulation](https://support.google.com/contributionpolicy/answer/7400114)): prohibited —
*"Discourage or prohibit negative reviews, or selectively solicit positive reviews from
customers"*; *"Offer incentives … in exchange for posting any review"*; allowed — *"Solicit or
encourage the posting of content that does represent a genuine experience, without offering
incentives."*

Against the code:

| Check | Result | Evidence |
|---|---|---|
| Solicitation filtered by sentiment/complaint/rating | **No.** Requests go to all completed bookings (`reviewRequests.ts:284-333`, `getCompletedBookingsWithoutReview`) and to all customers visited 6–8 days ago (`postInvoiceFollowUp.ts:64-73`); no sentiment/complaint branch anywhere in the request paths (grep: only reply-drafting and analytics use rating/sentiment) | compliant |
| Rating-branch funnel (≥4 → Google, else private form) | **No.** The review redirect endpoint "always redirects to the Google review page, even if tracking fails" (`_core/index.ts:1064-1077`); the `rating >= 4` branches found are in reply drafting (`crudAutomation.ts:416`), alerting (`reviewMonitor.ts:190`) and analytics (`gbp-reviews.ts:255, 416`) — all post-receipt | compliant |
| Incentives in request copy | **None found.** The only "coupon" hit is a competitor-comparison FAQ | compliant |
| "If we earned it, a quick Google review helps…" (`bridge-routes.ts:936`) | genuine-experience solicitation, no incentive | compliant |
| `reviewRatingFloor.test.ts` | a **display** floor — a 1-star review must not render as social proof on public pages (2026-08-29 defect) — not solicitation gating | compliant; `reviewGate.test.ts` is an unrelated PR-review gate (name collision) |

**Verdict: no review gating; keep it that way.** The account-risk item to watch is the opposite
failure — the Places sample (≤ 5) is not a complete review feed, so negative reviews can go
unanswered (§2.5), which is a reputation risk, not a policy one.

---

## 10. Design and personas — mechanical evidence only, no rendering

- Charts: **14 chart elements in 8 admin files** (`instagram/Learn.tsx` 3, `CallTrackingSection` 3,
  `outreach/SmsPerformanceSection` 2, `content/ContentManager` 2, `MarketIntelligence` 1,
  `customers/LoyaltyAdminSection` 1, `VoiceReceptionistSection` 1, `OutreachHubSection` 1).
  Whether each answers an operational question was **NOT INVESTIGATED** per chart — M-2 shows
  at least one tile answers a question with a malformed value.
- Motion: `framer-motion` imported in 4 admin files. Not audited for "communicates state."
- Today: 11 `Card` elements across `OverviewSection` + `today/*`. Whether they group coherent
  decisions cannot be judged from source. The rule from the earlier brief — a card only where
  it groups one object or decision; a chart only where it answers an operational question — is
  adoptable as a review checklist today; it is not verifiable by grep.
- **Personas, evidence only.** Six roles exist in code (`adminPermissions.ts:1`). Whether any
  human holds `front_desk`, `tech`, `accountant` or `viewer` is **NOT VERIFIED** — a prod read
  (`SELECT adminRole, COUNT(*) FROM users WHERE role='admin' GROUP BY adminRole`). A technician
  *model* exists (§1.3) but its assignment columns are never written. **Today serves all six
  roles** (`allowedRoles: ADMIN_ROLES`) and its money panels are not role-gated
  (`OverviewSection`/`today/*`: no `adminRole`/`hasAdminPermission`); the server permits it —
  `admindashboard.*` queries resolve to `admin.view`, which every role holds
  (`adminPermissions.ts:140-142`). So if a `tech` or `viewer` user exists, they see today's
  revenue. That is the earlier brief's "one dashboard serving conflicting jobs," with a file
  and line — and it is only a defect if such a user exists.

---

## 11. Production reads added by this artifact (all read-only)

1. `SELECT adminRole, COUNT(*) FROM users WHERE role='admin' GROUP BY adminRole;` — decides
   F-12, F-13, §10.
2. `SELECT COUNT(*) FROM bays; SELECT COUNT(*) FROM technicians; SELECT COUNT(*) FROM job_assignments;`
   — decides whether §1.3's bay/tech model is empty (expected) or hand-seeded.
3. `SELECT COUNT(*) FROM nexus_audit_jobs WHERE status='pending';` — the size of the queue
   nobody drains (F-18).
4. `SELECT COUNT(*) FROM inventory;` — expected 0 (§2.7).
5. Whether `CEO_EMAIL` is set on Railway — decides whether `notifyOwner` has ever delivered.
6. The four reads from artifact 2 §10.1 stand.

---

## 12. Not investigated in this artifact

| Cut | Why |
|---|---|
| Per-chart "does it answer an operational question" | needs the rendered tile and the operator's question list |
| `/links` and `/photo-improver` internals | personal-OS territory; verify their job with the operator before touching |
| `dailyReport.ts` revenue computation (M-5) | not traced |
| Whether `brainMemory` content carries customer PII | content, not schema |
| Retention / LTV engine definitions | reports-only lanes; artifact 3 §6 covers the metric caveats |
| The 1,007-orphan baseline's contents | a full census is its own artifact; the number is the finding |
