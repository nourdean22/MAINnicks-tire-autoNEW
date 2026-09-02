# Nick's Tire Admin — AI as an operator, the real operating model, IA decisions, and the smallest coherent shop OS

**2026-09-01 · Artifact 3 of the audit.** The decision-bearing document. Artifacts 1 and 2
([wiring](./ADMIN-WIRING-AUDIT-2026-09-01.md) · [automation/security/data](./ADMIN-AUTOMATION-SECURITY-DATA-AUDIT-2026-09-01.md))
were near-pure verified fact; this one carries recommendations, and every recommendation is
tied back to a numbered finding or a named file. **Where a sentence is opinion it says so.**
Same ref (`origin/main` @ `5c1195e6f`), same limits (no runtime, no live UI, no DB rows).

Findings continue the numbering (F-20…). The correction ledger closes at the end.

> **Status after implementation (2026-09-02, PR #2063).** §7's P0 and P1 items shipped except
> where noted in the PR: the operator-gated migrations (0114–0117) are written, not applied; the
> Memberships → Customers merge is held (it removes `accountant`'s only door — operator call);
> Ad Studio in the shell, DVI signature capture, the customer-deletion path (counsel) and
> retention deletes remain open. New standing canaries: `tableWriterCoverage`,
> `cronNoSwallowedFailure`, `cronInventoryParity`. Read the PR before re-planning any row here.

---

## 0. What the brief got wrong about this shop — and why it matters for every section below

The brief supplied a canonical operating model: *Lead → Customer → Vehicle → Appointment →
Inspection → Estimate → Authorization → Work Order → Technician/Resource Assignment → Parts →
Execution → QC → Invoice → Delivery → Follow-up → Review → Retention.* It said not to assume it.
Good — three of its links do not exist here, and one is explicitly refused:

| Brief's link | Reality at `5c1195e6f` | Source |
|---|---|---|
| Appointment → Technician/Resource/Bay assignment | **Deliberately absent.** *"A planning signal for a deliberately slot-less FCFS shop, not a schedule — there is no calendar/slot/bay model anywhere, on purpose."* | `docs/CURRENT-TRUTH.md`, "Authoritative operator surfaces → Arrival load" |
| Parts/Tires → supplier order | **No supplier API exists.** `tireOrders.status = "ordered"` is set by a human with no actor or timestamp (artifact 2, F-19). | `routers/gatewayTire.ts:1247-1263` |
| Authorization (customer signs) | **No signature artifact.** `status: "approved"` is the operator clicking convert. A DVI per-item customer decision *does* exist (§2.3). | `routers/estimates.ts:222`; `routers/services.ts` `inspectionRouter.decideItem` |
| Vehicle as a canonical entity | **Three identities, one dead** (artifact 2, F-16). | `schema.ts:313, 2094, 2125` |

Everything that follows is designed for the shop that exists: first-come-first-served, one
bay-less floor, tire orders placed by phone, authorization by conversation, and an operator
who runs it from an iPhone PWA. A recommendation that assumes bays, slots, or a supplier feed
would be the same category error as the brief's 48-item template.

---

## 1. AI / "Nick" as an operational agent — verified inventory

### 1.1 Shape

| Fact | Value | Source |
|---|---|---|
| LLM chokepoint | **one** — `invokeLLM()` | `_core/llm.ts:421` |
| Call sites through it | **65** (non-test), top file `contentManufacturing.ts` (7) | grep `invokeLLM(\|generateText(\|…` |
| Provider resolution | `AI_FORCE_OLLAMA` → `OLLAMA_MODEL \|\| "deepseek-v4-pro"`; `AI_FORCE_GEMINI` → `GEMINI_MODEL \|\| "gemini-2.5-flash"`; default Gemini 2.5 Flash (1.5-pro retired by Google); OpenAI if keyed; image parts on the Ollama lane are rerouted to Gemini | `_core/llm.ts:386-455` |
| Tool calling | supported at the chokepoint (`tool_choice`, `tools`) | `_core/llm.ts:65, 462-483` |
| Prompts | **inline in services**; `server/prompts/` holds one file (`creativeSkillPacks.ts`) | `git ls-tree` |
| Per-call usage/cost ledger | **none** — `invokeLLM` writes no table; `generation_reservations` is a *content-credit* ledger for reels, written by reel/quality services, not by the chokepoint | `_core/llm.ts` (0 inserts); `schema.ts:4132` |
| Eval datasets | **2 files**: `ig-retro-dual-judge.jsonl`, `proc-census.json` (the latter is not an eval) | `eval-datasets/` |
| Eval surface in admin | `PromptEvalsPanel` → one procedure, `contentAdmin.runPromptEvals` | `PromptEvalsPanel.tsx` |
| Rubrics (prose) | 25 docs in `docs/eval-rubrics/` | `git ls-tree` |
| Prompt evolution | offline optimizer seeded from **verified** conversions and operator rulings (`revenue_attribution_decisions`), recommends; does not self-apply | `services/promptEvolution.ts:44-102` |

### 1.2 Three autonomy systems, not one (artifact 2 §3, restated as a matrix)

| System | Governs | Gate | Human in loop? | Surfaced where |
|---|---|---|---|---|
| **Proposals / trust ladder** | `create_callback`, `create_booking_request`, and `publish` **only when a publish is blocked/unreachable** | `services/proposals.ts` state machine; `approveAndExecute` | yes, always | Approvals section |
| **SMS autonomy registry** | every AI SMS lane | `SMS_AUTOMATION_REGISTRY` per-lane `RolloutMode off\|shadow\|draft_only\|live_send\|legacy_passthrough`, `AutonomyLevel 0-4`, `evidenceRequirement` per lane | per lane; `force_human_review` on safety/complaint/legal intents | `AutonomyCensusPanel` (Winback section) |
| **Env flags** | IG image lane, reel lane, comment responder | `REEL_AUTOPOST_ENABLED`, `REEL_PUBLISH_ENABLED`, `IG_AUTOPOST_DRYRUN`, flag `legacy_autopost_live`, `REEL_COMMENT_RESPONDER_LIVE` | **no** — `dailyReelPost` calls `publishToSocial` "with no approval step" (CURRENT-TRUTH, verbatim) | Settings / Instagram; values on Railway |

The section labelled **Approvals** governs the smallest of the three. That is documented in
CURRENT-TRUTH ("publish is operator-gated ONLY on the admin surface"), so it is not a secret —
but the sidebar label and the registry comment ("every AI- or one-tap-originated action lands
here") overclaim, and an operator reading the sidebar would reasonably believe otherwise.

### 1.3 The SMS path is the codebase's best hybrid — and the model the rest should copy

Traced, not assumed (`services/smsIntentRouter.ts`, `smsReplyPlanner.ts`,
`nickgptPreflightGuard.ts`, `smsResponseParser.ts`, `smsOrchestrator.ts`):

1. **Deterministic first.** `smsIntentRouter` is *"PURE and deterministic: string + context in,
   typed decision out. No DB"*; multi-intent; each intent carries `risk: deterministic |
   human_assisted`. Regex confidence in `smsResponseParser` (e.g. bare "yes" = 95, `yes\b` = 85)
   with a `requiresHuman < 80` threshold.
2. **Plan before draft.** `buildReplyPlan()` produces a typed plan; `renderPlanPrompt()` turns it
   into the LLM instruction.
3. **Draft, then check the draft against the plan.** `planViolations(plan, draft)` — a
   post-hoc constraint check on the model's output, independent of the model.
4. **Preflight can force a human.** `runNickgptPreflightGuard` → `force_human_review`.
5. **Rollout mode decides send vs draft** per lane (§1.2).
6. **Sample for audit** — `nexusAuditSampler.shouldAuditMessage` → **queue with no worker**
   (artifact 2, F-18).

Against the brief's "rules-only vs heuristic vs LLM vs hybrid vs agentic" comparison: this is
the hybrid, already built, with the abstention and override hooks the brief asks for. What it
lacks is the *closure* — step 6 never runs, there is no eval corpus for steps 1–4 beyond the
IG judge file, and no per-call ledger (§1.1). **Recommendation: do not redesign this pipeline;
close it.** Every other AI lane should be measured against its six steps.

### 1.4 The tool surface an external agent can reach

`routers/nick/*` exports **24** `handle*` actions including `handleRunMigrations`,
`handleImportCustomerCSV`, `handleCreateWorkOrder`, `handleDispatchAction`,
`handleSocialPost`, `handleSendMedia`, `handleSetCamera`. They are tRPC `nickActions.*`
procedures; the resolver maps `nickactions.*` mutations to `settings.manage` (owner/manager).
**The Custom-GPT bridge does not reach any of them** (grep of `_core/bridge-routes.ts`: none).

What the bridge (19 routes, one flat `X-Bridge-Key`) does reach, verified route by route:

| Route | Effect | Guard |
|---|---|---|
| `GET` health / shop-snapshot / customer-lookup / analytics / cron-status / intelligence / probe-alg / openapi | reads (customer-lookup returns PII) | key only |
| `POST` mark-contacted / quick-note / dropoff / callback | writes to leads/callbacks/work orders | key only |
| `POST` ingest-reports / backfill-history / trigger-mirror / full-sync / diag | data-pipeline writes | key only |
| `POST run-job` | runs a background job — **allowlisted** (STRIDE-D, `:1079`) | key + allowlist |
| **`POST sms-campaign`** | **see F-20** | key + `dryRun` default |

### 🟠 F-20 · One static header can send up to 500 real win-back texts

`_core/bridge-routes.ts:22-24, 884-980`: input `{ dryRun: z.boolean().default(true),
limit: z.number().int().min(1).max(500).default(50), daysSince: … }`; when `dryRun` is false the
route selects `LIMIT ${limit}` recipients and calls `sendSms(m.phone, m.message, { via: "shop" })`
per row. The OpenAPI text handed to the GPT reads: *"DESTRUCTIVE: run a win-back SMS campaign
to real customers. dryRun defaults to true — set dryRun:false to actually send."*

What genuinely protects the customer: `sendSms`'s own gates apply, because the call passes no
`messageClass` and so defaults to `customer_marketing` — global pause (fail-closed), daily cap,
opt-out index, quiet hours (artifact 2 §1.2). What does **not** protect them: there is no
proposal, no second factor, no per-call ceiling below 500, and no operator notification on the
live path. Authorization is one long-lived shared secret held by a Custom GPT. **This is the
exact "AI expanding into consequential side effects" case the brief names**, and it sits
outside all three autonomy systems in §1.2.

**Options (opinion):** (a) route `dryRun:false` through `createProposal` so it lands in
Approvals — the cheapest fix and the one that makes the sidebar label true; (b) cap `limit` at
the daily-cap remainder; (c) per-client keys with scopes, as StateNour's bridge already did on
2026-08-27 (agent memory). (a) first.

### 🟠 F-21 · 65 model calls, zero per-call receipts

No table records model, tokens, latency, cost or outcome per `invokeLLM` call. Cost is visible
only per *content* lane (reel credits via `generation_reservations`) and via provider dashboards.
The brief's "track correction burden, false actions, abstention quality" is unmeasurable
without this row. UPSTREAMS records Langfuse **ADOPTED** on the StateNour side (2026-08-25); the
nickstire chokepoint has nothing equivalent. **Recommendation:** one insert at
`_core/llm.ts:421` (model, lane, tokens in/out, ms, ok/err, caller) — a build-small table, not
a vendor. Add Langfuse only if the StateNour instance can be shared at zero marginal cost.

### 🟡 F-22 · Evals exist for one lane

One real eval dataset (`ig-retro-dual-judge.jsonl`) and one admin-runnable eval procedure, for
65 call sites across SMS replies, voice extraction, content, SEO drafts, quality gates, and
resolution judging. The SMS pipeline (§1.3) — the lane that texts customers — has deterministic
tests (`smsIntentRouter`, `smsReplyPlanner`, `nickgptPreflightGuard` are all unit-tested) but
**no held-out corpus of real inbound texts with labelled correct actions.** UPSTREAMS's Promptfoo
row says the trigger is "hand-authored adversarial scenarios stop scaling"; for nickstire the
prior step — *any* labelled SMS corpus — has not happened. Note `smsLearningEngine` and
`sms_learning_recommendations` exist (operator-edit taxonomy → recommendation), which is the
seed of exactly this corpus.

### 🟡 F-23 · A customer's DVI decision reaches nobody

`inspectionRouter.decideItem` (`routers/services.ts`, public, token-authenticated) records
`approved | declined | question` plus the customer's note — *"No AI touches this path — the
decision and note are the customer's own words"* — and then **nothing notifies the advisor**:
no Telegram, no SSE event, no log line in the router or in `recordInspectionDecision`. The
advisor learns of a customer's answer only by re-opening the inspection. Writer with no reader,
in the one place the brief's customer-authorization loop actually exists.

### 1.5 Permission / side-effect matrix — what a consequential action requires **today**

| Action | Who/what can trigger | Requires | Receipt |
|---|---|---|---|
| Send one SMS to a customer (operator) | owner/manager via `smsConversations.send` | `marketing.manage` | `auditTrail` `customer.sms_manual_send` + **two thread rows** (F-8) |
| Send a segment campaign | owner/manager click, **or GPT bridge** (F-20) | `marketing.manage` / one key | campaign rows (claim-first) |
| AI auto-reply to inbound SMS | orchestrator | lane `RolloutMode = live_send` + preflight + planViolations | `sms_orchestrations` row; audit **sampled but never audited** (F-18) |
| Publish reel to Instagram | `dailyReelPost` cron | `REEL_AUTOPOST_ENABLED` + `REEL_PUBLISH_ENABLED` + gates; **no human** | publish-attempt ledger; reconciler exists but is called only from the manual procedure |
| Refund a tire order | any role with `workorders.manage` — **incl. `tech`** (F-12) | `adminProcedure` | `invoice.refunded` audit + Stripe idempotency key |
| Run a DB migration / import CSV | owner/manager | `settings.manage` | ? (not read) |
| Change tire-order status to "ordered" | any role with `workorders.manage` | — | **none** (F-19) |
| Approve an estimate | operator click | `workorders.manage` | `work_orders` row; **no customer artifact** |
| Delete a customer | **nobody** — no path (F-15) | — | — |

The brief asks that AI "never silently fabricate customer/shop state or convert inference into
canonical operational facts." The IG Create lane already enforces `recorded | inferred |
operator` provenance on every fact (CURRENT-TRUTH, "Create is evidence-first as of 2026-08-16").
The gap is not the AI — it is the *human-triggered* paths (§1.5 rows 5–8) that write canonical
state with no artifact.

---

## 2. The operating model as it actually is — canonical entities and state

Verified against `drizzle/schema.ts` (146 tables) and the routers. Only what is load-bearing.

### 2.1 Canonical entities and where their truth lives

| Entity | Table | Identity | Truth quality |
|---|---|---|---|
| Customer | `customers` | `phone` UNIQUE + generated normalised `phone10` UNIQUE | **strong**; `phone2` for second lines; no merge concept |
| Vehicle | `customer_vehicles` (live) · `vehicles` (dead, 0r/0w) · `work_orders.vehicle_id varchar(36)` (dangles) · ~12 free-text columns | none canonical | **broken** (F-16) |
| Lead / Booking / Callback | `leads`, `bookings`, `callback_requests` | int ids; lead↔call linkage via `vapi_call_logs.leadId` | good; METRICS-CONTRACT defines "created" strictly |
| Estimate | `estimates` (+ `alg_estimates` mirror, read-only) | int | ok; **approval has no artifact**; `followUpSent` is drifted (F-17) |
| Work order | `work_orders` | `order_number`; `status varchar(30)` default `draft`; `customer_id` FK SET NULL | ok; lifecycle labels in `customerMessaging.ts` STATUS_LABELS |
| Invoice | `invoices` (+ ShopDriver mirror) | int; `paymentStatus` (**unreliable per agent memory 2026-08-28**) | paid revenue = "invoice-backed revenue views" (CURRENT-TRUTH) |
| Tire order | `tire_orders` | `orderNumber`; 8-state enum | "ordered" unprovenanced (F-19) |
| Conversation / message | `sms_conversations` (phone) → `sms_messages` (6-state incl. `queued`, `sending`, `delivered`) | conversationId | good schema; duplicate rows on operator replies (F-8) |
| Proposal | `admin_proposals` | uuid; typed transitions | good; 3 action types |
| Review | `review_requests`, `review_replies`, `review_pipeline` | | good; Google review *fetch* dead (memory), replies live |

**Canonical vs derived — where the brief's distinction is already enforced:** the IG evidence
engine's `recorded | inferred | operator` basis; METRICS-CONTRACT's `observed | inferred |
verified | modeled` tiers; `adminSignal`'s `counted | unknown | not_measured` badge states;
the SW's network-first shell. **Where it is not:** every "sent" stamp in the outreach tables
(artifact 2 §1), tire-order status (F-19), and the estimate approval.

### 2.2 State machines that exist, with evidence

- **Proposal:** `PROPOSAL_STATUSES` + `PROPOSAL_TRANSITIONS` + `canTransition()`,
  `EXECUTING_STALE_MINUTES = 15`, `sweepStaleExecuting`, `resolveAmbiguous`
  (`services/proposals.ts:36-79, 473-546`). Real, typed, swept.
- **SMS message:** `queued → sending → sent → delivered | failed`, with `MAX_SEND_ATTEMPTS = 5`,
  stale-orphan recovery, and webhook-driven `delivered`/`failed` (`sms.ts:512-620`,
  `smsGateway.ts:423-478`). Real. (One race: an `sms:sent` event arriving after `sms:delivered`
  regresses the row to `sent` — `smsGateway.ts:439-441` sets unconditionally. **Hypothesis**,
  not verified against provider ordering.)
- **IG publish:** `ready → scheduled → published | failed | ambiguous` with `ambiguous` as a
  first-class parked state (CURRENT-TRUTH; `metaSocial.ts:537`). Real.
- **Tire order:** 8-value enum, no transition table, no history. Enum, not a machine.
- **Work order:** `status varchar(30)` — free string with labels; transitions live in
  `workOrderService`/`workOrderAutomation` (auto-advance to invoiced, auto-close after 7 days).
  Not read exhaustively — **NOT INVESTIGATED** beyond the automation hooks.
- **Booking:** `new | confirmed | completed | cancelled` + `followUp24hSent/7dSent` flags —
  the flags are the F-1 burn.

### 2.3 The authorization loop that exists, and the one that doesn't

Exists: DVI (`inspectionRouter`) — admin creates inspection, adds items **with photos**
(`addItem.photoUrl`), publishes; customer opens a **token link** (`byToken`, `recordView`),
decides **per item** (`decideItem: approved | declined | question` + note). This is most of
the Tekmetric/Shopmonkey mechanism (§4), minus notification (F-23), minus signature, minus a
price snapshot at decision time, and minus any link from an approved item to a work-order line.

Does not exist: estimate authorization as an artifact. `estimates.ts:222` returns
`status: "approved"` on conversion to a work order; there is no customer-side approve, no
signature, no immutable copy of what was approved.

---

## 3. Information architecture — the decision table

Method: each of the 17 registry sections (+ `/admin/ad-studio`) scored on **verified**
attributes — sidebar visibility, iPhone reachability (no Cmd+K on the PWA), code weight, number
of distinct tRPC procedures it calls, how many routers those span, inner tabs, and whether
its label names its contents. Verdicts are **opinion grounded in those attributes**; the
attributes are fact.

| Section (label) | KB / procs / routers | Inner surfaces | Reachable on iPhone | Verdict | Why |
|---|---|---|---|---|---|
| `overview` (Today) | 86 / 19 / **14** | 7 composed panels (MorningBrief, ExceptionFeed, ArrivalLoadStrip, NextBestActions, TodaysMoneyRisks, TodaysRealNumbers, TopMoneyMoves) | yes | **KEEP** | it is the hub; badge doctrine (`counted/unknown/not_measured`) already correct; the only page that must stay fast |
| `approvals` | 15 / 6 / 1 | 5 status filters | yes | **KEEP, RENAME to what it is** | governs 3 action types (§1.2); label "Approvals" overclaims. Either grow it (F-20 option a) or name it "Nick's drafts" |
| `customers` | 159 / 24 / 6 | customers · loyalty · coupons; Customer360 drawer | yes | **KEEP; MOVE coupons out** | coupons are marketing (`coupons.*` → `marketing.manage`), not a customer property; loyalty is |
| `leads` (Sales Pipeline) | 86 / 6 / 3 | kanban · list · walk-in calculator | yes | **KEEP** | small, focused; walk-in quote drawer is shell-level already |
| `revenue` (Money) | 155 / 33 / 6 | shopPulse · unpaid · declined · financing · shopStatus | yes | **KEEP** | dense and correct; the 2026-07-25 nav fix put it back on the sidebar for the iPhone |
| `memberships` (Nonstop Nick) | 9 / 2 / 1 | — | yes | **MERGE into Customers** | 2 procedures; a customer attribute with a Stripe subscription, not a product area |
| `tireOrders` (Tires) | 40 / 6 / 1 | 9 status filters | yes | **KEEP; REWORK the status control** | F-19: status changes need actor + timestamp; "ordered" needs a `gatewayOrderRef` prompt |
| `growth` (Marketing / Growth) | 39 / 10 / 3 | local · reviews · qa · photos · entity · competitors | yes | **MERGE with `content`** | both are "owned properties + GBP"; the `content` entry's own comment documents the collision was in the word, not the function |
| `content` (Website & Local) | 74 / 21 / 3 | manager · ideas · specials · evals | yes | **MERGE with `growth`**; **MOVE evals to System** | PromptEvals is an engineering surface, not a marketing one |
| `instagram` | **355** / **71** / 4 | 10 views (today create publish community insights planning patterns actions control settings) | yes | **KEEP as its own top-level** — it already is 22 % of the admin | the one lane that spends money and posts unattended; CURRENT-TRUTH's "Publish is the only queue" rule is right |
| `campaigns` (**Winback**) | 264 / **61** / **12** | sms · campaigns · followups · reviews · winback · performance · orchestrator | yes | **SPLIT + RENAME** | the label names one of seven tabs. Inside: the SMS inbox (daily, front-desk), campaign tools (marketing), the autonomy census (system). Three audiences under one word |
| `voiceReceptionist` | 123 / 19 / 4 | pending · performance; 8 panels | yes | **KEEP** | metric contracts exist for it; VAPI is the busiest procedure surface (harvest: 12 of 77) |
| `intelligence` (Intelligence HQ) | 38 / 4 / 1 | 5 panels + "battlefield" | yes | **REWORK or DELETE** | 4 procedures behind 5 panels named ContentWarRoom / MarketIntelligence / battlefield; `viewer`-visible. The registry note says it was removed once (2026-05-24) and re-added (2026-06-24). Justify with a JTBD or fold its 4 reads into Today |
| `opsHub` (Reports) | 10 / 2 / 2 | actions · reports · messages | yes | **MERGE into Settings/System** | 2 procedures + a hand-curated 9-claim registry (`opsRegistry.ts`) that is already wrong once (artifact 2 §6) |
| `settings` (Settings / Safety) | 192 / **39** / **11** | status · shopdriver · health · compliance · integrations + 9 panels (flags, VAPI, ALG budget, DB hygiene, declined recovery, cron issues…) | yes | **SPLIT: Settings vs System** | 11 routers = a junk drawer. The brief's control-plane instinct is right here: shop settings (hours, pricing, templates, consent) vs system (flags, crons, integrations, hygiene, evals, MFA) |
| `callTrackingView` | 21 / 4 / 3 | — | **no** (alias/URL only) | **MERGE into Voice** | same subject (calls); no sidebar door; the same nav-orphan class fixed for Money on 2026-07-25 |
| `trafficFunnel` | 46 / 10 / 4 | — | **no** | **MERGE into Money or Marketing** | "Traffic → Revenue" is an attribution view; orphaned |
| `/admin/ad-studio` (separate route) | 20 / — / — | — | **no** (`mobileHidden: true`, `Admin.tsx:57`) | **MOVE inside the shell** or **MERGE into Instagram** | outside the shell = no badges, no palette, no degraded banner, no MFA gate re-check on navigation |

**Net (opinion):** 17 + 1 → **9 top-level doors**: Today · Drafts/Approvals · Customers ·
Pipeline · Money · Tires · Inbox (SMS + calls) · Marketing (website/GBP/growth/campaigns) ·
Instagram · Settings — with **System** as the tenth, reached from Settings, holding flags,
crons, integrations, hygiene, evals, and the security panel. That keeps every daily-shop-floor
job at most one tap from Today on the iPhone and takes the two orphans and the outside-the-shell
page off the list of things only a URL can reach.

**Cross-page consistency (fact, not opinion):** the registry enforces one owner per alias
(`admin-registry-integrity.test.ts`), one role list per section (`adminRegistryTruth.test.ts`),
and one badge doctrine (`adminSignal.test.ts`). The entities that do *not* have one meaning
everywhere are Vehicle (F-16) and "sent" (artifact 2 §1). Those are data problems, not IA
problems, and no navigation change fixes them.

**Search / command (fact):** `cmdk` is installed; `CommandSearch` matches sections, customers,
orders, phones, invoices, VINs and two actions; `customers.list` is `LIKE '%term%'` over five
columns plus a booking-vehicle join with wildcard escaping (`customers.ts:111-115`). At this
customer volume that is milliseconds. **Verdict: no search engine, no FTS index — the brief's
own instinct. The one addition worth making is an exact `phone10` fast path** (the column and
its unique index already exist) so a typed number resolves before the LIKE scan runs.

---

## 4. Benchmark — bounded to mechanisms that map to verified gaps

The brief listed ~30 products. Per its own point 3, I did not tour them. I verified **two
mechanisms** that correspond to gaps found in the code, and **two dependencies** the product
already relies on. Everything else is "not benchmarked", not "benchmarked and fine".

| Mechanism | Source (first-party) | Transfers because | What NOT to copy |
|---|---|---|---|
| **Estimate → text → customer e-signature → immutable snapshot of the estimate at approval → advisor notified (approved/declined/both)** | Tekmetric: [Digital Signature & Authorization Process](https://support.tekmetric.com/hc/en-us/articles/4421125978391-Digital-Signature-Authorization-Process), [authorization update](https://www.vehicleservicepros.com/shop-operations/service-repair/news/21244420/tekmetric-tekmetric-releases-digital-authorization-update); Shopmonkey: [Customer E-Signatures](https://support.shopmonkey.io/hc/en-us/articles/38743424357652-Customer-E-Signatures-to-Authorize-Services), [How do customers authorize services?](https://www.shopmonkey.io/help/how-do-customers-authorize-services) | The DVI token link + per-item decide already exists (§2.3). Adding (a) advisor notification (F-23, trivial), (b) a canvas signature + SHA of the rendered estimate stored on the decision, (c) an "authorized" work-order line derived from approved items, closes the loop with no new dependency — `puppeteer` (installed, used for social renders) can produce the PDF snapshot. | Do not copy per-service line pricing UIs or labor-guide integrations — no labor-guide licence exists here (`autoLabor` router is the internal estimator). Do not copy "approve via phone → advisor clicks approved" as the *only* path; that is what exists today and is the gap. |
| **Two-way SMS with delivery state distinct from sent** | (nickstire's own `metaSocial`/`smsGateway` design) | already built — the gap is the callers (artifact 2 §1) | — |
| **NHTSA vPIC VIN decode** | [vpic.nhtsa.dot.gov/api](https://vpic.nhtsa.dot.gov/api/) — verified live 2026-09-01: v4.06 (code change 2026-06-13), free, `DecodeVinValues`, batch ≤ 50, rate-controlled but undisclosed, JSON/CSV/XML | UPSTREAMS already lists it **ADOPT-CANDIDATE (WP-23)**; 0 files implement it. Only worth doing **after** F-16 gives a vehicle somewhere to land. | Do not build a fitment database; vPIC does not carry tire fitment, and licensed fitment data is out of scope for this audit. |
| **Shop SMS gateway (`sms-gate.app`)** | [capcom6/android-sms-gateway](https://github.com/capcom6/android-sms-gateway) — Apache-2.0, [v1.68.0 released 2026-07-14](https://github.com/capcom6/android-sms-gateway/releases), Android app + cloud relay over FCM | it is the live path for every customer text (`via: "shop"`); actively maintained; `smsGatewayHealthMonitor` already polls device registration | The dependency is one physical Android phone. That is a business-continuity fact, not a code finding: the health monitor exists; a spare device procedure does not (NOT INVESTIGATED). |

**Not benchmarked and listed as such:** Shop-Ware, Mitchell 1, RO Writer, TireMaster, Fullbay,
PartsTech/Nexpart, Podium/Kukui/Birdeye, ServiceTitan/Housecall/Jobber, Linear/Shopify/Stripe
dashboards. A later pass should use them the way the brief intended — to find what this audit
*missed* — and each entry must arrive with the same four columns as the table above or not at
all.

---

## 5. OSS / tooling — cite the verdicts that exist, add only what nickstire needs

`docs/UPSTREAMS.md` (95 rows) is the repo's adoption ledger and **already answers most of the
brief's OSS list**. Relevant rows, verbatim verdicts: Trigger.dev/n8n **REJECT** (*"a sixth job
system is the disease"*) · Cal.com **WATCH** (*"reopen on real scheduling pain"* — and §0 says
there is none by design) · LangGraph / OpenAI Agents JS / Open WebUI **REJECT (duplicate)** ·
Outlines/vLLM **REJECT (wrong layer)** · Promptfoo **WATCH, incumbent won** · Langfuse
**ADOPTED (StateNour)** · OTel GenAI semconv **ADOPTED** · Plausible/PostHog **WATCH** · NHTSA
vPIC **ADOPT-CANDIDATE** · Lighthouse CI + CrUX **ADOPT-CANDIDATE** · OWASP LLM Top-10 / NIST AI
RMF / MITRE ATLAS **ADOPT-AS-CHECKLIST** · Docling **ADOPT-CANDIDATE (sidecar)** · Graphiti /
GraphRAG **PATTERN / WATCH**. **Do not re-litigate a row; reopen it with its own trigger.**

What is already installed (from `package.json`, so no proposal may duplicate it): `cmdk`,
`@tanstack/react-query`, 26 `@radix-ui/*` primitives, `recharts`, `react-hook-form`, `zod@4`,
`date-fns`, `framer-motion`, `sonner`, `lucide-react`, `wouter`, `puppeteer`, `sharp`, `stripe`,
`twilio`, `express-rate-limit`, `@sentry/node`, `web-push`, `drizzle-orm`, `@trpc/server`.

nickstire-specific verdicts (opinion, with the evidence that would change each):

| Capability | Verdict | Grounds | Flips if |
|---|---|---|---|
| Estimate/inspection PDF snapshot | **BUILD-SMALL** on installed `puppeteer` (HTML→PDF is one call; it already renders carousels) | no PDF lib present; the need is one document type | a second document type appears (invoices, work orders) → then `@react-pdf/renderer` |
| Customer e-signature | **BUILD-SMALL** (canvas → PNG + SHA-256 of rendered estimate, stored on the decision row) | no e-sign lib, no legal e-sign requirement named; counsel decides admissibility | counsel requires an audit-trail standard a homegrown capture cannot meet |
| Data grid / virtualization | **DEFER** | no `@tanstack/react-table` / `react-virtual`; no evidence any admin list exceeds a few thousand rows (2,888 invoices per agent memory) | a measured list render > 200 ms on the operator's phone |
| VIN decode | **ADOPT (vPIC)**, after F-16 | UPSTREAMS WP-23; verified live | — |
| Per-call LLM ledger | **BUILD-SMALL** (one table, one insert at the chokepoint) | F-21 | Langfuse StateNour instance can be shared free |
| Full-text / search engine | **REJECT** | §3 search verdict | customer count × 10 |
| Offline / local-first / CRDT | **REJECT** | SW is network-first by decision after the 2026-08-01 blank-page incident (artifact 2 §8) | the shop loses connectivity as a pattern, not an incident |
| Second job/queue system | **REJECT** | UPSTREAMS; one live scheduler with cross-dyno locks and an observer | — |
| Passkeys/WebAuthn | **DEFER** | TOTP MFA exists and is enforced only when `ADMIN_MFA_REQUIRED` — the flag, not the factor, is the question | the operator turns MFA on and finds TOTP a burden |
| iCalendar/RRULE | **REJECT** | §0 — no slots by design | the business changes its model |

**DO-NOT-ADD list:** any orchestration runtime, any vector/search service, any CRM product,
any offline sync layer, any second SMS provider path (Twilio is the documented dead fallback —
finish removing it or keep it as the tested fallback, but not both), any "AI agent framework".
The dependency budget for the whole roadmap in §7 is **zero new runtime dependencies** except
the vPIC fetch.

---

## 6. Metrics — what to trust, what to add

Trust `docs/METRICS-CONTRACT.md` as written (evidence tiers, denominators, revenue concepts).
Add one contract, because every outreach number currently violates it:

> **"Sent" means the provider accepted the message and returned an id; "delivered" means the
> provider's delivery receipt arrived; "queued" means accepted for a later window. A count
> labelled *sent* may include neither queued nor delivered rows. A booking, estimate or campaign
> row may be marked sent only on a `success && !queued` result, and must carry a separate
> `attemptedAt`.** (Artifact 2 §1; the standard is `unpaidInvoiceRecovery.ts:286-303`.)

Uncovered by any contract today, and the caveat that governs each: **ARO / car count** (invoice
basis; `paymentStatus` unreliable — memory 2026-08-28); **gross margin** (cost feed dead since
2026-04 — memory; do not display); **show rate** (bookings are FCFS signals, not slots — define
"showed" as a linked work order, per CURRENT-TRUTH's arrival rule); **technician productivity**
(a `technicians` / `job_assignments` model exists in code; this section first said the
`work_orders.assignedTech / assignedTechId / assignedBay` columns are never written — **withdrawn,
correction #17**: `assignedTech`/`assignedBay` are written by the Work Orders quick-input and
`assignedTechId` by `dispatch.assign`, and the Team Performance panel reads `assignedTechId`
today; define technician productivity on `assignedTechId`, and confirm the prod row count first); **inventory turns** (no inventory
ledger — tires are ordered per job; do not define); **review rate** (`review_requests` sent vs
`review_pipeline` detected — definable, both tables have writers); **outbound SMS volume**
(inflated by F-8 until fixed — re-baseline after).

---

## 7. Roadmap — dependencies, leverage, reversibility, kill criteria

Ranked by (certainty × harm) ÷ cost. All P0 items are reversible one-file changes with a test.

### 7.0 Protected-surface notice — read before opening any P0 PR

`PROTECTED-CORE.md` and `docs/operations/LOAD_BEARING_SYSTEMS.md` classify most of what follows as
load-bearing. Per those files, a PR touching a listed surface must carry **an impact statement,
focused validation evidence, rollback instructions, and owner acknowledgement in review**, and may
never weaken an auth or signature check (rule 1) or rename/remove a field without an additive
adapter first (rule 8). Mapping:

| Item | Protected surface (verbatim from the two files) | Note |
|---|---|---|
| P0-3 (F-1/F-6), P1-9 | *Lead, callback and booking persistence* · *Cron/background jobs* | additive columns only (rule 8); the canary is the validation evidence |
| P0-4 (F-8), P1-10 (F-7) | *SMS Gateway (shop F25e, primary) — `server/sms.ts` `via:"shop"` path* · *Customer opt-out, consent and quiet-hour enforcement* | F-7 is additionally counsel-gated |
| P0-5 (F-12), P0-7 (F-11) | *Authentication and admin authorization* · *Auth/Admin access — `server/_core`* | both changes **tighten** the check; rule 1 forbids the opposite direction only |
| P0-6 (F-20) | *Bridge/sync systems* | the GPT bridge is not the StateNour bridge named in PROTECTED-CORE, but LOAD_BEARING covers both |
| P1-13 (F-16) | *DB schema/migrations — `drizzle/`* | hand-applied SQL; operator approval required (rule 4); add the int FK additively, backfill, then retire `vehicles` |
| P1-11 (F-18), P1-16 (F-21) | *SMS Revenue Agent OS control plane* · none | F-21's table is new and additive |

Rule 9 of PROTECTED-CORE — *"A successful code edit is not a successful production action"* — is
the one-sentence version of this entire audit.

### P0 — first 7 days (all read-only or one-file fixes with a canary)

| # | Item | Depends on | Verification | Kill / stop criterion |
|---|---|---|---|---|
| 1 | The four production reads (artifact 2 §10.1): `sms_review_requests`, `sms_retention_sequences`, confirmations flag, `SHOW COLUMNS FROM estimates LIKE 'followUpSent'` | nothing | four values written into this doc's successor | — |
| 2 | Blast-radius SQL (artifact 2 §10.2, corrected) | 1 | counts recorded | if all four counts are 0 and both flags are on, downgrade F-1/F-6 to 🟡 and skip 3 |
| 3 | F-1 + F-6 fix: count on `success && !queued`; attempted/sent split; `LIMIT 10` sliding band → `attemptedAt IS NULL` — **with a canary test for each** (none exists today: only `sendSmsInternalLineGuard.test.ts` touches these paths) | 1 | test breaks the burn, asserts it fails; `pnpm verify:nick` receipt | — |
| 4 | F-8: `skipPersist: true` from `smsConversations.send`; single-row test | nothing | thread shows one row per reply | if the live thread was *not* showing duplicates, find out why before merging (something else dedupes) |
| 5 | F-12: pin `gatewaytire.refundorder` → `money.manage`; canary in `adminPermissionCoverage.test.ts` | nothing | test proves `tech` is refused | — |
| 6 | F-20: route bridge `sms-campaign dryRun:false` through `createProposal` | nothing | a GPT call lands in Approvals instead of sending | if the operator wants the GPT to send unsupervised, cap `limit` at the daily-cap remainder instead and say so in the OpenAPI text |
| 7 | F-11: fail closed on unreadable security state | nothing | test: `security = null` → `UNAUTHORIZED` | if a real prod DB blip rate would lock the owner out daily, fail closed for mutations only |
| 8 | Correct the three stale claims: `NICKSTIRE-ADMIN-CLEANUP-AUDIT.md:112`, `opsRegistry.customer-confirmations`, `REVENUE-AUTOMATION-STATE.md:22` | nothing | diff | — |

### P1 — first 30 days

| # | Item | Depends on | Leverage |
|---|---|---|---|
| 9 | Attempted/sent split across the remaining 12 `sendSms` callers (artifact 2 §1.3 ii) | P0-3 pattern | every outreach count becomes true |
| 10 | F-7: explicit `messageClass` for operator replies **after counsel answers** the STOP/quiet-hours question | counsel | the daily-use action reports its own outcome |
| 11 | F-18: nexus audit — build the worker (a cron that pulls `pending`, runs the judge, writes a verdict) **or** delete the enqueue | nothing | AI-SMS QA becomes real or stops pretending |
| 12 | F-23: notify advisor on `decideItem` (Telegram + SSE `inspection_decided`) | nothing | the one working authorization loop closes |
| 13 | F-16: retire `vehicles`; retype `work_orders.vehicle_id` → int FK `customer_vehicles.id`; backfill from free-text where a phone-linked vehicle exists | prod row count on `vehicles` (expected 0) | unblocks VIN decode and any vehicle history |
| 14 | F-9: rethrow in the ~30 remaining cron catches; extend `cron-rethrow.test.ts` | nothing | crashes become `failed` rows with error text |
| 15 | `CRON-INVENTORY.md` generated from `getJobCadences()`; `opsRegistry` entries must cite a test or be deleted | nothing | claims stop drifting |
| 16 | F-21: per-call LLM ledger table + insert at `invokeLLM` | nothing | AI cost and error rate become visible |
| 17 | IA: sidebar doors for `callTrackingView` and `trafficFunnel` (or merge per §3); bring `/admin/ad-studio` inside the shell | nothing | nothing reachable only by URL on the iPhone |

### P2 — later

Estimate authorization artifact (signature + snapshot PDF + advisor notify + WO line) · vPIC
decode after F-16 · Settings/System split · `campaigns` split/rename · SMS eval corpus seeded
from `sms_learning_recommendations` · F-13 front-desk permission decision · F-15 deletion path
if counsel says one is required · retention policy for the 119 unbounded tables · F-19 tire
order status history with actor.

### P3 / never — see §8.

---

## 8. What should explicitly NOT be built

- **A scheduler, calendar, bay board, or technician dispatch.** The business rejected it on
  purpose (§0). The Arrival Load strip is the right artefact for a FCFS shop.
- **A supplier ordering integration** without a supplier that offers one. Record the human
  claim honestly (actor + time + ref) instead.
- **A search engine, FTS index, or vector search for the admin.** `LIKE` over ~3k customers is
  fine; add the `phone10` fast path and stop.
- **Offline mode.** The SW is network-first by decision; an offline admin that can lie about
  "sent" would be worse than no admin.
- **A second job system, a second SMS provider path, a second audit ledger, a second vehicle
  table.** Every one of these already exists in duplicate somewhere in this codebase; the work
  is subtraction.
- **More dashboards.** `intelligence` (38 KB, 4 procedures, five war-room panels) is the
  cautionary example: reads that could live on Today, given a room of their own.
- **A universal "Approvals" gate over operator clicks.** Operator intent is consent; the gate
  belongs on AI-originated and machine-originated sends (F-20), not on the front desk.

---

## 9. Red team — where these recommendations are most likely wrong

| Recommendation | Strongest objection | What evidence settles it |
|---|---|---|
| F-1/F-6 are 🔴 | the flags may be ON in prod and the sends may be succeeding, in which case the counters are merely imprecise | P0-1 and P0-2 — four reads and four counts |
| F-8 duplicate rows | if the thread showed every reply twice, the operator would have reported it — so something I did not find dedupes | open one thread in real Chrome; if single rows, find the dedupe before touching the router |
| Merge `growth` + `content` | the `content` entry's comment says the *word* collided, not the function — the maintainer deliberately kept them apart | a JTBD interview with the operator: does one person do both jobs? |
| Delete/rework `intelligence` | `viewer` role can only see `overview`, `intelligence`, `opsHub` — it may exist *for* that role | who holds `viewer` in prod; if nobody, the objection is empty |
| F-20 via proposals | the operator may *want* the GPT to send unattended (it is his own GPT) | ask; the kill criterion in P0-6 already covers the alternative |
| "No offline" | a shop with one wifi router has outages | count blank-page incidents since 2026-08-01 in Sentry |
| DVI signature is P2 not P1 | if authorization disputes are a real cost, this is the highest-leverage item in the document | the operator's own count of "I never approved that" conversations |

---

## 10. The thesis

**Nick's Tire already has most of a serious shop operating system. What it lacks is not
surface area — it has 17 sections, 703 procedures, 146 tables and 52 crons — but closure.**
The best subsystems in this codebase (Meta publish with `ambiguous`, unpaid-invoice recovery
with attempted/sent, the SMS reply hybrid with `planViolations`, the proposal state machine,
the registry with tests that fail when it lies) all share one property: **the receipt is
written from the outcome, not from the intent.** Everywhere the admin misleads — follow-ups,
estimate follow-up, campaign counts, operator replies, tire-order status, the "fully wired"
audit, the "no send path" registry entry, the "Approvals" label — the receipt was written from
the intent.

So the smallest coherent shop OS is not a redesign. It is: **make every receipt true**
(§7 P0/P1), **delete the duplicates** (vehicles, ledgers, the second registry, the orphan
pages), **close the one authorization loop that already exists** (DVI → notify → sign →
snapshot), **put the AI's one unsupervised send under the gate that was built for it**, and
**give the operator a nav where nothing is reachable only by URL.** Zero new runtime
dependencies. Nothing here requires a bay board, a search engine, or a framework — and the
evidence for each item is a file and a line, not a screenshot of a competitor.

---

## 11. Cut from this artifact, with reasons

| Cut | Why |
|---|---|
| Wireframes, visual system, density modes, motion, typography | Opinion with no rendering to anchor it; and the brief's own warning about AI-slop aesthetics applies to a document that would specify them blind |
| Page-by-page redesign of all 17 sections | The decision table (§3) is the honest granularity without a live UI; per-page redesign needs the rendered thing |
| Accessibility (WCAG 2.2) audit | Requires DOM. The client has a lint ban on native dialogs and an `igAdminMobile.test.ts` / `mobileErgonomics.test.ts` pair — cite, don't guess |
| Performance budgets | Requires runtime. Facts recorded: admin code-split (`vite.config.ts:67-89`), 1.7 MB single chunk fixed May 2026, `/api/cwv` telemetry exists, `/api/trpc` rate limit incident 2026-07-20 |
| Full threat model (assets × actors × entry points) | Artifact 2 §4 covers the verified surface; a STRIDE pass needs the two bridges read route-by-route (NOT INVESTIGATED) |
| Integration ownership / reconciliation matrix | **Already exists — do not rebuild.** `docs/integrations/INTEGRATION_REGISTRY.md`: 14 integrations × purpose / required secrets / flag-or-trigger / owner / fallback / risk-if-down, with an "update in the same PR" rule. One row is likely stale against code: it lists Twilio as *"Fallback SMS + bulk/marketing campaigns"*, while `routers/campaigns.ts:500` sends campaigns `via: "shop"` and the code comments call Twilio dead. Reconcile that row; the matrix itself is the right artefact. |
| Competitor tour beyond §4 | By design — see §4's last paragraph |
| Experiments design | No outcome ledger for the AI lanes exists yet (F-21/F-22); designing experiments on an unmeasured system produces the confident-filler the brief forbids |
| Migration/backfill runbooks | F-13 and F-16 need prod row counts first |

---

## 12. Correction ledger — final

Artifacts 1–3: **11 corrections logged on ~35 candidate findings**; raw detector false-positive
rate 50 % (table writers) and ~30 % (name-based procedure scan) before falsification; two
avoided false positives were of the exact shape the sibling StateNour audit shipped (RBAC
unenforced; Twilio unsigned). Every finding numbered F-1…F-23 survived a falsification pass
whose method is recorded beside it. Runtime facts are marked NOT VERIFIED throughout, and the
four production reads in §7 P0-1 are the first thing that should happen next.

**Correction #11 — found by auditing my own citations, after the artifacts were written.**
A hostile re-check of 18 load-bearing `file:line` references against `origin/main` failed 5.
Three shared one cause: `shared/adminPermissions.ts` and `_core/trpc.ts` had been read through
`sed | grep -v` (comments stripped) and the *filtered ordinals* were cited as file lines. Two
were off-by-one from a windowed read. Because the cause is a read *pattern*, every citation
produced by it could be enumerated rather than sampled; all were re-fetched with `grep -n` and
corrected in artifacts 1–3 (`follow-ups.ts:84`, `FollowUpsSection.tsx:43`,
`adminPermissions.ts:146-155 / :158 / :162-165 / :24`, `trpc.ts:218-222 / :228-229`,
`customers.ts:111-115`, `customerMessageTemplates.ts:216-217`, `_core/index.ts:1104`). No
finding changed; every token was present in the named file. **Base rate, per
`base-rate-check`:** the 18 were chosen as load-bearing, not at random, so 5/18 is not the rate
across the ~150 citations in these documents — but the enumerated cause covers the only read
pattern that loses line numbers, so the remaining citations came from `grep -n` or unfiltered
`sed -n` and carry their numbers by construction.

**Detector base rates, stated with their denominators:** the table-writer detector flagged
6 of 146 tables (4.1 %); 3 of 146 (2.1 %) were confirmed — the "50 % false positive" is a
property of the flagged set, not of the schema. The prior-audit citation rot (4 of 22, 18 %) is
over *all* of that document's procedure citations, not a filtered subset.
