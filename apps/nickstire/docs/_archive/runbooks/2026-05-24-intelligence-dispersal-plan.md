# Intelligence Page · Dispersal Plan

**Date:** 2026-05-24
**Decision:** Delete the nickstire admin `Intelligence` page entirely. Disperse functionality across (a) statenour surfaces, (b) inline on existing nickstire pages, (c) cut.

**Rationale (operator):** statenour IS the intelligence OS. A separate "be intelligent" page in nickstire is the wrong architecture — it forces the operator to context-switch between shop-ops mode and intelligence mode. Disperse the signal to where it's needed.

**Scope of this session:** audit + plan only. No code execution. The plan below is the execution blueprint for follow-up sessions.

---

## 1 · Current state (verified inventory)

The nickstire `Intelligence` admin section currently has **4 tabs · ~30 panels** (file inventory by agent, line-cited):

> **Memory drift caught:** `MEMORY.md` claims the 4 tabs are `Brain/Funnel/Competitors/SEO Forensic`. **Actual current state** (verified in `client/src/pages/admin/IntelligenceSection.tsx` L26-35) is `Overview / Revenue / Customers / Operations`. The May-19 Elon-cut comment at L5-15 explicitly states Marketing/Growth/Safety were deleted. **MEMORY needs updating** — separate task.

### 1.1 · OverviewTab (`client/src/pages/admin/intelligence/OverviewTab.tsx` · 326 lines)

