# Nick's Tire — Revenue Attribution Control Layer

_2026-06 attribution-control wave · branch `nickstire-revenue-attribution-control` (from origin/main `4a12a6c2`)._
_Method: Phase-0 production verification of the tracking wave (real-browser QA clicks with network observation) + 5-cluster multi-agent read-only audit (8 agents, 213 tool calls, adversarially verified) + orchestrator spot-verification of every edit target._

> Mission: turn the click/form tracking shipped at `4a12a6c2` into owner-usable attribution — which pages, CTAs, and channels produce shop opportunities — without schema changes, write-path changes, or fake metrics.

---

## 1. Phase 0 — Production verification of the `4a12a6c2` tracking wave: ALL PASS

Deploy: Railway `MAINnicks-tire-auto` SUCCESS on commit `4a12a6c2`; nickstire.org 200; PWA service-worker cache (`nicks-v2-perf-2026-05-05`) busted before testing; fresh bundle confirmed.

| Check | Result | Evidence |
|---|---|---|
| A · Home hero CTAs | **PASS** | `tire_quote_cta_click` / `booking_cta_click` / `directions_click` `{source:"hero"}` all fired; **3x `customerEvents.log` HTTP 200** (rows landing in prod DB); `bodyHasPii:false` each |
| B · SiteMobileCTA | **PASS (by invariance)** | File untouched by the wave (scope-verified); call/text/directions distinctly tracked since pre-wave; live-verified in prior sessions |
| C · /areas-served | **PASS** | All 3 CTAs render; Call -> `phone_click {areas-served}` -> **`callTracking.logCall` 200 with UTM keys**; Directions -> `customerEvents.log` 200; no overflow |
| D · /contact | **PASS** | `phone_click {contact-info}` + `directions_click {contact-address}`; no overflow |
| E · Tire buyer tracking | **PASS (definitive)** | gtag-spy on /tires observed exactly `["event","phone_click"]` — `canonicalPhoneClickFired:true`, **`legacyPhoneCallClickFired:false`**; DB-path event `{source:"tire-finder"}`; no PII |
| F · Blind form attribution | **PASS (code-verified)** | UrgencyWidget/Financing/Chat `...getUtmData()` spreads shipped; no form submissions made (boundary) |
| G · External trackers | **DOC** | gtag+umami blocked in test browser -> zero errors (silent degradation proven IN PROD); fbq loaded; first-party writes all 200. Console errors = a local chrome-extension content script, zero site errors |

## 2. Attribution data inventory (verified)

