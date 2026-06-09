# Nick's Tire — Production Intelligence & Revenue-Ops Hardening

**Date:** 2026-06-09 (evening)
**Worktree/base:** `nickstire-production-intelligence-hardening` off `origin/main` `96a66a1c`
**Method:** Phase-0 live production verification (authed admin + public site on the fresh container) → Phase-1 six-cluster read-only gap audit (6 parallel agents + completeness critic, every claim file:line-cited) → Phase-2 ranked build set (4 builds) → built + gated. Claims tagged [VERIFIED-LIVE] (seen in prod this session) or [CODE] (read in repo).
**Core question:** what still prevents the owner from seeing and acting on real money signals?

---

## 1. Production verification (Phase 0) — what is LIVE on `96a66a1c`

Container `9e11ff0b` swapped in at 18:45; health healthy, DB up; all 7 public routes + /admin = 200.

| Wave | Status | Evidence |
|---|---|---|
| Public UI quality pass (`32a02729`) | **LIVE** | $25 proof qualified ("select 12-inch sizes (most run $40-80 installed)"), no fake ticker content, /areas-served Call/Directions/Schedule CTAs render, consoles clean |
| Lead-source hygiene W1+W2 (`97d63d1f`, `a5d3f04a`) | **LIVE** | Money Risks: 1 callback / LOW, no double-count; PHONE/CALLBACK badges render |
| Lead-source W3 HOLD items (`09df262a..6267cfff`) | **LIVE** | SOURCE HYGIENE strip renders (PHONE 4 · POPUP 3 · FINANCING_PREAPPROVAL 2); voice leads visible + actionable |
| Attribution wave (`4a12a6c2`) + revenue-attribution visibility (`96a66a1c`) | **LIVE** | LEADS BY SOURCE block (direct/untagged 5 · voice-agent 4) + per-lead `voice-agent:vapi-rack-check` chips |
| **Operational flag** | ⚠ | Daily Brief showed **F25e OFFLINE** (SMS gateway phone heartbeat). Not code-caused; operator should check the gateway phone. Also exposed a display gap fixed this wave (see Build 4). |

CTA *click* events were not QA-clicked (tel:/sms: side effects); wiring was verified at that wave's push. No PII observed in any rendered payload.

---

## 2. Master gap table (Phase 1 — 6 clusters, 39 gaps, deduped)

Full agent evidence lives in the session workflow output; this table is the deduped operating view. FIX# marks what this wave built.