| Panel | Source query | Bucket |
|---|---|---|
| Business Health Score + 13-component breakdown | `trpc.intelligence.masterReport` | → statenour |
| Top Alert / Opportunity / Risk narratives | `trpc.intelligence.masterReport` | → statenour |
| Revenue Pace stat | `masterReport.revenue.pacing.month` | CUT (MoneyBrief absorbs) |
| Churn Risk count | `masterReport.customers.churnRisk` | CUT (CustomersBrief adjacency) |
| Review Velocity stat | `masterReport.marketing.reviewVelocity` | → statenour |
| New Customers stat | `masterReport.customers.velocity` | CUT (LeadsBrief velocity) |
| Customer Journey Funnel (6-stage) | `masterReport` derived | → statenour (new `/funnel`) |
| NOUR OS Brain card (memories + automation rules + weather) | `trpc.intelligence.autonicksBrainStatus` + `autonicksWeather` | → statenour (it's already a proxy) |

### 1.2 · CustomersTab (189 lines)

| Panel | Source query | Bucket |
|---|---|---|
| LTV Segments (Whales/Regulars/Occasional/One-timers) | `trpc.intelligence.ltv` | CUT (CustomersBrief LTV) |
| Churn Prediction roster (high/medium risk) | `trpc.intelligence.churnPrediction` | inline → nickstire Customers page (roster column) |
| Unified Risk Scores | `trpc.intelligence.riskScores` | inline → nickstire Customers page (merge with churn) |
| Due-Back Predictions | `trpc.intelligence.repeatVisit` | inline → nickstire Customers page OR OutreachBrief |
| Customer Value Trend | `trpc.intelligence.valueTrend` | → statenour brain |
| Service Affinity / Predicted Next | `trpc.intelligence.serviceAffinity` | → statenour brain (cross-sell) |
| First Visit Conversion (rate + bySource + avgDaysToRepeat) | `trpc.intelligence.firstVisitConversion` | → statenour `/funnel` |
| Top LTV Customers | `trpc.intelligence.ltv.topCustomers` | CUT (CustomersBrief) |

### 1.3 · OperationsTab (209 lines)

| Panel | Source query | Bucket |
|---|---|---|
| Shop Load KPIs (Active WOs · Today's Bookings · Est. Wait) | `trpc.intelligence.shopLoad` | inline → nickstire Today page above-fold |
| Tech Efficiency Rankings | `trpc.intelligence.techEfficiency` | inline → nickstire Staff/Operations strip |
| Bay Utilization (occupancy · peak/idle hours) | `trpc.intelligence.bayUtilization` | inline → nickstire Today/Operations |
| Turnaround Times by Service | `trpc.intelligence.turnaroundTime` | inline → nickstire Today (overlaps existing) |
| Parts Cost Analysis | `trpc.intelligence.partsCost` | inline → nickstire Money page |
| Capacity Forecast (tomorrow + next week + staffing) | `trpc.intelligence.capacityForecast` | inline → nickstire Today (tomorrow card) |
| Stage Bottlenecks | `trpc.intelligence.bottlenecks` | inline → nickstire Today/Operations |

> **All OperationsTab content is `SHOP_LOCAL`** — none of it belongs on statenour. It's live floor data for the shop manager · should NOT round-trip through the bridge.

### 1.4 · RevenueTab (337 lines)

| Panel | Source query | Bucket |
|---|---|---|
| Forecast KPIs (Today/Week/Month projection + Trend) | `trpc.intelligence.forecast` | CUT (MoneyBrief covers) |
| MTD progress bar | `trpc.intelligence.forecast` | CUT (MoneyBrief pacing) |
| Revenue Anomalies (spike-or-dip) | `trpc.intelligence.revenueAnomaly` | → statenour brain |
| Cash Flow Forecast (7d/30d + outstanding AR) | `trpc.intelligence.cashFlow` | inline → nickstire Money page |
| Profit Margins by Service | `trpc.intelligence.profitMargins` | inline → nickstire Money page |
| Payment Trends (method mix + financing growth) | `trpc.intelligence.paymentTrends` | inline → nickstire Money page |
| Avg Ticket Trend | `trpc.intelligence.ticketTrend` | CUT (MoneyBrief adjacency) |
| Revenue Concentration (top-10%-customer risk) | `trpc.intelligence.revenueConcentration` | → statenour brain |
| Weather → Revenue Correlation | `trpc.intelligence.autonicksWeather` | → statenour (it's already a proxy) |

---

## 2 · Statenour receiving surfaces (verified inventory)

Top-level routes under `apps/statenour/app/(mastery)/`:

**Live surfaces ready to receive:**
- `/scoreboard` · Phase-A.2 "what matters now" anomalous-on-top KPI cards · `OperatorPulse` · best fit for HEALTH SCORE + ALERTS
- `/cockpit` · Ultron apex dashboard · preserved post-Wave-27
- `/brain` · unified brain (skill library · 8-axis identity · qualitative · beliefs · contradictions · Ghost-Nick · nudges · maturity · pattern card · prediction streaks)
- `/customer-360/[customerId]` · **already wired to nickstire bridge** · single-customer detail with cached `BrainMemory(customer_preferences)`
- `/system` · operator system hub (~37 cards · health · crons · logs · brain-bus)
  - `/system/vapi-calls` · nickstire-sourced VAPI logs
  - `/system/tire-stock-requests` · nickstire-sourced
  - `/system/brain-bus` · cross-app event stream
- `/journal` · thought-capture feed
- `/outreach` · bulk-SMS composer (statenour-side)

**Gaps · need new statenour surfaces:**
- **`/funnel`** · 6-stage Lead→Estimate→Drop-off→Job→Review→Retained · MEDIUM effort
- **`/customers` cohort list** · churn-risk · LTV whales · due-soon · MEDIUM effort
- **`/radar` (competitor + AI-visibility)** · HIGH effort (no Apify pipeline exists yet)
- **`/seo` (GSC + Ahrefs + forensic)** · HIGH effort (no SEO pipeline exists yet)

> **Operations content has NO statenour destination** — that's the intentional split. OperationsTab is shop-local; OPS dispersal targets nickstire's Today/Operations pages, NOT statenour.

---

## 3 · Cross-app data plumbing (the bridge contract)

Statenour ≠ shared TiDB. Each app has its own DB (statenour = Neon/Postgres · nickstire = TiDB Cloud/MySQL).

**The bridge** (`apps/statenour/lib/nickstire/query.ts`):
- `POST https://nickstire.org/api/nour-os/query`
- Header: `x-sync-key: <STATENOUR_SYNC_KEY>`
- Body: `{ query, filters }`
- 12s timeout · 3 retries with exponential backoff
- 200-with-error fallback for unknown actions
- Contract: `apps/statenour/docs/NICKSTIRE-QUERY-CONTRACT.md` v11.4

**Cache layer:**
- `BrainMemory` table on statenour · categories include `customer_preferences`, `location_ranking`, `suggestion_loop`, `tire_stock_request`
- Surfaces read with graceful fallback when bridge is down (`bridgeStatus: ok | degraded | down`)

**Event stream:**
- Durable `brain-bus` table · cursor-tailed at `/system/brain-bus`
- Natural ingestion lane for nickstire→statenour async pushes

**Implication for every "→ statenour" item below:** UI-move-only is NOT sufficient. Each migration requires:
1. **Bridge action** on nickstire side (per `NICKSTIRE-QUERY-CONTRACT.md`)
2. **Cache layer** in `BrainMemory` (optional · for resilience)
3. **Statenour UI** (the receiver)

---

## 4 · Dispersal map · per-bucket summary

### 4.1 · Bucket A · CUT (already absorbed by existing nickstire briefs)

Just delete · no migration · no plumbing.

- `Revenue Pace stat` (Overview) — MoneyBrief velocity
- `Churn Risk count` (Overview) — CustomersBrief adjacency
- `New Customers stat` (Overview) — LeadsBrief velocity
- `LTV Segments` (Customers) — CustomersBrief LTV roster
- `Top LTV Customers` (Customers) — CustomersBrief
- `Forecast KPIs` + `MTD progress bar` (Revenue) — MoneyBrief velocity+pacing
- `Avg Ticket Trend` (Revenue) — MoneyBrief adjacency

**Net: ~7 panels cut · ~150 LOC removable from Intelligence tabs alone.**

### 4.2 · Bucket B · Inline on existing nickstire page

No statenour involvement. Move data inline onto the relevant nickstire admin page.

| Source | Destination | Approx LOC |
|---|---|---|
| Churn Prediction roster (Customers tab) | nickstire Customers page · merge with row roster | ~60 |
| Risk Scores (Customers tab) | nickstire Customers page · same column as churn | ~30 |
| Due-Back Predictions (Customers tab) | nickstire Customers page OR OutreachBrief | ~40 |
| Shop Load KPIs (Operations tab) | nickstire Today above-fold | ~50 |
| Tech Efficiency Rankings (Operations tab) | nickstire Today/Operations strip | ~60 |
| Bay Utilization (Operations tab) | nickstire Today | ~40 |
| Turnaround Times (Operations tab) | nickstire Today | ~30 |
| Capacity Forecast (Operations tab) | nickstire Today · tomorrow card | ~40 |
| Stage Bottlenecks (Operations tab) | nickstire Today/Operations | ~40 |
| Parts Cost Analysis (Operations tab) | nickstire Money page | ~40 |
| Cash Flow Forecast (Revenue tab) | nickstire Money page | ~50 |
| Profit Margins by Service (Revenue tab) | nickstire Money page | ~50 |
| Payment Trends (Revenue tab) | nickstire Money page | ~40 |

**Net: ~13 panels moved inline · ~570 LOC of mostly-existing UI re-homed.** Each move is a copy-paste with light import-rewiring · no new tRPC procedures.

### 4.3 · Bucket C · Migrate to statenour

Each requires bridge action + optional BrainMemory cache + statenour UI.

| Source | Destination | Bridge action | Effort |
|---|---|---|---|
| Business Health Score (Overview) | `/scoreboard` extension | `master_report` | LOW |
| Top Alert / Opportunity / Risk (Overview) | `/scoreboard` `OperatorPulse` | `master_report` | LOW |
| 13-component breakdown (Overview) | `/scoreboard` collapsible | `master_report` | LOW |
| Customer Journey Funnel (Overview) | `/funnel` NEW | `funnel_overview` | MEDIUM (new page + bridge) |
| First Visit Conversion (Customers) | `/funnel` extension | `funnel_first_visit` | LOW (once funnel exists) |
| Service Affinity / Predicted Next (Customers) | `/brain` cross-sell panel | `service_affinity` | LOW |
| Customer Value Trend (Customers) | `/brain` customer-trend panel | `customer_value_trend` | LOW |
| Revenue Anomalies (Revenue) | `/scoreboard` anomaly grid | `revenue_anomaly` | LOW |
| Revenue Concentration (Revenue) | `/brain` concentration-risk | `revenue_concentration` | LOW |
| Review Velocity (Overview) | `/radar` brand panel (NEW) | `review_velocity` | MEDIUM |
| NOUR OS Brain card (Overview) | **DELETE** · it's already a proxy | n/a · UI delete only | LOW |
| Weather → Revenue (Revenue) | **DELETE** · already on statenour | n/a · UI delete only | LOW |

**Net: ~10 panels migrated · 8 new bridge actions · ~3 new statenour pages or sections.**

### 4.4 · Operator decisions (locked 2026-05-24)

Operator answered 3 of 4 open questions explicitly:

1. **`intelligence.masterReport` engine fate** → **KEEP underlying sub-reports.** The umbrella synthesis (score + top alert/opp/risk) moves to statenour `/scoreboard`. The sub-reports (`revenue.pacing` · `customers.churnRisk` · `marketing.reviewVelocity` · `operations.pipeline` · etc.) STAY on nickstire as the underlying data for future improvements. Don't retire the engine — retire only the UI surface that displayed it.

2. **Operations content destination** → **SINGLE STRIP on Today page.** Tech Efficiency · Bay Utilization · Turnaround · Bottlenecks · Shop Load · Capacity Forecast all collapse into one Operations strip above-fold on the Today page. No new `/admin/operations` page. Need a UX pass during Wave 2 to keep Today scannable (it's already absorbing Money/Outreach signal).

3. **Risk + Churn merger** → **ONE COLUMN on Customers roster.** Unified `risk_score` column · churn prediction collapses into it as a sub-signal. Single source of truth · simpler operator mental model.

4. **Service Affinity / Predicted Next-Service** → **STATENOUR BRAIN PATTERN** · operator flagged this needs **extra attention**. Separate research-synthesis pass produced a v2 design doc — see `2026-05-24-service-affinity-v2.md`. Highest-leverage cross-sell signal in the business · merits its own end-to-end design (model + surface + closed loop).

---

## 5 · Suggested execution order (3 waves)

### Wave 1 · Easy wins · ~1 session
1. CUT bucket (7 panels · pure deletes · zero risk)
2. Delete NOUR OS Brain card (it's a proxy)
3. Delete Weather → Revenue (it's a proxy)
4. Bridge contract: ship `master_report` action on nickstire side
5. Statenour: extend `/scoreboard` with health-score + top alert/opp/risk cards
6. Update MEMORY.md (drift bug — tabs are Overview/Customers/Operations/Revenue, not Brain/Funnel/Competitors/SEO)

**Outcome:** Intelligence Overview tab shrinks to ~30% size. Score signal now lives on statenour `/scoreboard`.

### Wave 2 · Inline absorption · ~2 sessions
1. Migrate all Customers-tab churn/risk/due-back into nickstire Customers page roster
2. Migrate Operations-tab content into nickstire Today page (above-fold + operations strip)
3. Migrate Revenue-tab cash-flow + profit-margins + payment-trends into nickstire Money page (extend the 5 existing tabs)
4. **Delete the Intelligence Customers, Operations, Revenue tabs entirely**

**Outcome:** Intelligence section is down to Overview tab only · ~80% of code removed from nickstire.

### Wave 3 · Statenour gap surfaces · ~3-5 sessions
1. Ship `/funnel` on statenour (new page · 6-stage conversion · bridge: `funnel_overview` + `funnel_first_visit`)
2. Migrate Customer Journey Funnel + First Visit Conversion from Overview to `/funnel`
3. Ship `/customers` cohort list (3 tabs: At Risk / Whales / Due Soon · bridge: `customers_churn_risk` + `customers_whales` + `customers_due_soon`)
4. Ship statenour `/brain` extensions: cross-sell (service affinity) · customer value trend · revenue concentration · revenue anomalies
5. **Delete the entire IntelligenceSection from nickstire admin**

**Outcome:** Intelligence page is gone. Statenour now hosts cohort + funnel + brain surfaces. Bridge contract grows by 7 actions.

### Wave 4 (deferred · operator opt-in) · `/radar` + `/seo`
- Build statenour `/radar` (competitor + AI-visibility + SOV) — requires Apify pipeline migration · HIGH effort
- Build statenour `/seo` (GSC + Ahrefs + forensic) — requires bridge for nickstire-side SEO data
- Not blocking · these have no current home in either app · "build it when there's time"

---

## 6 · Code surface changes

After all 3 waves:

**Nickstire deletions:**
- `client/src/pages/admin/IntelligenceSection.tsx` (69 LOC)
- `client/src/pages/admin/intelligence/OverviewTab.tsx` (326 LOC)
- `client/src/pages/admin/intelligence/CustomersTab.tsx` (189 LOC)
- `client/src/pages/admin/intelligence/OperationsTab.tsx` (209 LOC)
- `client/src/pages/admin/intelligence/RevenueTab.tsx` (337 LOC)
- `client/src/pages/admin/intelligence/utils.tsx` (115 LOC)
- Plus the `intelligence` AdminSection type entry in `shared.tsx`
- Plus the sidebar link · Cmd+K entry · URL alias

**Net nickstire reduction: ~1245 LOC + section/route/Cmd+K plumbing.**

**Nickstire additions (inline):**
- ~570 LOC re-homed onto Today / Money / Customers pages (mostly copy-paste from the tabs)
- ~5-7 new tRPC bridge action handlers under `server/routers/nourOs/`

**Statenour additions:**
- ~4 new pages (`/funnel`, `/customers`, optionally `/radar`, `/seo`)
- `/scoreboard` extension (~4 KPI cards + OperatorPulse keys)
- `/brain` extensions (~3 new panels)
- ~8 new bridge actions per `NICKSTIRE-QUERY-CONTRACT.md`
- `BrainMemory` category additions

**Net codebase shape:** -1245 LOC nickstire · +~800 LOC statenour · = ~445 LOC of pure deletion · plus a cleaner mental model.

---

## 7 · Risks + open questions

1. **MEMORY.md drift** — the memory note about Intelligence tabs is outdated by 6 months · indicates other memory entries may have drifted too. Worth a sweep before Wave 1 ships.

2. **`masterIntelligence` engine** — moving the synthesizer to statenour means the LLM-driven narrative ("top alert · top opportunity") might shift voice. Worth a side-by-side comparison before swapping.

3. **Inline absorption risk** — Today page is already busy. Stacking Operations content on top may overflow. Phase 3 needs a separate UX pass to make sure Today stays scannable.

4. **Bridge dependency** — every "→ statenour" item assumes the bridge is up. If `bdnick.info` is down, statenour surfaces show stale data. Phase 3 surfaces should gracefully degrade like `customer-360` already does.

5. **Operator workflow change** — current operator habit may be "go to Intelligence for the daily check-in". Dispersing this signal means re-training muscle memory. Could shape Wave 1 as "Intelligence becomes a passthrough to /scoreboard" so the URL still works.

---

## 8 · Next session triggers

When operator says "execute the intelligence dispersal":

1. Re-load this doc
2. Confirm Wave 1 scope (CUT bucket + Brain/Weather deletes + master_report bridge action + /scoreboard extension)
3. Dispatch the same 3-agent verify pattern on the deletes before shipping
4. One commit per Wave · clean revert points

---

**Source agents:** infinite-gratitude parallel dispatch · 2 read-only research agents.
**Synthesis:** research-synthesis applied to merge nickstire inventory + statenour surface map into actionable plan.
**Verification:** every panel claim, every statenour route, every bridge contract claim was spot-checked against actual file content before inclusion in this doc.