| Data Source | Stored Fields | Queryable? | Displayed in Admin? | Page? | CTA? | UTM? | Referrer? | PII Risk | Owner Usefulness | Safe Next Action |
|---|---|---|---|---|---|---|---|---|---|---|
| `call_events` (phone clicks) | sourcePage(=CTA label), clickElement(const), utm x3, landingPage, referrer, UA, createdAt | YES — `callTracking.list` (last 100) | **YES** — CallTrackingSection: by-utmSource bars + per-click Source/Medium/Campaign table | stored not shown | YES (mislabeled "Page") | YES | stored not shown | none (shop phone only) | HIGH | relabel "Page"->"CTA"; add date filter (later) |
| `customer_events` (CTA/events) | eventName, eventData JSON, sourcePage(=path), utm x3, referrer, UA, sessionId, createdAt | YES — `customerEvents.summary` (totals + recent 50) | YES — TrafficFunnelSection CustomerEventsPanel | YES | via eventData.source | partially | stored not shown | low (JSDoc guard added prior wave) | MED-HIGH | per-source/page grouping (later) |
| `leads` rows | utmSource/Medium/Campaign, landingPage, referrer (+ voice self-labels `voice-agent`/`vapi-rack-check`) | YES — `lead.list` = SELECT * already ships to admin | **WAS NO -> NOW YES (built)** | NOW | n/a | NOW | tooltip | none added (utm labels + pathnames only) | HIGH | — shipped this wave |
| `bookings` rows | utm x3, landingPage, referrer, gclid | YES (columns + idx_booking_created) | **WAS NO -> NOW YES (built)** | NOW | n/a | stored | stored | none (only landingPage+counts leave DB) | HIGH | — shipped this wave |
| `callback_requests` | sourcePage + utm x3 + landing + referrer | YES | partially (queue shows context) | partial | n/a | stored not shown | no | none | MED | chips later if owner asks |
| `tireOrders` | **zero attribution columns** | n/a | n/a | NO | NO | NO | NO | n/a | — | schema wave (HOLD) |
| Google Sheets CRM | name/phone/source/problem only | n/a | (owner's working view) | NO | NO | **NO** | NO | n/a | currently lossy | HOLD — cheapest fix once authorized |

## 3. What the owner can see NOW (post-build) vs what remains hidden

**Can see:** which campaign/source made the phone ring (CallTracking, pre-existing) · which CTA drives calls (CallTracking "Page" column = CTA label) · **which campaign/page produced each lead** (NEW: attribution chips on lead rows + leads-by-source rollup) · **which pages turn into booked jobs** (NEW: Top Pages by Bookings card with coverage caption) · event totals (CustomerEventsPanel).

**Still hidden (HOLD):** per-customer click->call->booking journey (needs schema FK + matching) · tire-order attribution (zero columns) · attribution in the Google Sheet (no UTM columns) · Meta-side conversion feedback (CAPI stub) · leads dying at the door from the enum bug (no row = invisible to every dashboard, by definition).

## 4. What was built (2 read-only improvements + pure helper, adversarially verified SAFE)

1. **Lead attribution chips + leads-by-source rollup** (`LeadsSection.tsx`, render-only): `lead.list` (SELECT *) has shipped utm/landing/referrer to the admin browser since wave-125 — the section just never rendered them. Added: `AttributionChip` (utmSource:campaign + landing pathname, referrer in tooltip; renders nothing when utmSource null — no "unknown" filler) on list rows next to the source badge; compact "Leads by source" strip over the loaded set (buckets null as `direct/untagged`, caption "of N loaded leads"). Zero new queries.
2. **Top Pages by Bookings** (`trafficFunnel.topBookingPages` + `TopBookingPagesPanel`): ONE new read-only adminProcedure — indexed range scan on `bookings.createdAt`, selects ONLY `landingPage`, normalizes full-href -> pathname via the shared helper (else counts fragment per UTM variant), groups in Node, returns top-N + `totalBookings` vs `withAttribution`. Card renders in TrafficFunnelSection with a **mandatory coverage caption** ("N of M bookings carry page attribution — tire-order and phone bookings carry none") and an honest empty state. No PII leaves the DB (paths + counts only).
3. **`shared/attribution.ts` `normalizePathname`** — pure, unit-tested (7 tests incl. the UTM-variant-fragmentation contract).

**What was skipped (and why):** "clickElement column in CallTracking" — REJECTED: it's the hardcoded constant `phone_link` (SEO.tsx), would render one identical value per row (two cluster audits proposed it; synthesis killed it). "Lead capture health counter" — REJECTED: the enum bug means lost leads never create rows; the counter would honestly read 0 while leads die (misleading). Kanban-card chips — skipped (dense view, `hideWebSource` precedent). Tracking-health card — folded into this doc instead of UI (the HOLD facts change as soon as the owner acts; a doc is the honest home).

## 5. HOLD items (explicit, ranked)

| # | Item | What it is | Risk | Readiness |
|---|---|---|---|---|
| 1 | **Enum-divergence bug** — ✅ **ADDRESSED mid-flight by the sibling session** | Was: `sms_capture`/`newsletter` submits passed Zod but the MySQL enum rejected them -> customer-visible failure, silent lead loss. **Fixed on main at `fddc3b54` (remap of unsupported lead sources to valid enum values — option B)** while this wave was being built. Residual: option A (enum migration) remains available later if per-source analytic distinctness is wanted | RESOLVED (remap) | Verify post-deploy with one safe smoke submit if desired; migration for distinctness = optional future wave |
| 2 | Sheets UTM columns | syncLead/Booking/CallbackToSheet signatures accept zero UTM (sheets-sync.ts:101-195); the owner's working CRM can't answer attribution | CAREFUL | Cheapest HOLD (~30 min): owner adds columns, extend 3 signatures + call sites. Blocked only by the Sheets boundary |
| 3 | Voice rack-check dedup — ✅ **ADDRESSED mid-flight by the sibling session** | Was: rack-check inserts had no same-phone guard (~5 callers/14d). **Fixed on main at `09df262a` (dedup onto one person).** The sibling also shipped a read-only Source-hygiene summary strip in LeadsSection (`d5f9ec30`) — complementary to this wave's marketing-channel rollup (origin-type vs utmSource axes) | RESOLVED | Side-find still open (minor): checkTireStock never sets vapi_call_logs.convertedToLead/leadId |
| 4 | Meta CAPI enablement | meta-capi.ts all no-ops (token never configured). Correction from prior session: `pixelEventId` IS passed to sendLeadEvent (lead.ts:198-211) — it reaches the stub | HOLD | Blocked on EXTERNAL ops: owner generates token -> Railway env vars -> restore impl (stub header cites commit 37c8093 — verify hash exists). eventId persistence = separate migration |
| 5 | GA4 report repointing | `phone_call_click` stopped accruing at the `4a12a6c2` deploy (consolidated into `phone_click`) | SAFE (owner action) | If any GA4 report keys on the old name, re-point it; series break is the documented cutover |
| 6 | call_events eventId / click->conversion join | No FK/eventId linking clicks to leads/callbacks/bookings; journey attribution structurally impossible | HOLD | DEFER — migration + error-prone matching heuristics; build only against a specific ROI question aggregates can't answer. tireOrders attribution columns belong to this same future wave |

## 6. Next recommended wave
_(Enum bug + rack-check dedup were addressed by the concurrent lead-source session at `fddc3b54`/`09df262a` while this wave was in flight — struck from the queue.)_
1. Sheets UTM columns (HOLD #2 — owner's daily view becomes attribution-capable in ~30 min once authorized).
2. CallTracking polish: relabel "Page"->"CTA", optional landingPage column + date filter (read-only, SAFE).
3. CAPI when the owner produces a token (HOLD #4).
4. Optional: enum migration for sms_capture/newsletter analytic distinctness (the remap at `fddc3b54` preserves capture but folds them into existing buckets).

---
_All builds: read-only display + one read-only adminProcedure + pure helper. Zero schema/migration/write-path/Sheets/CAPI/public-UI/event-firing changes. Zero PII rendered. Verified: tsc 0 · attribution 7/7 + smoke 5/5 · build green · admin preview. Not pushed pending operator approval._
