# Nick's Tire — Lead-Source Hygiene Audit

**Date:** 2026-06-09
**Worktree / base:** `nickstire-lead-source-cleanup-audit` off `origin/main` `5c1c1951` (Wave-2 money cards present)
**Scope:** `apps/nickstire` — why callers / callback requests / voice-agent calls create duplicate "people" across Leads, Callbacks, and the admin money-risk surfaces.
**Method:** 4 parallel read-only audit agents + direct code verification of every load-bearing claim. Every claim below is tagged **[VERIFIED]** (I read the exact code) or **[CLAIM]** (agent-reported, not independently re-read).
**Stance:** operator-first, cash-register/data-quality, skeptical. Protect lead capture + callback capture above everything.

---

## 1. Bottom line

The admin double-counts the same caller. One web callback submission writes **two** rows — a `callback_requests` row **and** a `source="callback"` row in `leads` (linked by `leads.callbackId`). The **Today's Money Risks** card then counts that person **twice**: once as a "stale lead" and once as a "callback waiting." Voice-agent rack-check calls add *more* `source="callback"` leads with **zero dedup**. Source labels in the Leads list don't distinguish a callback artifact from a real website lead.

**Fix shipped this wave (SAFE, client-only, no DB/migration/prod-data change):** a pure lead-source classifier + a Money-Risks counting fix that excludes the *linked-duplicate* callback leads (the ones already counted as callbacks) while still counting voice rack-check leads (which have no callback row) — plus distinct source badges in the Leads list. Backend write behavior was **left unchanged** (Option B held — real consumers depend on the lead row).

---

## 2. The `leads.source` enum + link fields  [VERIFIED]

`apps/nickstire/drizzle/schema.ts:100`:
```ts
source: mysqlEnum("source", ["popup","chat","booking","manual","callback","fleet","financing_preapproval","sms","careers"]).default("popup").notNull(),
```
`schema.ts:136-138` — pipeline link FKs (plain int columns, no FK constraint; indexed at 147-149):
```ts
callbackId: int("callbackId"),
bookingId: int("bookingId"),
invoiceId: int("invoiceId"),
```
`callback_requests` is a **separate physical table** (`schema.ts:617-641`), its own status enum `["new","called","no-answer","completed"]`, indexed on `status`. There is **no UNIQUE constraint on phone** in either table — no DB-level dedup backstop.

---

## 3. Every writer into `leads` (full census)  [VERIFIED — all 10 sites read]

| # | Writer (file:line) | Trigger | source | Dedup | Sets callbackId | Classification |
|---|---|---|---|---|---|---|
| 1 | `server/routers/lead.ts:100` (`lead.submit`) | All website lead forms (popup, landing, careers, financing, fleet page, text-me-quote, newsletter, estimate) | client input | **5-min same-phone** (`lead.ts:91-98`) | no | TRUE_LEAD |
| 2 | `server/routers/chat.ts:66` | AI chat detects appointment intent | `chat` (hardcoded) | none | no | TRUE_LEAD |
| 3 | `server/routers/messengerBot.ts:110` | FB Messenger keyword match | `chat` (hardcoded) | none | no | TRUE_LEAD |
| 4 | `server/routers/fleetRouter.ts:28` | Fleet inquiry endpoint | `fleet` (hardcoded) | none | no | TRUE_LEAD |
| 5 | `server/routers/public.ts:101` | Labor-estimate form | `popup` (hardcoded; mislabeled — emits `estimate` on the event bus) | none | no | TRUE_LEAD |
| 6 | `server/services/smsResponseParser.ts:196` | Inbound SMS price Q (flag `sms_auto_quote`) | `sms` (hardcoded) | none | no | TRUE_LEAD |
| 7 | `server/services/workOrderAutomation.ts:216` | `booking_created` event | `booking` (hardcoded) | **5-min same-phone** | no (despite being booking-originated) | TRUE_LEAD |
| 8 | `server/routers/callback.ts:93` (`callback.submit`) | Website "Call Me Back" form | `callback` | **5-min same-phone** (`callback.ts:76-84`); on hit, stamps callbackId on existing lead | **yes** (`:100`) | OPERATIONAL_CALLBACK → **duplicateLink** |
| 9 | `server/routers/voiceAgent.ts:571` (`tireInquiry`, rack-check only) | VAPI voice-agent call | `callback` | **none** | no | PHONE_CALL |
| 10 | `server/routers/voiceAgent.ts:866` (`checkTireStock`) | VAPI voice-agent call | `callback` | **none** | no | PHONE_CALL |