| # | Gap | Area | Rev impact | Safety | Type | Disposition |
|---|---|---|---|---|---|---|
| 1 | Same caller double-listed in Priority Queue / NBA hot_lead / Today pills / MorningBrief urgent count; hygiene waves fixed counts but missed the ACTION surfaces | Today/NBA/stats | high | CAREFUL | FIX_NOW | **BUILT (1)** |
| 2 | Ghost lead never closes: `callback.updateStatus` resolves only callback_requests; linked lead stays status=new urgency-4 forever (re-enters queues; stale-SMS cron double-texts) | callback write path | high | CAREFUL | FIX_NOW | **BUILT (2)** — the one small write-path fix, risk-documented §4 |
| 3 | LeadsBrief SLA/at-risk + NOT-YET-CONTACTED banner count callback duplicates | Leads page | medium | SAFE | FIX_NOW | **BUILT (1)** |
| 4 | Traffic funnel: engaged stage counts dup callback leads + booking-auto leads; callbacks in stage 3 AND 4 (numerator+denominator); thresholds keyed to inflated numbers | trafficFunnel.overview | medium | CAREFUL | FIX_NOW | **BUILT (3)** |
| 5 | Hardcoded fabricated "(218 invoices this month)" in the critical Call-tracking-dead alert; real `invoices` var in scope | trafficFunnel alerts | low | SAFE | FIX_NOW | **BUILT (3)** |
| 6 | CallTracking subtitle claims a Twilio status webhook that only logs; "Page" column is actually CTA placement; landingPage shipped-but-never-rendered; uncaptioned last-100 window | CallTrackingSection | medium | SAFE | FIX_NOW | **BUILT (4)** |
| 7 | MorningBrief F25e OFFLINE line gated behind `ovr.length > 0` — quiet night + dead gateway = false all-clear (mechanism = client MorningBrief.tsx:86) | Today brief | high | SAFE | FIX_NOW | **BUILT (4)** |
| 8 | Money-CTA events (directions/sms/tire-quote/booking) locked at name-level totals; sourcePage/landingPage per-row but no per-CTA-page rollup | attribution display | medium | SAFE | FIX_NOW | next wave (one summary card; needs design pass w/ 96a66a1c's new blocks to avoid duplication) |
| 9 | Voice conversion invisible: `vapi_call_logs.convertedToLead/leadId` written but zero read surfaces | Voice section | medium | SAFE | FIX_NOW | next wave |
| 10 | `checkTireStock` (primary rack-check) never stamps `convertedToLead/leadId` on vapi_call_logs (tireInquiry does) | voice write path | low | CAREFUL | FIX_NOW | next wave (write-path; bundle with #9 so the metric it feeds exists) |
| 11 | sourceAttribution 90-day rollups computed server-side on every stats response — render status needs re-verify post-`96a66a1c` (critic) | admin stats | high | SAFE | UNKNOWN | next wave (verify first) |
| 12 | Phone-click landingPage aggregations (top pages for calls) absent | attribution | high | SAFE | FIX_NOW | partially addressed (Build 4 renders per-row); rollup next wave |
| 13 | Voice `successEvaluation` fetched per call row, never rendered (failed-AI-call triage) | Voice section | medium | SAFE | FIX_NOW | next wave |
| 14 | Integration-failure logging unreachable on money paths — Sheets Sync Health reads "Healthy" because nothing can log a failure | reliability | high | CAREFUL | FIX_NOW | next wave (error-path wiring needs its own focused review; do not rush) |
| 15 | Service worker stale-HTML race can pin an error page post-deploy | PWA | medium | CAREFUL | FIX_NOW | next wave (needs local SW testing harness) |
| 16 | Static SPA shell `client/index.html` still says "Used tires from $60" (pre-hydration flash contradicts canonical $25 proof) | public shell | low | SAFE | FIX_NOW | next wave (must regen prerender — weekly CI or manual) |
| 17 | Email vendor-health reads in-memory log, resets per deploy, never checks RESEND_API_KEY | Site Health | medium | SAFE | FIX_NOW | next wave |
| 18 | Cross-channel phone-format mismatch (web `sanitizePhone` vs voice digits-only) weakens cross-channel dedup | write paths | low | CAREFUL | HOLD_RISKY | accepted gap (documented W3); normalize-at-write needs its own wave |
| 19 | Source filter can't isolate PHONE vs CALLBACK (filters raw enum) | Leads UI | low | SAFE | FIX_NOW | next wave (small) |
| 20 | controlCenter decision procedures (~900 lines) have zero in-repo consumers | dead code | low | HOLD | DOC_ONLY | operator decision: wire or delete |
| 21 | Google Reviews card silently substitutes static `BUSINESS.reviews` when live fetch fails | Site Health | low | SAFE | FIX_NOW | next wave (honest empty state) |
| 22 | staleLeadFollowup cron selects status=new with no dup exclusion → double-texts callback submitters (critic catch) | cron | medium | CAREFUL | FIX_NOW | **mitigated by BUILT (2)** (resolved callbacks now leave 'new'); residual: unresolved dups still in 2-24h window — acceptable (person hasn't been called yet) |
| 23 | dashboardSync (15-min Sheets Dashboard tab) repeats every count defect + different revenue definition (critic catch) | cron/Sheets | medium | CAREFUL | FIX_NOW | next wave (align with countActionableLeads + canonical revenue) |
| 24 | Financing Apply-Now writes no DB record (Sheets-only + fabricated-urgency alert) (critic catch) | financing | high | CAREFUL | HOLD_OPERATOR | needs decision: add table (schema) vs reuse leads |
| 25 | Chat transcripts unreachable in admin; non-converted sessions with contact info evaporate (critic catch) | chat | medium | SAFE | FIX_NOW | next wave |
| 26 | Telegram double-alert per web lead (direct + eventBus) (critic catch) | alerts | low | CAREFUL | FIX_NOW | next wave (pick one path) |

### Standing HOLDs (Cluster F — exact unblocks)
- **Meta CAPI** [HOLD_OPERATOR]: `server/meta-capi.ts` is a stub; call sites fully plumbed (eventId, user-data hashes passed). Unblock = `META_CAPI_ACCESS_TOKEN` (+ pixel id confirm) from Meta Business → implement the stub's fetch. No schema.
- **Sheets UTM columns** [HOLD_OPERATOR]: sync fns accept no UTM fields; lead call site has the data in scope. Unblock = owner approves new sheet columns (layout decision), then additive param threading.
- **call_events↔journey join** [HOLD_RISKY]: no eventId/FK in schema; needs migration. Not this wave by boundary.
- **GA4 repointing** [HOLD_OPERATOR]: code side complete (canonical `phone_click`); any owner-saved GA4 report keyed on the legacy event name needs a manual report edit in GA4 UI.
- **Voice dedup / enum remap / hygiene card**: ALREADY_FIXED, verified live this session.

---

## 3. What was built this wave (4 builds, ranked by money-signal value)

**Build 1 — Finish the one-person invariant on ACTION surfaces** (`OverviewSection.tsx`, `today/types.ts`, `intelligence.ts`, `admin-stats.ts`, `LeadsBrief.tsx`, `LeadsSection.tsx`)
Callback-linked duplicate leads (`source='callback' AND callbackId IS NOT NULL`) are now excluded from: the Today Priority Queue, the NBA hot_lead SQL, the Today `new`/`urgent` stat pills (pipeline-state counters stay raw), LeadsBrief uncontacted/SLA/at-risk, and the NOT-YET-CONTACTED banner. Same discriminator as Waves 1–2 (`shared/leadSource.ts`); voice leads (callbackId null) keep counting everywhere.

**Build 2 — Close the ghost lead when its callback resolves** (`callback.ts` updateStatus) — *the one small write-path change*
When a callback is marked called/no-answer/completed, the linked duplicate lead (matched on `leads.callbackId`, **only if still `status='new'`**) flips to `contacted` with `lastFollowUpAt=now`, `contactedBy='callback-resolution'`. FAIL-OPEN: sync errors only log; the callback update always lands.
**Documented risk:** (a) changes `staleLeadFollowup` cron population — resolved-callback ghosts no longer receive the 2–24h auto-SMS. That is the *correct* behavior (the person was just called; pre-fix they got double-texted), but it is a behavior change. (b) Any operator workflow that relied on manually clearing ghost leads sees them pre-cleared. Reversible by reverting one commit; no schema, no deletes, never touches manually-progressed leads, never fires on re-open-to-'new'.

**Build 3 — Traffic-funnel truth** (`trafficFunnel.ts`)
Engaged-stage leads count now excludes callback duplicates and `source='booking'` auto-mirror leads; callbacks counted in ONE stage (stage 4 commitment; removed from stage-3 actions, sub-text says so); the fabricated "(218 invoices this month)" replaced with the in-scope real `${invoices}` count. Stage severities now grade real numbers.

**Build 4 — Call-tracking + brief honesty** (`CallTrackingSection.tsx`, `MorningBrief.tsx`)
Subtitle no longer claims a Twilio status webhook ("rows are tel: clicks… not carrier call logs"); "Page" column renamed **CTA** (it holds placement labels); **Landing Page** column added (field was always in the payload; pathname-rendered via the attribution wave's `normalizePathname`); recent-events header states the row window. MorningBrief: **F25e OFFLINE now renders on quiet nights too** (was gated behind "there were calls" — the exact false-all-clear scenario).

### What was explicitly NOT built (boundaries honored)
No schema/migrations · no CAPI token work · no Sheets columns · no GA4/Meta rewrite · no new dashboard · no public redesign · no customer-contact behavior changes (Build 2 *reduces* an automated double-text; it sends nothing new) · no fake metrics (one fake metric REMOVED) · no prod-data cleanup scripts.

---

## 4. Verification

- `tsc --noEmit` 0 errors · vitest targeted suites 37 passed · `lint:hooks` clean · `pnpm run build` green.
- Boundary greps clean: no schema/.sql/migration, no prerender/SEO/route-registry, no send-call additions/removals, no secret/PII-shaped strings.
- Existing regression nets still green: `lead-source.test.ts` (22) + `money-risks.test.ts` (15) — they pin the discriminator used by every Build-1 edit.
- Honest gaps: funnel math is inline SQL+arith in the router (no cheap pure-fn test seam — extraction was out of scope); Build-2's cron interaction is reasoning-verified, not integration-tested; live admin verification of the new surfaces happens post-push, same protocol as prior waves.

## 5. Risk register
1. **F25e gateway OFFLINE at verification time** — operational; owner should check the gateway phone. The brief now surfaces it even on quiet nights.
2. Build-2 cron interaction (documented above) — watch the first resolved callback post-deploy.
3. Funnel numbers will visibly DROP after Build 3 (they were inflated). This is the truth landing, not a regression — expect "engaged" and stage-4 conversion to shrink.
4. Sheets "Dashboard" tab (dashboardSync) still shows the old inflated counting until gap #23 ships — the admin and the sheet will disagree in the interim (admin is the corrected one).

## 6. Next recommended wave (in order)
1. Voice conversion visibility (#9 + #10 together) — surfaces the rack-check → lead pipeline the prior waves cleaned.
2. dashboardSync alignment (#23) — stop the sheet from contradicting the admin.
3. Attribution snapshot card (#8/#12 rollups) — after re-verifying what `96a66a1c` already renders (#11).
4. Reliability pair: integration-failure wiring (#14) + email vendor-health truth (#17).
5. HOLD_OPERATOR queue for the owner: CAPI token · Sheets UTM columns · financing record decision (#24) · GA4 saved-report edit.
