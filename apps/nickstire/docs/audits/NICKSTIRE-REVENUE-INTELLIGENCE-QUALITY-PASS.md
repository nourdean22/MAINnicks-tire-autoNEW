# Nick's Tire — Revenue Intelligence Quality Pass

_2026-06 · branch `nickstire-revenue-attribution-control` (continuation) · base origin/main `96a66a1c`._
_Method: full production verification of the attribution-visibility deploy with the authed operator browser + real shop data, then an operator-lens quality review. The live session surfaced display bugs no code audit had caught._

---

## 1. Production verification of `96a66a1c`: ALL PASS

Railway `MAINnicks-tire-auto` = **SUCCESS** on commit `96a66a1c` · origin/main = `96a66a1c` · public smoke `/` `/areas-served` `/contact` `/tires` `/admin` all **200** · `/api/health` **200** · PWA SW cache (`nicks-v2-perf-2026-05-05`) busted before testing · fresh bundle confirmed.

| Surface | Result | Live evidence (real shop data) |
|---|---|---|
| Leads page (A) | **PASS** | Kanban + list work; PHONE badges render; **Source hygiene strip** live ("PHONE 4 · POPUP 3 · FINANCING_PREAPPROVAL 2"); **Leads by source strip** live ("direct/untagged 5 · voice-agent 4 · of 9 loaded leads"); **4 attribution chips render live** (`voice-agent:vapi-rack-check`); direct/untagged labeled honestly; voice rack-checks clearly marked; no overflow; lead name/phone on rows is the page's purpose, not a leak |
| Traffic Funnel (B) | **PASS** | **Top Pages by Bookings** card renders with the **honest empty state** ("No bookings with page attribution in this window... tire-order and phone bookings never carry it") — truthful: landingPage stamping began when UTM capture shipped; coverage caption correctly renders only with data |
| Tracking sanity (C) | **PASS** | Public pages 200; prior-wave CTA tracking unchanged (verified end-to-end last deploy); third-party net::ERR_FAILED remains DOC-only |
| Admin smoke (D) | **PASS** | Overview fully loads (Daily Brief, pills, **Money-at-Risk card live**: "LOW · 1 callback waiting >4h · Check Callbacks first", NBA, queue 25, Wave-Metric Wins, cohort, activity); Voice loads; Site Health loads (incl. Sheets Sync Health card); Traffic Funnel loads; **zero console errors** |

## 2. Master intelligence findings (live-session)

| Finding | Evidence | Why it matters | Class |
|---|---|---|---|
| **Raw out-of-range urgency scores render as "Score 42/5" / "(34/5 urgency)"** | LIVE: queue rows "Score 42/5, 41/5, 35/5, 34/5, 31/5, 25/5"; NBA "hot lead (34/5 urgency)". Code: OverviewSection detail template + intelligence.ts:68 message — both used raw `urgencyScore`; wave-187 clamped `UrgencyBadge` but missed these two | Nonsense math erodes the owner's trust in the urgency system; also raw 42 fell through `URGENCY_DOTS[42]` to the LOWEST-urgency dot (a 42-score lead displayed as least urgent) | **FIX_NOW — BUILT** |
| **Hygiene strip leaks raw enum (`FINANCING_PREAPPROVAL`)** | LIVE strip text; LeadsSection renders `countsByLabel` keys verbatim uppercase | Developer-speak in an operator surface | **CLARIFY_NOW — BUILT** (underscore -> space at render; enum untouched) |
| **Two adjacent rollup strips, no axis explanation** | "Source hygiene" vs "Leads by source" sit stacked with similar shapes | Operator can conflate origin-type cleanliness with marketing attribution | **CLARIFY_NOW — BUILT** (hover titles: hygiene = how the lead ENTERED; by-source = utm campaign tag; cursor-help) |
| Duplicate popup lead (same name/score, "Andrew Liang" x2, both 2d 2h) | LIVE queue | Two rows beyond the 30-min same-phone dedup window — likely a genuine double-submit; queue shows both | **DOC_ONLY** (lead.ts guard works as designed; widen only if the owner reports noise) |
| Docs post-sibling-wave | Hygiene audit properly struck/annotated (Wave 3 detail at :126-127); my control doc updated mid-rebase; tracking audit HOLDs still valid | No stale-doc risk | **ALREADY_FIXED** |
| Sibling remap preserves origin in utmCampaign | leadSource hygiene doc :127 — sms_capture/newsletter remap stores origin in utmCampaign when no UTM sent | Those leads now surface IN the by-source rollup/chips — the two waves interlock | **ALREADY_FIXED** (verified design) |
| Booking attribution coverage currently 0 in 30d window | LIVE empty state | Honest: stamping is new + recent bookings are tire-order/phone; data accrues from web-form bookings now | **DOC_ONLY** (re-check in 2-4 weeks) |