**`callback_requests` writers (NOT leads):** `callback.ts`→`createCallbackRequest` (`db.ts:405`, always, no dedup); `voiceAgent.ts:275` (`escalate`); `voiceAgent.ts:920` (`scheduleCallback`). **`vapi_call_logs` writer:** `routes/webhooks/vapi.ts:507` (UNIQUE on `vapiCallId`; never sets `callbackId`).

---

## 4. Exact cause of caller/callback pollution  [VERIFIED]

### 4a. The double-count (the money-surface defect)
`Today's Money Risks` = pure fn `deriveMoneyRisks(leads, callbacks, now)` (`client/src/pages/admin/today/moneyRisks.ts:90-133`), fed by `getOverviewMediumBundle()` (`server/services/adminBundle.ts:66-81`) which returns **both** `listLeads()` (`SELECT * FROM leads … LIMIT 1000`, **no source filter** — `adminBundle.ts:50`) and `getCallbackRequests()`.

- Leads loop (`moneyRisks.ts:104-111`): counts `status==="new"` past the 4h SLA → `staleLeadCount`. **Includes `source="callback"` rows.**
- Callbacks loop (`moneyRisks.ts:113-119`): counts `callback_requests` `status∈{new,pending}` past 4h → `callbacksWaitingCount`.
- `totalRisks = staleLeadCount + callbacksWaitingCount` (`:121`); severity escalates at `totalRisks>=2` (medium) / `>=4` (high) (`:124-126`).

A web callback submission creates **both** a `callback_requests` row and a linked `leads(source=callback, callbackId=set)` row (`callback.ts:54,93-100`). The same person therefore adds **+1 to `staleLeadCount` and +1 to `callbacksWaitingCount`** → counted twice, and inflates severity.

### 4b. Why "just exclude source=callback" is WRONG  [VERIFIED — the key nuance]
`source="callback"` leads have **two distinct origins**:
- **Web callback form** (`callback.ts:93`) → **sets `callbackId`** AND has a matching `callback_requests` row. → genuine duplicate.
- **Voice-agent rack-check** (`voiceAgent.ts:571/866`) → **`callbackId` null**, and **no** `callback_requests` row. → counted only once (as a lead).

Blanket-excluding `source="callback"` would make voice rack-check leads vanish from Money Risks (undercount a real promised callback). The correct discriminator is **`callbackId`**: exclude `source="callback" && callbackId != null` (the *linked duplicate*), keep the rest.

### 4c. Secondary pollution
- **Voice rack-check has zero dedup** (`voiceAgent.ts:571/866`) — repeat calls each insert a fresh `source="callback"` lead.
- **The 5-min window is the only dedup** and only on the `leads` table — a caller who calls, then submits the web form an hour later, gets multiple rows.
- **Same double-count pattern exists server-side** in `morningBrief.ts:49-72` (`pendingCount = pendingLeads + pendingCallbacks`) and `controlCenter.ts:191-209/366-399` — **documented as future work, not fixed this wave** (those feed Nick AI / control-center, higher blast radius).

### 4d. Visibility gap  [VERIFIED]
`lead.list` (`lead.ts:293-297`) = `SELECT * … ORDER BY createdAt LIMIT 1000`, **no filter** → server returns all sources. `LeadsSection.tsx` default `sourceFilter="all"` (`:501`) and the **Kanban view ignores the source filter** entirely. Badges: only `careers` gets a distinct pill (`LeadsSection.tsx:893-901`, `120-124`); every other source renders identical grey `via {source}` — an operator can't tell a callback artifact from a real web lead at a glance.

---

## 5. Source classification table

| Class | Definition (lead-row level) | Money-Risks treatment | Lives in |
|---|---|---|---|
| **trueLead** | `source` ∈ {popup, chat, booking, manual, fleet, financing_preapproval, sms, careers} | counted as stale lead | Leads (default) |
| **duplicateLink** | `source="callback"` **AND** `callbackId != null` (linked to a `callback_requests` row) | **EXCLUDED** (already counted as a callback) | Callbacks (canonical) + Leads (artifact) |
| **phoneCall** | `source="callback"`, `callbackId` null, voice markers (`utmMedium="phone"` / `utmCampaign~vapi`) | counted once (as lead — no callback row exists) | Leads |
| **operationalCallback** | `source="callback"`, `callbackId` null, no voice marker (rare: callback-row insert failed) | counted once | Leads |
| **unknown** | `source` empty/unrecognized | counted (unchanged behavior) | Leads |

Implemented as the pure `classifyLeadOrigin()` in `apps/nickstire/shared/leadSource.ts`.

---

## 6. Fix path — risk classification

| Option | What | Risk | Decision |
|---|---|---|---|
| **A** UI/count exclusion | Exclude linked-duplicate callback leads from money-risk counts | **SAFE** (pure, client) | **SHIPPED** |
| **D** Source visibility | Distinct source badges in Leads | **SAFE** (presentational) | **SHIPPED** |
| **C** Grouping/dedup view | Collapse same-phone lead+callback into one entity | CAREFUL | Future work |
| **B** Stop creating the callback lead row | `callback.submit` writes only `callback_requests` | **CAREFUL/HOLD** | **HELD** — see §7 |

**Why B is held (dependency verdict — [VERIFIED via agent + code]):** removing the `source="callback"` lead row would **break / drop data** in:
- **`server/cron/jobs/staleLeadFollowup.ts:38-46`** — auto-SMS nudge queries `leads status="new"`; callback callers would lose it (though they already get a confirm SMS at `callback.ts:128` — arguably a double-text today).
- **`server/routers/intelligence.ts:62-73`** (NBA `hot_lead`) — callback leads (urgency 4) drive this; they'd drop to the `callback` branch only.
Both are real behavior changes → not a safe pure-backend edit. Held for explicit operator approval.

---

## 7. What was built this wave

1. **`apps/nickstire/shared/leadSource.ts`** — pure, dependency-free classifier (`classifyLeadOrigin`, `isCallbackDuplicateLead`, `isOperationalCallerLead`, `leadSourceLabel`). Shared so client (now) and server (future) use one definition.
2. **`moneyRisks.ts`** — `RiskLead` extended with `source`/`callbackId`/`utm*`; the stale-lead loop now `continue`s on `isCallbackDuplicateLead(l)`. Kills the web-callback double-count; voice rack-check leads still counted. + unit tests proving no double-count.
3. **`LeadsSection.tsx`** — list + Kanban badges now show distinct **CALLBACK** / **PHONE** labels (vs grey `via {source}` for real web leads), so artifacts are obvious. No filtering/hiding changed (a real lead can never be hidden by default).

**Tests:** `lead-source.test.ts` (classifier) + extended `money-risks.test.ts` (double-count regression).

---

## 8. What stayed HOLD / future work

- **Option B** (stop the callback lead-row insert) — needs operator sign-off + cron/NBA migration to read `callback_requests`.
- **Server-side double-count** in `morningBrief.ts` + `controlCenter.ts` — same root cause, same classifier applies; not touched (feeds Nick AI / control center). Recommend a follow-up applying `isCallbackDuplicateLead` server-side.
- **Voice rack-check has no dedup** (`voiceAgent.ts:571/866`) — CAREFUL (touches voice write path).
- **Enum divergence (separate HIGH-severity bug)** — `lead.submit` Zod enum (`lead.ts:41-52`) accepts `sms_capture`/`newsletter` (NOT in the DB enum) and lacks `sms`; `TextMeQuote.tsx:43` + `EmailNewsletterCapture.tsx:48` send them → MySQL coerces to `''` (or errors in strict mode → lost lead). Needs schema migration OR write-time remap — **HOLD** (migration/write-path; verify TiDB `sql_mode` first). Documented, not fixed.
- **Source-hygiene summary card** (read-only counts by source + duplicate-phone overlap) — SAFE, deferred to keep this wave minimal.

---

## 9. Safety / boundaries honored

- No prod data mutation · no migrations · no schema changes · no customer-contact changes · no SMS/email/CAPI behavior changes · no public-form/callback/booking rewrites · no public SEO changes · no auth/RBAC · no destructive actions.
- Backend callback creation **unchanged**. Customer-contact paths **untouched**.
- No secrets / raw payloads / transcripts / customer-sensitive data added to any surface.