**Lens verdicts:** Operator usefulness — strips distinct + now self-explaining; <10s readable. Revenue signal — clicks (call_events) / leads / bookings cleanly separated across CallTracking / Leads / Funnel; tire vs general traffic distinguishable via CTA labels (`tire-finder`) + voice campaign tags. Truthfulness — every new surface carries scope captions ("of N loaded", coverage line, honest empties); counts scoped correctly (rollup = loaded rows, labeled; Top Pages = full window query). Lead-source quality — rack-checks deduped (sibling), badged PHONE, self-label `voice-agent:vapi-rack-check`. Reliability — health 200, zero console errors, new query indexed, auth via adminProcedure.

## 3. What was built (3 small fixes, display-only)

1. **Urgency display clamp — queue** (`OverviewSection.tsx`): `Score ${clamp 1-5}/5` + clamped `urgency` field (fixes sort-dot mis-display: out-of-range scores now get the red dot they deserve instead of the fallback gray).
2. **Urgency display clamp — NBA message** (`server/routers/intelligence.ts:68`): presentation-string only; the row's stored score untouched; `urgency` derives from the clamped value (same 1-5 band as before for in-range data).
3. **Strip clarity** (`LeadsSection.tsx`): hover titles on both strip headers (hygiene = "how each lead ENTERED... not marketing attribution"; by-source = "which campaign/channel tag (utm_source)... direct/untagged = no campaign tag") + `cursor-help`; hygiene labels render `_` as space (`FINANCING PREAPPROVAL`).

**Skipped:** any new cards (none needed); popup-dedup widening (operator call); everything in the do-not-build list.

## 4. Remaining HOLD items (unchanged ranking)
1. Sheets UTM columns (~30 min once owner authorizes layout) — the owner's daily CRM is still attribution-blind.
2. Meta CAPI enablement (blocked on owner token; restore from history; then eventId persistence migration).
3. call_events eventId / click->booking journey join (schema + matching heuristics — build only against a specific ROI question).
4. GA4 repointing if any report keys on `phone_call_click` (series ended at the tracking-wave deploy).
5. Minor: checkTireStock doesn't set vapi_call_logs.convertedToLead/leadId (voice path — needs sign-off).
6. Optional: enum migration for sms_capture/newsletter first-class analytics distinctness (remap currently folds them).

## 5. Next 3 recommended waves (ROI x risk)
1. **Sheets UTM columns** — cheapest, turns the owner's working CRM attribution-capable; needs only his column sign-off.
2. **Booking-attribution check-in (2-4 wks)** — once web-form bookings accrue landingPage data, the Top Pages card starts answering "which pages pull money"; revisit and consider a CallTracking "Page->CTA" relabel + landingPage column in the same small pass.
3. **CAPI enablement** when the owner produces the token — recovers ad-blocked/iOS Meta conversions; the client eventId plumbing already exists.

---
_This pass: display-only fixes; zero schema/write-path/Sheets/CAPI/public-UI/event-capture changes; zero PII. Gates: tsc 0 · 34/34 tests · build green. Not pushed pending operator approval._
